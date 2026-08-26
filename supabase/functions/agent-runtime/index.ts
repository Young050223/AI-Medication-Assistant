/**
 * @file agent-runtime/index.ts
 * @description Agent Runtime bootstrap/feed/CRUD endpoint.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
    selectAgentThinkingPolicy,
    type AgentThinkingModePreference,
} from '../_shared/agent_runtime/index.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt, x-trace-id',
};

type RuntimeAction =
    | 'bootstrap'
    | 'list'
    | 'get'
    | 'update_state'
    | 'update'
    | 'create_task'
    | 'enqueue_task'
    | 'cancel_task'
    | 'retry_task'
    | 'delete_task'
    | 'create_event'
    | 'ack_event'
    | 'archive_event'
    | 'create_memory'
    | 'update_memory'
    | 'revoke_memory';

interface RuntimeRequest {
    action?: RuntimeAction;
    userJwt?: string;
    language?: 'zh-CN' | 'zh-TW' | 'en';
    thinkingModePreference?: AgentThinkingModePreference;
    lifecycleStatus?: string;
    taskId?: string;
    eventId?: string;
    memoryId?: string;
    task?: {
        taskType?: string;
        title?: string;
        summary?: string;
        priority?: string;
        input?: Record<string, unknown>;
        scheduledAt?: string;
    };
    taskType?: string;
    title?: string;
    summary?: string;
    priority?: string;
    input?: Record<string, unknown>;
    memory?: {
        memoryType?: string;
        content?: string;
        confidence?: number;
        sourceTable?: string;
        sourceId?: string;
        expiresAt?: string;
        metadata?: Record<string, unknown>;
    };
    event?: {
        eventType?: string;
        title?: string;
        body?: string;
        severity?: string;
        payload?: Record<string, unknown>;
        visibleAt?: string;
    };
}

function createTraceId(req: Request): string {
    const header = req.headers.get('x-trace-id') || req.headers.get('X-Trace-Id');
    const normalized = header?.trim();
    if (normalized) return normalized.slice(0, 128);
    return crypto.randomUUID();
}

function jsonHeaders(traceId: string): Record<string, string> {
    return {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'x-trace-id': traceId,
    };
}

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
    const matched = value.match(/^Bearer\s+(.+)$/i);
    const token = matched ? matched[1] : value;
    return token.trim() || null;
}

function getBearerToken(req: Request): string | null {
    const userJwtHeader = normalizeToken(req.headers.get('x-user-jwt') || req.headers.get('X-User-Jwt'));
    if (userJwtHeader) return userJwtHeader;

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
    if (!supabase || !token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
}

function isMissingRelationError(error: { message?: string } | null | undefined, relation: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('relation') && message.includes(relation.toLowerCase()) && message.includes('does not exist');
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeThinkingPreference(value: unknown): AgentThinkingModePreference {
    if (value === 'fast' || value === 'slow') return value;
    return 'auto';
}

function normalizePriority(value: unknown): 'low' | 'normal' | 'high' | 'critical' {
    if (value === 'low' || value === 'high' || value === 'critical') return value;
    return 'normal';
}

function normalizeMemoryType(value: unknown): 'profile' | 'medication' | 'preference' | 'follow_up' | 'safety' | 'conversation' {
    if (
        value === 'profile'
        || value === 'medication'
        || value === 'preference'
        || value === 'follow_up'
        || value === 'safety'
        || value === 'conversation'
    ) {
        return value;
    }
    return 'conversation';
}

function clipText(value: unknown, max: number): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function mapRuntimeState(row: Record<string, unknown>) {
    return {
        userId: String(row.user_id || ''),
        lifecycleStatus: String(row.lifecycle_status || 'idle'),
        thinkingModePreference: normalizeThinkingPreference(row.thinking_mode_preference),
        currentThinkingMode: row.current_thinking_mode === 'slow' ? 'slow' : 'fast',
        lastContextSummary: String(row.last_context_summary || ''),
        lastContextTags: asStringArray(row.last_context_tags),
        lastTriggerSignals: asStringArray(row.last_trigger_signals),
        activeTaskCount: Number(row.active_task_count) || 0,
        pendingActionCount: Number(row.pending_action_count) || 0,
        backgroundStatus: row.background_status && typeof row.background_status === 'object'
            ? row.background_status
            : {},
        lastError: row.last_error || null,
        lastBootstrappedAt: row.last_bootstrapped_at || null,
        lastInteractionAt: row.last_interaction_at || null,
        createdAt: String(row.created_at || ''),
        updatedAt: String(row.updated_at || ''),
    };
}

function mapTask(row: Record<string, unknown>) {
    return {
        id: String(row.id || ''),
        taskType: String(row.task_type || ''),
        taskStatus: String(row.task_status || 'queued'),
        priority: String(row.priority || 'normal'),
        title: String(row.title || ''),
        summary: String(row.summary || ''),
        input: row.input && typeof row.input === 'object' ? row.input : {},
        output: row.output && typeof row.output === 'object' ? row.output : {},
        error: row.error || null,
        scheduledAt: String(row.scheduled_at || ''),
        startedAt: row.started_at || null,
        completedAt: row.completed_at || null,
        lockedAt: row.locked_at || null,
        attemptCount: Number(row.attempt_count) || 0,
        maxAttempts: Number(row.max_attempts) || 3,
        createdAt: String(row.created_at || ''),
        updatedAt: String(row.updated_at || ''),
    };
}

function mapEvent(row: Record<string, unknown>) {
    return {
        id: String(row.id || ''),
        sourceTaskId: row.source_task_id || null,
        sourceRequestId: row.source_request_id || null,
        eventType: String(row.event_type || ''),
        eventStatus: String(row.event_status || 'new'),
        severity: String(row.severity || 'info'),
        title: String(row.title || ''),
        body: String(row.body || ''),
        payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
        visibleAt: String(row.visible_at || ''),
        acknowledgedAt: row.acknowledged_at || null,
        createdAt: String(row.created_at || ''),
        updatedAt: String(row.updated_at || ''),
    };
}

function mapMemory(row: Record<string, unknown>) {
    return {
        id: String(row.id || ''),
        memoryType: String(row.memory_type || 'conversation'),
        factStatus: String(row.fact_status || 'active'),
        content: String(row.content || ''),
        sourceTable: row.source_table || null,
        sourceId: row.source_id || null,
        confidence: Number(row.confidence) || 0,
        expiresAt: row.expires_at || null,
        revokedAt: row.revoked_at || null,
        metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
        createdAt: String(row.created_at || ''),
        updatedAt: String(row.updated_at || ''),
    };
}

function mapPendingAction(row: Record<string, unknown>) {
    return {
        requestId: String(row.id || ''),
        commandName: String(row.command_name || ''),
        status: String(row.request_status || 'pending'),
        confirmationState: String(row.confirmation_state || 'pending'),
        priority: String(row.priority || 'normal'),
        title: String(row.title || ''),
        summary: String(row.summary || ''),
        createdAt: String(row.created_at || ''),
        updatedAt: String(row.updated_at || ''),
    };
}

async function loadSuggestionSignals(params: {
    supabase: NonNullable<ReturnType<typeof getSupabaseClient>>;
    userId: string;
}): Promise<{ contextTags: string[]; triggerSignals: string[] }> {
    const { supabase, userId } = params;
    const { data, error } = await supabase
        .from('agent_suggested_questions')
        .select('context_tags, trigger_signals')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) return { contextTags: [], triggerSignals: [] };
    const row = data as Record<string, unknown> | null;
    return {
        contextTags: asStringArray(row?.context_tags),
        triggerSignals: asStringArray(row?.trigger_signals),
    };
}

async function ensureContextPrefetchTask(params: {
    supabase: NonNullable<ReturnType<typeof getSupabaseClient>>;
    userId: string;
    contextTags: string[];
    triggerSignals: string[];
}) {
    const { supabase, userId, contextTags, triggerSignals } = params;
    const nowIso = new Date().toISOString();
    const recentSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const existing = await supabase
        .from('agent_background_tasks')
        .select('id')
        .eq('user_id', userId)
        .eq('task_type', 'context_prefetch')
        .gte('created_at', recentSince)
        .limit(1)
        .maybeSingle();

    if (existing.data || (existing.error && isMissingRelationError(existing.error, 'agent_background_tasks'))) {
        return;
    }

    const inserted = await supabase
        .from('agent_background_tasks')
        .insert({
            user_id: userId,
            task_type: 'context_prefetch',
            task_status: 'succeeded',
            priority: 'normal',
            title: '预读取用户上下文',
            summary: contextTags.length > 0
                ? `已预读取 ${contextTags.length} 类上下文。`
                : '已完成基础上下文预读取。',
            input: { trigger: 'agent_runtime_bootstrap' },
            output: {
                contextTags,
                triggerSignals,
            },
            scheduled_at: nowIso,
            started_at: nowIso,
            completed_at: nowIso,
            attempt_count: 1,
        })
        .select('id')
        .maybeSingle();

    if (inserted.error || !inserted.data?.id) return;

    const recentEvent = await supabase
        .from('agent_runtime_events')
        .select('id')
        .eq('user_id', userId)
        .eq('event_type', 'context_prefetched')
        .gte('created_at', recentSince)
        .limit(1)
        .maybeSingle();

    if (recentEvent.data || (recentEvent.error && isMissingRelationError(recentEvent.error, 'agent_runtime_events'))) {
        return;
    }

    await supabase
        .from('agent_runtime_events')
        .insert({
            user_id: userId,
            source_task_id: inserted.data.id,
            event_type: 'context_prefetched',
            event_status: 'new',
            severity: 'success',
            title: 'Agent 已预读取上下文',
            body: contextTags.length > 0
                ? `本次已准备：${contextTags.slice(0, 4).join('、')}`
                : '已完成基础状态准备，等待你的下一步输入。',
            payload: {
                contextTags,
                triggerSignals,
            },
        });
}

async function loadRuntimeSnapshot(params: {
    supabase: NonNullable<ReturnType<typeof getSupabaseClient>>;
    userId: string;
    language: string;
}) {
    const { supabase, userId } = params;
    const nowIso = new Date().toISOString();
    const suggestionSignals = await loadSuggestionSignals({ supabase, userId });

    await ensureContextPrefetchTask({
        supabase,
        userId,
        contextTags: suggestionSignals.contextTags,
        triggerSignals: suggestionSignals.triggerSignals,
    });

    const [pendingActionsRes, activeTasksRes] = await Promise.all([
        supabase
            .from('agent_action_requests')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .in('request_status', ['pending', 'ready', 'running']),
        supabase
            .from('agent_background_tasks')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .in('task_status', ['queued', 'running']),
    ]);

    const pendingActionCount = pendingActionsRes.count || 0;
    const activeTaskCount = activeTasksRes.count || 0;

    const stateUpsert = await supabase
        .from('agent_runtime_states')
        .upsert({
            user_id: userId,
            lifecycle_status: pendingActionCount > 0 ? 'waiting_confirmation' : 'ready',
            last_context_summary: suggestionSignals.contextTags.length > 0
                ? `已预读取 ${suggestionSignals.contextTags.length} 类上下文`
                : '已完成基础状态预读取',
            last_context_tags: suggestionSignals.contextTags,
            last_trigger_signals: suggestionSignals.triggerSignals,
            active_task_count: activeTaskCount,
            pending_action_count: pendingActionCount,
            background_status: {
                lastBootstrapAt: nowIso,
                contextPrepared: suggestionSignals.contextTags.length > 0,
            },
            last_bootstrapped_at: nowIso,
        }, {
            onConflict: 'user_id',
        })
        .select('*')
        .maybeSingle();

    if (stateUpsert.error) {
        throw new Error(stateUpsert.error.message);
    }

    const [tasksRes, eventsRes, memoryRes, actionsRes] = await Promise.all([
        supabase
            .from('agent_background_tasks')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(8),
        supabase
            .from('agent_runtime_events')
            .select('*')
            .eq('user_id', userId)
            .neq('event_status', 'archived')
            .is('acknowledged_at', null)
            .lte('visible_at', nowIso)
            .order('visible_at', { ascending: false })
            .limit(8),
        supabase
            .from('agent_memory_facts')
            .select('*')
            .eq('user_id', userId)
            .eq('fact_status', 'active')
            .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
            .order('updated_at', { ascending: false })
            .limit(8),
        supabase
            .from('agent_action_requests')
            .select('id, command_name, request_status, confirmation_state, priority, title, summary, created_at, updated_at')
            .eq('user_id', userId)
            .in('request_status', ['pending', 'ready', 'running'])
            .order('created_at', { ascending: false })
            .limit(8),
    ]);

    const state = mapRuntimeState((stateUpsert.data || {}) as Record<string, unknown>);
    const thinkingPolicy = selectAgentThinkingPolicy({
        message: '',
        preference: state.thinkingModePreference,
    });

    return {
        runtimeState: state,
        backgroundTasks: ((tasksRes.data || []) as Record<string, unknown>[]).map(mapTask),
        runtimeEvents: ((eventsRes.data || []) as Record<string, unknown>[]).map(mapEvent),
        memoryHighlights: ((memoryRes.data || []) as Record<string, unknown>[]).map(mapMemory),
        pendingActions: ((actionsRes.data || []) as Record<string, unknown>[]).map(mapPendingAction),
        thinkingPolicy,
    };
}

serve(async (req) => {
    const traceId = createTraceId(req);
    const respond = (status: number, payload: Record<string, unknown>) => new Response(
        JSON.stringify({ ...payload, traceId }),
        { status, headers: jsonHeaders(traceId) }
    );

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { ...corsHeaders, 'x-trace-id': traceId } });
    }

    if (req.method !== 'POST') {
        return respond(405, { success: false, error: 'Method not allowed' });
    }

    try {
        const supabase = getSupabaseClient();
        if (!supabase) return respond(500, { success: false, error: '服务配置错误' });

        const body = await req.json() as RuntimeRequest;
        const action = body.action || 'bootstrap';
        const userId = await getAuthenticatedUserId(
            supabase,
            normalizeToken(body.userJwt) || getBearerToken(req)
        );
        if (!userId) return respond(401, { success: false, error: '未授权访问' });

        if (action === 'bootstrap' || action === 'list' || action === 'get') {
            const snapshot = await loadRuntimeSnapshot({
                supabase,
                userId,
                language: body.language || 'zh-CN',
            });
            return respond(200, { success: true, ...snapshot });
        }

        if (action === 'update_state' || action === 'update') {
            const updates: Record<string, unknown> = {};
            if (body.thinkingModePreference) {
                updates.thinking_mode_preference = normalizeThinkingPreference(body.thinkingModePreference);
            }
            if (body.lifecycleStatus && ['idle', 'warming', 'ready', 'thinking', 'waiting_confirmation', 'acting', 'error'].includes(body.lifecycleStatus)) {
                updates.lifecycle_status = body.lifecycleStatus;
            }

            if (Object.keys(updates).length === 0) {
                return respond(400, { success: false, error: '没有可更新的状态字段' });
            }

            const { error } = await supabase
                .from('agent_runtime_states')
                .update(updates)
                .eq('user_id', userId);
            if (error) return respond(500, { success: false, error: error.message });
            return respond(200, { success: true });
        }

        if (action === 'create_task' || action === 'enqueue_task') {
            const taskType = clipText(body.task?.taskType || body.taskType, 64);
            const title = clipText(body.task?.title || body.title, 160);
            if (!taskType || !title) return respond(400, { success: false, error: '缺少 taskType 或 title' });
            const { data, error } = await supabase
                .from('agent_background_tasks')
                .insert({
                    user_id: userId,
                    task_type: taskType,
                    task_status: 'queued',
                    priority: normalizePriority(body.task?.priority || body.priority),
                    title,
                    summary: clipText(body.task?.summary || body.summary, 500),
                    input: body.task?.input || body.input || {},
                    scheduled_at: body.task?.scheduledAt || new Date().toISOString(),
                })
                .select('*')
                .single();
            if (error) return respond(500, { success: false, error: error.message });
            return respond(200, { success: true, task: mapTask(data as Record<string, unknown>) });
        }

        if (action === 'cancel_task' || action === 'retry_task' || action === 'delete_task') {
            if (!body.taskId) return respond(400, { success: false, error: '缺少 taskId' });
            const updates = action === 'cancel_task' || action === 'delete_task'
                ? { task_status: 'cancelled', completed_at: new Date().toISOString() }
                : { task_status: 'queued', error: null, scheduled_at: new Date().toISOString() };
            const { error } = await supabase
                .from('agent_background_tasks')
                .update(updates)
                .eq('id', body.taskId)
                .eq('user_id', userId);
            if (error) return respond(500, { success: false, error: error.message });
            return respond(200, { success: true });
        }

        if (action === 'create_event') {
            const eventType = clipText(body.event?.eventType, 64);
            const title = clipText(body.event?.title, 160);
            if (!eventType || !title) return respond(400, { success: false, error: '缺少 eventType 或 title' });
            const severity = ['success', 'warning', 'critical'].includes(String(body.event?.severity))
                ? String(body.event?.severity)
                : 'info';
            const { data, error } = await supabase
                .from('agent_runtime_events')
                .insert({
                    user_id: userId,
                    event_type: eventType,
                    event_status: 'new',
                    severity,
                    title,
                    body: clipText(body.event?.body, 500),
                    payload: body.event?.payload || {},
                    visible_at: body.event?.visibleAt || new Date().toISOString(),
                })
                .select('*')
                .single();
            if (error) return respond(500, { success: false, error: error.message });
            return respond(200, { success: true, event: mapEvent(data as Record<string, unknown>) });
        }

        if (action === 'ack_event' || action === 'archive_event') {
            if (!body.eventId) return respond(400, { success: false, error: '缺少 eventId' });
            const nowIso = new Date().toISOString();
            const updates = action === 'ack_event'
                ? { event_status: 'acknowledged', acknowledged_at: nowIso }
                : { event_status: 'archived', acknowledged_at: nowIso };
            const { error } = await supabase
                .from('agent_runtime_events')
                .update(updates)
                .eq('id', body.eventId)
                .eq('user_id', userId);
            if (error) return respond(500, { success: false, error: error.message });
            return respond(200, { success: true });
        }

        if (action === 'create_memory') {
            const content = clipText(body.memory?.content, 1000);
            if (!content) return respond(400, { success: false, error: '缺少 memory content' });
            const { data, error } = await supabase
                .from('agent_memory_facts')
                .insert({
                    user_id: userId,
                    memory_type: normalizeMemoryType(body.memory?.memoryType),
                    fact_status: 'active',
                    content,
                    source_table: clipText(body.memory?.sourceTable, 80) || null,
                    source_id: body.memory?.sourceId || null,
                    confidence: Math.max(0, Math.min(1, Number(body.memory?.confidence) || 0.7)),
                    expires_at: body.memory?.expiresAt || null,
                    metadata: body.memory?.metadata || {},
                })
                .select('*')
                .single();
            if (error) return respond(500, { success: false, error: error.message });
            return respond(200, { success: true, memory: mapMemory(data as Record<string, unknown>) });
        }

        if (action === 'update_memory' || action === 'revoke_memory') {
            if (!body.memoryId) return respond(400, { success: false, error: '缺少 memoryId' });
            const updates: Record<string, unknown> = action === 'revoke_memory'
                ? { fact_status: 'revoked', revoked_at: new Date().toISOString() }
                : {};
            if (action === 'update_memory') {
                if (body.memory?.content) updates.content = clipText(body.memory.content, 1000);
                if (body.memory?.confidence !== undefined) {
                    updates.confidence = Math.max(0, Math.min(1, Number(body.memory.confidence) || 0));
                }
                if (body.memory?.expiresAt !== undefined) updates.expires_at = body.memory.expiresAt || null;
                if (body.memory?.metadata) updates.metadata = body.memory.metadata;
            }
            const { error } = await supabase
                .from('agent_memory_facts')
                .update(updates)
                .eq('id', body.memoryId)
                .eq('user_id', userId);
            if (error) return respond(500, { success: false, error: error.message });
            return respond(200, { success: true });
        }

        return respond(400, { success: false, error: '不支持的 action' });
    } catch (error) {
        return respond(500, {
            success: false,
            error: error instanceof Error ? error.message : 'Agent Runtime 请求失败',
        });
    }
});
