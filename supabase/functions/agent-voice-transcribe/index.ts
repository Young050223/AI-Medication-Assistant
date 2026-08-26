/**
 * @file agent-voice-transcribe/index.ts
 * @description Agent Chat 语音转文字：前端录音 -> Qwen-3-ASR -> transcript
 * @endpoint POST /functions/v1/agent-voice-transcribe
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { transcribeAudioBlobWithQwen } from '../_shared/qwen_asr.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt',
};

interface AgentVoiceRequest {
    audioDataUrl?: string;
    language?: 'zh-CN' | 'zh-TW' | 'en' | 'zh';
    source?: 'agent-chat';
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

function normalizeAudioMimeType(file: File): string {
    const rawType = String(file.type || '').toLowerCase().trim();
    if (rawType.startsWith('audio/')) {
        return rawType;
    }

    const rawName = String(file.name || '').toLowerCase();
    if (rawName.endsWith('.wav')) return 'audio/wav';
    if (rawName.endsWith('.mp3')) return 'audio/mpeg';
    if (rawName.endsWith('.m4a') || rawName.endsWith('.mp4')) return 'audio/mp4';
    if (rawName.endsWith('.ogg') || rawName.endsWith('.oga')) return 'audio/ogg';
    if (rawName.endsWith('.webm')) return 'audio/webm';
    return 'audio/webm';
}

function dataUrlToAudioBlob(dataUrl: string): Blob {
    const match = dataUrl.match(/^data:(audio\/[^;]+);base64,(.+)$/i);
    if (!match) {
        throw new Error('无效的音频数据格式');
    }

    const mimeType = match[1];
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
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

        const token = getBearerToken(req);
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

        const contentType = String(req.headers.get('content-type') || '').toLowerCase();
        let rawLanguage = '';
        let normalizedAudioBlob: Blob | null = null;

        if (contentType.includes('application/json')) {
            const body: AgentVoiceRequest = await req.json();
            rawLanguage = String(body.language || '').trim();

            if (!body.audioDataUrl) {
                return new Response(
                    JSON.stringify({ success: false, error: '缺少 audioDataUrl' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            normalizedAudioBlob = dataUrlToAudioBlob(body.audioDataUrl);
        } else {
            const formData = await req.formData();
            const audioFile = formData.get('audio');
            rawLanguage = String(formData.get('language') || '').trim();

            if (!(audioFile instanceof File)) {
                return new Response(
                    JSON.stringify({ success: false, error: '缺少音频文件' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            if (audioFile.size <= 0) {
                return new Response(
                    JSON.stringify({ success: false, error: '未检测到有效音频' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            normalizedAudioBlob = new Blob(
                [await audioFile.arrayBuffer()],
                { type: normalizeAudioMimeType(audioFile) },
            );
        }

        if (!normalizedAudioBlob || normalizedAudioBlob.size <= 0) {
            return new Response(
                JSON.stringify({ success: false, error: '未检测到有效音频' }),
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

        const result = await transcribeAudioBlobWithQwen({
            audioBlob: normalizedAudioBlob,
            apiKey: qwenApiKey,
            language: rawLanguage === 'en' ? 'en' : 'zh',
        });

        return new Response(
            JSON.stringify({
                success: true,
                transcript: result.transcript,
                model: result.model,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('[agent-voice-transcribe] Error:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '语音转写失败',
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
