/**
 * @file voice-feedback-assist/index.ts
 * @description 语音反馈辅助：Qwen-3-ASR 转写 + OpenAI 医学化总结
 * @endpoint POST /functions/v1/voice-feedback-assist
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
    extractAssistantText,
    transcribeAudioBlobWithQwen,
} from '../_shared/qwen_asr.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt',
};

type Lang = 'zh-CN' | 'zh-TW' | 'en';
type Action = 'transcribe' | 'summarize' | 'assist';

interface AssistRequest {
    action?: Action;
    userJwt?: string;
    audioDataUrl?: string;
    transcript?: string;
    medicationName?: string;
    mood?: 'good' | 'neutral' | 'bad' | 'mild' | 'severe';
    language?: Lang;
}

interface SummaryOutput {
    medicalText: string;
    structuredSummary: {
        chiefComplaint: string;
        symptomList: string[];
        severity: string;
        onset: string;
        duration: string;
        impact: string;
        notes: string;
    };
    safetyFlags: string[];
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

function normalizeLanguage(language?: string): Lang {
    if (language === 'zh-TW' || language === 'en') return language;
    return 'zh-CN';
}

function stripMarkdownCodeFence(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith('```')) return trimmed;
    return trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

function normalizeSummaryOutput(raw: Partial<SummaryOutput>): SummaryOutput {
    return {
        medicalText: String(raw.medicalText || '').trim(),
        structuredSummary: {
            chiefComplaint: String(raw.structuredSummary?.chiefComplaint || '患者未明确说明').trim(),
            symptomList: Array.isArray(raw.structuredSummary?.symptomList)
                ? raw.structuredSummary!.symptomList.map(item => String(item).trim()).filter(Boolean)
                : [],
            severity: String(raw.structuredSummary?.severity || '未明确').trim(),
            onset: String(raw.structuredSummary?.onset || '患者未明确说明').trim(),
            duration: String(raw.structuredSummary?.duration || '患者未明确说明').trim(),
            impact: String(raw.structuredSummary?.impact || '患者未明确说明').trim(),
            notes: String(raw.structuredSummary?.notes || '').trim(),
        },
        safetyFlags: Array.isArray(raw.safetyFlags)
            ? raw.safetyFlags.map(item => String(item).trim()).filter(Boolean)
            : [],
    };
}

function getSummarySystemPrompt(language: Lang): string {
    const langPromptMap: Record<Lang, string> = {
        'zh-CN': '请使用简体中文。',
        'zh-TW': '請使用繁體中文。',
        en: 'Please use English.',
    };

    return `你是医疗文书整理助手。你的任务是把“患者口语反馈”整理成更专业、客观、可读的医学化表述。

核心约束：
1) 只能基于输入文本改写，不得新增未提及事实。
2) 不做诊断，不给治疗建议，不推断病因。
3) 信息缺失时，明确写“患者未明确说明”。
4) 输出语气客观、克制、临床记录风格。

输出要求：
${langPromptMap[language]}
必须返回 JSON（不要 Markdown），字段如下：
{
  "medicalText": "给患者确认的医学化段落（1-3段）",
  "structuredSummary": {
    "chiefComplaint": "主诉",
    "symptomList": ["症状1", "症状2"],
    "severity": "轻/中/重或未明确",
    "onset": "起病时间",
    "duration": "持续时长",
    "impact": "对生活影响",
    "notes": "补充说明"
  },
  "safetyFlags": ["仅提取文本中已出现的危险信号，如呼吸困难/胸痛等；没有则空数组"]
}`;
}

function getSummaryUserPrompt(input: {
    transcript: string;
    medicationName?: string;
    mood?: string;
    language: Lang;
}): string {
    return [
        `语言: ${input.language}`,
        `药物名称: ${input.medicationName || '未提供'}`,
        `用户感受标签: ${input.mood || '未提供'}`,
        '患者原始口语反馈:',
        input.transcript,
    ].join('\n');
}

async function summarizeTranscriptWithOpenAI(options: {
    transcript: string;
    medicationName?: string;
    mood?: string;
    language: Lang;
    apiKey: string;
}): Promise<SummaryOutput> {
    const model = Deno.env.get('OPENAI_FEEDBACK_MODEL') || 'gpt-5.2';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            max_completion_tokens: 900,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: getSummarySystemPrompt(options.language) },
                {
                    role: 'user',
                    content: getSummaryUserPrompt({
                        transcript: options.transcript,
                        medicationName: options.medicationName,
                        mood: options.mood,
                        language: options.language,
                    }),
                },
            ],
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI summarize error: ${response.status} - ${errorText}`);
    }

    const payload = await response.json();
    const content = stripMarkdownCodeFence(extractAssistantText(payload));
    if (!content) {
        throw new Error('OpenAI 未返回总结内容');
    }

    let parsed: Partial<SummaryOutput> = {};
    try {
        parsed = JSON.parse(content);
    } catch {
        parsed = { medicalText: content };
    }

    const normalized = normalizeSummaryOutput(parsed);
    if (!normalized.medicalText) {
        normalized.medicalText = options.transcript.trim();
    }
    return normalized;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ success: false, error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const body: AssistRequest = await req.json();

        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            return new Response(
                JSON.stringify({ success: false, error: '服务配置错误: 缺少 Supabase 配置' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        const token = normalizeToken(body.userJwt) || getBearerToken(req);
        if (!token) {
            return new Response(
                JSON.stringify({ success: false, error: '未授权访问' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const { data: authData, error: authError } = await supabase.auth.getUser(token);
        if (authError || !authData?.user?.id) {
            return new Response(
                JSON.stringify({ success: false, error: '未授权访问' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const action: Action = body.action || 'assist';
        const language = normalizeLanguage(body.language);

        let transcript = (body.transcript || '').trim();
        if ((action === 'transcribe' || action === 'assist')) {
            if (!body.audioDataUrl) {
                return new Response(
                    JSON.stringify({ success: false, error: '缺少 audioDataUrl' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            const qwenApiKey = Deno.env.get('DASHSCOPE_API_KEY');
            if (!qwenApiKey) {
                return new Response(
                    JSON.stringify({ success: false, error: '服务配置错误: 缺少 DASHSCOPE_API_KEY' }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            const match = body.audioDataUrl.match(/^data:(audio\/[^;]+);base64,(.+)$/i);
            if (!match) {
                return new Response(
                    JSON.stringify({ success: false, error: '无效的音频数据格式' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            const mimeType = match[1];
            const base64 = match[2];
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }

            const audioBlob = new Blob([bytes], { type: mimeType });
            const asrResult = await transcribeAudioBlobWithQwen({
                audioBlob,
                apiKey: qwenApiKey,
                language: language === 'en' ? 'en' : 'zh',
            });
            transcript = asrResult.transcript;
        }

        if (action === 'transcribe') {
            return new Response(
                JSON.stringify({ success: true, transcript }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        if (!transcript) {
            return new Response(
                JSON.stringify({ success: false, error: '缺少 transcript' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
        if (!openaiApiKey) {
            return new Response(
                JSON.stringify({ success: false, error: '服务配置错误: 缺少 OPENAI_API_KEY' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const summary = await summarizeTranscriptWithOpenAI({
            transcript,
            medicationName: body.medicationName,
            mood: body.mood,
            language,
            apiKey: openaiApiKey,
        });

        return new Response(
            JSON.stringify({
                success: true,
                transcript,
                medicalText: summary.medicalText,
                structuredSummary: summary.structuredSummary,
                safetyFlags: summary.safetyFlags,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('[voice-feedback-assist] Error:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '处理失败',
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
