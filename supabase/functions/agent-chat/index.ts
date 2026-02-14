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
 *   - gpt-5.3 模型，低成本高效率
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// 类型
// =============================================

interface ChatRequest {
    conversationId?: string;   // 空 = 新对话
    message: string;
    userId?: string;
    language?: 'zh-CN' | 'zh-TW' | 'en';
    medications?: string[];    // 当前用药列表（前端注入）
}

interface ChatResponse {
    success: boolean;
    conversationId: string;
    reply: string;
    error?: string;
}

interface DBMessage {
    role: string;
    content: string;
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
// System Prompt 构建
// =============================================

function buildSystemPrompt(language: string, medications?: string[]): string {
    const langMap: Record<string, string> = {
        'zh-CN': '请用简体中文回复。',
        'zh-TW': '請用繁體中文回覆。',
        'en': 'Please respond in English.',
    };

    let medContext = '';
    if (medications && medications.length > 0) {
        medContext = `\n\n## 用户当前用药\n${medications.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n请根据用户的当前用药情况提供个性化建议。`;
    }

    return `你是一位专业、友善的 AI 用药助手（类似 Gemini 的对话风格）。

## 核心职责
1. 回答用药相关问题（用法、副作用、相互作用、饮食禁忌等）
2. 基于用户的当前用药列表提供个性化提醒
3. 发现潜在用药风险时主动警示

## 安全原则
- **绝不做诊断** — 仅提供药物信息参考
- **始终建议咨询医生** — 任何涉及调整用药的问题都提醒遵医嘱
- **不确定时明确表示** — 不编造信息
- 在适当位置加入 ⚠️ 警示标记

## 对话风格
- 简洁友好，避免过度专业术语
- 关键信息用列表或粗体标记
- 每条回复控制在 200 字以内（除非用户要求详细解释）
- 主动追问以更好地帮助用户${medContext}

${langMap[language] || langMap['zh-CN']}`;
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

        const body: ChatRequest = await req.json();
        const { message, language = 'zh-CN', medications } = body;

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return new Response(
                JSON.stringify({ success: false, error: '请输入消息' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
        if (!OPENAI_API_KEY) {
            return new Response(
                JSON.stringify({ success: false, error: '服务配置错误: 缺少 API 密钥' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = getSupabaseClient();
        let conversationId = body.conversationId;

        // ========================================
        // Step 1: 创建或验证对话
        // ========================================
        if (!conversationId && supabase && body.userId) {
            const { data: conv, error: convErr } = await supabase
                .from('chat_conversations')
                .insert({
                    user_id: body.userId,
                    title: message.slice(0, 50),
                })
                .select('id')
                .single();

            if (!convErr && conv) {
                conversationId = conv.id;
                console.log(`[agent-chat] 新对话: ${conversationId}`);
            }
        }

        // ========================================
        // Step 2: 加载对话历史（最近 20 条）
        // ========================================
        let historyMessages: DBMessage[] = [];

        if (conversationId && supabase) {
            const { data: history } = await supabase
                .from('chat_messages')
                .select('role, content')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true })
                .limit(20);

            if (history) {
                historyMessages = history;
                console.log(`[agent-chat] 加载 ${history.length} 条历史消息`);
            }
        }

        // ========================================
        // Step 3: 持久化用户消息
        // ========================================
        if (conversationId && supabase) {
            await supabase.from('chat_messages').insert({
                conversation_id: conversationId,
                role: 'user',
                content: message.trim(),
            });
        }

        // ========================================
        // Step 4: 调用 OpenAI Chat API
        // ========================================
        const systemPrompt = buildSystemPrompt(language, medications);

        const openaiMessages = [
            { role: 'system', content: systemPrompt },
            ...historyMessages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message.trim() },
        ];

        console.log(`[agent-chat] 发送 ${openaiMessages.length} 条消息到 OpenAI`);

        const startTime = Date.now();
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-5.3',
                messages: openaiMessages,
                temperature: 0.5,
                max_tokens: 800,
            }),
        });

        const elapsed = Date.now() - startTime;
        console.log(`[agent-chat] OpenAI 响应: status=${openaiResponse.status}, time=${elapsed}ms`);

        if (!openaiResponse.ok) {
            const errText = await openaiResponse.text();
            console.error('[agent-chat] OpenAI 错误:', errText);
            return new Response(
                JSON.stringify({ success: false, error: 'AI 服务暂时不可用，请稍后重试' }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const openaiData = await openaiResponse.json();
        const reply = openaiData.choices?.[0]?.message?.content || '抱歉，我暂时无法回答。请稍后再试。';

        console.log(`[agent-chat] 回复长度: ${reply.length}, tokens: prompt=${openaiData.usage?.prompt_tokens}, completion=${openaiData.usage?.completion_tokens}`);

        // ========================================
        // Step 5: 持久化 AI 回复
        // ========================================
        if (conversationId && supabase) {
            await supabase.from('chat_messages').insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: reply,
            });
        }

        // ========================================
        // 返回
        // ========================================
        const response: ChatResponse = {
            success: true,
            conversationId: conversationId || 'local',
            reply,
        };

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('[agent-chat] Error:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '对话失败，请稍后重试',
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
