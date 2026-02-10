/**
 * @file agentApi.ts
 * @description Agent API客户端 - 调用Supabase Edge Functions
 * @author AI用药助手开发团队
 * @created 2026-02-03
 * 
 * 安全: 所有API调用通过Edge Functions，前端无API Key暴露
 */

import { supabase } from './supabase';

// =============================================
// 类型定义
// =============================================

export interface AnalyzeDrugRequest {
    drugName: string;
    language?: 'zh-CN' | 'zh-TW' | 'en';
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
 * 获取认证Header - 使用 anon key 调用 Edge Function
 * 
 * 注意: Edge Function 不需要用户 JWT，只需要 anon key
 * 用户 JWT (ES256) 与 Supabase 网关不兼容会导致 401
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    console.log('┌─────────────────────────────────────────────');
    console.log('│ [Auth] Edge Function 认证');
    console.log('├─────────────────────────────────────────────');
    console.log(`│ 使用 anon key 调用 (长度: ${anonKey?.length || 0})`);
    console.log(`│ Key 预览: ${anonKey?.substring(0, 20)}...${anonKey?.slice(-10)}`);
    console.log('└─────────────────────────────────────────────');

    // 始终使用 anon key - 这是 curl 测试成功的配置
    return {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
    };
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

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                text,
                queryType: options?.queryType || 'drug_search',
                saveToHistory: options?.saveToHistory || false,
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

        // 2. 调用Supabase RPC函数搜索
        const { data, error } = await supabase.rpc('match_user_queries', {
            query_embedding: embeddingResult.embedding,
            match_threshold: 0.7,
            match_count: limit,
        });

        if (error) {
            return { success: false, error: error.message };
        }

        return {
            success: true,
            results: data?.map((item: { query_text: string; query_type: string; similarity: number }) => ({
                queryText: item.query_text,
                queryType: item.query_type,
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

export default {
    analyzeDrug,
    checkRisks,
    generateEmbedding,
    searchSimilarQueries,
};
