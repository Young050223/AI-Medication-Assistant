/**
 * @file agentApi.ts
 * @description Agent API客户端 - 调用Supabase Edge Functions
 * @author AI用药助手开发团队
 * @created 2026-02-03
 * 
 * 安全: 所有API调用通过Edge Functions，前端无API Key暴露
 */

import { supabase } from './supabase';
import type { AgentPendingAction } from './agentCommandApi';

// =============================================
// 类型定义
// =============================================

export interface AnalyzeDrugRequest {
    drugName: string;
    language?: 'zh-CN' | 'zh-TW' | 'en';
}

export interface WorkflowLog {
    step: string;
    status: 'start' | 'success' | 'error' | 'skip' | 'info';
    message: string;
    timestamp: string;
    meta?: Record<string, unknown>;
}

export interface ReactionStat {
    term: string;
    count: number;
    percentage: number;
}

export interface AdverseEvents {
    totalReports: number;
    seriousRate: number;
    topReactions: ReactionStat[];
    source: string;
    dataRange: string;
    lastUpdated: string;
}

export interface Disclaimer {
    title: string;
    content: string[];
}

export interface DrugAnalysisResult {
    drugName: string;
    normalizedName?: string;
    rxcui?: string;
    adverseEvents?: AdverseEvents;
    labelSummary?: {
        indications?: string;
        warnings?: string;
        contraindications?: string;
    };
    aiSummary?: {
        overview: string;
        keyPoints: string[];
        warnings: string[];
        commonSideEffects: string[];
        foodInteractions: string[];
    };
    disclaimer: Disclaimer;
    sources: string[];
    analyzedAt: string;
}

export interface AnalyzeDrugResponse {
    success: boolean;
    data?: DrugAnalysisResult;
    workflowLogs?: WorkflowLog[];
    error?: string;
}

export interface RiskAlert {
    type: 'ALLERGY_WARNING' | 'CONTRAINDICATION' | 'DRUG_INTERACTION' | 'GENERAL_WARNING';
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    message: string;
    source: string;
}

export interface CheckRisksRequest {
    userProfile: {
        allergies?: string[];
        conditions?: string[];
        currentMedications?: string[];
    };
    drugInfo: {
        name: string;
        ingredients?: string[];
        contraindications?: string[];
        interactions?: string[];
        warnings?: string[];
    };
    language?: 'zh-CN' | 'zh-TW' | 'en';
}

export interface CheckRisksResponse {
    success: boolean;
    alerts: RiskAlert[];
    checkedAt: string;
    error?: string;
}

export interface ConversationListItem {
    id: string;
    title: string;
    updatedAt: string;
    createdAt: string;
    lastMessage?: string;
    lastMessageRole?: string;
}

export interface ConversationMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
    thoughtMode?: 'fast' | 'slow';
    thinkingPolicy?: AgentThinkingPolicySummary;
    contextUsed?: {
        sourceTags: string[];
        ragMatchCount: number;
        drugKnowledgeCount: number;
        fetchedAt: string;
    };
}

export interface VectorizeDocumentRequest {
    userId?: string;
    userJwt?: string;
    sourceType: 'chat_message' | 'medication_feedback' | 'user_query' | 'health_profile' | 'medication_schedule';
    sourceId?: string;
    content: string;
    metadata?: Record<string, unknown>;
}

export interface VectorizeDocumentResponse {
    success: boolean;
    documentId?: string;
    error?: string;
}

export interface AgentThinkingPolicySummary {
    reasonCodes: string[];
    contextBudget: 'minimal' | 'full';
    modelReasoningEffort: 'none' | 'minimal';
    reasoningSummary: string;
}

export interface AgentRuntimeState {
    userId: string;
    lifecycleStatus: string;
    thinkingModePreference: 'auto' | 'fast' | 'slow';
    currentThinkingMode: 'fast' | 'slow';
    lastContextSummary: string;
    lastContextTags: string[];
    lastTriggerSignals: string[];
    activeTaskCount: number;
    pendingActionCount: number;
    backgroundStatus: Record<string, unknown>;
    lastError?: string | null;
    lastBootstrappedAt?: string | null;
    lastInteractionAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AgentBackgroundTask {
    id: string;
    taskType: string;
    taskStatus: string;
    priority: string;
    title: string;
    summary: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    error?: string | null;
    scheduledAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    lockedAt?: string | null;
    attemptCount: number;
    maxAttempts: number;
    createdAt: string;
    updatedAt: string;
}

export interface AgentRuntimeEvent {
    id: string;
    sourceTaskId?: string | null;
    sourceRequestId?: string | null;
    eventType: string;
    eventStatus: string;
    severity: 'info' | 'success' | 'warning' | 'critical';
    title: string;
    body: string;
    payload: Record<string, unknown>;
    visibleAt: string;
    acknowledgedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AgentMemoryFact {
    id: string;
    memoryType: string;
    factStatus: string;
    content: string;
    sourceTable?: string | null;
    sourceId?: string | null;
    confidence: number;
    expiresAt?: string | null;
    revokedAt?: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface AgentRuntimePendingAction {
    requestId: string;
    commandName: string;
    status: string;
    confirmationState: string;
    priority: string;
    title: string;
    summary: string;
    createdAt: string;
    updatedAt: string;
}

export interface AgentRuntimeBootstrapResponse {
    success: boolean;
    runtimeState?: AgentRuntimeState;
    backgroundTasks: AgentBackgroundTask[];
    runtimeEvents: AgentRuntimeEvent[];
    memoryHighlights: AgentMemoryFact[];
    pendingActions: AgentRuntimePendingAction[];
    thinkingPolicy?: AgentThinkingPolicySummary;
    error?: string;
}

export interface VoiceFeedbackAssistRequest {
    action?: 'transcribe' | 'summarize' | 'assist';
    userJwt?: string;
    audioDataUrl?: string;
    transcript?: string;
    medicationName?: string;
    mood?: 'good' | 'neutral' | 'bad' | 'mild' | 'severe';
    language?: 'zh-CN' | 'zh-TW' | 'en';
}

export interface VoiceFeedbackAssistResponse {
    success: boolean;
    transcript?: string;
    medicalText?: string;
    structuredSummary?: {
        chiefComplaint?: string;
        symptomList?: string[];
        severity?: string;
        onset?: string;
        duration?: string;
        impact?: string;
        notes?: string;
    };
    safetyFlags?: string[];
    error?: string;
}

export interface AgentVoiceTranscribeRequest {
    audio: Blob;
    language?: 'zh-CN' | 'zh-TW' | 'en';
    source?: 'agent-chat';
}

export interface AgentVoiceTranscribeResponse {
    success: boolean;
    transcript?: string;
    language?: string;
    durationMs?: number;
    model?: string;
    error?: string;
}

// =============================================
// API 调用函数
// =============================================

/**
 * 获取Edge Function URL
 */
function getEdgeFunctionUrl(functionName: string): string {
    // Supabase Edge Function URL格式
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://nvxjvbkynxuzigxzaevq.supabase.co';
    return `${supabaseUrl}/functions/v1/${functionName}`;
}

/**
 * 获取 Edge Function 调用 Header
 *
 * 默认同时携带 apikey；Authorization 优先使用用户 access token，
 * 退化场景再回落到 anon key。
 */
async function getAuthHeaders(contentType: 'json' | 'multipart' = 'json'): Promise<Record<string, string>> {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
        'apikey': anonKey,
        // Supabase Edge Gateway 仍使用项目 key 做网关鉴权
        'Authorization': `Bearer ${anonKey}`,
    };

    if (contentType === 'json') {
        headers['Content-Type'] = 'application/json';
    }

    // 用户级鉴权 token 透传到自定义头，由 Edge Function 内部验证
    if (session?.access_token) {
        headers['x-user-jwt'] = session.access_token;
    }

    return headers;
}

async function getCurrentUserId(): Promise<string | null> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        return user?.id || null;
    } catch {
        return null;
    }
}

async function getCurrentAccessToken(): Promise<string | null> {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token || null;
    } catch {
        return null;
    }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    const data = await blob.arrayBuffer();
    const bytes = new Uint8Array(data);
    let binary = '';
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    const base64 = btoa(binary);
    const mimeType = blob.type || 'audio/webm';
    return `data:${mimeType};base64,${base64}`;
}

function inferAudioFileExtension(mimeType?: string): string {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('webm')) return 'webm';
    if (normalized.includes('ogg')) return 'ogg';
    if (normalized.includes('mp4')) return 'mp4';
    if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
    if (normalized.includes('wav')) return 'wav';
    return 'webm';
}

/**
 * 分析药物信息
 * 
 * 调用流程: 
 * 前端 → Edge Function → RxNorm + DailyMed + OpenFDA + OpenAI → 返回结果
 * 
 * @param request 分析请求
 * @returns 分析结果（含来源标注）
 */
export async function analyzeDrug(request: AnalyzeDrugRequest): Promise<AnalyzeDrugResponse> {
    const startTime = Date.now();
    console.log('====================================');
    console.log('[agentApi] 🚀 开始药物分析');
    console.log('[agentApi] 请求参数:', JSON.stringify(request, null, 2));

    try {
        const url = getEdgeFunctionUrl('analyze-drug');
        console.log('[agentApi] Edge Function URL:', url);

        const headers = await getAuthHeaders();
        console.log('[agentApi] 请求头:', JSON.stringify({
            ...headers,
            Authorization: headers.Authorization ? '***已设置***' : '未设置',
            apikey: headers.apikey ? '***已设置***' : '未设置'
        }, null, 2));

        console.log('[agentApi] ⏳ 发送请求中...');
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(request),
        });

        const elapsed = Date.now() - startTime;
        console.log(`[agentApi] 📡 响应状态: ${response.status} (${elapsed}ms)`);

        const data = await response.json();
        console.log('[agentApi] 📦 响应数据:', JSON.stringify(data, null, 2));

        if (!response.ok) {
            console.error(`[agentApi] ❌ 请求失败: ${response.status}`);
            return {
                success: false,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        console.log('[agentApi] ✅ 分析成功!');
        console.log('====================================');
        return data as AnalyzeDrugResponse;
    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`[agentApi] ❌ 网络错误 (${elapsed}ms):`, error);
        console.log('====================================');
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 检查个性化风险
 * 
 * @param request 风险检查请求
 * @returns 风险警报列表
 */
export async function checkRisks(request: CheckRisksRequest): Promise<CheckRisksResponse> {
    try {
        const url = getEdgeFunctionUrl('check-risks');
        const headers = await getAuthHeaders();

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(request),
        });

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                alerts: [],
                checkedAt: new Date().toISOString(),
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return data as CheckRisksResponse;
    } catch (error) {
        console.error('[agentApi] checkRisks error:', error);
        return {
            success: false,
            alerts: [],
            checkedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 生成文本向量 (用于语义搜索)
 * 
 * @param text 输入文本
 * @param options 选项
 * @returns 向量数组
 */
export async function generateEmbedding(
    text: string,
    options?: {
        queryType?: 'drug_search' | 'symptom' | 'interaction' | 'side_effect';
        saveToHistory?: boolean;
    }
): Promise<{ success: boolean; embedding?: number[]; savedId?: string; error?: string }> {
    try {
        const url = getEdgeFunctionUrl('generate-embedding');
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                text,
                queryType: options?.queryType || 'drug_search',
                saveToHistory: options?.saveToHistory || false,
                userJwt: userJwt || undefined,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return data;
    } catch (error) {
        console.error('[agentApi] generateEmbedding error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 搜索相似查询历史
 * 
 * @param queryText 查询文本
 * @param limit 返回数量
 * @returns 相似查询列表
 */
export async function searchSimilarQueries(
    queryText: string,
    limit: number = 5
): Promise<{ success: boolean; results?: Array<{ queryText: string; queryType: string; similarity: number }>; error?: string }> {
    try {
        // 1. 生成查询向量
        const embeddingResult = await generateEmbedding(queryText);

        if (!embeddingResult.success || !embeddingResult.embedding) {
            return { success: false, error: embeddingResult.error };
        }

        const userId = await getCurrentUserId();
        if (!userId) {
            return { success: false, error: '用户未登录' };
        }

        // 2. 调用统一 RAG RPC函数搜索
        const { data, error } = await supabase.rpc('match_rag_documents', {
            query_embedding: embeddingResult.embedding,
            target_user_id: userId,
            source_types: ['user_query'],
            match_threshold: 0.7,
            match_count: limit,
        });

        if (error) {
            return { success: false, error: error.message };
        }

        return {
            success: true,
            results: data?.map((item: { content: string; metadata?: Record<string, unknown>; similarity: number }) => ({
                queryText: item.content,
                queryType: String(item.metadata?.query_type || 'drug_search'),
                similarity: item.similarity,
            })) || [],
        };
    } catch (error) {
        console.error('[agentApi] searchSimilarQueries error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '搜索失败',
        };
    }
}

/**
 * 通用文档向量化
 */
export async function vectorizeDocument(
    request: VectorizeDocumentRequest
): Promise<VectorizeDocumentResponse> {
    try {
        const url = getEdgeFunctionUrl('vectorize-document');
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                ...request,
                userJwt: request.userJwt || userJwt || undefined,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return data as VectorizeDocumentResponse;
    } catch (error) {
        console.error('[agentApi] vectorizeDocument error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 语音反馈辅助（Qwen-3-ASR + OpenAI总结）
 */
export async function voiceFeedbackAssist(
    request: VoiceFeedbackAssistRequest
): Promise<VoiceFeedbackAssistResponse> {
    try {
        const url = getEdgeFunctionUrl('voice-feedback-assist');
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                ...request,
                userJwt: request.userJwt || userJwt || undefined,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return data as VoiceFeedbackAssistResponse;
    } catch (error) {
        console.error('[agentApi] voiceFeedbackAssist error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * Agent Chat 语音转文字（Qwen-3-ASR）
 */
export async function transcribeAgentVoice(
    request: AgentVoiceTranscribeRequest
): Promise<AgentVoiceTranscribeResponse> {
    try {
        const url = getEdgeFunctionUrl('agent-voice-transcribe');
        const headers = await getAuthHeaders();
        const extension = inferAudioFileExtension(request.audio.type);
        const fileName = `agent-chat-${Date.now()}.${extension}`;
        const normalizedAudio = request.audio instanceof File
            ? request.audio
            : new File([request.audio], fileName, { type: request.audio.type || 'audio/webm' });
        const audioDataUrl = await blobToDataUrl(normalizedAudio);

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                audioDataUrl,
                language: request.language,
                source: request.source,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return data as AgentVoiceTranscribeResponse;
    } catch (error) {
        console.error('[agentApi] transcribeAgentVoice error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 获取对话列表
 */
export async function fetchConversationList(
    page: number = 1,
    pageSize: number = 20
): Promise<{ success: boolean; conversations: ConversationListItem[]; total: number; page: number; pageSize: number; error?: string }> {
    try {
        const url = getEdgeFunctionUrl('chat-history');
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'list',
                userJwt: userJwt || undefined,
                page,
                pageSize,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                conversations: [],
                total: 0,
                page,
                pageSize,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return {
            success: true,
            conversations: data.conversations || [],
            total: data.total || 0,
            page: data.page || page,
            pageSize: data.pageSize || pageSize,
        };
    } catch (error) {
        console.error('[agentApi] fetchConversationList error:', error);
        return {
            success: false,
            conversations: [],
            total: 0,
            page,
            pageSize,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 获取单个对话的消息列表
 */
export async function fetchConversationMessages(
    conversationId: string
): Promise<{ success: boolean; messages: ConversationMessage[]; error?: string }> {
    try {
        const url = getEdgeFunctionUrl('chat-history');
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'messages',
                userJwt: userJwt || undefined,
                conversationId,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                messages: [],
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        const normalizedMessages: ConversationMessage[] = Array.isArray(data.messages)
            ? data.messages.map((item: unknown) => {
                const row = item && typeof item === 'object'
                    ? item as Record<string, unknown>
                    : {};
                const contextUsed = row.contextUsed && typeof row.contextUsed === 'object'
                    ? row.contextUsed as Record<string, unknown>
                    : null;

                return {
                    id: String(row.id || ''),
                    role: row.role as ConversationMessage['role'],
                    content: String(row.content || ''),
                    createdAt: String(row.createdAt || ''),
                    thoughtMode: row.thoughtMode === 'fast' || row.thoughtMode === 'slow'
                        ? row.thoughtMode
                        : undefined,
                    thinkingPolicy: normalizeThinkingPolicy(row.thinkingPolicy),
                    contextUsed: contextUsed
                    ? {
                        sourceTags: Array.isArray(contextUsed.sourceTags)
                            ? contextUsed.sourceTags.map((tag: unknown) => String(tag))
                            : [],
                        ragMatchCount: Number(contextUsed.ragMatchCount) || 0,
                        drugKnowledgeCount: Number(contextUsed.drugKnowledgeCount) || 0,
                        fetchedAt: String(contextUsed.fetchedAt || ''),
                    }
                    : undefined,
                };
            })
            : [];

        return {
            success: true,
            messages: normalizedMessages,
        };
    } catch (error) {
        console.error('[agentApi] fetchConversationMessages error:', error);
        return {
            success: false,
            messages: [],
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 删除对话
 */
export async function deleteConversation(
    conversationId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const url = getEdgeFunctionUrl('chat-history');
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'delete',
                userJwt: userJwt || undefined,
                conversationId,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return { success: true };
    } catch (error) {
        console.error('[agentApi] deleteConversation error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

let agentRuntimeCache: {
    response: AgentRuntimeBootstrapResponse;
    expiresAtMs: number;
} | null = null;

function normalizeThinkingPolicy(value: unknown): AgentThinkingPolicySummary | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const row = value as Record<string, unknown>;
    return {
        reasonCodes: Array.isArray(row.reasonCodes)
            ? row.reasonCodes.map((item) => String(item)).filter(Boolean)
            : [],
        contextBudget: row.contextBudget === 'full' ? 'full' : 'minimal',
        modelReasoningEffort: row.modelReasoningEffort === 'minimal' ? 'minimal' : 'none',
        reasoningSummary: String(row.reasoningSummary || ''),
    };
}

function normalizeRuntimeBootstrap(data: Record<string, unknown>): AgentRuntimeBootstrapResponse {
    return {
        success: !!data.success,
        runtimeState: data.runtimeState as AgentRuntimeState | undefined,
        backgroundTasks: Array.isArray(data.backgroundTasks)
            ? data.backgroundTasks as AgentBackgroundTask[]
            : [],
        runtimeEvents: Array.isArray(data.runtimeEvents)
            ? data.runtimeEvents as AgentRuntimeEvent[]
            : [],
        memoryHighlights: Array.isArray(data.memoryHighlights)
            ? data.memoryHighlights as AgentMemoryFact[]
            : [],
        pendingActions: Array.isArray(data.pendingActions)
            ? data.pendingActions as AgentRuntimePendingAction[]
            : [],
        thinkingPolicy: normalizeThinkingPolicy(data.thinkingPolicy),
        error: typeof data.error === 'string' ? data.error : undefined,
    };
}

/**
 * 获取 Agent Runtime 快照：状态、后台任务、事件、记忆摘要和待确认动作。
 */
export async function fetchAgentRuntimeBootstrap(options?: {
    language?: SuggestionLanguage;
    preferCache?: boolean;
}): Promise<AgentRuntimeBootstrapResponse> {
    const preferCache = options?.preferCache !== false;
    const now = Date.now();
    if (preferCache && agentRuntimeCache && agentRuntimeCache.expiresAtMs > now) {
        return {
            ...agentRuntimeCache.response,
            backgroundTasks: [...agentRuntimeCache.response.backgroundTasks],
            runtimeEvents: [...agentRuntimeCache.response.runtimeEvents],
            memoryHighlights: [...agentRuntimeCache.response.memoryHighlights],
            pendingActions: [...agentRuntimeCache.response.pendingActions],
        };
    }

    try {
        const url = getEdgeFunctionUrl('agent-runtime');
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'bootstrap',
                language: normalizeSuggestionLanguage(options?.language),
                userJwt: userJwt || undefined,
            }),
        });
        const data = await response.json();
        const normalized = normalizeRuntimeBootstrap(data as Record<string, unknown>);
        if (!response.ok || !normalized.success) {
            return {
                success: false,
                backgroundTasks: [],
                runtimeEvents: [],
                memoryHighlights: [],
                pendingActions: [],
                error: normalized.error || `请求失败: ${response.status}`,
            };
        }

        agentRuntimeCache = {
            response: normalized,
            expiresAtMs: now + 60 * 1000,
        };
        return normalized;
    } catch (error) {
        console.error('[agentApi] fetchAgentRuntimeBootstrap error:', error);
        return {
            success: false,
            backgroundTasks: [],
            runtimeEvents: [],
            memoryHighlights: [],
            pendingActions: [],
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

export async function prewarmAgentRuntime(options?: {
    language?: SuggestionLanguage;
    forceRefresh?: boolean;
}): Promise<void> {
    const result = await fetchAgentRuntimeBootstrap({
        language: options?.language,
        preferCache: !options?.forceRefresh,
    });

    if (!result.success) {
        console.warn('[agentApi] prewarmAgentRuntime failed:', result.error || 'unknown');
    }
}

export async function ackAgentRuntimeEvent(eventId: string): Promise<{ success: boolean; error?: string }> {
    if (!eventId) return { success: false, error: '缺少 eventId' };

    try {
        const url = getEdgeFunctionUrl('agent-runtime');
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'ack_event',
                eventId,
                userJwt: userJwt || undefined,
            }),
        });
        const data = await response.json();
        if (!response.ok || data.success !== true) {
            return { success: false, error: data.error || `请求失败: ${response.status}` };
        }
        agentRuntimeCache = null;
        return { success: true };
    } catch (error) {
        console.error('[agentApi] ackAgentRuntimeEvent error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

export async function updateAgentRuntimeState(options: {
    thinkingModePreference?: 'auto' | 'fast' | 'slow';
    lifecycleStatus?: string;
}): Promise<{ success: boolean; error?: string }> {
    try {
        const url = getEdgeFunctionUrl('agent-runtime');
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'update_state',
                userJwt: userJwt || undefined,
                ...options,
            }),
        });
        const data = await response.json();
        if (!response.ok || data.success !== true) {
            return { success: false, error: data.error || `请求失败: ${response.status}` };
        }
        agentRuntimeCache = null;
        return { success: true };
    } catch (error) {
        console.error('[agentApi] updateAgentRuntimeState error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

export interface AgentSuggestedQuestionsResponse {
    success: boolean;
    questions: string[];
    contextTags: string[];
    triggerSignals: string[];
    generatedAt: string;
    expiresAt: string;
    fromCache: boolean;
    error?: string;
}

type SuggestionLanguage = 'zh-CN' | 'zh-TW' | 'en';

interface AgentSuggestionCacheEntry {
    key: string;
    response: AgentSuggestedQuestionsResponse;
    expiresAtMs: number;
}

const agentPresetCache = new Map<string, AgentSuggestionCacheEntry>();

function normalizeSuggestionLanguage(language?: string): SuggestionLanguage {
    if (language === 'en' || language === 'zh-TW') return language;
    return 'zh-CN';
}

function parsePresetExpiry(expiresAt: string): number {
    const parsed = Date.parse(expiresAt);
    if (Number.isNaN(parsed)) {
        return Date.now() + 5 * 60 * 1000;
    }
    return parsed;
}

function normalizeSuggestionResponse(data: Record<string, unknown>): AgentSuggestedQuestionsResponse {
    return {
        success: true,
        questions: Array.isArray(data.questions)
            ? data.questions.filter((item): item is string => typeof item === 'string')
            : [],
        contextTags: Array.isArray(data.contextTags)
            ? data.contextTags.map((item) => String(item))
            : [],
        triggerSignals: Array.isArray(data.triggerSignals)
            ? data.triggerSignals.map((item) => String(item))
            : [],
        generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString(),
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : new Date().toISOString(),
        fromCache: !!data.fromCache,
    };
}

function normalizeCachedSuggestionResponse(response: AgentSuggestedQuestionsResponse): AgentSuggestedQuestionsResponse {
    return {
        ...response,
        questions: [...response.questions],
        contextTags: [...response.contextTags],
        triggerSignals: [...response.triggerSignals],
        fromCache: true,
    };
}

function upsertSuggestionCache(key: string, response: AgentSuggestedQuestionsResponse): void {
    agentPresetCache.set(key, {
        key,
        response: {
            ...response,
            questions: [...response.questions],
            contextTags: [...response.contextTags],
            triggerSignals: [...response.triggerSignals],
        },
        expiresAtMs: parsePresetExpiry(response.expiresAt),
    });
}

function getValidSuggestionCache(key: string): AgentSuggestedQuestionsResponse | null {
    const cached = agentPresetCache.get(key);
    if (!cached) return null;
    if (cached.expiresAtMs <= Date.now()) return null;
    return normalizeCachedSuggestionResponse(cached.response);
}

async function getSuggestionCacheKey(language: SuggestionLanguage): Promise<string> {
    const userId = await getCurrentUserId();
    return `${userId || 'anonymous'}:${language}`;
}

/**
 * 获取 Agent 个性化问题（默认走 agent-bootstrap）
 */
export async function fetchAgentSuggestedQuestions(options?: {
    forceRefresh?: boolean;
    language?: SuggestionLanguage;
    preferCache?: boolean;
    contextKey?: string;
}): Promise<AgentSuggestedQuestionsResponse> {
    const forceRefresh = !!options?.forceRefresh;
    const language = normalizeSuggestionLanguage(options?.language);
    const preferCache = options?.preferCache !== false;
    const contextKey = String(options?.contextKey || 'global').trim() || 'global';
    const endpoint = forceRefresh ? 'generate-agent-suggestions' : 'agent-bootstrap';

    try {
        const cacheKey = `${await getSuggestionCacheKey(language)}:${contextKey}`;

        if (!forceRefresh && preferCache) {
            const cached = getValidSuggestionCache(cacheKey);
            if (cached) return cached;
        }

        const url = getEdgeFunctionUrl(endpoint);
        const headers = await getAuthHeaders();
        const userJwt = await getCurrentAccessToken();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                forceRefresh,
                language,
                userJwt: userJwt || undefined,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            const cached = !forceRefresh && preferCache ? getValidSuggestionCache(cacheKey) : null;
            if (cached) return cached;

            return {
                success: false,
                questions: [],
                contextTags: [],
                triggerSignals: [],
                generatedAt: new Date().toISOString(),
                expiresAt: new Date().toISOString(),
                fromCache: false,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        const normalized = normalizeSuggestionResponse(data as Record<string, unknown>);
        upsertSuggestionCache(cacheKey, normalized);
        return normalized;
    } catch (error) {
        console.error('[agentApi] fetchAgentSuggestedQuestions error:', error);

        if (!forceRefresh && preferCache) {
            const cacheKey = `${await getSuggestionCacheKey(language)}:${contextKey}`;
            const cached = getValidSuggestionCache(cacheKey);
            if (cached) return cached;
        }

        return {
            success: false,
            questions: [],
            contextTags: [],
            triggerSignals: [],
            generatedAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
            fromCache: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 进入 Agent 前预热个性化问题缓存
 */
export async function prewarmAgentSuggestedQuestions(options?: {
    language?: SuggestionLanguage;
    forceRefresh?: boolean;
}): Promise<void> {
    const result = await fetchAgentSuggestedQuestions({
        language: options?.language,
        forceRefresh: options?.forceRefresh,
        preferCache: true,
    });

    if (!result.success) {
        console.warn('[agentApi] prewarmAgentSuggestedQuestions failed:', result.error || 'unknown');
    }
}

// 兼容旧命名，避免现有调用中断
export type AgentPresetQuestionsResponse = AgentSuggestedQuestionsResponse;
export const fetchAgentPresetQuestions = fetchAgentSuggestedQuestions;
export const prewarmAgentPresetQuestions = prewarmAgentSuggestedQuestions;

// =============================================
// Agent Chat (多轮对话)
// =============================================

export interface ChatRequest {
    conversationId?: string;
    message: string;
    userId?: string;
    userJwt?: string;
    language?: 'zh-CN' | 'zh-TW' | 'en';
    medications?: string[];
    agentStyle?: 'friendly' | 'efficient';
}

export interface ChatResponse {
    success: boolean;
    conversationId: string;
    reply: string;
    thoughtMode?: 'fast' | 'slow';
    thinkingPolicy?: AgentThinkingPolicySummary;
    usedPersonalContext?: boolean;
    pendingAction?: AgentPendingAction;
    styleUsed?: 'friendly' | 'efficient';
    contextUsed?: {
        sourceTags: string[];
        ragMatchCount: number;
        drugKnowledgeCount: number;
        fetchedAt: string;
    };
    error?: string;
}

/**
 * 多轮对话 — 调用 agent-chat Edge Function
 */
export async function chatWithAgent(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    console.log('[agentApi] 💬 Agent Chat 发送消息');

    try {
        const url = getEdgeFunctionUrl('agent-chat');
        const userJwt = await getCurrentAccessToken();
        if (!userJwt) {
            return {
                success: false,
                conversationId: request.conversationId || 'local',
                reply: '',
                error: '请先登录后再使用 Agent',
            };
        }
        const headers = await getAuthHeaders();

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                ...request,
                userJwt: request.userJwt || userJwt || undefined,
            }),
        });

        const elapsed = Date.now() - startTime;
        console.log(`[agentApi] 💬 Chat 响应: status=${response.status} (${elapsed}ms)`);

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                conversationId: request.conversationId || 'local',
                reply: '',
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return data as ChatResponse;
    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`[agentApi] 💬 Chat 错误 (${elapsed}ms):`, error);
        return {
            success: false,
            conversationId: request.conversationId || 'local',
            reply: '',
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

export default {
    analyzeDrug,
    checkRisks,
    generateEmbedding,
    searchSimilarQueries,
    vectorizeDocument,
    fetchConversationList,
    fetchConversationMessages,
    deleteConversation,
    fetchAgentRuntimeBootstrap,
    prewarmAgentRuntime,
    ackAgentRuntimeEvent,
    updateAgentRuntimeState,
    fetchAgentSuggestedQuestions,
    prewarmAgentSuggestedQuestions,
    fetchAgentPresetQuestions,
    prewarmAgentPresetQuestions,
    chatWithAgent,
};
