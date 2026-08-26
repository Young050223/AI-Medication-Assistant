/**
 * @file chat-history/index.ts
 * @description 对话历史管理 Edge Function
 * @endpoint POST /functions/v1/chat-history
 *
 * 功能:
 *   action=list     → 获取用户对话列表（分页，含最后消息预览）
 *   action=messages  → 获取单个对话的全部消息
 *   action=delete    → 删除对话
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt, x-trace-id',
};

type LogLevel = 'info' | 'warn' | 'error';

function isFeatureEnabled(envKey: string, defaultValue: boolean = true): boolean {
    const raw = Deno.env.get(envKey);
    if (raw === undefined || raw === null || raw.trim() === '') return defaultValue;
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function createTraceId(req: Request): string {
    const header = req.headers.get('x-trace-id') || req.headers.get('X-Trace-Id');
    const normalized = header?.trim();
    if (normalized) return normalized.slice(0, 128);
    return crypto.randomUUID();
}

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
        service: 'chat-history',
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

interface ListRequest {
    action: 'list';
    userJwt?: string;
    page?: number;
    pageSize?: number;
}

interface MessagesRequest {
    action: 'messages';
    userJwt?: string;
    conversationId: string;
}

interface DeleteRequest {
    action: 'delete';
    userJwt?: string;
    conversationId: string;
}

type HistoryRequest = ListRequest | MessagesRequest | DeleteRequest;

interface ConversationItem {
    id: string;
    title: string;
    updatedAt: string;
    createdAt: string;
    lastMessage?: string;
    lastMessageRole?: string;
}

interface MessageItem {
    id: string;
    role: string;
    content: string;
    createdAt: string;
    thoughtMode?: 'fast' | 'slow';
    thinkingPolicy?: {
        reasonCodes: string[];
        contextBudget: 'minimal' | 'full';
        modelReasoningEffort: 'none' | 'minimal';
        reasoningSummary: string;
    };
    contextUsed?: {
        sourceTags: string[];
        ragMatchCount: number;
        drugKnowledgeCount: number;
        fetchedAt: string;
    };
}

function parseThinkingPolicy(metadata: unknown): MessageItem['thinkingPolicy'] {
    if (!metadata || typeof metadata !== 'object') return undefined;
    const record = metadata as Record<string, unknown>;
    const raw = record.thinking_policy;
    if (!raw || typeof raw !== 'object') return undefined;

    const policy = raw as Record<string, unknown>;
    const reasonCodes = Array.isArray(policy.reason_codes)
        ? policy.reason_codes.map((item) => String(item)).filter(Boolean)
        : [];
    const contextBudget = policy.context_budget === 'full' ? 'full' : 'minimal';
    const modelReasoningEffort = policy.model_reasoning_effort === 'minimal' ? 'minimal' : 'none';

    return {
        reasonCodes,
        contextBudget,
        modelReasoningEffort,
        reasoningSummary: String(policy.reasoning_summary || ''),
    };
}

function parseThoughtMode(metadata: unknown): MessageItem['thoughtMode'] {
    if (!metadata || typeof metadata !== 'object') return undefined;
    const value = (metadata as Record<string, unknown>).thought_mode;
    return value === 'fast' || value === 'slow' ? value : undefined;
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
        console.warn('[chat-history] auth failed:', error?.message || 'no user');
        return null;
    }
    return data.user.id;
}

async function ensureConversationOwner(
    supabase: ReturnType<typeof getSupabaseClient>,
    conversationId: string,
    userId: string
): Promise<{ exists: boolean; hasError: boolean }> {
    if (!supabase) return { exists: false, hasError: true };
    const { data, error } = await supabase
        .from('chat_conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('[chat-history] verify owner error:', error);
        return { exists: false, hasError: true };
    }

    return { exists: !!data, hasError: false };
}

function parseContextUsed(metadata: unknown): MessageItem['contextUsed'] {
    if (!metadata || typeof metadata !== 'object') return undefined;
    const record = metadata as Record<string, unknown>;
    const raw = record.context_used;
    if (!raw || typeof raw !== 'object') return undefined;

    const context = raw as Record<string, unknown>;
    const sourceTagsRaw = context.source_tags;
    const sourceTags = Array.isArray(sourceTagsRaw)
        ? sourceTagsRaw.map((item) => String(item)).filter(Boolean)
        : [];

    return {
        sourceTags,
        ragMatchCount: Number(context.rag_match_count) || 0,
        drugKnowledgeCount: Number(context.drug_knowledge_count) || 0,
        fetchedAt: typeof context.fetched_at === 'string'
            ? context.fetched_at
            : '',
    };
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
        if (!isFeatureEnabled('FEATURE_CHAT_HISTORY_ENABLED', true)) {
            return respond(
                503,
                { success: false, error: '历史会话功能暂未开放' },
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

        const body: HistoryRequest = await req.json();
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
        logTrace('info', 'request.authenticated', traceId, { user_id: authUserId });

        // ========================================
        // action=list — 对话列表
        // ========================================
        if (body.action === 'list') {
            const { page = 1, pageSize = 20 } = body as ListRequest;

            const offset = (page - 1) * pageSize;

            // 获取对话列表
            const { data: conversations, error: convErr } = await supabase
                .from('chat_conversations')
                .select('id, title, updated_at, created_at')
                .eq('user_id', authUserId)
                .order('updated_at', { ascending: false })
                .range(offset, offset + pageSize - 1);

            if (convErr) {
                console.error('[chat-history] list error:', convErr);
                return respond(
                    500,
                    { success: false, error: convErr.message },
                    'conversation.list_failed'
                );
            }

            // 为每个对话获取最后一条消息预览
            const items: ConversationItem[] = [];
            for (const conv of conversations || []) {
                const { data: lastMsg } = await supabase
                    .from('chat_messages')
                    .select('content, role')
                    .eq('conversation_id', conv.id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                items.push({
                    id: conv.id,
                    title: conv.title || '新对话',
                    updatedAt: conv.updated_at,
                    createdAt: conv.created_at,
                    lastMessage: lastMsg?.content?.slice(0, 100),
                    lastMessageRole: lastMsg?.role,
                });
            }

            // 获取总数
            const { count } = await supabase
                .from('chat_conversations')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', authUserId);

            return respond(
                200,
                {
                    success: true,
                    conversations: items,
                    total: count || 0,
                    page,
                    pageSize,
                },
                'conversation.list_succeeded',
                { count: items.length, page, page_size: pageSize }
            );
        }

        // ========================================
        // action=messages — 对话消息详情
        // ========================================
        if (body.action === 'messages') {
            const { conversationId } = body as MessagesRequest;

            if (!conversationId) {
                return respond(
                    400,
                    { success: false, error: '缺少 conversationId' },
                    'messages.invalid_request'
                );
            }

            const ownership = await ensureConversationOwner(supabase, conversationId, authUserId);
            if (ownership.hasError) {
                return respond(
                    500,
                    { success: false, error: '查询对话失败' },
                    'messages.verify_failed',
                    { conversation_id: conversationId }
                );
            }
            if (!ownership.exists) {
                return respond(
                    403,
                    { success: false, error: '无权访问该对话' },
                    'messages.forbidden',
                    { conversation_id: conversationId }
                );
            }

            const { data: messages, error: msgErr } = await supabase
                .from('chat_messages')
                .select('id, role, content, created_at, metadata')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });

            if (msgErr) {
                console.error('[chat-history] messages error:', msgErr);
                return respond(
                    500,
                    { success: false, error: msgErr.message },
                    'messages.query_failed',
                    { conversation_id: conversationId }
                );
            }

            const items: MessageItem[] = (messages || []).map(m => ({
                id: m.id,
                role: m.role,
                content: m.content,
                createdAt: m.created_at,
                thoughtMode: parseThoughtMode(m.metadata),
                thinkingPolicy: parseThinkingPolicy(m.metadata),
                contextUsed: parseContextUsed(m.metadata),
            }));

            return respond(
                200,
                { success: true, messages: items },
                'messages.query_succeeded',
                { conversation_id: conversationId, count: items.length }
            );
        }

        // ========================================
        // action=delete — 删除对话
        // ========================================
        if (body.action === 'delete') {
            const { conversationId } = body as DeleteRequest;

            if (!conversationId) {
                return respond(
                    400,
                    { success: false, error: '缺少 conversationId' },
                    'conversation.delete_invalid_request'
                );
            }

            const ownership = await ensureConversationOwner(supabase, conversationId, authUserId);
            if (ownership.hasError) {
                return respond(
                    500,
                    { success: false, error: '查询对话失败' },
                    'conversation.delete_verify_failed',
                    { conversation_id: conversationId }
                );
            }
            if (!ownership.exists) {
                return respond(
                    403,
                    { success: false, error: '无权删除该对话' },
                    'conversation.delete_forbidden',
                    { conversation_id: conversationId }
                );
            }

            // 删除对话（chat_messages 会通过 ON DELETE CASCADE 自动删除）
            const { error: delErr } = await supabase
                .from('chat_conversations')
                .delete()
                .eq('id', conversationId)
                .eq('user_id', authUserId);

            if (delErr) {
                console.error('[chat-history] delete error:', delErr);
                return respond(
                    500,
                    { success: false, error: delErr.message },
                    'conversation.delete_failed',
                    { conversation_id: conversationId }
                );
            }

            // 同时删除相关的 RAG 文档
            await supabase
                .from('rag_documents')
                .delete()
                .eq('user_id', authUserId)
                .eq('source_type', 'chat_message')
                .filter('metadata->>conversation_id', 'eq', conversationId);

            return respond(
                200,
                { success: true },
                'conversation.delete_succeeded',
                { conversation_id: conversationId }
            );
        }

        return respond(
            400,
            { success: false, error: '不支持的 action' },
            'request.invalid_action'
        );

    } catch (error) {
        console.error('[chat-history] Error:', error);
        return respond(
            500,
            {
                success: false,
                error: error instanceof Error ? error.message : '操作失败',
            },
            'request.failed_unexpected'
        );
    }
});
