/**
 * @file generate-embedding/index.ts
 * @description 向量生成 Edge Function
 * @endpoint POST /functions/v1/generate-embedding
 * @created 2026-02-03
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateEmbedding } from '../_shared/openai.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EmbeddingRequest {
    text: string;
    queryType?: 'drug_search' | 'symptom' | 'interaction' | 'side_effect';
    saveToHistory?: boolean;
}

interface EmbeddingResponse {
    success: boolean;
    embedding?: number[];
    savedId?: string;
    error?: string;
}

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

        const body: EmbeddingRequest = await req.json();
        const { text, queryType = 'drug_search', saveToHistory = false } = body;

        if (!text || typeof text !== 'string') {
            return new Response(
                JSON.stringify({ success: false, error: '请提供文本内容' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!OPENAI_API_KEY) {
            return new Response(
                JSON.stringify({ success: false, error: '服务配置错误' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 生成向量
        console.log('[generate-embedding] Generating embedding for text length:', text.length);
        const embedding = await generateEmbedding(text, OPENAI_API_KEY);

        let savedId: string | undefined;

        // 如果需要保存到历史记录
        if (saveToHistory && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
            // 从请求头获取用户JWT
            const authHeader = req.headers.get('Authorization');

            if (authHeader) {
                const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

                // 验证用户token获取user_id
                const token = authHeader.replace('Bearer ', '');
                const { data: { user }, error: authError } = await supabase.auth.getUser(token);

                if (!authError && user) {
                    // 保存到用户查询历史
                    const { data, error: insertError } = await supabase
                        .from('user_query_embeddings')
                        .insert({
                            user_id: user.id,
                            query_text: text.slice(0, 500), // 限制长度
                            query_type: queryType,
                            embedding: embedding,
                        })
                        .select('id')
                        .single();

                    if (!insertError && data) {
                        savedId = data.id;
                    } else {
                        console.error('[generate-embedding] Save error:', insertError);
                    }
                }
            }
        }

        const response: EmbeddingResponse = {
            success: true,
            embedding,
            savedId,
        };

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('[generate-embedding] Error:', error);

        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '生成向量失败'
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
