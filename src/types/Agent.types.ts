/**
 * @file Agent.types.ts
 * @description AI Agent 模块类型定义
 * @author AI用药助手开发团队
 * @created 2026-02-03
 */

// =============================================
// RxNorm Types
// =============================================

/**
 * RxNorm API返回的药物概念
 */
export interface RxNormConcept {
    rxcui: string;
    name: string;
    synonym?: string;
    tty: string; // Term Type (IN, SCD, SBD, etc.)
}

/**
 * RxNorm药物属性
 */
export interface RxNormDrugProperties {
    rxcui: string;
    name: string;
    synonym?: string;
    tty: string;
    language?: string;
    suppress?: string;
    umlscui?: string;
}

/**
 * RxNorm API响应
 */
export interface RxNormSearchResult {
    idGroup?: {
        rxnormId?: string[];
    };
    drugGroup?: {
        conceptGroup?: Array<{
            tty: string;
            conceptProperties?: RxNormConcept[];
        }>;
    };
}

// =============================================
// DailyMed Types
// =============================================

/**
 * DailyMed SPL（药物说明书）
 */
export interface DailyMedSPL {
    setid: string;
    spl_version: number;
    title: string;
    published_date: string;
}

/**
 * 药物说明书部分
 */
export interface LabelSection {
    id: string;
    name: string;
    title: string;
    text: string;
}

/**
 * 完整药物标签信息
 */
export interface DrugLabel {
    setId: string;
    title: string;
    effectiveTime: string;
    sections: LabelSection[];
}

// =============================================
// OpenFDA Types
// =============================================

/**
 * OpenFDA不良事件反应统计
 */
export interface ReactionStat {
    term: string;
    count: number;
    percentage?: number;
}

/**
 * OpenFDA不良事件统计
 */
export interface AdverseEventStats {
    totalReports: number;
    seriousCount: number;
    deathCount: number;
    hospitalizationCount: number;
    topReactions: ReactionStat[];
    lastUpdated?: string;
}

/**
 * OpenFDA召回信息
 */
export interface RecallInfo {
    recallNumber: string;
    reason: string;
    status: string;
    recallInitiationDate: string;
    productDescription: string;
}

// =============================================
// OpenAI Types
// =============================================

/**
 * 药物总结请求
 */
export interface DrugSummaryRequest {
    drugName: string;
    rxcui?: string;
    drugLabel?: DrugLabel;
    adverseEvents?: AdverseEventStats;
    userContext?: {
        allergies?: string[];
        currentMedications?: string[];
        conditions?: string[];
    };
    language?: 'zh-CN' | 'zh-TW' | 'en';
}

/**
 * 药物总结响应
 */
export interface DrugSummary {
    overview: string;
    keyPoints: string[];
    warnings: string[];
    commonSideEffects: string[];
    foodInteractions?: string[];
    disclaimer: string;
    sources: string[];
}

// =============================================
// Agent Analysis Types
// =============================================

/**
 * 分析进度状态
 */
export type AnalysisStep =
    | 'idle'
    | 'normalizing'
    | 'fetching_label'
    | 'fetching_events'
    | 'summarizing'
    | 'complete'
    | 'error';

/**
 * 分析进度
 */
export interface AnalysisProgress {
    step: AnalysisStep;
    percentage: number;
    message: string;
}

/**
 * 完整药物分析结果
 */
export interface DrugAnalysisResult {
    drugName: string;
    normalizedName?: string;
    rxcui?: string;
    label?: DrugLabel;
    adverseEvents?: AdverseEventStats;
    summary?: DrugSummary;
    analyzedAt: string;
    error?: string;
}

/**
 * 多药物分析结果
 */
export interface MultiDrugAnalysisResult {
    drugs: DrugAnalysisResult[];
    interactions?: DrugInteraction[];
    overallSummary?: string;
    analyzedAt: string;
}

/**
 * 药物相互作用
 */
export interface DrugInteraction {
    drug1: string;
    drug2: string;
    severity: 'low' | 'moderate' | 'high' | 'critical';
    description: string;
    recommendation: string;
}

// =============================================
// Vector Search Types
// =============================================

/**
 * 查询类型
 */
export type QueryType = 'drug_search' | 'symptom' | 'interaction' | 'side_effect';

/**
 * 用户查询向量记录
 */
export interface UserQueryEmbedding {
    id: string;
    userId: string;
    queryText: string;
    queryType: QueryType;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    createdAt: string;
}

/**
 * 药物嵌入内容类型
 */
export type MedicationContentType = 'label' | 'adverse_event' | 'interaction';

/**
 * 药物向量记录
 */
export interface MedicationEmbedding {
    id: string;
    medicationName: string;
    rxcui?: string;
    contentType: MedicationContentType;
    contentText: string;
    embedding?: number[];
    source?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

/**
 * 相似查询结果
 */
export interface SimilarQuery {
    id: string;
    queryText: string;
    queryType: QueryType;
    similarity: number;
}

/**
 * 药物匹配结果
 */
export interface MedicationMatch {
    id: string;
    medicationName: string;
    contentType: MedicationContentType;
    contentText: string;
    similarity: number;
}

// =============================================
// API Configuration Types
// =============================================

/**
 * API配置
 */
export interface AgentAPIConfig {
    openaiApiKey?: string;
    openfdaApiKey?: string;
    embeddingModel?: string;
    chatModel?: string;
    maxTokens?: number;
}
