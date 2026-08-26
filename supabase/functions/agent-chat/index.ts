/**
 * @file agent-chat/index.ts
 * @description AI Agent 多轮对话 Edge Function
 * @endpoint POST /functions/v1/agent-chat
 *
 * 功能: 接收用户消息 → 加载对话历史 → 调用 OpenAI Chat API → 持久化消息 → 返回
 *
 * 🏛️ 架构师决策:
 *   - 与 analyze-drug 分离：不同职责（多轮对话 vs 单次分析）
 *   - 对话历史存 Supabase，上下文窗口限制最近 20 条
 *   - System prompt 注入用户当前用药列表，实现个性化
 *
 * 🔧 工程师实现:
 *   - 复用 _shared/openai.ts 的常量和工具
 *   - 使用 service_role key 读写 chat_messages
 *   - 主模型默认 gpt-5.4，备用模型默认 gpt-4.1
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateEmbedding } from '../_shared/openai.ts';
import { normalizeDrugName } from '../_shared/rxnorm.ts';
import { getDrugLabel } from '../_shared/dailymed.ts';
import { getAdverseEvents } from '../_shared/openfda.ts';
import {
    buildAgentStylePrompt,
    normalizeAgentStyle,
    type AgentStyle,
} from '../_shared/agent_style.ts';
import {
    getAgentRolloutStage,
    isAgentPersonalizationEnabled,
    isFeatureEnabled,
} from '../_shared/feature_rollout.ts';
import {
    inferActionPriority,
    mapThinkingPolicyToOpenAIReasoningEffort,
    requiresActionConfirmation,
    selectAgentThinkingPolicy,
    type AgentCommandName,
    type AgentConfirmationState,
    type AgentModelReasoningEffort,
    type AgentThinkingMode,
    type AgentThinkingModePreference,
} from '../_shared/agent_runtime/index.ts';

// CORS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt, x-trace-id',
};

type LogLevel = 'info' | 'warn' | 'error';

function createTraceId(req: Request): string {
    const header = req.headers.get('x-trace-id') || req.headers.get('X-Trace-Id');
    const normalized = header?.trim();
    if (normalized) return normalized.slice(0, 128);
    return crypto.randomUUID();
}

const DEFAULT_AGENT_CHAT_MODEL = 'gpt-5.4';
const DEFAULT_AGENT_CHAT_FALLBACK_MODEL = 'gpt-4.1';
const DEFAULT_AGENT_SUMMARY_MODEL = 'gpt-4.1';
const GPT_5_4_MIN_COMPLETION_TOKENS = 420;
const ACTION_PLANNING_CONTEXT_MAX_CHARS = 1800;
const SUPPORTED_ACTION_COMMANDS = new Set<AgentCommandName>([
    'medication_plan.apply_change_set',
    'medication_plan.create',
    'medication_plan.pause',
    'medication_log.confirm',
    'medication_log.miss',
    'medication_feedback.create',
    'health_profile.update',
    'settings.update',
]);

function traceJsonHeaders(traceId: string): Record<string, string> {
    return {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'x-trace-id': traceId,
    };
}

function logTrace(level: LogLevel, event: string, traceId: string, meta?: Record<string, unknown>) {
    const payload = {
        level,
        service: 'agent-chat',
        event,
        trace_id: traceId,
        ...meta,
    };
    const message = JSON.stringify(payload);
    if (level === 'error') {
        console.error(message);
        return;
    }
    if (level === 'warn') {
        console.warn(message);
        return;
    }
    console.log(message);
}

// =============================================
// 类型
// =============================================

interface ChatRequest {
    conversationId?: string;   // 空 = 新对话
    message: string;
    userId?: string;           // 兼容字段：服务端不再信任此字段
    userJwt?: string;          // 用户会话 JWT（网关兼容传递）
    language?: 'zh-CN' | 'zh-TW' | 'en';
    medications?: string[];    // 当前用药列表（前端注入）
    agentStyle?: AgentStyle;   // 当前会话期望风格（前端即时注入）
}

interface ChatResponse {
    success: boolean;
    conversationId: string;
    reply: string;
    thoughtMode?: AgentThinkingMode;
    thinkingPolicy?: {
        reasonCodes: string[];
        contextBudget: 'minimal' | 'full';
        modelReasoningEffort: AgentModelReasoningEffort;
        reasoningSummary: string;
    };
    usedPersonalContext?: boolean;
    pendingAction?: PendingActionResponse;
    styleUsed?: AgentStyle;
    contextUsed?: {
        sourceTags: string[];
        ragMatchCount: number;
        drugKnowledgeCount: number;
        fetchedAt: string;
    };
    error?: string;
}

interface DBMessage {
    role: string;
    content: string;
}

interface ConversationSummaryState {
    summary: string;
    summaryMessageCount: number;
    summaryUpdatedAt: string | null;
    supported: boolean;
}

interface HealthProfileRow {
    birth_date: string | null;
    gender: string | null;
    height_cm: number | null;
    weight_kg: number | null;
    medical_history: string | null;
    allergies: string | null;
}

interface UserProfilePreferenceRow {
    agent_style: string | null;
}

interface AgentRuntimePreferenceRow {
    thinking_mode_preference: AgentThinkingModePreference | null;
}

interface MedicationScheduleRow {
    id: string;
    medication_name: string;
    medication_dosage: string | null;
    frequency: string | null;
    instructions: string | null;
    reminders: unknown;
    status: string | null;
    start_date: string;
    end_date: string | null;
    source_record_id: string | null;
    updated_at: string;
    effective_status?: string | null;
    is_current?: boolean | null;
}

interface RagMatchRow {
    id: string;
    source_type: string;
    source_id: string | null;
    content: string;
    metadata: Record<string, unknown> | null;
    similarity: number;
    created_at: string;
}

interface MedicationLogRow {
    medication_name: string | null;
    status: string | null;
    scheduled_date: string | null;
    taken_at: string | null;
}

interface MedicationFeedbackRow {
    medication_name: string | null;
    mood: string | null;
    content: string | null;
    side_effects: string[] | null;
    created_at: string;
}

interface PrescriptionItemRow {
    medication_name: string | null;
    dosage: string | null;
    frequency: string | null;
    duration: string | null;
    instructions: string | null;
    confidence: number | null;
    created_at: string;
}

interface RecentDialogueRow {
    conversation_id: string;
    role: string;
    content: string;
    created_at: string;
}

interface DrugKnowledgeSnippet {
    medicationName: string;
    normalizedName?: string;
    summary: string;
}

type DrugKnowledgeType =
    | 'leaflet'
    | 'contraindication'
    | 'warning'
    | 'adverse_reaction'
    | 'food_interaction';

interface DrugKnowledgeChunkPayload {
    knowledgeType: DrugKnowledgeType;
    content: string;
    metadata?: Record<string, unknown>;
}

interface AgentActionPlan {
    shouldCreateRequest: boolean;
    commandName?: AgentCommandName;
    title?: string;
    summary?: string;
    impactDescription?: string;
    impactPoints?: string[];
    confirmHint?: string;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    payload?: Record<string, unknown>;
    reason?: string;
}

interface MedicationPlanChangeOperation {
    changeItemId?: string;
    draftId?: string;
    operationKind: 'create' | 'update' | 'pause' | 'archive' | 'keep';
    targetMedicationName?: string;
    targetScheduleId?: string;
    medicationName?: string;
    medicationDosage?: string;
    frequency?: string;
    instructions?: string;
    reminderTimes?: string[];
    startDate?: string;
    endDate?: string;
    notes?: string;
}

interface MedicationPlanChangeSetPlan {
    shouldCreateChangeSet: boolean;
    title?: string;
    summary?: string;
    effectiveDate?: string;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    confirmHint?: string;
    impactDescription?: string;
    impactPoints?: string[];
    operations: MedicationPlanChangeOperation[];
    reason?: string;
}

interface PendingActionResponse {
    requestId: string;
    changeSetId?: string;
    commandName: AgentCommandName;
    status: string;
    confirmationState: AgentConfirmationState;
    title: string;
    summary: string;
    impactDescription: string;
    impactPoints: string[];
    previewSections?: Array<{ title: string; items: string[] }>;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    confirmHint?: string;
    editablePlan?: {
        effectiveDate?: string;
        operations: MedicationPlanChangeOperation[];
    };
}

interface DrugKnowledgeSourceRow {
    id: string;
    medication_name: string;
    normalized_name: string | null;
    fetched_at: string | null;
}

interface DrugKnowledgeChunkRow {
    source_id: string;
    medication_name: string;
    normalized_name: string | null;
    knowledge_type: DrugKnowledgeType;
    chunk_index: number;
    content: string;
}

interface DrugKnowledgeMatchRow {
    source_id: string;
    medication_name: string;
    normalized_name: string | null;
    knowledge_type: DrugKnowledgeType;
    content: string;
    similarity: number;
    fetched_at: string | null;
}

interface RagContext {
    healthProfile: string;
    doctorPrescriptions: string;
    activeMedications: string;
    pastMedications: string;
    recentMedicationLogs: string;
    recentFeedback: string;
    futureMedicationPlan: string;
    recentDialogues: string;
    retrievedDocuments: string;
    drugKnowledge: string;
    sourceTags: string[];
    ragMatchCount: number;
    drugKnowledgeCount: number;
}

interface ContextCompressionResult {
    contextText: string;
    usedSourceTags: string[];
    droppedSections: string[];
}

interface OpenAIChatResult {
    data: OpenAIChatResponsePayload;
    model: string;
}

interface OpenAIChatChoice {
    message?: {
        content?: string;
    };
}

interface OpenAIChatUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
}

interface OpenAIChatResponsePayload {
    choices?: OpenAIChatChoice[];
    usage?: OpenAIChatUsage;
}

// =============================================
// Supabase 客户端
// =============================================

function getSupabaseClient() {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return null;
    return createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

function normalizeToken(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const value = raw.trim();
    if (!value) return null;
    const bearerMatch = value.match(/^Bearer\s+(.+)$/i);
    const token = bearerMatch ? bearerMatch[1] : value;
    return token.trim() || null;
}

function getBearerToken(req: Request): string | null {
    const userJwtHeader = normalizeToken(req.headers.get('x-user-jwt') || req.headers.get('X-User-Jwt'));
    if (userJwtHeader) {
        return userJwtHeader;
    }

    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader) return null;
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return normalizeToken(token);
}

async function getAuthenticatedUserId(
    supabase: ReturnType<typeof getSupabaseClient>,
    token: string | null
): Promise<string | null> {
    if (!supabase) return null;
    if (!token) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
        console.warn('[agent-chat] auth failed:', error?.message || 'no user');
        return null;
    }
    return data.user.id;
}

async function verifyConversationOwnership(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    conversationId: string;
    userId: string;
}): Promise<{ exists: boolean; hasError: boolean }> {
    const { supabase, conversationId, userId } = params;
    if (!supabase) return { exists: false, hasError: true };

    const { data, error } = await supabase
        .from('chat_conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('[agent-chat] verify conversation owner error:', error);
        return { exists: false, hasError: true };
    }

    return { exists: !!data, hasError: false };
}

function isMissingColumnError(error: { message?: string } | null | undefined, column: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('column') && message.includes(column.toLowerCase()) && message.includes('does not exist');
}

function isMissingRelationError(error: { message?: string } | null | undefined, relation: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('relation') && message.includes(relation.toLowerCase()) && message.includes('does not exist');
}

function normalizeThinkingModePreference(value: unknown): AgentThinkingModePreference {
    return value === 'fast' || value === 'slow' || value === 'auto' ? value : 'auto';
}

async function loadThinkingModePreference(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
}): Promise<AgentThinkingModePreference> {
    const { supabase, userId } = params;
    if (!supabase) return 'auto';

    const { data, error } = await supabase
        .from('agent_runtime_states')
        .select('thinking_mode_preference')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        if (!isMissingRelationError(error, 'agent_runtime_states')) {
            console.warn('[agent-chat] 读取思考模式偏好失败:', error.message);
        }
        return 'auto';
    }

    return normalizeThinkingModePreference((data as AgentRuntimePreferenceRow | null)?.thinking_mode_preference);
}

function buildRuntimeTriggerSignals(params: {
    forcePlanEvidence: boolean;
    includePastMedicationContext: boolean;
    pendingAction?: PendingActionResponse | null;
    policyReasonCodes?: string[];
}): string[] {
    const signals = new Set<string>();
    if (params.forcePlanEvidence) signals.add('medication_plan_question');
    if (params.includePastMedicationContext) signals.add('historical_medication_context');
    if (params.pendingAction) signals.add(`pending_action:${params.pendingAction.commandName}`);
    (params.policyReasonCodes || []).forEach((code) => signals.add(`policy:${code}`));
    return Array.from(signals);
}

async function countPendingActions(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
}): Promise<number> {
    const { supabase, userId } = params;
    if (!supabase) return 0;
    const { count, error } = await supabase
        .from('agent_action_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('request_status', ['pending', 'ready', 'running']);

    if (error) return 0;
    return Number(count || 0);
}

async function countActiveBackgroundTasks(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
}): Promise<number> {
    const { supabase, userId } = params;
    if (!supabase) return 0;
    const { count, error } = await supabase
        .from('agent_background_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('task_status', ['queued', 'running']);

    if (error) return 0;
    return Number(count || 0);
}

async function updateAgentRuntimeState(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    lifecycleStatus: 'ready' | 'thinking' | 'waiting_confirmation' | 'error';
    thinkingMode?: AgentThinkingMode;
    contextTags?: string[];
    triggerSignals?: string[];
    contextSummary?: string;
    lastError?: string | null;
}) {
    const {
        supabase,
        userId,
        lifecycleStatus,
        thinkingMode,
        contextTags,
        triggerSignals,
        contextSummary,
        lastError,
    } = params;
    if (!supabase) return;

    const [activeTaskCount, pendingActionCount] = await Promise.all([
        countActiveBackgroundTasks({ supabase, userId }),
        countPendingActions({ supabase, userId }),
    ]);

    const patch: Record<string, unknown> = {
        user_id: userId,
        lifecycle_status: lifecycleStatus,
        active_task_count: activeTaskCount,
        pending_action_count: pendingActionCount,
        background_status: {
            activeTaskCount,
            pendingActionCount,
        },
        last_interaction_at: new Date().toISOString(),
        last_error: lastError || null,
    };

    if (thinkingMode) patch.current_thinking_mode = thinkingMode;
    if (contextTags) patch.last_context_tags = contextTags;
    if (triggerSignals) patch.last_trigger_signals = triggerSignals;
    if (contextSummary !== undefined) patch.last_context_summary = contextSummary;

    const { error } = await supabase
        .from('agent_runtime_states')
        .upsert(patch, { onConflict: 'user_id' });

    if (error && !isMissingRelationError(error, 'agent_runtime_states')) {
        console.warn('[agent-chat] 更新 Agent runtime state 失败:', error.message);
    }
}

async function loadAgentStylePreference(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    requestStyle?: AgentStyle;
}): Promise<AgentStyle> {
    const { supabase, userId, requestStyle } = params;
    if (requestStyle) return normalizeAgentStyle(requestStyle);
    if (!supabase) return normalizeAgentStyle(null);

    const { data, error } = await supabase
        .from('user_profiles')
        .select('agent_style')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        if (!isMissingColumnError(error, 'agent_style')) {
            console.warn('[agent-chat] 读取助手风格失败:', error.message);
        }
        return normalizeAgentStyle(null);
    }

    return normalizeAgentStyle((data as UserProfilePreferenceRow | null)?.agent_style);
}

async function loadConversationSummaryState(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    conversationId: string;
    userId: string;
}): Promise<ConversationSummaryState> {
    const { supabase, conversationId, userId } = params;
    const emptyState: ConversationSummaryState = {
        summary: '',
        summaryMessageCount: 0,
        summaryUpdatedAt: null,
        supported: false,
    };
    if (!supabase) return emptyState;

    const { data, error } = await supabase
        .from('chat_conversations')
        .select('summary, summary_message_count, summary_updated_at')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        if (isMissingColumnError(error, 'summary') || isMissingColumnError(error, 'summary_message_count')) {
            return emptyState;
        }
        console.warn('[agent-chat] 读取会话摘要失败:', error.message);
        return emptyState;
    }
    if (!data) return emptyState;

    return {
        summary: typeof data.summary === 'string' ? data.summary.trim() : '',
        summaryMessageCount: Number(data.summary_message_count) || 0,
        summaryUpdatedAt: typeof data.summary_updated_at === 'string'
            ? data.summary_updated_at
            : null,
        supported: true,
    };
}

async function loadRecentConversationMessages(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    conversationId: string;
    limit: number;
}): Promise<DBMessage[]> {
    const { supabase, conversationId, limit } = params;
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.warn('[agent-chat] 加载历史消息失败:', error.message);
        return [];
    }

    const rows = (data || []) as DBMessage[];
    return rows.slice().reverse();
}

function getChatModelCandidates(): string[] {
    const primary = Deno.env.get('OPENAI_AGENT_CHAT_MODEL')
        || Deno.env.get('OPENAI_CHAT_MODEL')
        || DEFAULT_AGENT_CHAT_MODEL;
    const fallback = Deno.env.get('OPENAI_AGENT_CHAT_FALLBACK_MODEL')
        || Deno.env.get('OPENAI_FALLBACK_CHAT_MODEL')
        || DEFAULT_AGENT_CHAT_FALLBACK_MODEL;
    return Array.from(new Set([primary, fallback].filter(Boolean)));
}

function getSummaryModelCandidates(): string[] {
    const primary = Deno.env.get('OPENAI_AGENT_SUMMARY_MODEL')
        || Deno.env.get('OPENAI_SUMMARY_MODEL')
        || DEFAULT_AGENT_SUMMARY_MODEL;
    const fallback = Deno.env.get('OPENAI_AGENT_SUMMARY_FALLBACK_MODEL')
        || Deno.env.get('OPENAI_SUMMARY_FALLBACK_MODEL')
        || Deno.env.get('OPENAI_AGENT_CHAT_FALLBACK_MODEL')
        || Deno.env.get('OPENAI_FALLBACK_CHAT_MODEL')
        || DEFAULT_AGENT_CHAT_FALLBACK_MODEL;
    return Array.from(new Set([primary, fallback].filter(Boolean)));
}

function isGpt5ChatModel(model: string): boolean {
    return model.startsWith('gpt-5');
}

function buildOpenAIChatRequestBody(params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    maxTokens: number;
    reasoningEffort?: AgentModelReasoningEffort;
}): { body?: Record<string, unknown>; skipReason?: string } {
    const { model, messages, temperature, maxTokens, reasoningEffort = 'none' } = params;

    if (model === 'gpt-5-pro') {
        return {
            skipReason: 'gpt-5-pro 仅支持 /v1/responses，当前 agent-chat 仍使用 /v1/chat/completions',
        };
    }

    if (model === 'gpt-5.4') {
        return {
            body: {
                model,
                messages,
                max_completion_tokens: Math.max(maxTokens, GPT_5_4_MIN_COMPLETION_TOKENS),
                reasoning_effort: reasoningEffort,
            },
        };
    }

    if (isGpt5ChatModel(model)) {
        const safeReasoningEffort = reasoningEffort === 'none' ? 'minimal' : reasoningEffort;
        return {
            body: {
                model,
                messages,
                max_completion_tokens: maxTokens,
                reasoning_effort: safeReasoningEffort,
            },
        };
    }

    return {
        body: {
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
        },
    };
}

async function callOpenAIChat(params: {
    apiKey: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
    modelCandidates?: string[];
    reasoningEffort?: AgentModelReasoningEffort;
}): Promise<OpenAIChatResult> {
    const {
        apiKey,
        messages,
        temperature = 0.5,
        maxTokens = 800,
        modelCandidates,
        reasoningEffort = 'none',
    } = params;
    const models = modelCandidates && modelCandidates.length > 0
        ? modelCandidates
        : getChatModelCandidates();
    const errors: string[] = [];

    for (const model of models) {
        const requestConfig = buildOpenAIChatRequestBody({
            model,
            messages,
            temperature,
            maxTokens,
            reasoningEffort,
        });
        if (!requestConfig.body) {
            errors.push(`${model} skipped=${requestConfig.skipReason}`);
            console.warn(`[agent-chat] 跳过模型 (${model}):`, requestConfig.skipReason);
            continue;
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestConfig.body),
        });

        if (response.ok) {
            const data = await response.json();
            const content = clipText(data?.choices?.[0]?.message?.content, maxTokens * 4);
            if (!content) {
                const shortErr = `${model} status=200 err=empty_content`;
                errors.push(shortErr);
                console.warn(`[agent-chat] OpenAI 空回复 (${model})，自动尝试下一个模型`);
                continue;
            }
            return { data, model };
        }

        const errText = await response.text();
        const shortErr = `${model} status=${response.status} err=${errText.slice(0, 300)}`;
        errors.push(shortErr);
        console.error(`[agent-chat] OpenAI 错误 (${model}):`, errText);

        // 模型不可用/参数问题时继续尝试下一个模型；其它错误也记录后继续
        continue;
    }

    throw new Error(errors.join(' | '));
}

// =============================================
// System Prompt 构建
// =============================================

function formatHealthProfile(profile: HealthProfileRow | null): string {
    if (!profile) return '';

    const items: string[] = [];
    if (profile.gender) items.push(`性别: ${profile.gender}`);
    if (profile.birth_date) items.push(`出生日期: ${profile.birth_date}`);
    if (profile.height_cm) items.push(`身高: ${profile.height_cm}cm`);
    if (profile.weight_kg) items.push(`体重: ${profile.weight_kg}kg`);
    if (profile.medical_history) items.push(`病史: ${profile.medical_history.slice(0, 300)}`);
    if (profile.allergies) items.push(`过敏史: ${profile.allergies.slice(0, 300)}`);

    return items.join('\n');
}

function formatActiveMedications(schedules: MedicationScheduleRow[]): string {
    if (!schedules.length) return '';

    return schedules.slice(0, 10).map((item, index) => {
        const parts = [
            `${index + 1}. ${item.medication_name}`,
            item.medication_dosage ? `剂量: ${item.medication_dosage}` : '',
            item.frequency ? `频率: ${item.frequency}` : '',
            item.instructions ? `说明: ${item.instructions.slice(0, 120)}` : '',
        ].filter(Boolean);

        return parts.join(' | ');
    }).join('\n');
}

function formatRetrievedDocuments(matches: RagMatchRow[]): string {
    if (!matches.length) return '';

    return matches.map((doc, index) => {
        const sourceLabelMap: Record<string, string> = {
            chat_message: '历史对话',
            medication_feedback: '用药反馈',
            medication_schedule: '用药计划',
            health_profile: '健康档案',
            user_query: '历史查询',
        };
        const sourceLabel = sourceLabelMap[doc.source_type] || doc.source_type;
        const content = doc.content.replace(/\s+/g, ' ').slice(0, 300);
        const score = doc.similarity.toFixed(3);
        return `${index + 1}. [${sourceLabel} | 相似度:${score}] ${content}`;
    }).join('\n');
}

function formatPastMedications(schedules: MedicationScheduleRow[]): string {
    if (!schedules.length) return '';

    return schedules.slice(0, 8).map((item, index) => {
        const status = item.effective_status || item.status || 'unknown';
        const dateRange = `${item.start_date || '-'} ~ ${item.end_date || '至今'}`;
        return `${index + 1}. ${item.medication_name} | 状态: ${status} | 日期: ${dateRange}`;
    }).join('\n');
}

function clipText(text: string | null | undefined, max: number): string {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function formatDoctorPrescriptions(schedules: MedicationScheduleRow[]): string {
    if (!schedules.length) return '';
    return schedules.slice(0, 10).map((item, index) => {
        const parts = [
            `${index + 1}. ${item.medication_name}`,
            item.medication_dosage ? `剂量:${item.medication_dosage}` : '',
            item.frequency ? `频率:${item.frequency}` : '',
            item.instructions ? `医嘱:${clipText(item.instructions, 120)}` : '',
            `开始:${item.start_date}`,
            item.end_date ? `结束:${item.end_date}` : '结束:未设置',
        ].filter(Boolean);
        return parts.join(' | ');
    }).join('\n');
}

function formatPrescriptionItems(items: PrescriptionItemRow[]): string {
    if (!items.length) return '';
    return items.slice(0, 12).map((item, index) => {
        const name = item.medication_name || '未命名药物';
        const confidence = typeof item.confidence === 'number' ? Math.round(item.confidence * 100) : null;
        const parts = [
            `${index + 1}. ${name}`,
            item.dosage ? `剂量:${item.dosage}` : '',
            item.frequency ? `频率:${item.frequency}` : '',
            item.duration ? `疗程:${item.duration}` : '',
            item.instructions ? `医嘱:${clipText(item.instructions, 120)}` : '',
            confidence !== null ? `置信度:${confidence}%` : '',
        ].filter(Boolean);
        return parts.join(' | ');
    }).join('\n');
}

function formatMedicationLogs(logs: MedicationLogRow[]): string {
    if (!logs.length) return '';

    const byMedication = new Map<string, { taken: number; late: number; skipped: number; total: number }>();
    logs.forEach((log) => {
        const name = (log.medication_name || '未命名药物').trim();
        if (!name) return;
        const entry = byMedication.get(name) || { taken: 0, late: 0, skipped: 0, total: 0 };
        entry.total += 1;
        if (log.status === 'taken') entry.taken += 1;
        if (log.status === 'late') entry.late += 1;
        if (log.status === 'skipped') entry.skipped += 1;
        byMedication.set(name, entry);
    });

    return Array.from(byMedication.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 8)
        .map(([name, stat], index) => {
            const done = stat.taken + stat.late;
            const compliance = stat.total > 0 ? Math.round((done / stat.total) * 100) : 0;
            return `${index + 1}. ${name} | 近30天依从率:${compliance}% | 按时:${stat.taken} 延迟:${stat.late} 漏服:${stat.skipped}`;
        })
        .join('\n');
}

function formatMedicationFeedback(feedbackRows: MedicationFeedbackRow[]): string {
    if (!feedbackRows.length) return '';

    const moodCounter = { good: 0, neutral: 0, bad: 0 };
    const sideEffectCounter = new Map<string, number>();

    feedbackRows.forEach((item) => {
        const mood = item.mood as keyof typeof moodCounter;
        if (mood && moodCounter[mood] !== undefined) moodCounter[mood] += 1;
        (item.side_effects || []).forEach((effect) => {
            const key = effect.trim();
            if (!key) return;
            sideEffectCounter.set(key, (sideEffectCounter.get(key) || 0) + 1);
        });
    });

    const moodSummary = `近60天反馈情绪: good=${moodCounter.good}, neutral=${moodCounter.neutral}, bad=${moodCounter.bad}`;
    const topSideEffects = Array.from(sideEffectCounter.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([effect, count]) => `${effect}(${count})`)
        .join(', ');

    const latestFeedback = feedbackRows
        .slice(0, 5)
        .map((item, index) => `${index + 1}. ${item.medication_name || '未命名药物'} | ${item.mood || '未知'} | ${clipText(item.content, 80)}`)
        .join('\n');

    return [
        moodSummary,
        topSideEffects ? `高频副作用: ${topSideEffects}` : '',
        latestFeedback ? `近期反馈:\n${latestFeedback}` : '',
    ].filter(Boolean).join('\n');
}

function parseDateKey(dateText: string | null | undefined): string | null {
    if (!dateText) return null;
    const normalized = dateText.includes('T') ? dateText.split('T')[0] : dateText;
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function dateKeyOffset(baseDate: Date, days: number): string {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

function getReminderTimes(reminders: unknown): string[] {
    if (!Array.isArray(reminders)) return [];

    return reminders
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const row = item as { time?: unknown };
            return typeof row.time === 'string' && row.time.length >= 4
                ? row.time.slice(0, 5)
                : null;
        })
        .filter((time): time is string => !!time)
        .slice(0, 6);
}

function formatFutureMedicationPlan(schedules: MedicationScheduleRow[], todayKey: string): string {
    if (!schedules.length) return '';

    const horizon = dateKeyOffset(new Date(`${todayKey}T00:00:00Z`), 3);
    const lines: string[] = [];

    for (const schedule of schedules) {
        const effectiveStatus = String(schedule.effective_status || schedule.status || 'active').toLowerCase();
        if (['paused', 'cancelled', 'completed'].includes(effectiveStatus)) continue;

        const start = parseDateKey(schedule.start_date) || todayKey;
        const end = parseDateKey(schedule.end_date) || horizon;
        if (start > horizon || end < todayKey) continue;

        const effectiveStart = start < todayKey ? todayKey : start;
        const effectiveEnd = end > horizon ? horizon : end;
        const reminderTimes = getReminderTimes(schedule.reminders);
        const reminderText = reminderTimes.length ? reminderTimes.join(', ') : '未配置提醒时间';

        lines.push(
            `${schedule.medication_name} | 日期:${effectiveStart}~${effectiveEnd} | 提醒:${reminderText} | 剂量:${schedule.medication_dosage || '未设置'}`
        );
        if (lines.length >= 8) break;
    }

    return lines.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function formatRecentDialogues(rows: RecentDialogueRow[]): string {
    if (!rows.length) return '';

    return rows
        .slice(0, 8)
        .map((item, index) => `${index + 1}. ${item.role}: ${clipText(item.content, 120)}`)
        .join('\n');
}

function uniqueStringList(values: string[]): string[] {
    const set = new Set<string>();
    values.forEach((value) => {
        const normalized = value.trim();
        if (!normalized) return;
        if (!set.has(normalized)) set.add(normalized);
    });
    return Array.from(set);
}

function includesKeyword(text: string, keywords: string[]): boolean {
    const normalized = text.toLowerCase();
    return keywords.some((keyword) => normalized.includes(keyword));
}

function shouldUseCrossConversationContext(message: string): boolean {
    return includesKeyword(message, [
        '上次',
        '之前',
        '先前',
        '继续',
        '接着',
        '延续',
        '刚才那个',
        '之前那个',
        '历史',
        'follow up',
        'continue',
        'previous',
        'last time',
        'earlier',
    ]);
}

function shouldIncludeHistoricalMedicationContext(message: string): boolean {
    return includesKeyword(message, [
        '历史用药',
        '以前吃过',
        '之前吃过',
        '曾经吃过',
        '过去用过',
        '停药',
        '停用了',
        '结束的药',
        'completed',
        'stopped',
        'previous medication',
        'past medication',
        'used to take',
    ]);
}

const DRUG_KNOWLEDGE_CACHE_TTL_HOURS = 24;
const DRUG_KNOWLEDGE_CHUNK_MAX = 480;
const CONVERSATION_HISTORY_LIMIT = 12;
const CONVERSATION_SUMMARY_BATCH_SIZE = 10;
const CONVERSATION_SUMMARY_MIN_NEW_MESSAGES = 4;
const CONVERSATION_SUMMARY_MAX_LENGTH = 1600;
const PROMPT_CONTEXT_TOTAL_BUDGET = 5600;
const SUPPORTED_DRUG_KNOWLEDGE_TYPES: DrugKnowledgeType[] = [
    'leaflet',
    'contraindication',
    'warning',
    'adverse_reaction',
    'food_interaction',
];

function pickMedicationTargets(params: {
    message: string;
    activeSchedules: MedicationScheduleRow[];
    prescriptionSchedules: MedicationScheduleRow[];
    prescriptionItems?: PrescriptionItemRow[];
    medications?: string[];
}): string[] {
    const { message, activeSchedules, prescriptionSchedules, prescriptionItems, medications } = params;
    const activeNames = activeSchedules.map((item) => item.medication_name || '');
    const currentPrescriptionNames = prescriptionSchedules.map((item) => item.medication_name || '');
    const pool = uniqueStringList([
        ...(medications || []),
        ...activeNames,
        ...currentPrescriptionNames,
    ]);

    if (pool.length === 0) return [];

    const lowerMessage = message.toLowerCase();
    const mentioned = pool.filter((name) => lowerMessage.includes(name.toLowerCase()));
    const explicitlyMentionedHistorical = (prescriptionItems || [])
        .map((item) => item.medication_name || '')
        .filter((name) => !!name && lowerMessage.includes(String(name).toLowerCase()));
    const ordered = uniqueStringList([...mentioned, ...explicitlyMentionedHistorical, ...pool]);
    return ordered.slice(0, 2);
}

function splitTextForKnowledge(text: string, maxLen: number = DRUG_KNOWLEDGE_CHUNK_MAX): string[] {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    if (normalized.length <= maxLen) return [normalized];

    const chunks: string[] = [];
    let cursor = 0;
    while (cursor < normalized.length) {
        const end = Math.min(cursor + maxLen, normalized.length);
        chunks.push(normalized.slice(cursor, end));
        cursor = end;
    }
    return chunks;
}

async function sha256Hex(input: string): Promise<string> {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const arr = Array.from(new Uint8Array(digest));
    return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isKnowledgeSourceFresh(fetchedAt: string | null): boolean {
    if (!fetchedAt) return false;
    const ts = new Date(fetchedAt).getTime();
    if (Number.isNaN(ts)) return false;
    const ttlMs = DRUG_KNOWLEDGE_CACHE_TTL_HOURS * 60 * 60 * 1000;
    return Date.now() - ts < ttlMs;
}

function buildKnowledgeChunksFromApiResult(params: {
    medicationName: string;
    normalizedName?: string;
    labelResult: Awaited<ReturnType<typeof getDrugLabel>>;
    adverseResult: Awaited<ReturnType<typeof getAdverseEvents>>;
}): DrugKnowledgeChunkPayload[] {
    const { labelResult, adverseResult } = params;
    const chunks: DrugKnowledgeChunkPayload[] = [];

    const pushChunks = (knowledgeType: DrugKnowledgeType, rawText: string | null | undefined, metadata?: Record<string, unknown>) => {
        const text = (rawText || '').trim();
        if (!text) return;
        splitTextForKnowledge(text).forEach((part) => {
            chunks.push({
                knowledgeType,
                content: part,
                metadata,
            });
        });
    };

    const indications = clipText(labelResult.keySections?.indications?.text, 1800);
    const dosage = clipText(labelResult.keySections?.dosage?.text, 1800);
    const leafletText = [indications ? `适应症: ${indications}` : '', dosage ? `用法用量: ${dosage}` : '']
        .filter(Boolean)
        .join('\n');
    pushChunks('leaflet', leafletText, {
        source: 'dailymed',
        set_id: labelResult.label?.setId || null,
    });

    pushChunks(
        'contraindication',
        clipText(labelResult.keySections?.contraindications?.text, 2000),
        { source: 'dailymed', set_id: labelResult.label?.setId || null }
    );

    pushChunks(
        'warning',
        clipText(labelResult.keySections?.warnings?.text, 2000),
        { source: 'dailymed', set_id: labelResult.label?.setId || null }
    );

    const adverseTextFromLabel = clipText(labelResult.keySections?.adverseReactions?.text, 1800);
    const topReactions = adverseResult.success
        ? (adverseResult.adverseEvents?.topReactions || []).slice(0, 8).map((item, index) =>
            `${index + 1}. ${item.term} (${item.count})`
        ).join('; ')
        : '';
    const adverseText = [
        adverseTextFromLabel ? `说明书不良反应: ${adverseTextFromLabel}` : '',
        topReactions ? `OpenFDA高频不良反应: ${topReactions}` : '',
    ].filter(Boolean).join('\n');
    pushChunks('adverse_reaction', adverseText, {
        source: 'dailymed_openfda',
        openfda_total_reports: adverseResult.adverseEvents?.totalReports || 0,
    });

    const interactionText = clipText(labelResult.keySections?.drugInteractions?.text, 2000);
    pushChunks('food_interaction', interactionText, {
        source: 'dailymed',
        set_id: labelResult.label?.setId || null,
    });

    return chunks
        .filter((item) => SUPPORTED_DRUG_KNOWLEDGE_TYPES.includes(item.knowledgeType));
}

async function fetchDrugKnowledgeFromApis(params: {
    medicationName: string;
    openfdaApiKey?: string;
}): Promise<{
    medicationName: string;
    normalizedName?: string;
    sourceKey: string;
    sourceUrl?: string;
    publishedAt?: string;
    payload: Record<string, unknown>;
    chunks: DrugKnowledgeChunkPayload[];
    snippet: DrugKnowledgeSnippet | null;
} | null> {
    const { medicationName, openfdaApiKey } = params;

    try {
        let normalizedName = medicationName;
        let rxcui: string | undefined;

        const normalized = await normalizeDrugName(medicationName);
        if (normalized.success) {
            normalizedName = normalized.normalizedName || medicationName;
            rxcui = normalized.rxcui;
        }

        const [labelResult, adverseResult] = await Promise.all([
            rxcui ? getDrugLabel(rxcui, true) : getDrugLabel(normalizedName, false),
            getAdverseEvents(normalizedName, openfdaApiKey),
        ]);

        const chunks = buildKnowledgeChunksFromApiResult({
            medicationName,
            normalizedName,
            labelResult,
            adverseResult,
        });
        if (chunks.length === 0) return null;

        const topReaction = adverseResult.success
            ? adverseResult.adverseEvents?.topReactions?.[0]
            : undefined;
        const summary = [
            clipText(labelResult.keySections?.contraindications?.text, 180)
                ? `禁忌: ${clipText(labelResult.keySections?.contraindications?.text, 180)}`
                : '',
            clipText(labelResult.keySections?.warnings?.text, 180)
                ? `警告: ${clipText(labelResult.keySections?.warnings?.text, 180)}`
                : '',
            clipText(labelResult.keySections?.drugInteractions?.text, 180)
                ? `食物/相互作用: ${clipText(labelResult.keySections?.drugInteractions?.text, 180)}`
                : '',
            topReaction
                ? `OpenFDA高频反应: ${topReaction.term}(${topReaction.count})`
                : '',
        ].filter(Boolean).join(' | ');

        return {
            medicationName,
            normalizedName: normalizedName !== medicationName ? normalizedName : undefined,
            sourceKey: `${normalizedName || medicationName}:${labelResult.label?.setId || 'na'}`,
            sourceUrl: labelResult.label?.setId
                ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${labelResult.label.setId}`
                : undefined,
            publishedAt: labelResult.label?.effectiveTime || undefined,
            payload: {
                normalized_name: normalizedName,
                rxcui: rxcui || null,
                label: labelResult,
                adverse: adverseResult,
            },
            chunks,
            snippet: summary
                ? {
                    medicationName,
                    normalizedName: normalizedName !== medicationName ? normalizedName : undefined,
                    summary,
                }
                : null,
        };
    } catch (error) {
        console.warn('[agent-chat] 药物说明书检索失败:', medicationName, error);
        return null;
    }
}

async function getLatestDrugKnowledgeSource(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    medicationName: string;
}): Promise<DrugKnowledgeSourceRow | null> {
    const { supabase, medicationName } = params;
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('drug_knowledge_sources')
        .select('id, medication_name, normalized_name, fetched_at')
        .ilike('medication_name', medicationName)
        .order('fetched_at', { ascending: false })
        .limit(1);

    if (error) {
        console.warn('[agent-chat] 查询药物知识缓存失败:', error.message);
        return null;
    }
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0] as DrugKnowledgeSourceRow;
}

async function sourceHasKnowledgeChunks(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    sourceId: string;
}): Promise<boolean> {
    const { supabase, sourceId } = params;
    if (!supabase) return false;
    const { data, error } = await supabase
        .from('drug_knowledge_chunks')
        .select('id')
        .eq('source_id', sourceId)
        .limit(1);

    if (error) {
        console.warn('[agent-chat] 查询药物知识分块失败:', error.message);
        return false;
    }

    return Array.isArray(data) && data.length > 0;
}

async function persistDrugKnowledgeSnapshot(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    openaiApiKey: string;
    snapshot: NonNullable<Awaited<ReturnType<typeof fetchDrugKnowledgeFromApis>>>;
}): Promise<void> {
    const { supabase, openaiApiKey, snapshot } = params;
    if (!supabase) return;
    const nowIso = new Date().toISOString();
    const fullText = snapshot.chunks.map((item) => `${item.knowledgeType}:${item.content}`).join('\n');
    const contentHash = await sha256Hex(fullText);

    const { data: sourceRow, error: sourceError } = await supabase
        .from('drug_knowledge_sources')
        .upsert({
            medication_name: snapshot.medicationName,
            normalized_name: snapshot.normalizedName || null,
            source_provider: 'dailymed_openfda',
            source_key: snapshot.sourceKey,
            source_url: snapshot.sourceUrl || null,
            fetched_at: nowIso,
            published_at: snapshot.publishedAt || null,
            content_hash: contentHash,
            payload: snapshot.payload,
        }, {
            onConflict: 'medication_name,source_provider,source_key',
        })
        .select('id')
        .single();

    if (sourceError || !sourceRow?.id) {
        console.warn('[agent-chat] 写入药物知识来源失败:', sourceError?.message || 'unknown');
        return;
    }

    const sourceId = sourceRow.id as string;
    const { error: clearError } = await supabase
        .from('drug_knowledge_chunks')
        .delete()
        .eq('source_id', sourceId);
    if (clearError) {
        console.warn('[agent-chat] 清理旧药物知识分块失败:', clearError.message);
    }

    const chunkRows = [];
    for (let index = 0; index < snapshot.chunks.length; index += 1) {
        const chunk = snapshot.chunks[index];
        const embedding = await generateEmbedding(chunk.content.slice(0, 2000), openaiApiKey);
        chunkRows.push({
            source_id: sourceId,
            medication_name: snapshot.medicationName,
            normalized_name: snapshot.normalizedName || null,
            knowledge_type: chunk.knowledgeType,
            chunk_index: index,
            content: chunk.content,
            embedding,
            metadata: chunk.metadata || {},
        });
    }

    if (chunkRows.length === 0) return;
    const { error: chunkInsertError } = await supabase
        .from('drug_knowledge_chunks')
        .insert(chunkRows);

    if (chunkInsertError) {
        console.warn('[agent-chat] 写入药物知识分块失败:', chunkInsertError.message);
    }
}

async function ensureDrugKnowledgeCache(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    medicationNames: string[];
    openaiApiKey: string;
    openfdaApiKey?: string;
}): Promise<DrugKnowledgeSnippet[]> {
    const { supabase, medicationNames, openaiApiKey, openfdaApiKey } = params;
    const snippets: DrugKnowledgeSnippet[] = [];

    for (const medicationName of medicationNames) {
        const latestSource = await getLatestDrugKnowledgeSource({ supabase, medicationName });
        const hasFreshCache = latestSource
            ? isKnowledgeSourceFresh(latestSource.fetched_at) && await sourceHasKnowledgeChunks({
                supabase,
                sourceId: latestSource.id,
            })
            : false;
        if (hasFreshCache) continue;

        const snapshot = await fetchDrugKnowledgeFromApis({ medicationName, openfdaApiKey });
        if (!snapshot) continue;
        await persistDrugKnowledgeSnapshot({
            supabase,
            openaiApiKey,
            snapshot,
        });
        if (snapshot.snippet) snippets.push(snapshot.snippet);
    }

    return snippets;
}

async function loadCachedDrugKnowledgeSnippets(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    medicationNames: string[];
}): Promise<DrugKnowledgeSnippet[]> {
    const { supabase, medicationNames } = params;
    const snippets: DrugKnowledgeSnippet[] = [];
    if (!supabase) return snippets;

    for (const medicationName of medicationNames) {
        const latestSource = await getLatestDrugKnowledgeSource({ supabase, medicationName });
        if (!latestSource?.id) continue;

        const { data, error } = await supabase
            .from('drug_knowledge_chunks')
            .select('source_id, medication_name, normalized_name, knowledge_type, chunk_index, content')
            .eq('source_id', latestSource.id)
            .in('knowledge_type', SUPPORTED_DRUG_KNOWLEDGE_TYPES)
            .order('chunk_index', { ascending: true })
            .limit(24);

        if (error) {
            console.warn('[agent-chat] 读取缓存药物知识分块失败:', error.message);
            continue;
        }

        const rows = (data || []) as DrugKnowledgeChunkRow[];
        if (rows.length === 0) continue;

        const byType = new Map<DrugKnowledgeType, string>();
        rows.forEach((row) => {
            if (!row.content || byType.has(row.knowledge_type)) return;
            byType.set(row.knowledge_type, row.content);
        });

        const labelMap: Record<DrugKnowledgeType, string> = {
            leaflet: '说明书',
            contraindication: '禁忌',
            warning: '警示',
            adverse_reaction: '不良反应',
            food_interaction: '食物相互作用',
        };
        const summary = SUPPORTED_DRUG_KNOWLEDGE_TYPES
            .filter((type) => byType.has(type))
            .slice(0, 4)
            .map((type) => `${labelMap[type]}: ${clipText(byType.get(type), 180)}`)
            .join(' | ');

        if (!summary) continue;
        snippets.push({
            medicationName: rows[0].medication_name || medicationName,
            normalizedName: rows[0].normalized_name || undefined,
            summary,
        });
    }

    return snippets;
}

async function searchDrugKnowledgeChunks(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    queryEmbedding: number[] | null;
    medicationNames: string[];
}): Promise<DrugKnowledgeMatchRow[]> {
    const { supabase, queryEmbedding, medicationNames } = params;
    if (!supabase || !queryEmbedding || medicationNames.length === 0) return [];

    const { data, error } = await supabase.rpc('match_drug_knowledge_chunks', {
        query_embedding: queryEmbedding,
        medication_names: medicationNames,
        knowledge_types: SUPPORTED_DRUG_KNOWLEDGE_TYPES,
        match_threshold: 0.42,
        match_count: 10,
    });

    if (error) {
        console.warn('[agent-chat] 药物知识向量检索失败:', error.message);
        return [];
    }
    return (data || []) as DrugKnowledgeMatchRow[];
}

function formatDrugKnowledgeMatchesToSnippets(matches: DrugKnowledgeMatchRow[]): DrugKnowledgeSnippet[] {
    if (!matches.length) return [];
    const grouped = new Map<string, DrugKnowledgeMatchRow[]>();
    matches.forEach((item) => {
        const key = item.normalized_name || item.medication_name;
        const list = grouped.get(key) || [];
        list.push(item);
        grouped.set(key, list);
    });

    const snippets: DrugKnowledgeSnippet[] = [];
    grouped.forEach((rows, key) => {
        const sorted = rows
            .slice()
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 4);

        const summary = sorted
            .map((row) => {
                const labelMap: Record<DrugKnowledgeType, string> = {
                    leaflet: '说明书',
                    contraindication: '禁忌',
                    warning: '警示',
                    adverse_reaction: '不良反应',
                    food_interaction: '食物相互作用',
                };
                return `${labelMap[row.knowledge_type] || row.knowledge_type}: ${clipText(row.content, 180)}`;
            })
            .join(' | ');

        snippets.push({
            medicationName: rows[0].medication_name || key,
            normalizedName: rows[0].normalized_name || undefined,
            summary,
        });
    });

    return snippets;
}

function formatDrugKnowledge(snippets: DrugKnowledgeSnippet[]): string {
    if (!snippets.length) return '';

    return snippets.map((item, index) => {
        const name = item.normalizedName
            ? `${item.medicationName} (${item.normalizedName})`
            : item.medicationName;
        return `${index + 1}. ${name} | ${clipText(item.summary, 500)}`;
    }).join('\n');
}

function formatConversationSummaryBlock(summaryState: ConversationSummaryState): string {
    if (!summaryState.summary) return '';
    const dateLabel = summaryState.summaryUpdatedAt
        ? new Date(summaryState.summaryUpdatedAt).toISOString().split('T')[0]
        : '';
    const header = dateLabel
        ? `会话摘要（更新于 ${dateLabel}）`
        : '会话摘要';
    return `${header}: ${clipText(summaryState.summary, 1200)}`;
}

function createEmptyRagContext(): RagContext {
    return {
        healthProfile: '',
        doctorPrescriptions: '',
        activeMedications: '',
        pastMedications: '',
        recentMedicationLogs: '',
        recentFeedback: '',
        futureMedicationPlan: '',
        recentDialogues: '',
        retrievedDocuments: '',
        drugKnowledge: '',
        sourceTags: [],
        ragMatchCount: 0,
        drugKnowledgeCount: 0,
    };
}

function buildMinimalRagContext(medications?: string[]): RagContext {
    const context = createEmptyRagContext();
    const medList = Array.isArray(medications)
        ? medications.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [];
    if (medList.length > 0) {
        context.activeMedications = medList.map((item, index) => `${index + 1}. ${item}`).join('\n');
        context.sourceTags = ['medication_schedule'];
    }
    return context;
}

function isMedicationPlanQuestion(message: string): boolean {
    const content = (message || '').toLowerCase();
    if (!content) return false;
    const keywords = [
        '用药计划', '服药计划', '吃药计划', '提醒', '按时吃药', '下一次服药', '什么时候吃',
        '漏服', '补服', '打卡', '计划调整', '今日用药', '今天吃什么药',
        'medication plan', 'dose plan', 'schedule', 'reminder', 'next dose', 'when should i take',
        'missed dose', 'adherence',
    ];
    return keywords.some((item) => content.includes(item));
}

function isMedicationPlanChangeRequest(message: string): boolean {
    const content = (message || '').toLowerCase();
    if (!content) return false;
    const keywords = [
        '调整用药计划', '更新用药计划', '删减和增加用药计划', '删掉', '停用', '停掉', '取消提醒', '新增', '加上',
        '更新我的用药计划', '按照医生要求', '按医生要求', '改成', '保留', '继续', '不要吃', '从今天开始',
        'update my medication plan', 'adjust medication plan', 'stop taking', 'add medication', 'remove medication',
        'change reminders', 'from today', 'doctor said',
    ];
    return keywords.some((item) => content.includes(item));
}

function isMedicationPlanConfirmationReply(message: string, historyMessages: DBMessage[]): boolean {
    const content = (message || '').trim().toLowerCase();
    if (!content) return false;

    const confirmSignals = [
        '确认', '確定', '确定', '好的', '好', '可以', '就这样', '就這樣', '按这个', '按這個', '照这个', '照這個',
        '没问题', '沒問題', '行', '是的', '对', '對', 'ok', 'okay', 'yes', 'confirm',
    ];

    const latestAssistantMessage = [...historyMessages]
        .reverse()
        .find((item) => item.role === 'assistant' && String(item.content || '').trim());

    if (!latestAssistantMessage) return false;

    const latestContent = String(latestAssistantMessage.content || '').toLowerCase();
    const latestHasPlanContext = [
        '用药计划', '用藥計劃', '服药计划', '服藥計劃', '调整', '調整', '停用', '新增', '保留', '更新',
        '提醒时间', '提醒時間', '从今天开始', '從今天開始', '确认具体', '確認具體', '请确认', '請確認',
    ].some((keyword) => latestContent.includes(keyword));

    return latestHasPlanContext && confirmSignals.some((signal) => content.includes(signal));
}

function buildPlannerHistoryContext(historyMessages: DBMessage[]): string {
    const recentMessages = historyMessages
        .filter((item) => item.role === 'user' || item.role === 'assistant')
        .slice(-6);

    if (recentMessages.length === 0) return '';

    return recentMessages
        .map((item, index) => `${index + 1}. ${item.role === 'assistant' ? '助手' : '用户'}：${String(item.content || '').trim()}`)
        .join('\n');
}

function extractJsonObject(text: string): string | null {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
        return fencedMatch[1].trim();
    }

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return raw.slice(start, end + 1);
}

function firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) return normalized;
    }
    return '';
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function normalizeMedicationFeedbackActionPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | null {
    const source = payload || {};
    const medicationName = firstNonEmptyString(
        source.medicationName,
        source.medication_name,
        source.medication,
        source.drugName,
        source.drug_name
    );
    const content = firstNonEmptyString(
        source.content,
        source.feedbackContent,
        source.feedback_content,
        source.feedback,
        source.note,
        source.notes,
        source.symptomDescription,
        source.symptoms
    );

    if (!medicationName || !content) return null;

    const feedbackDate = firstNonEmptyString(source.feedbackDate, source.feedback_date, source.date);
    const scheduleId = firstNonEmptyString(source.scheduleId, source.schedule_id);
    const mood = firstNonEmptyString(source.mood, source.feeling);
    const sideEffects = normalizeStringList(source.sideEffects ?? source.side_effects);

    return {
        ...source,
        medicationName,
        content,
        ...(feedbackDate ? { feedbackDate } : {}),
        ...(scheduleId ? { scheduleId } : {}),
        ...(mood ? { mood } : {}),
        ...(sideEffects.length > 0 ? { sideEffects } : {}),
    };
}

function normalizeAgentActionPlan(plan: AgentActionPlan): AgentActionPlan {
    if (!plan?.shouldCreateRequest || !plan.commandName) return plan;

    if (plan.commandName === 'medication_feedback.create') {
        const normalizedPayload = normalizeMedicationFeedbackActionPayload(plan.payload);
        if (!normalizedPayload) {
            return {
                shouldCreateRequest: false,
                reason: 'missing_required_payload:medication_feedback.create',
            };
        }

        return {
            ...plan,
            payload: normalizedPayload,
        };
    }

    return plan;
}

function getCurrentDateKey(): string {
    return new Date().toISOString().split('T')[0];
}

function compareDateKeys(left: string, right: string): number {
    return left.localeCompare(right);
}

function addDaysToDateKey(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().split('T')[0];
}

function addMonthsToDateKey(dateKey: string, months: number): string {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() + months);
    return date.toISOString().split('T')[0];
}

function parseSimpleChineseNumber(value: string): number | null {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (/^\d+$/.test(normalized)) return Number(normalized);

    const digitMap: Record<string, number> = {
        一: 1,
        两: 2,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
        十: 10,
    };

    if (digitMap[normalized] !== undefined) return digitMap[normalized];
    if (normalized.length === 2 && normalized.startsWith('十')) {
        return 10 + (digitMap[normalized[1]] || 0);
    }
    if (normalized.length === 2 && normalized.endsWith('十')) {
        return (digitMap[normalized[0]] || 0) * 10;
    }
    if (normalized.length === 3 && normalized[1] === '十') {
        return (digitMap[normalized[0]] || 0) * 10 + (digitMap[normalized[2]] || 0);
    }

    return null;
}

function hasExplicitMedicationPlanStartDate(message: string): boolean {
    const content = String(message || '').trim();
    if (!content) return false;

    return [
        /\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/,
        /\d{1,2}月\d{1,2}[日号]/,
        /(?:从|自|由|starting|start(?:ing)? from)\s*(?:今天|今日|明天|后天|大后天|\d{4}|\d{1,2}月|\d{1,2}[日号]|下周|下月|next|tomorrow|today)/i,
        /(?:今天|今日|明天|后天|大后天|下周|下个月|下月|本周|本月|周[一二三四五六日天]|星期[一二三四五六日天]|today|tomorrow|next week|next month)/i,
    ].some((pattern) => pattern.test(content));
}

function inferMedicationPlanEndDate(message: string, startDate: string): string | null {
    const content = String(message || '').trim();
    if (!content || !startDate) return null;

    const monthMatch = content.match(/([一二两三四五六七八九十\d]+)\s*(?:个)?月/);
    if (monthMatch?.[1]) {
        const months = parseSimpleChineseNumber(monthMatch[1]);
        if (months && months > 0) {
            return addDaysToDateKey(addMonthsToDateKey(startDate, months), -1);
        }
    }

    const weekMatch = content.match(/([一二两三四五六七八九十\d]+)\s*(?:周|星期|week)s?/i);
    if (weekMatch?.[1]) {
        const weeks = parseSimpleChineseNumber(weekMatch[1]);
        if (weeks && weeks > 0) {
            return addDaysToDateKey(startDate, weeks * 7 - 1);
        }
    }

    const dayMatch = content.match(/([一二两三四五六七八九十\d]+)\s*(?:天|日|day)s?/i);
    if (dayMatch?.[1]) {
        const days = parseSimpleChineseNumber(dayMatch[1]);
        if (days && days > 0) {
            return addDaysToDateKey(startDate, days - 1);
        }
    }

    return null;
}

function normalizeMedicationPlanChangeSetPlan(
    plan: MedicationPlanChangeSetPlan,
    message: string,
    currentDate: string
): MedicationPlanChangeSetPlan {
    if (!plan?.shouldCreateChangeSet || !Array.isArray(plan.operations) || plan.operations.length === 0) {
        return plan;
    }

    const userSpecifiedStartDate = hasExplicitMedicationPlanStartDate(message);
    const parsedEffectiveDate = parseDateKey(plan.effectiveDate || '');
    const effectiveDate = !parsedEffectiveDate
        ? currentDate
        : (!userSpecifiedStartDate && compareDateKeys(parsedEffectiveDate, currentDate) < 0)
            ? currentDate
            : parsedEffectiveDate;
    const inferredEndDate = inferMedicationPlanEndDate(message, effectiveDate);

    return {
        ...plan,
        effectiveDate,
        operations: plan.operations.map((operation) => {
            const parsedStartDate = parseDateKey(operation.startDate || '');
            const startDate = !parsedStartDate
                ? effectiveDate
                : (!userSpecifiedStartDate && compareDateKeys(parsedStartDate, currentDate) < 0)
                    ? effectiveDate
                    : parsedStartDate;
            const parsedEndDate = parseDateKey(operation.endDate || '');
            const endDate = parsedEndDate && compareDateKeys(parsedEndDate, startDate) >= 0
                ? parsedEndDate
                : inferredEndDate || undefined;

            return {
                ...operation,
                startDate,
                endDate,
            };
        }),
    };
}

async function planAgentAction(params: {
    apiKey: string;
    message: string;
    language: string;
    compressedContext: ContextCompressionResult;
}): Promise<AgentActionPlan | null> {
    const { apiKey, message, language, compressedContext } = params;
    const contextPreview = clipText(compressedContext.contextText, ACTION_PLANNING_CONTEXT_MAX_CHARS);
    const languageHint = language === 'en'
        ? 'Output JSON values in English.'
        : language === 'zh-TW'
            ? '請以繁體中文填寫 title/summary/impactDescription/confirmHint。'
            : '请以简体中文填写 title/summary/impactDescription/confirmHint。';

    const plannerMessages = [
        {
            role: 'system',
            content: `你是 App 动作规划器。你的职责是判断用户是否明确要求 Agent 代为执行 App 内动作，而不是单纯问答。仅允许以下命令名：medication_plan.create, medication_plan.pause, medication_log.confirm, medication_log.miss, medication_feedback.create, health_profile.update, settings.update。medication_feedback.create payload 必须使用 {"medicationName":"药物名","content":"反馈正文","feedbackDate":"YYYY-MM-DD 可选","mood":"good|neutral|bad 可选","sideEffects":["副作用"] 可选,"scheduleId":"计划ID 可选"}。禁止编造缺失字段；如果信息不足，必须返回 shouldCreateRequest=false。只输出 JSON。${languageHint}`,
        },
        {
            role: 'user',
            content: `用户消息:\n${message}\n\n可用上下文摘要:\n${contextPreview || '(无)'}\n\n输出 JSON，格式为：{"shouldCreateRequest":boolean,"commandName":"...","title":"...","summary":"...","impactDescription":"...","impactPoints":["..."],"confirmHint":"...","riskLevel":"low|medium|high|critical","payload":{},"reason":"..."}`,
        },
    ];

    try {
        const result = await callOpenAIChat({
            apiKey,
            messages: plannerMessages,
            temperature: 0.1,
            maxTokens: 360,
            modelCandidates: getSummaryModelCandidates(),
        });
        const raw = String(result.data?.choices?.[0]?.message?.content || '');
        const jsonText = extractJsonObject(raw);
        if (!jsonText) return null;
        const parsed = JSON.parse(jsonText) as AgentActionPlan;
        if (!parsed || !parsed.shouldCreateRequest || !parsed.commandName) {
            return parsed || null;
        }
        if (!SUPPORTED_ACTION_COMMANDS.has(parsed.commandName)) {
            return {
                shouldCreateRequest: false,
                reason: `unsupported_command:${String(parsed.commandName)}`,
            };
        }
        return normalizeAgentActionPlan(parsed);
    } catch (error) {
        console.warn('[agent-chat] action planner failed:', error);
        return null;
    }
}

async function planMedicationChangeSet(params: {
    apiKey: string;
    message: string;
    language: string;
    compressedContext: ContextCompressionResult;
    historyMessages: DBMessage[];
    isConfirmationReply?: boolean;
}): Promise<MedicationPlanChangeSetPlan | null> {
    const { apiKey, message, language, compressedContext, historyMessages, isConfirmationReply = false } = params;
    const contextPreview = clipText(compressedContext.contextText, ACTION_PLANNING_CONTEXT_MAX_CHARS);
    const historyPreview = clipText(buildPlannerHistoryContext(historyMessages), 1400);
    const currentDate = getCurrentDateKey();
    const languageHint = language === 'en'
        ? 'Output title/summary/notes in English.'
        : language === 'zh-TW'
            ? '請以繁體中文輸出 title/summary/impactDescription/confirmHint/notes。'
            : '请以简体中文输出 title/summary/impactDescription/confirmHint/notes。';

    const plannerMessages = [
        {
            role: 'system',
            content: `你是用药计划变更集规划器。你的职责是把用户明确要求 Agent 执行的“多步计划调整”转换成变更集。当前日期是 ${currentDate}。禁止把未执行的内容说成已执行。只允许 operationKind 使用 create/update/pause/archive/keep。新增用药计划至少需要药物名、每次用量/剂量、频率或提醒时间；品牌确认、厂家、医生补充建议不是执行必填项，不得因为这些可选信息阻塞预览。若真正缺少执行必填字段，则返回 shouldCreateChangeSet=false。用户没有明确指定开始日期时，effectiveDate 和 create/update 的 startDate 必须使用当前日期 ${currentDate}，禁止猜测历史日期。用户给出“吃一个月/7天/两周”等疗程时，请基于 startDate 计算 endDate。对于“停用某药 + 新增某药 + 保留其他药”这类请求，必须输出多条 operations。若当前用户消息只是“确认/就按这个”等确认口令，你必须结合最近对话里已经确认过的具体细则直接生成最终变更集，不得再要求第 3 轮确认。只输出 JSON。${languageHint}`,
        },
        {
            role: 'user',
            content: `当前用户消息:\n${message}\n\n是否为“细则已确认后的第 2 轮最终确认”:\n${isConfirmationReply ? '是' : '否'}\n\n最近对话:\n${historyPreview || '(无)'}\n\n当前上下文摘要:\n${contextPreview || '(无)'}\n\n输出 JSON，格式为：{"shouldCreateChangeSet":boolean,"title":"...","summary":"...","effectiveDate":"YYYY-MM-DD","riskLevel":"low|medium|high|critical","confirmHint":"...","impactDescription":"...","impactPoints":["..."],"operations":[{"operationKind":"create|update|pause|archive|keep","targetMedicationName":"...","targetScheduleId":"...","medicationName":"...","medicationDosage":"...","frequency":"...","instructions":"...","reminderTimes":["07:00","13:00"],"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","notes":"..."}],"reason":"..."}`,
        },
    ];

    try {
        const result = await callOpenAIChat({
            apiKey,
            messages: plannerMessages,
            temperature: 0.1,
            maxTokens: 700,
            modelCandidates: getSummaryModelCandidates(),
        });
        const raw = String(result.data?.choices?.[0]?.message?.content || '');
        const jsonText = extractJsonObject(raw);
        if (!jsonText) return null;
        const parsed = JSON.parse(jsonText) as MedicationPlanChangeSetPlan;
        if (!parsed || !parsed.shouldCreateChangeSet || !Array.isArray(parsed.operations) || parsed.operations.length === 0) {
            return parsed || null;
        }
        parsed.operations = parsed.operations
            .filter((operation) => !!operation && typeof operation === 'object')
            .map((operation) => ({
                ...operation,
                changeItemId: String(operation.changeItemId || '').trim() || undefined,
                draftId: String(operation.draftId || '').trim() || crypto.randomUUID(),
                reminderTimes: Array.isArray(operation.reminderTimes)
                    ? operation.reminderTimes.map((item) => String(item)).filter((item) => /^\d{2}:\d{2}$/.test(item))
                    : [],
            }))
            .filter((operation) => ['create', 'update', 'pause', 'archive', 'keep'].includes(String(operation.operationKind)));
        if (parsed.operations.length === 0) {
            return {
                shouldCreateChangeSet: false,
                operations: [],
                reason: 'no_supported_operations',
            };
        }
        return normalizeMedicationPlanChangeSetPlan(parsed, message, currentDate);
    } catch (error) {
        console.warn('[agent-chat] medication change set planner failed:', error);
        return null;
    }
}

function buildChangeSetPreviewSections(plan: MedicationPlanChangeSetPlan): Array<{ title: string; items: string[] }> {
    const sections: Array<{ title: string; items: string[] }> = [];
    const groups: Array<{
        title: string;
        operationKinds: MedicationPlanChangeOperation['operationKind'][];
    }> = [
            { title: '将停用的计划', operationKinds: ['archive', 'pause'] },
            { title: '将新增的计划', operationKinds: ['create'] },
            { title: '将更新的计划', operationKinds: ['update'] },
            { title: '将保留的计划', operationKinds: ['keep'] },
        ];

    groups.forEach((group) => {
        const items = plan.operations
            .filter((operation) => group.operationKinds.includes(operation.operationKind))
            .map((operation) => {
                const name = operation.medicationName || operation.targetMedicationName || '未命名药物';
                const detailParts = [
                    operation.medicationDosage ? `剂量 ${operation.medicationDosage}` : '',
                    operation.frequency ? `频率 ${operation.frequency}` : '',
                    Array.isArray(operation.reminderTimes) && operation.reminderTimes.length > 0
                        ? `提醒 ${operation.reminderTimes.join(', ')}`
                        : '',
                    operation.notes ? operation.notes : '',
                ].filter(Boolean);
                return detailParts.length > 0 ? `${name}：${detailParts.join('，')}` : name;
            });

        if (items.length > 0) {
            sections.push({
                title: group.title,
                items,
            });
        }
    });

    return sections;
}

async function createMedicationPlanChangeSet(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    conversationId?: string;
    requestId: string;
    plan: MedicationPlanChangeSetPlan;
    activeSchedules: MedicationScheduleRow[];
}): Promise<{
    changeSetId: string;
    previewSections: Array<{ title: string; items: string[] }>;
    editablePlan: {
        effectiveDate?: string;
        operations: MedicationPlanChangeOperation[];
    };
} | null> {
    const { supabase, userId, conversationId, requestId, plan, activeSchedules } = params;
    if (!supabase) return null;

    const previewSections = buildChangeSetPreviewSections(plan);
    const effectiveDate = parseDateKey(plan.effectiveDate) || new Date().toISOString().split('T')[0];

    const { data: changeSet, error: changeSetError } = await supabase
        .from('medication_plan_change_sets')
        .insert({
            user_id: userId,
            request_id: requestId,
            conversation_id: conversationId || null,
            title: plan.title || '待确认的用药计划变更',
            summary: plan.summary || '',
            effective_date: effectiveDate,
            change_status: 'pending',
            preview_payload: {
                previewSections,
                impactDescription: plan.impactDescription || '',
                impactPoints: plan.impactPoints || [],
                riskLevel: plan.riskLevel || 'medium',
            },
        })
        .select('id')
        .single();

    if (changeSetError || !changeSet?.id) {
        console.warn('[agent-chat] create change set failed:', changeSetError?.message || 'unknown');
        return null;
    }

    const items = plan.operations.map((operation, index) => {
        const matchedSchedule = activeSchedules.find((schedule) => {
            const currentName = (schedule.medication_name || '').trim().toLowerCase();
            const targetName = String(operation.targetMedicationName || operation.medicationName || '').trim().toLowerCase();
            return currentName.length > 0 && targetName.length > 0 && currentName === targetName;
        });

        return {
            change_set_id: changeSet.id,
            user_id: userId,
            sort_order: index,
            operation_kind: operation.operationKind,
            target_schedule_id: operation.targetScheduleId || matchedSchedule?.id || null,
            medication_name: operation.medicationName || operation.targetMedicationName || null,
            medication_dosage: operation.medicationDosage || null,
            frequency: operation.frequency || null,
            instructions: operation.instructions || null,
            reminder_times: operation.reminderTimes || [],
            start_date: parseDateKey(operation.startDate || '') || effectiveDate,
            end_date: parseDateKey(operation.endDate || '') || null,
            status_after: operation.operationKind === 'archive'
                ? 'completed'
                : operation.operationKind === 'pause'
                    ? 'paused'
                    : 'active',
            notes: operation.notes || null,
            payload: {
                targetMedicationName: operation.targetMedicationName || null,
            },
        };
    });

    const { data: insertedItems, error: itemsError } = await supabase
        .from('medication_plan_change_items')
        .insert(items)
        .select('id, sort_order');

    if (itemsError) {
        console.warn('[agent-chat] create change set items failed:', itemsError.message);
        await supabase
            .from('medication_plan_change_sets')
            .delete()
            .eq('id', changeSet.id)
            .eq('user_id', userId);
        return null;
    }

    const insertedItemIds = Array.isArray(insertedItems)
        ? [...insertedItems].sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
        : [];

    return {
        changeSetId: changeSet.id,
        previewSections,
        editablePlan: {
            effectiveDate,
            operations: plan.operations.map((operation, index) => ({
                ...operation,
                changeItemId: String(insertedItemIds[index]?.id || '').trim() || undefined,
                draftId: String(operation.draftId || '').trim() || crypto.randomUUID(),
                startDate: parseDateKey(operation.startDate || '') || effectiveDate,
                endDate: parseDateKey(operation.endDate || '') || undefined,
            })),
        },
    };
}

async function createMedicationPlanChangeRequest(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    conversationId?: string;
    thinkingMode: AgentThinkingMode;
    plan: MedicationPlanChangeSetPlan;
    activeSchedules: MedicationScheduleRow[];
    contextSnapshot?: Record<string, unknown>;
}): Promise<PendingActionResponse | null> {
    const {
        supabase,
        userId,
        conversationId,
        thinkingMode,
        plan,
        activeSchedules,
        contextSnapshot,
    } = params;
    if (!supabase) return null;

    const previewSections = buildChangeSetPreviewSections(plan);
    const snapshot = {
        ...(contextSnapshot || {}),
        ui: {
            impactDescription: plan.impactDescription || plan.summary || '',
            impactPoints: plan.impactPoints || [],
            previewSections,
            confirmHint: plan.confirmHint || '',
            riskLevel: plan.riskLevel || 'medium',
            editablePlan: {
                effectiveDate: parseDateKey(plan.effectiveDate || '') || new Date().toISOString().split('T')[0],
                operations: plan.operations.map((operation) => ({
                    ...operation,
                    draftId: String(operation.draftId || '').trim() || crypto.randomUUID(),
                })),
            },
        },
    };

    const { data: requestRow, error: requestError } = await supabase
        .from('agent_action_requests')
        .insert({
            user_id: userId,
            conversation_id: conversationId || null,
            command_name: 'medication_plan.apply_change_set',
            thinking_mode: thinkingMode,
            confirmation_state: 'required',
            request_status: 'pending',
            priority: inferActionPriority('medication_plan.apply_change_set'),
            title: plan.title || '待确认的用药计划变更',
            summary: plan.summary || '',
            payload: {},
            context_snapshot: snapshot,
            requires_confirmation: true,
        })
        .select('id, command_name, request_status, confirmation_state, title, summary, payload, context_snapshot')
        .single();

    if (requestError || !requestRow?.id) {
        console.warn('[agent-chat] create plan change request failed:', requestError?.message || 'unknown');
        return null;
    }

    const changeSet = await createMedicationPlanChangeSet({
        supabase,
        userId,
        conversationId,
        requestId: requestRow.id,
        plan,
        activeSchedules,
    });

    if (!changeSet?.changeSetId) {
        await supabase
            .from('agent_action_requests')
            .delete()
            .eq('id', requestRow.id)
            .eq('user_id', userId);
        return null;
    }

    await supabase
        .from('agent_action_requests')
        .update({
            payload: {
                changeSetId: changeSet.changeSetId,
            },
            context_snapshot: {
                ...snapshot,
                ui: {
                    ...(snapshot.ui || {}),
                    previewSections: changeSet.previewSections,
                    editablePlan: changeSet.editablePlan,
                },
            },
        })
        .eq('id', requestRow.id)
        .eq('user_id', userId);

    await supabase.from('agent_action_logs').insert({
        user_id: userId,
        request_id: requestRow.id,
        command_name: 'medication_plan.apply_change_set',
        action_status: 'pending',
        message: '已生成待确认的用药计划变更集。',
        detail: {
            change_set_id: changeSet.changeSetId,
            operation_count: plan.operations.length,
        },
    });

    const ui = (snapshot.ui || {}) as Record<string, unknown>;
    return {
        requestId: requestRow.id,
        changeSetId: changeSet.changeSetId,
        commandName: 'medication_plan.apply_change_set',
        status: String(requestRow.request_status || 'pending'),
        confirmationState: requestRow.confirmation_state,
        title: String(requestRow.title || plan.title || '待确认的用药计划变更'),
        summary: String(requestRow.summary || plan.summary || ''),
        impactDescription: String(ui.impactDescription || ''),
        impactPoints: Array.isArray(ui.impactPoints) ? ui.impactPoints.map((item) => String(item)) : [],
        previewSections: changeSet.previewSections,
        riskLevel: (String(ui.riskLevel || 'medium') as PendingActionResponse['riskLevel']),
        confirmHint: String(ui.confirmHint || '') || undefined,
        editablePlan: changeSet.editablePlan,
    };
}

async function createAgentActionRequest(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    conversationId?: string;
    thinkingMode: AgentThinkingMode;
    commandName: AgentCommandName;
    title: string;
    summary: string;
    payload?: Record<string, unknown>;
    contextSnapshot?: Record<string, unknown>;
    impactDescription?: string;
    impactPoints?: string[];
    previewSections?: Array<{ title: string; items: string[] }>;
    changeSetId?: string;
    confirmHint?: string;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}): Promise<PendingActionResponse | null> {
    const {
        supabase,
        userId,
        conversationId,
        thinkingMode,
        commandName,
        title,
        summary,
        payload,
        contextSnapshot,
        impactDescription,
        impactPoints,
        previewSections,
        changeSetId,
        confirmHint,
        riskLevel,
    } = params;
    if (!supabase) return null;

    const snapshot = {
        ...(contextSnapshot || {}),
        ui: {
            impactDescription: impactDescription || summary,
            impactPoints: impactPoints || [],
            previewSections: previewSections || [],
            confirmHint: confirmHint || '',
            riskLevel: riskLevel || 'medium',
        },
    };

    const confirmationState: AgentConfirmationState = requiresActionConfirmation(commandName)
        ? 'required'
        : 'skipped';

    const { data, error } = await supabase
        .from('agent_action_requests')
        .insert({
            user_id: userId,
            conversation_id: conversationId || null,
            command_name: commandName,
            thinking_mode: thinkingMode,
            confirmation_state: confirmationState,
            request_status: 'pending',
            priority: inferActionPriority(commandName),
            title,
            summary,
            payload: {
                ...(payload || {}),
                ...(changeSetId ? { changeSetId } : {}),
            },
            context_snapshot: snapshot,
            requires_confirmation: requiresActionConfirmation(commandName),
        })
        .select('id, command_name, request_status, confirmation_state, title, summary, payload, context_snapshot')
        .single();

    if (error || !data) {
        console.warn('[agent-chat] create agent action request failed:', error?.message || 'unknown');
        return null;
    }

    await supabase.from('agent_action_logs').insert({
        user_id: userId,
        request_id: data.id,
        command_name: commandName,
        action_status: 'pending',
        message: '已生成待确认的 Agent 动作请求。',
        detail: {
            reason: 'planned_from_chat',
        },
    });

    const ui = (data.context_snapshot?.ui || {}) as Record<string, unknown>;
    return {
        requestId: data.id,
        changeSetId: String((data.payload?.changeSetId || changeSetId || '') || '') || undefined,
        commandName: data.command_name,
        status: String(data.request_status || 'pending'),
        confirmationState: data.confirmation_state,
        title: String(data.title || title),
        summary: String(data.summary || summary),
        impactDescription: String(ui.impactDescription || impactDescription || summary),
        impactPoints: Array.isArray(ui.impactPoints) ? ui.impactPoints.map((item) => String(item)) : [],
        previewSections: Array.isArray(ui.previewSections)
            ? ui.previewSections.map((section) => {
                const record = section as Record<string, unknown>;
                return {
                    title: String(record.title || ''),
                    items: Array.isArray(record.items)
                        ? record.items.map((item) => String(item)).filter(Boolean)
                        : [],
                };
            })
            : [],
        riskLevel: (String(ui.riskLevel || riskLevel || 'medium') as PendingActionResponse['riskLevel']),
        confirmHint: String(ui.confirmHint || confirmHint || '') || undefined,
    };
}

async function logContextAccess(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    conversationId?: string;
    requestId?: string;
    thinkingMode: AgentThinkingMode;
    sourceTags: string[];
    accessScope: string;
    accessReason: string;
}) {
    const { supabase, userId, conversationId, requestId, thinkingMode, sourceTags, accessScope, accessReason } = params;
    if (!supabase || sourceTags.length === 0) return;

    const rows = sourceTags.map((tag) => ({
        user_id: userId,
        request_id: requestId || null,
        conversation_id: conversationId || null,
        thinking_mode: thinkingMode,
        access_scope: accessScope,
        source_tag: tag,
        access_reason: accessReason,
    }));

    const { error } = await supabase
        .from('agent_context_access_logs')
        .insert(rows);
    if (error) {
        console.warn('[agent-chat] context access log failed:', error.message);
    }
}



function buildPrioritizedContext(params: {
    ragContext: RagContext;
    summaryState: ConversationSummaryState;
    medications?: string[];
    includePastMedications?: boolean;
}): ContextCompressionResult {
    const { ragContext, summaryState, medications, includePastMedications = false } = params;
    const fallbackMedicationList = !ragContext.activeMedications && Array.isArray(medications) && medications.length > 0
        ? medications.slice(0, 8).map((item, index) => `${index + 1}. ${item}`).join('\n')
        : '';

    const currentMedicationAndProfileText = [
        ragContext.activeMedications || (fallbackMedicationList ? `前端上报用药:\n${fallbackMedicationList}` : ''),
        ragContext.healthProfile,
    ].filter(Boolean).join('\n');

    const historyAndPrivateRagText = [
        formatConversationSummaryBlock(summaryState),
        ragContext.recentDialogues,
        ragContext.retrievedDocuments,
    ].filter(Boolean).join('\n');

    const blocks: Array<{
        key: string;
        title: string;
        content: string;
        maxChars: number;
        tags: string[];
    }> = [
            {
                key: 'doctor',
                title: '医生处方与医嘱（最高优先级）',
                content: ragContext.doctorPrescriptions,
                maxChars: 1200,
                tags: ['doctor_prescription'],
            },
            {
                key: 'profile',
                title: '当前活跃用药与健康档案',
                content: currentMedicationAndProfileText,
                maxChars: 1400,
                tags: ['medication_schedule', 'health_profile'],
            },
            {
                key: 'adherence',
                title: '近期服药记录与反馈',
                content: [ragContext.recentMedicationLogs, ragContext.recentFeedback].filter(Boolean).join('\n'),
                maxChars: 1200,
                tags: ['medication_logs', 'medication_feedback'],
            },
            {
                key: 'future',
                title: '未来用药计划',
                content: ragContext.futureMedicationPlan,
                maxChars: 850,
                tags: ['medication_schedule'],
            },
            ...(includePastMedications ? [{
                key: 'past_medications',
                title: '历史或已结束用药（仅在用户明确询问历史时参考）',
                content: ragContext.pastMedications,
                maxChars: 700,
                tags: ['medication_schedule'],
            }] : []),
            {
                key: 'history',
                title: '历史对话与私有检索',
                content: historyAndPrivateRagText,
                maxChars: 1000,
                tags: ['conversation_summary', 'chat_history', 'rag_retrieval'],
            },
            {
                key: 'drug_knowledge',
                title: '药物知识库检索',
                content: ragContext.drugKnowledge,
                maxChars: 900,
                tags: ['drug_knowledge_rag', 'drug_label_api'],
            },
        ];

    const availableTags = new Set<string>(ragContext.sourceTags);
    if (summaryState.summary) {
        availableTags.add('conversation_summary');
    }

    let usedChars = 0;
    const sections: string[] = [];
    const droppedSections: string[] = [];
    const usedSourceTags = new Set<string>();
    let sectionIndex = 1;

    blocks.forEach((block) => {
        const raw = block.content.trim();
        if (!raw) return;

        const remaining = PROMPT_CONTEXT_TOTAL_BUDGET - usedChars;
        if (remaining < 120) {
            droppedSections.push(block.key);
            return;
        }

        const clipped = clipText(raw, Math.min(block.maxChars, remaining));
        if (!clipped) return;

        sections.push(`### ${sectionIndex}. ${block.title}\n${clipped}`);
        sectionIndex += 1;
        usedChars += clipped.length;

        block.tags.forEach((tag) => {
            if (availableTags.has(tag)) usedSourceTags.add(tag);
        });
    });

    return {
        contextText: sections.join('\n\n'),
        usedSourceTags: Array.from(usedSourceTags),
        droppedSections,
    };
}

async function loadRagContext(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId?: string;
    message: string;
    openaiApiKey: string;
    medications?: string[];
}): Promise<RagContext> {
    const { supabase, userId, message, openaiApiKey, medications } = params;
    const sourceTags = new Set<string>();
    const context: RagContext = createEmptyRagContext();
    const allowCrossConversationContext = shouldUseCrossConversationContext(message);
    const allowHistoricalMedicationContext = shouldIncludeHistoricalMedicationContext(message);

    if (!supabase || !userId) {
        return context;
    }

    const today = new Date().toISOString().split('T')[0];
    const recentLogSince = dateKeyOffset(new Date(`${today}T00:00:00Z`), -30);
    const recentFeedbackSince = dateKeyOffset(new Date(`${today}T00:00:00Z`), -60);

    // 2.1) 结构化数据：健康档案
    const { data: profileData, error: profileError } = await supabase
        .from('health_profiles')
        .select('birth_date, gender, height_cm, weight_kg, medical_history, allergies')
        .eq('user_id', userId)
        .maybeSingle();

    if (profileError) {
        console.warn('[agent-chat] 健康档案读取失败:', profileError.message);
    }
    context.healthProfile = formatHealthProfile(profileData as HealthProfileRow | null);
    if (context.healthProfile) {
        sourceTags.add('health_profile');
    }

    // 2.2) 结构化数据：处方/用药计划
    const { data: projectedSchedulesData, error: projectedSchedulesError } = await supabase
        .rpc('get_medication_schedule_projection', {
            target_user_id: userId,
            as_of_date: today,
        });

    const { data: schedulesData, error: schedulesError } = projectedSchedulesError
        ? await supabase
            .from('medication_schedules')
            .select('id, medication_name, medication_dosage, frequency, instructions, reminders, status, start_date, end_date, source_record_id, updated_at')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(80)
        : { data: projectedSchedulesData, error: null };

    if (schedulesError) {
        console.warn('[agent-chat] 用药计划读取失败:', schedulesError.message);
    }

    const allSchedules = (schedulesData || []) as MedicationScheduleRow[];
    const activeSchedules = allSchedules.filter((item) =>
        item.is_current === true
        || (
            typeof item.is_current !== 'boolean'
            && (item.status === 'active' || item.status === null)
            && (item.start_date || today) <= today
            && (!item.end_date || item.end_date >= today)
        )
    );
    const prescriptionSchedules = activeSchedules.filter((item) => !!item.source_record_id);
    const pastSchedules = allSchedules.filter((item) => {
        if (activeSchedules.some((active) => active.id === item.id)) return false;

        const effectiveStatus = String(item.effective_status || item.status || 'active').toLowerCase();
        const startDate = parseDateKey(item.start_date) || item.start_date || today;
        const endDate = parseDateKey(item.end_date || '') || item.end_date || null;
        const isFutureScheduled = effectiveStatus === 'scheduled'
            || (
                startDate > today
                && !['paused', 'cancelled', 'completed'].includes(effectiveStatus)
            );

        if (isFutureScheduled) return false;
        return ['paused', 'cancelled', 'completed'].includes(effectiveStatus) || (!!endDate && endDate < today);
    });

    const { data: prescriptionRows, error: prescriptionError } = await supabase
        .from('prescription_items')
        .select('medication_name, dosage, frequency, duration, instructions, confidence, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(40);

    if (prescriptionError) {
        console.warn('[agent-chat] 处方明细读取失败:', prescriptionError.message);
    }

    const activeMedicationNames = new Set(
        activeSchedules.map((item) => (item.medication_name || '').trim().toLowerCase()).filter(Boolean)
    );
    const currentPrescriptionItems = ((prescriptionRows || []) as PrescriptionItemRow[])
        .filter((item) => activeMedicationNames.has(String(item.medication_name || '').trim().toLowerCase()));
    const schedulePrescriptionText = formatDoctorPrescriptions(prescriptionSchedules);
    const itemPrescriptionText = formatPrescriptionItems(currentPrescriptionItems);
    context.doctorPrescriptions = [schedulePrescriptionText, itemPrescriptionText]
        .filter((item) => !!item)
        .join('\n');
    context.activeMedications = formatActiveMedications(activeSchedules);
    context.pastMedications = formatPastMedications(pastSchedules);
    context.futureMedicationPlan = formatFutureMedicationPlan(allSchedules, today);

    if (context.doctorPrescriptions) sourceTags.add('doctor_prescription');
    if (context.activeMedications || context.pastMedications || context.futureMedicationPlan) {
        sourceTags.add('medication_schedule');
    }

    // 2.3) 结构化数据：服药日志
    const { data: logRows, error: logsError } = await supabase
        .from('medication_logs')
        .select('medication_name, status, scheduled_date, taken_at')
        .eq('user_id', userId)
        .gte('scheduled_date', recentLogSince)
        .in('status', ['taken', 'late', 'skipped'])
        .order('scheduled_date', { ascending: false })
        .limit(500);

    if (logsError) {
        console.warn('[agent-chat] 用药日志读取失败:', logsError.message);
    }
    context.recentMedicationLogs = formatMedicationLogs((logRows || []) as MedicationLogRow[]);
    if (context.recentMedicationLogs) sourceTags.add('medication_logs');

    // 2.4) 结构化数据：用药反馈
    const { data: feedbackRows, error: feedbackError } = await supabase
        .from('medication_feedback')
        .select('medication_name, mood, content, side_effects, created_at')
        .eq('user_id', userId)
        .gte('feedback_date', recentFeedbackSince)
        .order('created_at', { ascending: false })
        .limit(120);

    if (feedbackError) {
        console.warn('[agent-chat] 用药反馈读取失败:', feedbackError.message);
    }
    context.recentFeedback = formatMedicationFeedback((feedbackRows || []) as MedicationFeedbackRow[]);
    if (context.recentFeedback) sourceTags.add('medication_feedback');

    // 2.5) 结构化数据：跨会话历史
    if (allowCrossConversationContext) {
        const { data: recentConversations } = await supabase
            .from('chat_conversations')
            .select('id')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(6);

        const recentConversationIds = (recentConversations || []).map((item) => item.id).filter(Boolean);
        if (recentConversationIds.length > 0) {
            const { data: recentMessages, error: dialogueError } = await supabase
                .from('chat_messages')
                .select('conversation_id, role, content, created_at')
                .in('conversation_id', recentConversationIds)
                .order('created_at', { ascending: false })
                .limit(40);

            if (dialogueError) {
                console.warn('[agent-chat] 历史对话读取失败:', dialogueError.message);
            } else {
                context.recentDialogues = formatRecentDialogues((recentMessages || []) as RecentDialogueRow[]);
                if (context.recentDialogues) sourceTags.add('chat_history');
            }
        }
    }

    // 3) 私有RAG：向量检索用户私有文档
    let queryEmbedding: number[] | null = null;
    try {
        queryEmbedding = await generateEmbedding(message.slice(0, 2000), openaiApiKey);
        const { data: ragMatches, error: ragError } = await supabase.rpc('match_rag_documents', {
            query_embedding: queryEmbedding,
            target_user_id: userId,
            source_types: allowCrossConversationContext
                ? ['chat_message', 'medication_feedback', 'medication_schedule', 'health_profile', 'user_query']
                : ['medication_feedback', 'medication_schedule', 'health_profile', 'user_query'],
            match_threshold: 0.65,
            match_count: 8,
        });

        if (ragError) {
            console.error('[agent-chat] RAG检索失败:', ragError);
        } else {
            const matches = ((ragMatches || []) as RagMatchRow[]).filter((item) => {
                if (item.source_type !== 'medication_schedule') return true;
                if (allowHistoricalMedicationContext) return true;

                const isActive = item.metadata?.is_active;
                return isActive !== false && isActive !== 'false';
            });
            context.retrievedDocuments = formatRetrievedDocuments(matches);
            context.ragMatchCount = matches.length;
            console.log(`[agent-chat] RAG召回 ${matches.length} 条文档`);
            if (matches.length > 0) sourceTags.add('rag_retrieval');
        }
    } catch (err) {
        console.error('[agent-chat] RAG embedding失败:', err);
    }

    // 4) 全局药物知识RAG：API缓存 + 向量检索
    const medicationTargets = pickMedicationTargets({
        message,
        activeSchedules,
        prescriptionSchedules,
        prescriptionItems: (prescriptionRows || []) as PrescriptionItemRow[],
        medications,
    });

    if (medicationTargets.length > 0) {
        const openfdaApiKey = Deno.env.get('OPENFDA_API_KEY') || undefined;
        const apiSnippets = await ensureDrugKnowledgeCache({
            supabase,
            medicationNames: medicationTargets,
            openaiApiKey,
            openfdaApiKey,
        });

        const matchedChunks = await searchDrugKnowledgeChunks({
            supabase,
            queryEmbedding,
            medicationNames: medicationTargets,
        });

        const ragSnippets = formatDrugKnowledgeMatchesToSnippets(matchedChunks);
        const cachedSnippets = await loadCachedDrugKnowledgeSnippets({
            supabase,
            medicationNames: medicationTargets,
        });
        const allSnippets = ragSnippets.length > 0
            ? ragSnippets
            : (apiSnippets.length > 0 ? apiSnippets : cachedSnippets);

        if (allSnippets.length > 0) {
            context.drugKnowledge = formatDrugKnowledge(allSnippets);
            context.drugKnowledgeCount = allSnippets.length;
            sourceTags.add('drug_label_api');
            if (ragSnippets.length > 0) {
                sourceTags.add('drug_knowledge_rag');
            }
        }
    }

    context.sourceTags = Array.from(sourceTags);
    return context;
}

async function saveChatMessageToRag(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    messageId?: string | null;
    language: string;
    openaiApiKey: string;
}) {
    const { supabase, userId, conversationId, role, content, messageId, language, openaiApiKey } = params;
    if (!supabase || !content.trim()) return;

    const embedding = await generateEmbedding(content.slice(0, 2000), openaiApiKey);
    const payload = {
        user_id: userId,
        source_type: 'chat_message',
        source_id: messageId || null,
        content: content.slice(0, 5000),
        embedding,
        metadata: {
            conversation_id: conversationId,
            role,
            language,
        },
    };

    const { error } = messageId
        ? await supabase
            .from('rag_documents')
            .upsert(payload, { onConflict: 'user_id,source_type,source_id' })
        : await supabase
            .from('rag_documents')
            .insert(payload);

    if (error) {
        console.error('[agent-chat] 写入rag_documents失败:', error);
    }
}

function formatMessagesForSummary(messages: DBMessage[]): string {
    if (!messages.length) return '';
    return messages
        .map((item, index) => {
            const role = item.role === 'assistant' ? '助手' : item.role === 'system' ? '系统' : '用户';
            return `${index + 1}. ${role}: ${clipText(item.content, 220)}`;
        })
        .join('\n');
}

async function refreshConversationSummary(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    conversationId: string;
    openaiApiKey: string;
    language: string;
}): Promise<void> {
    const { supabase, userId, conversationId, openaiApiKey, language } = params;
    if (!supabase) return;

    const summaryState = await loadConversationSummaryState({
        supabase,
        conversationId,
        userId,
    });
    if (!summaryState.supported) return;

    const from = Math.max(0, summaryState.summaryMessageCount);
    const to = from + CONVERSATION_SUMMARY_BATCH_SIZE - 1;
    const { data: deltaMessages, error: deltaError } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .range(from, to);

    if (deltaError) {
        console.warn('[agent-chat] 读取摘要增量消息失败:', deltaError.message);
        return;
    }

    const rows = (deltaMessages || []) as DBMessage[];
    if (rows.length < CONVERSATION_SUMMARY_MIN_NEW_MESSAGES) return;

    const transcript = formatMessagesForSummary(rows);
    if (!transcript) return;

    const langMap: Record<string, string> = {
        'zh-CN': '请用简体中文输出。',
        'zh-TW': '請用繁體中文輸出。',
        'en': 'Please output in English.',
    };
    const summaryMessages = [
        {
            role: 'system',
            content: `你是医疗对话摘要助手。请把新对话融合进已有摘要，保留与用药相关的事实信息：处方变化、过敏/病史、依从性问题、副作用反馈、待跟进事项。输出 5-8 行要点，禁止编造。${langMap[language] || langMap['zh-CN']}`,
        },
        {
            role: 'user',
            content: `已有摘要:\n${summaryState.summary || '(无)'}\n\n新增消息:\n${transcript}\n\n请输出融合后的最新摘要。`,
        },
    ];

    let mergedSummary = '';
    try {
        const result = await callOpenAIChat({
            apiKey: openaiApiKey,
            messages: summaryMessages,
            temperature: 0.2,
            maxTokens: 260,
            modelCandidates: getSummaryModelCandidates(),
        });
        mergedSummary = clipText(result.data?.choices?.[0]?.message?.content, CONVERSATION_SUMMARY_MAX_LENGTH);
    } catch (error) {
        console.warn('[agent-chat] 生成会话摘要失败:', error);
        return;
    }

    if (!mergedSummary) return;

    const nextCount = from + rows.length;
    const { error: updateError } = await supabase
        .from('chat_conversations')
        .update({
            summary: mergedSummary,
            summary_message_count: nextCount,
            summary_updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .eq('user_id', userId);

    if (updateError) {
        if (isMissingColumnError(updateError, 'summary')) return;
        console.warn('[agent-chat] 持久化会话摘要失败:', updateError.message);
    }
}

function buildSystemPrompt(params: {
    medications?: string[];
    compressedContext: ContextCompressionResult;
}): string {
    const { medications, compressedContext } = params;
    let medContext = '';
    if (medications && medications.length > 0) {
        medContext = `\n\n## 用户当前用药\n${medications.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n请基于用户的已知用药进行分析。`;
    }

    const prioritizedContext = compressedContext.contextText
        ? `\n\n## 结构化上下文数据（高优先级参考）\n${compressedContext.contextText}`
        : '';

    return `你是系统后端的结构化推理中枢，专门负责解析健康档案与用药数据，并为后续对话内容生成结构化回复。由于健康信息的敏感性，你必须遵守以下核心安全原则。

## 核心职责与安全原则
1. **绝不做诊断** — 仅提供药物信息参考。
2. **始终建议咨询医生** — 任何涉及调整用药的问题都提醒遵医嘱。
3. **识别紧急情况** — 如果用户描述服用过量、严重反应或急症（如呼吸困难、剧痛），必须立刻建议急诊或拨打急救电话。
4. **不确定时明确表示** — 未知数据不能编造（例如：若没有查到 INR 数值，必须直接说没有）。
5. **强依据输出** — 回答只依据给定上下文。如果上下文缺失，请明确说明缺失。
6. **执行状态必须真实** — 只有在系统明确返回“已执行成功”时，才能说“已更新/已执行”；若只是生成了待确认预览，必须明确说明“尚未执行，等待用户确认”。
7. **计划调整需区分预览与结果** — 当系统处于待确认阶段时，你的回答只能描述“将要发生的变更预览”，不能描述“已经完成的变更结果”。
8. **用药计划确认最多两轮** — 第一轮只确认具体细则；用户确认细则后必须直接进入最终确认弹窗，不得继续发起第 3 轮确认。
9. **当前药物范围必须严格受限** — 只有当前用户消息、当前活跃用药、医生处方、以及待确认计划预览里出现的药物，才可被当作“当前相关药物”主动展开；历史对话里提到、但未加入当前计划的药物，以及已结束/暂停/取消的药物，除非用户当前明确追问，否则禁止主动带出。
${medContext}${prioritizedContext}`;
}

function buildStylePrompt(params: {
    agentStyle: AgentStyle;
    language: string;
    forcePlanEvidence?: boolean;
    hasPendingPreview?: boolean;
}): string {
    const basePrompt = buildAgentStylePrompt(params);
    if (!params.hasPendingPreview) return basePrompt;
    return `${basePrompt}\n\n当前系统状态：你正在展示一份待确认的计划变更预览。请明确告诉用户“尚未执行”，等待用户确认后才会正式更新。`;
}

// =============================================
// 主处理逻辑
// =============================================

serve(async (req) => {
    const traceId = createTraceId(req);
    const startedAt = Date.now();
    const respond = (
        status: number,
        payload: Record<string, unknown>,
        event: string,
        meta?: Record<string, unknown>
    ) => {
        const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        logTrace(level, event, traceId, {
            status,
            elapsed_ms: Date.now() - startedAt,
            ...meta,
        });
        return new Response(
            JSON.stringify({
                ...payload,
                traceId,
            }),
            { status, headers: traceJsonHeaders(traceId) }
        );
    };

    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                ...corsHeaders,
                'x-trace-id': traceId,
            },
        });
    }

    logTrace('info', 'request.received', traceId, {
        method: req.method,
        pathname: new URL(req.url).pathname,
        has_auth_header: Boolean(req.headers.get('authorization') || req.headers.get('Authorization')),
        has_user_jwt: Boolean(req.headers.get('x-user-jwt') || req.headers.get('X-User-Jwt')),
    });

    try {
        if (!isFeatureEnabled('FEATURE_AGENT_CHAT_ENABLED', true)) {
            return respond(
                503,
                { success: false, error: 'Agent 功能暂未开放' },
                'request.blocked.feature_disabled'
            );
        }

        if (req.method !== 'POST') {
            return respond(
                405,
                { success: false, error: 'Method not allowed' },
                'request.invalid_method'
            );
        }

        const body: ChatRequest = await req.json();
        const { message, language = 'zh-CN', medications } = body;
        const messageText = message?.trim() || '';
        const forcePlanEvidence = isMedicationPlanQuestion(messageText);
        const includePastMedicationContext = shouldIncludeHistoricalMedicationContext(messageText);

        if (!message || typeof message !== 'string' || messageText.length === 0) {
            return respond(
                400,
                { success: false, error: '请输入消息' },
                'request.invalid_message'
            );
        }

        const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
        if (!OPENAI_API_KEY) {
            return respond(
                500,
                { success: false, error: '服务配置错误: 缺少 API 密钥' },
                'request.config_error',
                { missing_env: 'OPENAI_API_KEY' }
            );
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
            return respond(
                500,
                { success: false, error: '服务配置错误' },
                'request.config_error',
                { missing_env: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY' }
            );
        }

        const authUserId = await getAuthenticatedUserId(
            supabase,
            normalizeToken(body.userJwt) || getBearerToken(req)
        );
        if (!authUserId) {
            return respond(
                401,
                { success: false, error: '未授权访问' },
                'request.unauthorized'
            );
        }
        const thinkingPreference = await loadThinkingModePreference({
            supabase,
            userId: authUserId,
        });
        const thinkingPolicy = selectAgentThinkingPolicy({
            message: messageText,
            preference: thinkingPreference,
            forceSlowSignals: forcePlanEvidence ? ['medication_plan_question'] : [],
        });
        const thoughtMode = thinkingPolicy.mode;
        const modelReasoningEffort = mapThinkingPolicyToOpenAIReasoningEffort(thinkingPolicy);
        await updateAgentRuntimeState({
            supabase,
            userId: authUserId,
            lifecycleStatus: 'thinking',
            thinkingMode: thoughtMode,
            triggerSignals: buildRuntimeTriggerSignals({
                forcePlanEvidence,
                includePastMedicationContext,
                policyReasonCodes: thinkingPolicy.reasonCodes,
            }),
            contextSummary: '正在读取对话、用药和健康上下文',
        });
        logTrace('info', 'request.authenticated', traceId, { user_id: authUserId });
        const rolloutStage = getAgentRolloutStage();
        const personalizationEnabled = isAgentPersonalizationEnabled();
        logTrace('info', 'rollout.state', traceId, {
            rollout_stage: rolloutStage,
            personalization_enabled: personalizationEnabled,
            force_plan_evidence: forcePlanEvidence,
            thought_mode: thoughtMode,
            thinking_preference: thinkingPreference,
            thinking_policy_reasons: thinkingPolicy.reasonCodes,
            model_reasoning_effort: modelReasoningEffort,
            include_past_medication_context: includePastMedicationContext,
        });
        const agentStyle = await loadAgentStylePreference({
            supabase,
            userId: authUserId,
            requestStyle: body.agentStyle,
        });
        logTrace('info', 'style.selected', traceId, {
            agent_style: agentStyle,
        });

        let conversationId = body.conversationId;
        let summaryState: ConversationSummaryState = {
            summary: '',
            summaryMessageCount: 0,
            summaryUpdatedAt: null,
            supported: false,
        };
        let historyMessages: DBMessage[] = [];

        // ========================================
        // Step 1: 会话创建/所有权校验
        // ========================================
        if (!conversationId) {
            const { data: conv, error: convErr } = await supabase
                .from('chat_conversations')
                .insert({
                    user_id: authUserId,
                    title: messageText.slice(0, 50),
                })
                .select('id')
                .single();

            if (!convErr && conv) {
                conversationId = conv.id;
                console.log(`[agent-chat] 新对话: ${conversationId}`);
            }
        } else {
            const ownership = await verifyConversationOwnership({
                supabase,
                conversationId,
                userId: authUserId,
            });

            if (ownership.hasError) {
                return respond(
                    500,
                    { success: false, error: '查询对话失败' },
                    'conversation.verify_failed',
                    { conversation_id: conversationId }
                );
            }

            if (!ownership.exists) {
                return respond(
                    403,
                    { success: false, error: '无权访问该对话' },
                    'conversation.forbidden',
                    { conversation_id: conversationId }
                );
            }
        }

        // ========================================
        // Step 2: 拉结构化会话数据（摘要 + 最近原始消息）
        // ========================================
        if (conversationId) {
            summaryState = await loadConversationSummaryState({
                supabase,
                conversationId,
                userId: authUserId,
            });
            historyMessages = await loadRecentConversationMessages({
                supabase,
                conversationId,
                limit: CONVERSATION_HISTORY_LIMIT,
            });
            console.log(
                `[agent-chat] 历史消息=${historyMessages.length}, 摘要状态=${summaryState.supported ? 'enabled' : 'disabled'}`
            );
        }

        // ========================================
        // Step 3 & 4: 私有RAG与药物知识RAG（含结构化数据读取）
        // ========================================
        const shouldUseFullPersonalizedContext = personalizationEnabled && thinkingPolicy.shouldLoadPersonalContext;
        const ragContext = shouldUseFullPersonalizedContext
            ? await loadRagContext({
                supabase,
                userId: authUserId,
                message: messageText,
                openaiApiKey: OPENAI_API_KEY,
                medications,
            })
            : buildMinimalRagContext(medications);

        if (!personalizationEnabled && !forcePlanEvidence && thoughtMode === 'fast') {
            logTrace('warn', 'context.personalization_disabled', traceId, {
                rollout_stage: rolloutStage,
            });
        } else if (!personalizationEnabled && (forcePlanEvidence || thoughtMode === 'slow')) {
            logTrace('warn', 'context.personalization_forced_for_plan_query', traceId, {
                rollout_stage: rolloutStage,
            });
        }

        logTrace('info', 'context.loaded', traceId, {
            rollout_stage: rolloutStage,
            source_tags: ragContext.sourceTags,
            rag_match_count: ragContext.ragMatchCount,
            drug_knowledge_count: ragContext.drugKnowledgeCount,
        });

        // ========================================
        // Step 5: 上下文压缩（固定优先级）
        // ========================================
        const compressedContext = buildPrioritizedContext({
            ragContext,
            summaryState,
            medications,
            includePastMedications: includePastMedicationContext,
        });
        const effectiveSourceTagSet = new Set(
            compressedContext.usedSourceTags.length > 0
                ? compressedContext.usedSourceTags
                : ragContext.sourceTags
        );
        if (forcePlanEvidence) {
            ['medication_schedule', 'medication_logs', 'medication_feedback'].forEach((tag) => {
                effectiveSourceTagSet.add(tag);
            });
        }
        const effectiveSourceTags = Array.from(effectiveSourceTagSet);
        logTrace('info', 'context.compressed', traceId, {
            rollout_stage: rolloutStage,
            source_tags: effectiveSourceTags,
            dropped_sections: compressedContext.droppedSections,
            rag_match_count: ragContext.ragMatchCount,
            drug_knowledge_count: ragContext.drugKnowledgeCount,
            force_plan_evidence: forcePlanEvidence,
        });

        const isPlanChangeConfirmation = thoughtMode === 'slow'
            && isMedicationPlanConfirmationReply(messageText, historyMessages);
        const isPlanChangeRequest = thoughtMode === 'slow'
            && (isMedicationPlanChangeRequest(messageText) || isPlanChangeConfirmation);
        let currentProjectedSchedules: MedicationScheduleRow[] = [];
        if (isPlanChangeRequest) {
            const { data: projectedRows, error: projectedError } = await supabase
                .rpc('get_medication_schedule_projection', {
                    target_user_id: authUserId,
                    as_of_date: new Date().toISOString().split('T')[0],
                });
            if (projectedError) {
                console.warn('[agent-chat] load projected schedules for change set failed:', projectedError.message);
            } else {
                currentProjectedSchedules = ((projectedRows || []) as MedicationScheduleRow[])
                    .filter((item) => item.is_current === true);
            }
        }

        const medicationChangeSetPlan = isPlanChangeRequest
            ? await planMedicationChangeSet({
                apiKey: OPENAI_API_KEY,
                message: messageText,
                language,
                compressedContext,
                historyMessages,
                isConfirmationReply: isPlanChangeConfirmation,
            })
            : null;

        const actionPlan = thoughtMode === 'slow' && !isPlanChangeRequest
            ? await planAgentAction({
                apiKey: OPENAI_API_KEY,
                message: messageText,
                language,
                compressedContext,
            })
            : null;
        const hasPendingPreview = Boolean(
            (conversationId && medicationChangeSetPlan?.shouldCreateChangeSet && medicationChangeSetPlan.operations.length > 0)
            || (conversationId && actionPlan?.shouldCreateRequest)
        );

        // ========================================
        // 预写入用户消息（聊天表）
        // ========================================
        let userMessageId: string | null = null;
        if (conversationId) {
            const { data: insertedUser, error: userInsertErr } = await supabase
                .from('chat_messages')
                .insert({
                    conversation_id: conversationId,
                    role: 'user',
                    content: messageText,
                })
                .select('id')
                .single();

            if (userInsertErr) {
                console.error('[agent-chat] 写入用户消息失败:', userInsertErr);
            } else {
                userMessageId = insertedUser?.id || null;
            }
        }

        // ========================================
        // Step 6: 模型生成
        // ========================================
        const shouldSuppressTextReplyForPendingPreview = hasPendingPreview;
        let openaiData: OpenAIChatResponsePayload | null = null;
        let usedModel = '';
        if (!shouldSuppressTextReplyForPendingPreview) {
            const systemPrompt = buildSystemPrompt({
                medications,
                compressedContext,
            });

            const stylePrompt = buildStylePrompt({
                agentStyle,
                language,
                forcePlanEvidence,
                hasPendingPreview,
            });

            const openaiMessages = [
                { role: 'system', content: systemPrompt },
                ...historyMessages.map(m => ({ role: m.role, content: m.content })),
                { role: 'system', content: stylePrompt },
                { role: 'user', content: messageText },
            ];

            console.log(`[agent-chat] 发送 ${openaiMessages.length} 条消息到 OpenAI`);

            const startTime = Date.now();
            try {
                const result = await callOpenAIChat({
                    apiKey: OPENAI_API_KEY,
                    messages: openaiMessages,
                    reasoningEffort: modelReasoningEffort,
                });
                openaiData = result.data;
                usedModel = result.model;
            } catch (chatErr) {
                const elapsed = Date.now() - startTime;
                console.error('[agent-chat] OpenAI 调用失败:', chatErr);
                console.log(`[agent-chat] OpenAI 响应失败, time=${elapsed}ms`);
                await updateAgentRuntimeState({
                    supabase,
                    userId: authUserId,
                    lifecycleStatus: 'error',
                    thinkingMode: thoughtMode,
                    triggerSignals: buildRuntimeTriggerSignals({
                        forcePlanEvidence,
                        includePastMedicationContext,
                        policyReasonCodes: thinkingPolicy.reasonCodes,
                    }),
                    contextSummary: 'AI 服务暂时不可用',
                    lastError: chatErr instanceof Error ? chatErr.message : 'openai_chat_failed',
                });
                return respond(
                    502,
                    { success: false, error: 'AI 服务暂时不可用，请稍后重试' },
                    'openai.chat_failed'
                );
            }

            const elapsed = Date.now() - startTime;
            console.log(`[agent-chat] OpenAI 响应成功: model=${usedModel}, time=${elapsed}ms`);
        } else {
            console.log('[agent-chat] 已生成待确认预览，跳过普通聊天回复，避免一边弹预览一边追问。');
        }

        let reply = '';
        const citations: Array<{ id: string; type: string; title: string }> = [];
        let pendingAction: PendingActionResponse | null = null;

        try {
            const rawReply = shouldSuppressTextReplyForPendingPreview
                ? ''
                : (openaiData?.choices?.[0]?.message?.content || '抱歉，我暂时无法回答。请稍后再试。');

            // Try to parse if it's JSON structured output (if tools/JSON mode were used)
            // Or extract normally. Here we use the raw reply for text, and format citations natively from backend context
            reply = rawReply;

            // Generate citations based on the context used
            effectiveSourceTags.forEach(tag => {
                const labelMap: Record<string, string> = {
                    health_profile: '健康档案',
                    doctor_prescription: '医生处方',
                    medication_schedule: '用药计划',
                    medication_logs: '用药记录',
                    medication_feedback: '用药反馈',
                    chat_history: '历史对话',
                    rag_retrieval: '相关文档记录',
                    drug_label_api: '药物说明书',
                    drug_knowledge_rag: '知识库',
                    conversation_summary: '过往交流摘要',
                };
                citations.push({
                    id: `cite-${tag}`,
                    type: tag,
                    title: labelMap[tag] || tag,
                });
            });

        } catch (e) {
            console.error('解析回复错误', e);
            reply = '解析回复时出错。';
        }

        if (medicationChangeSetPlan?.shouldCreateChangeSet && conversationId) {
            pendingAction = await createMedicationPlanChangeRequest({
                supabase,
                userId: authUserId,
                conversationId,
                thinkingMode: thoughtMode,
                plan: medicationChangeSetPlan,
                activeSchedules: currentProjectedSchedules,
                contextSnapshot: {
                    sourceTags: effectiveSourceTags,
                    ragMatchCount: ragContext.ragMatchCount,
                    drugKnowledgeCount: ragContext.drugKnowledgeCount,
                },
            });

            if (pendingAction) {
                reply = '';
            }
        } else if (actionPlan?.shouldCreateRequest && actionPlan.commandName && conversationId) {
            pendingAction = await createAgentActionRequest({
                supabase,
                userId: authUserId,
                conversationId,
                thinkingMode: thoughtMode,
                commandName: actionPlan.commandName,
                title: String(actionPlan.title || '待确认操作'),
                summary: String(actionPlan.summary || actionPlan.reason || ''),
                payload: actionPlan.payload || {},
                contextSnapshot: {
                    sourceTags: effectiveSourceTags,
                    ragMatchCount: ragContext.ragMatchCount,
                    drugKnowledgeCount: ragContext.drugKnowledgeCount,
                },
                impactDescription: String(actionPlan.impactDescription || actionPlan.summary || ''),
                impactPoints: Array.isArray(actionPlan.impactPoints) ? actionPlan.impactPoints.map((item) => String(item)) : [],
                previewSections: [],
                confirmHint: String(actionPlan.confirmHint || ''),
                riskLevel: actionPlan.riskLevel || 'medium',
            });

            if (pendingAction) {
                reply = '';
            }
        }

        if (shouldSuppressTextReplyForPendingPreview && !pendingAction) {
            reply = '我暂时无法生成待确认预览，请稍后重试，或补充更完整的用药信息。';
        }

        const contextUsed = {
            sourceTags: effectiveSourceTags,
            ragMatchCount: ragContext.ragMatchCount,
            drugKnowledgeCount: ragContext.drugKnowledgeCount,
            fetchedAt: new Date().toISOString(),
        };

        await updateAgentRuntimeState({
            supabase,
            userId: authUserId,
            lifecycleStatus: pendingAction ? 'waiting_confirmation' : 'ready',
            thinkingMode: thoughtMode,
            contextTags: contextUsed.sourceTags,
            triggerSignals: buildRuntimeTriggerSignals({
                forcePlanEvidence,
                includePastMedicationContext,
                pendingAction,
                policyReasonCodes: thinkingPolicy.reasonCodes,
            }),
            contextSummary: contextUsed.sourceTags.length > 0
                ? `本轮使用 ${contextUsed.sourceTags.length} 类上下文`
                : '本轮未命中额外上下文',
        });

        if (thoughtMode === 'slow' && effectiveSourceTags.length > 0) {
            await logContextAccess({
                supabase,
                userId: authUserId,
                conversationId,
                requestId: pendingAction?.requestId,
                thinkingMode: thoughtMode,
                sourceTags: effectiveSourceTags,
                accessScope: pendingAction ? 'command_planning' : 'slow_reply',
                accessReason: pendingAction
                    ? `为命令 ${pendingAction.commandName} 规划并准备待确认动作`
                    : '用户问题涉及个人信息，按慢思考装配上下文',
            });
        }

        const shouldPersistAssistantReply = reply.trim().length > 0;

        console.log(`[agent-chat] 回复长度: ${reply.length}, tokens: prompt=${openaiData?.usage?.prompt_tokens || 0}, completion=${openaiData?.usage?.completion_tokens || 0}`);

        // ========================================
        // 写入 AI 回复（聊天表）
        // ========================================
        let assistantMessageId: string | null = null;
        if (conversationId && shouldPersistAssistantReply) {
            const { data: insertedAssistant, error: assistantInsertErr } = await supabase
                .from('chat_messages')
                .insert({
                    conversation_id: conversationId,
                    role: 'assistant',
                    content: reply,
                    metadata: {
                        context_used: {
                            source_tags: contextUsed.sourceTags,
                            rag_match_count: contextUsed.ragMatchCount,
                            drug_knowledge_count: contextUsed.drugKnowledgeCount,
                            fetched_at: contextUsed.fetchedAt,
                        },
                        thought_mode: thoughtMode,
                        thinking_policy: {
                            reason_codes: thinkingPolicy.reasonCodes,
                            context_budget: thinkingPolicy.contextBudget,
                            model_reasoning_effort: modelReasoningEffort,
                            reasoning_summary: thinkingPolicy.reasoningSummary,
                        },
                        pending_action: pendingAction,
                        agent_style: agentStyle,
                        model: usedModel || null,
                        usage: openaiData?.usage || null,
                    },
                })
                .select('id')
                .single();

            if (assistantInsertErr) {
                console.error('[agent-chat] 写入AI消息失败:', assistantInsertErr);
            } else {
                assistantMessageId = insertedAssistant?.id || null;
            }
        }

        // ========================================
        // Step 7: 异步任务（RAG写入 + 会话摘要增量）
        // ========================================
        if (conversationId) {
            const asyncTasks: Promise<unknown>[] = [
                saveChatMessageToRag({
                    supabase,
                    userId: authUserId,
                    conversationId,
                    role: 'user',
                    content: messageText,
                    messageId: userMessageId,
                    language,
                    openaiApiKey: OPENAI_API_KEY,
                }),
                refreshConversationSummary({
                    supabase,
                    userId: authUserId,
                    conversationId,
                    openaiApiKey: OPENAI_API_KEY,
                    language,
                }),
            ];

            if (shouldPersistAssistantReply) {
                asyncTasks.push(saveChatMessageToRag({
                    supabase,
                    userId: authUserId,
                    conversationId,
                    role: 'assistant',
                    content: reply,
                    messageId: assistantMessageId,
                    language,
                    openaiApiKey: OPENAI_API_KEY,
                }));
            }

            void Promise.allSettled(asyncTasks).then((results) => {
                const failed = results.filter((r) => r.status === 'rejected').length;
                if (failed > 0) {
                    console.warn(`[agent-chat] ${failed} 条异步任务失败`);
                } else {
                    console.log('[agent-chat] 异步任务完成');
                }
            });
        }

        // ========================================
        // 返回
        // ========================================
        const response: ChatResponse & { citations?: Array<{ id: string; type: string; title: string }> } = {
            success: true,
            conversationId: conversationId || 'local',
            reply,
            thoughtMode,
            thinkingPolicy: {
                reasonCodes: thinkingPolicy.reasonCodes,
                contextBudget: thinkingPolicy.contextBudget,
                modelReasoningEffort,
                reasoningSummary: thinkingPolicy.reasoningSummary,
            },
            usedPersonalContext: shouldUseFullPersonalizedContext,
            pendingAction: pendingAction || undefined,
            styleUsed: agentStyle,
            contextUsed,
            citations,
        };

        return respond(
            200,
            response as unknown as Record<string, unknown>,
            'request.succeeded',
            {
                user_id: authUserId,
                conversation_id: conversationId || 'local',
                agent_style: agentStyle,
                thought_mode: thoughtMode,
                source_tags: contextUsed.sourceTags,
                rag_match_count: contextUsed.ragMatchCount,
                drug_knowledge_count: contextUsed.drugKnowledgeCount,
            }
        );

    } catch (error) {
        console.error('[agent-chat] Error:', error);
        return respond(
            500,
            {
                success: false,
                error: error instanceof Error ? error.message : '对话失败，请稍后重试',
            },
            'request.failed_unexpected'
        );
    }
});
