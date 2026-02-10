/**
 * @file useAgentAnalysis.ts
 * @description AI Agent分析 Hook
 * @author AI用药助手开发团队
 * @created 2026-02-03
 */

import { useState, useCallback } from 'react';
import {
    analyzeDrug,
    checkRisks,
    type AnalyzeDrugRequest,
    type DrugAnalysisResult,
    type RiskAlert,
    type CheckRisksRequest,
} from '../../services/agentApi';

// =============================================
// 类型定义
// =============================================

export type AnalysisStep =
    | 'idle'
    | 'analyzing'
    | 'checking_risks'
    | 'complete'
    | 'error';

export interface AnalysisProgress {
    step: AnalysisStep;
    percentage: number;
    message: string;
}

export interface AgentAnalysisState {
    isAnalyzing: boolean;
    progress: AnalysisProgress;
    result: DrugAnalysisResult | null;
    riskAlerts: RiskAlert[];
    error: string | null;
}

export interface UseAgentAnalysisReturn extends AgentAnalysisState {
    /** 分析单个药物 */
    analyzedrugInfo: (drugName: string, language?: 'zh-CN' | 'zh-TW' | 'en') => Promise<void>;

    /** 检查个性化风险 */
    checkPersonalizedRisks: (request: CheckRisksRequest) => Promise<RiskAlert[]>;

    /** 清除结果 */
    clearResult: () => void;

    /** 重置状态 */
    reset: () => void;
}

// =============================================
// 初始状态
// =============================================

const initialProgress: AnalysisProgress = {
    step: 'idle',
    percentage: 0,
    message: '',
};

const initialState: AgentAnalysisState = {
    isAnalyzing: false,
    progress: initialProgress,
    result: null,
    riskAlerts: [],
    error: null,
};

// =============================================
// Hook 实现
// =============================================

/**
 * AI Agent分析 Hook
 * 
 * 功能:
 * 1. 分析药物信息 (RxNorm → DailyMed → OpenFDA → OpenAI)
 * 2. 检查个性化风险 (规则匹配)
 * 3. 提供分析进度状态
 */
export function useAgentAnalysis(): UseAgentAnalysisReturn {
    const [state, setState] = useState<AgentAnalysisState>(initialState);

    /**
     * 更新进度
     */
    const updateProgress = useCallback((step: AnalysisStep, percentage: number, message: string) => {
        setState(prev => ({
            ...prev,
            progress: { step, percentage, message },
        }));
    }, []);

    /**
     * 分析药物信息
     */
    const analyzedrugInfo = useCallback(async (
        drugName: string,
        language: 'zh-CN' | 'zh-TW' | 'en' = 'zh-CN'
    ) => {
        setState(prev => ({
            ...prev,
            isAnalyzing: true,
            error: null,
            progress: { step: 'analyzing', percentage: 10, message: '正在分析药物信息...' },
        }));

        try {
            // 调用Edge Function分析
            updateProgress('analyzing', 30, '正在标准化药物名称...');

            const request: AnalyzeDrugRequest = { drugName, language };
            const response = await analyzeDrug(request);

            if (!response.success || !response.data) {
                throw new Error(response.error || '分析失败');
            }

            updateProgress('complete', 100, '分析完成');

            setState(prev => ({
                ...prev,
                isAnalyzing: false,
                result: response.data!,
                progress: { step: 'complete', percentage: 100, message: '分析完成' },
            }));

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '分析失败，请稍后重试';

            setState(prev => ({
                ...prev,
                isAnalyzing: false,
                error: errorMessage,
                progress: { step: 'error', percentage: 0, message: errorMessage },
            }));
        }
    }, [updateProgress]);

    /**
     * 检查个性化风险
     */
    const checkPersonalizedRisks = useCallback(async (request: CheckRisksRequest): Promise<RiskAlert[]> => {
        setState(prev => ({
            ...prev,
            progress: { step: 'checking_risks', percentage: 80, message: '正在检查个性化风险...' },
        }));

        try {
            const response = await checkRisks(request);

            if (!response.success) {
                console.error('[useAgentAnalysis] Risk check failed:', response.error);
                return [];
            }

            setState(prev => ({
                ...prev,
                riskAlerts: response.alerts,
            }));

            return response.alerts;

        } catch (error) {
            console.error('[useAgentAnalysis] Risk check error:', error);
            return [];
        }
    }, []);

    /**
     * 清除结果
     */
    const clearResult = useCallback(() => {
        setState(prev => ({
            ...prev,
            result: null,
            riskAlerts: [],
            error: null,
        }));
    }, []);

    /**
     * 重置状态
     */
    const reset = useCallback(() => {
        setState(initialState);
    }, []);

    return {
        ...state,
        analyzedrugInfo,
        checkPersonalizedRisks,
        clearResult,
        reset,
    };
}

export default useAgentAnalysis;
