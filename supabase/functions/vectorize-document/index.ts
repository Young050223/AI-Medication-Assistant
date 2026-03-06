/**
 * @file vectorize-document/index.ts
 * @description 通用文档向量化 Edge Function
 * @endpoint POST /functions/v1/vectorize-document
 *
 * 功能: 接收任意文档内容 → 生成 embedding → 写入 rag_documents 统一表
 * 来源类型: chat_message, medication_feedback, user_query, health_profile
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateEmbedding } from '../_shared/openai.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// 类型
// =============================================

interface VectorizeRequest {
    userId: string;
    sourceType: 'chat_message' | 'medication_feedback' | 'user_query' | 'health_profile' | 'medication_schedule';
    sourceId?: string;
    content: string;
    metadata?: Record<string, unknown>;
}

interface VectorizeResponse {
    success: boolean;
    documentId?: string;
    error?: string;
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

        const body: VectorizeRequest = await req.json();
        const { userId, sourceType, sourceId, content, metadata = {} } = body;

        // 参数校验
        if (!userId) {
            return new Response(
                JSON.stringify({ success: false, error: '缺少 userId' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }
        if (!sourceType || !content) {
            return new Response(
                JSON.stringify({ success: false, error: '缺少 sourceType 或 content' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            return new Response(
                JSON.stringify({ success: false, error: '服务配置错误' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 1. 生成向量
        console.log(`[vectorize-document] Generating embedding for ${sourceType}, content length: ${content.length}`);
        const embedding = await generateEmbedding(content.slice(0, 2000), OPENAI_API_KEY);

        // 2. 写入 rag_documents
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data, error: insertError } = await supabase
            .from('rag_documents')
            .insert({
                user_id: userId,
                source_type: sourceType,
                source_id: sourceId || null,
                content: content.slice(0, 5000),
                embedding,
                metadata,
            })
            .select('id')
            .single();

        if (insertError) {
            console.error('[vectorize-document] Insert error:', insertError);
            return new Response(
                JSON.stringify({ success: false, error: insertError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log(`[vectorize-document] Saved document: ${data.id}`);

        const response: VectorizeResponse = {
            success: true,
            documentId: data.id,
        };

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('[vectorize-document] Error:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '向量化失败',
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
