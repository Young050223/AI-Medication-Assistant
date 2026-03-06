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

export interface WorkflowLog {
    step: string;
    status: 'start' | 'success' | 'error' | 'skip' | 'info';
    message: string;
    timestamp: string;
    meta?: Record<string, unknown>;
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
    workflowLogs?: WorkflowLog[];
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

export interface ConversationListItem {
    id: string;
    title: string;
    updatedAt: string;
    createdAt: string;
    lastMessage?: string;
    lastMessageRole?: string;
}

export interface ConversationMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
}

export interface VectorizeDocumentRequest {
    userId: string;
    sourceType: 'chat_message' | 'medication_feedback' | 'user_query' | 'health_profile' | 'medication_schedule';
    sourceId?: string;
    content: string;
    metadata?: Record<string, unknown>;
}

export interface VectorizeDocumentResponse {
    success: boolean;
    documentId?: string;
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

async function getCurrentUserId(): Promise<string | null> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        return user?.id || null;
    } catch {
        return null;
    }
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

        const userId = await getCurrentUserId();
        if (!userId) {
            return { success: false, error: '用户未登录' };
        }

        // 2. 调用统一 RAG RPC函数搜索
        const { data, error } = await supabase.rpc('match_rag_documents', {
            query_embedding: embeddingResult.embedding,
            target_user_id: userId,
            source_types: ['user_query'],
            match_threshold: 0.7,
            match_count: limit,
        });

        if (error) {
            return { success: false, error: error.message };
        }

        return {
            success: true,
            results: data?.map((item: { content: string; metadata?: Record<string, unknown>; similarity: number }) => ({
                queryText: item.content,
                queryType: String(item.metadata?.query_type || 'drug_search'),
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

/**
 * 通用文档向量化
 */
export async function vectorizeDocument(
    request: VectorizeDocumentRequest
): Promise<VectorizeDocumentResponse> {
    try {
        const url = getEdgeFunctionUrl('vectorize-document');
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
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return data as VectorizeDocumentResponse;
    } catch (error) {
        console.error('[agentApi] vectorizeDocument error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 获取对话列表
 */
export async function fetchConversationList(
    userId: string,
    page: number = 1,
    pageSize: number = 20
): Promise<{ success: boolean; conversations: ConversationListItem[]; total: number; page: number; pageSize: number; error?: string }> {
    try {
        const url = getEdgeFunctionUrl('chat-history');
        const headers = await getAuthHeaders();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'list',
                userId,
                page,
                pageSize,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                conversations: [],
                total: 0,
                page,
                pageSize,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return {
            success: true,
            conversations: data.conversations || [],
            total: data.total || 0,
            page: data.page || page,
            pageSize: data.pageSize || pageSize,
        };
    } catch (error) {
        console.error('[agentApi] fetchConversationList error:', error);
        return {
            success: false,
            conversations: [],
            total: 0,
            page,
            pageSize,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 获取单个对话的消息列表
 */
export async function fetchConversationMessages(
    conversationId: string
): Promise<{ success: boolean; messages: ConversationMessage[]; error?: string }> {
    try {
        const url = getEdgeFunctionUrl('chat-history');
        const headers = await getAuthHeaders();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'messages',
                conversationId,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                messages: [],
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return {
            success: true,
            messages: data.messages || [],
        };
    } catch (error) {
        console.error('[agentApi] fetchConversationMessages error:', error);
        return {
            success: false,
            messages: [],
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

/**
 * 删除对话
 */
export async function deleteConversation(
    conversationId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const url = getEdgeFunctionUrl('chat-history');
        const headers = await getAuthHeaders();
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'delete',
                conversationId,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return { success: true };
    } catch (error) {
        console.error('[agentApi] deleteConversation error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

// =============================================
// Agent Chat (多轮对话)
// =============================================

export interface ChatRequest {
    conversationId?: string;
    message: string;
    userId?: string;
    language?: 'zh-CN' | 'zh-TW' | 'en';
    medications?: string[];
}

export interface ChatResponse {
    success: boolean;
    conversationId: string;
    reply: string;
    error?: string;
}

/**
 * 多轮对话 — 调用 agent-chat Edge Function
 */
export async function chatWithAgent(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    console.log('[agentApi] 💬 Agent Chat 发送消息');

    try {
        const url = getEdgeFunctionUrl('agent-chat');
        const headers = await getAuthHeaders();

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(request),
        });

        const elapsed = Date.now() - startTime;
        console.log(`[agentApi] 💬 Chat 响应: status=${response.status} (${elapsed}ms)`);

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                conversationId: request.conversationId || 'local',
                reply: '',
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return data as ChatResponse;
    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`[agentApi] 💬 Chat 错误 (${elapsed}ms):`, error);
        return {
            success: false,
            conversationId: request.conversationId || 'local',
            reply: '',
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

export default {
    analyzeDrug,
    checkRisks,
    generateEmbedding,
    searchSimilarQueries,
    vectorizeDocument,
    fetchConversationList,
    fetchConversationMessages,
    deleteConversation,
    chatWithAgent,
};
