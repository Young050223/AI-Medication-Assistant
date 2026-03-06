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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// 类型
// =============================================

interface ListRequest {
    action: 'list';
    userId: string;
    page?: number;
    pageSize?: number;
}

interface MessagesRequest {
    action: 'messages';
    conversationId: string;
}

interface DeleteRequest {
    action: 'delete';
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

// =============================================
// 主处理逻辑
// =============================================

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ success: false, error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const body: HistoryRequest = await req.json();
        const supabase = getSupabaseClient();

        if (!supabase) {
            return new Response(
                JSON.stringify({ success: false, error: '服务配置错误' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ========================================
        // action=list — 对话列表
        // ========================================
        if (body.action === 'list') {
            const { userId, page = 1, pageSize = 20 } = body as ListRequest;

            if (!userId) {
                return new Response(
                    JSON.stringify({ success: false, error: '缺少 userId' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const offset = (page - 1) * pageSize;

            // 获取对话列表
            const { data: conversations, error: convErr } = await supabase
                .from('chat_conversations')
                .select('id, title, updated_at, created_at')
                .eq('user_id', userId)
                .order('updated_at', { ascending: false })
                .range(offset, offset + pageSize - 1);

            if (convErr) {
                console.error('[chat-history] list error:', convErr);
                return new Response(
                    JSON.stringify({ success: false, error: convErr.message }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
                .eq('user_id', userId);

            return new Response(
                JSON.stringify({
                    success: true,
                    conversations: items,
                    total: count || 0,
                    page,
                    pageSize,
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ========================================
        // action=messages — 对话消息详情
        // ========================================
        if (body.action === 'messages') {
            const { conversationId } = body as MessagesRequest;

            if (!conversationId) {
                return new Response(
                    JSON.stringify({ success: false, error: '缺少 conversationId' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { data: messages, error: msgErr } = await supabase
                .from('chat_messages')
                .select('id, role, content, created_at')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });

            if (msgErr) {
                console.error('[chat-history] messages error:', msgErr);
                return new Response(
                    JSON.stringify({ success: false, error: msgErr.message }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const items: MessageItem[] = (messages || []).map(m => ({
                id: m.id,
                role: m.role,
                content: m.content,
                createdAt: m.created_at,
            }));

            return new Response(
                JSON.stringify({ success: true, messages: items }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ========================================
        // action=delete — 删除对话
        // ========================================
        if (body.action === 'delete') {
            const { conversationId } = body as DeleteRequest;

            if (!conversationId) {
                return new Response(
                    JSON.stringify({ success: false, error: '缺少 conversationId' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 删除对话（chat_messages 会通过 ON DELETE CASCADE 自动删除）
            const { error: delErr } = await supabase
                .from('chat_conversations')
                .delete()
                .eq('id', conversationId);

            if (delErr) {
                console.error('[chat-history] delete error:', delErr);
                return new Response(
                    JSON.stringify({ success: false, error: delErr.message }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 同时删除相关的 RAG 文档
            await supabase
                .from('rag_documents')
                .delete()
                .eq('source_type', 'chat_message')
                .filter('metadata->>conversation_id', 'eq', conversationId);

            return new Response(
                JSON.stringify({ success: true }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ success: false, error: '不支持的 action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('[chat-history] Error:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '操作失败',
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
