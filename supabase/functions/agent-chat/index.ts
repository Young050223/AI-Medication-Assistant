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
import { generateEmbedding } from '../_shared/openai.ts';

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

interface HealthProfileRow {
    birth_date: string | null;
    gender: string | null;
    height_cm: number | null;
    weight_kg: number | null;
    medical_history: string | null;
    allergies: string | null;
}

interface MedicationScheduleRow {
    id: string;
    medication_name: string;
    medication_dosage: string | null;
    frequency: string | null;
    instructions: string | null;
    status: string | null;
    start_date: string;
    end_date: string | null;
    updated_at: string;
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

interface RagContext {
    healthProfile: string;
    activeMedications: string;
    pastMedications: string;
    retrievedDocuments: string;
}

interface OpenAIChatResult {
    data: any;
    model: string;
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

function getChatModelCandidates(): string[] {
    const primary = Deno.env.get('OPENAI_CHAT_MODEL') || 'gpt-4o-mini';
    const fallback = Deno.env.get('OPENAI_FALLBACK_CHAT_MODEL') || 'gpt-4.1-mini';
    return Array.from(new Set([primary, fallback].filter(Boolean)));
}

async function callOpenAIChat(params: {
    apiKey: string;
    messages: Array<{ role: string; content: string }>;
}): Promise<OpenAIChatResult> {
    const { apiKey, messages } = params;
    const models = getChatModelCandidates();
    const errors: string[] = [];

    for (const model of models) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.5,
                max_tokens: 800,
            }),
        });

        if (response.ok) {
            const data = await response.json();
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
        const status = item.status || 'unknown';
        const dateRange = `${item.start_date || '-'} ~ ${item.end_date || '至今'}`;
        return `${index + 1}. ${item.medication_name} | 状态: ${status} | 日期: ${dateRange}`;
    }).join('\n');
}

async function loadRagContext(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId?: string;
    message: string;
    openaiApiKey: string;
}): Promise<RagContext> {
    const { supabase, userId, message, openaiApiKey } = params;
    const context: RagContext = {
        healthProfile: '',
        activeMedications: '',
        pastMedications: '',
        retrievedDocuments: '',
    };

    if (!supabase || !userId) {
        return context;
    }

    const today = new Date().toISOString().split('T')[0];

    // 1) 直接查询健康档案
    const { data: profileData } = await supabase
        .from('health_profiles')
        .select('birth_date, gender, height_cm, weight_kg, medical_history, allergies')
        .eq('user_id', userId)
        .maybeSingle();

    context.healthProfile = formatHealthProfile(profileData as HealthProfileRow | null);

    // 2) 直接查询活跃用药
    const { data: schedulesData } = await supabase
        .from('medication_schedules')
        .select('id, medication_name, medication_dosage, frequency, instructions, status, start_date, end_date, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(20);

    const allSchedules = (schedulesData || []) as MedicationScheduleRow[];
    const activeSchedules = allSchedules.filter((item) =>
        item.status === 'active'
        && item.start_date <= today
        && (!item.end_date || item.end_date >= today)
    );
    const pastSchedules = allSchedules.filter((item) => !activeSchedules.find((active) => active.id === item.id));

    context.activeMedications = formatActiveMedications(activeSchedules);
    context.pastMedications = formatPastMedications(pastSchedules);

    // 3) 生成查询向量 + 4) 向量搜索历史文档
    try {
        const queryEmbedding = await generateEmbedding(message.slice(0, 2000), openaiApiKey);
        const { data: ragMatches, error: ragError } = await supabase.rpc('match_rag_documents', {
            query_embedding: queryEmbedding,
            target_user_id: userId,
            source_types: ['chat_message', 'medication_feedback'],
            match_threshold: 0.65,
            match_count: 5,
        });

        if (ragError) {
            console.error('[agent-chat] RAG检索失败:', ragError);
        } else {
            const matches = (ragMatches || []) as RagMatchRow[];
            context.retrievedDocuments = formatRetrievedDocuments(matches);
            console.log(`[agent-chat] RAG召回 ${matches.length} 条文档`);
        }
    } catch (err) {
        console.error('[agent-chat] RAG embedding失败:', err);
    }

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

    const { error } = await supabase
        .from('rag_documents')
        .insert({
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
        });

    if (error) {
        console.error('[agent-chat] 写入rag_documents失败:', error);
    }
}

function buildSystemPrompt(language: string, medications?: string[], ragContext?: RagContext): string {
    const langMap: Record<string, string> = {
        'zh-CN': '请用简体中文回复。',
        'zh-TW': '請用繁體中文回覆。',
        'en': 'Please respond in English.',
    };

    let medContext = '';
    if (medications && medications.length > 0) {
        medContext = `\n\n## 用户当前用药\n${medications.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n请根据用户的当前用药情况提供个性化建议。`;
    }

    let ragProfileContext = '';
    if (ragContext?.healthProfile) {
        ragProfileContext = `\n\n## 用户健康档案（数据库）\n${ragContext.healthProfile}`;
    }

    let ragMedicationContext = '';
    if (ragContext?.activeMedications) {
        ragMedicationContext = `\n\n## 用户活跃用药（数据库）\n${ragContext.activeMedications}`;
    }

    let ragPastMedicationContext = '';
    if (ragContext?.pastMedications) {
        ragPastMedicationContext = `\n\n## 用户过往用药（数据库）\n${ragContext.pastMedications}`;
    }

    let ragRetrievedContext = '';
    if (ragContext?.retrievedDocuments) {
        ragRetrievedContext = `\n\n## 历史相关记录（RAG召回）\n${ragContext.retrievedDocuments}`;
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
- 主动追问以更好地帮助用户
- 优先使用给定的用户上下文信息回答，若上下文不足请明确说明${medContext}${ragProfileContext}${ragMedicationContext}${ragPastMedicationContext}${ragRetrievedContext}

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
        const messageText = message?.trim() || '';

        if (!message || typeof message !== 'string' || messageText.length === 0) {
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
                    title: messageText.slice(0, 50),
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
        // Step 2.5: 组装RAG上下文
        // ========================================
        const ragContext = await loadRagContext({
            supabase,
            userId: body.userId,
            message: messageText,
            openaiApiKey: OPENAI_API_KEY,
        });

        // ========================================
        // Step 3: 持久化用户消息（聊天表）
        // ========================================
        let userMessageId: string | null = null;
        if (conversationId && supabase) {
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
        // Step 4: 调用 OpenAI Chat API
        // ========================================
        const systemPrompt = buildSystemPrompt(language, medications, ragContext);

        const openaiMessages = [
            { role: 'system', content: systemPrompt },
            ...historyMessages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: messageText },
        ];

        console.log(`[agent-chat] 发送 ${openaiMessages.length} 条消息到 OpenAI`);

        const startTime = Date.now();
        let openaiData: any;
        let usedModel = '';
        try {
            const result = await callOpenAIChat({
                apiKey: OPENAI_API_KEY,
                messages: openaiMessages,
            });
            openaiData = result.data;
            usedModel = result.model;
        } catch (chatErr) {
            const elapsed = Date.now() - startTime;
            console.error('[agent-chat] OpenAI 调用失败:', chatErr);
            console.log(`[agent-chat] OpenAI 响应失败, time=${elapsed}ms`);
            return new Response(
                JSON.stringify({ success: false, error: 'AI 服务暂时不可用，请稍后重试' }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const elapsed = Date.now() - startTime;
        console.log(`[agent-chat] OpenAI 响应成功: model=${usedModel}, time=${elapsed}ms`);

        const reply = openaiData.choices?.[0]?.message?.content || '抱歉，我暂时无法回答。请稍后再试。';

        console.log(`[agent-chat] 回复长度: ${reply.length}, tokens: prompt=${openaiData.usage?.prompt_tokens}, completion=${openaiData.usage?.completion_tokens}`);

        // ========================================
        // Step 5: 持久化 AI 回复（聊天表）
        // ========================================
        let assistantMessageId: string | null = null;
        if (conversationId && supabase) {
            const { data: insertedAssistant, error: assistantInsertErr } = await supabase
                .from('chat_messages')
                .insert({
                    conversation_id: conversationId,
                    role: 'assistant',
                    content: reply,
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
        // Step 6: 异步写入 RAG 文档
        // ========================================
        if (conversationId && supabase && body.userId) {
            const ragWriteTasks = [
                saveChatMessageToRag({
                    supabase,
                    userId: body.userId,
                    conversationId,
                    role: 'user',
                    content: messageText,
                    messageId: userMessageId,
                    language,
                    openaiApiKey: OPENAI_API_KEY,
                }),
                saveChatMessageToRag({
                    supabase,
                    userId: body.userId,
                    conversationId,
                    role: 'assistant',
                    content: reply,
                    messageId: assistantMessageId,
                    language,
                    openaiApiKey: OPENAI_API_KEY,
                }),
            ];

            void Promise.allSettled(ragWriteTasks).then((results) => {
                const failed = results.filter((r) => r.status === 'rejected').length;
                if (failed > 0) {
                    console.warn(`[agent-chat] ${failed} 条RAG写入失败`);
                } else {
                    console.log('[agent-chat] RAG写入完成');
                }
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
