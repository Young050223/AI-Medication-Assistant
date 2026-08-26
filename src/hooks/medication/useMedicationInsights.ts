/**
 * @file useMedicationInsights.ts
 * @description 首页用药洞察聚合（依从率/风险摘要）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../user/useAuth';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { formatLocalDateKey } from '../../utils/dateKey';

export type InsightRiskLevel = 'low' | 'medium' | 'high';

export interface MedicationInsights {
    adherenceRate30d: number | null;
    missedDoseCount7d: number;
    abnormalFeedbackCount30d: number;
    riskLevel: InsightRiskLevel;
    riskSummary: string;
    fetchedAt: string;
    source: 'cloud' | 'local';
}

interface UseMedicationInsightsReturn {
    insights: MedicationInsights;
    isLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

function dateOffsetKey(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return formatLocalDateKey(d);
}

function hasAbnormalKeyword(text: string | null | undefined): boolean {
    if (!text) return false;
    const content = text.toLowerCase();
    return ['严重', '异常', '加重', '胸闷', '心悸', '头晕', '恶心', '呕吐', '发麻', '疼痛'].some((kw) => content.includes(kw));
}

function buildRiskSummary(missedDoseCount7d: number, abnormalFeedbackCount30d: number): {
    riskLevel: InsightRiskLevel;
    riskSummary: string;
} {
    if (missedDoseCount7d >= 3 || abnormalFeedbackCount30d >= 3) {
        return {
            riskLevel: 'high',
            riskSummary: `近7天漏服 ${missedDoseCount7d} 次，异常反馈 ${abnormalFeedbackCount30d} 条，建议尽快联系医生复核方案。`,
        };
    }
    if (missedDoseCount7d > 0 || abnormalFeedbackCount30d > 0) {
        return {
            riskLevel: 'medium',
            riskSummary: `近7天漏服 ${missedDoseCount7d} 次，异常反馈 ${abnormalFeedbackCount30d} 条，请重点关注并按时复诊。`,
        };
    }
    return {
        riskLevel: 'low',
        riskSummary: '近期依从性和反馈稳定，可继续按当前医嘱执行。',
    };
}

const emptyInsights: MedicationInsights = {
    adherenceRate30d: null,
    missedDoseCount7d: 0,
    abnormalFeedbackCount30d: 0,
    riskLevel: 'low',
    riskSummary: '暂无足够云端数据，已显示本地计划信息。',
    fetchedAt: new Date().toISOString(),
    source: 'local',
};

/**
 * 首页洞察聚合 Hook
 */
export function useMedicationInsights(): UseMedicationInsightsReturn {
    const { user } = useAuth();
    const userId = user?.id || null;
    const cloudEnabled = useMemo(() => Boolean(userId) && isSupabaseConfigured(), [userId]);

    const [insights, setInsights] = useState<MedicationInsights>(emptyInsights);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!cloudEnabled || !userId) {
            setInsights((prev) => ({
                ...prev,
                source: 'local',
                fetchedAt: new Date().toISOString(),
            }));
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const since30d = dateOffsetKey(-30);
            const since7d = dateOffsetKey(-7);

            const [logRes, feedbackRes] = await Promise.all([
                supabase
                    .from('medication_logs')
                    .select('status, scheduled_date')
                    .eq('user_id', userId)
                    .gte('scheduled_date', since30d)
                    .in('status', ['taken', 'late', 'skipped'])
                    .limit(1000),
                supabase
                    .from('medication_feedback')
                    .select('mood, content, side_effects, feedback_date')
                    .eq('user_id', userId)
                    .gte('feedback_date', since30d)
                    .limit(400),
            ]);

            const logs = Array.isArray(logRes.data) ? logRes.data : [];
            const feedbacks = Array.isArray(feedbackRes.data) ? feedbackRes.data : [];

            const totalRelevantLogs = logs.filter((item) => item.status === 'taken' || item.status === 'late' || item.status === 'skipped');
            const adheredLogs = totalRelevantLogs.filter((item) => item.status === 'taken' || item.status === 'late');
            const missed7d = logs.filter((item) => item.status === 'skipped' && String(item.scheduled_date || '') >= since7d).length;

            const abnormalFeedbackCount30d = feedbacks.filter((item) => {
                if (item.mood === 'bad') return true;
                if (Array.isArray(item.side_effects) && item.side_effects.length > 0) return true;
                return hasAbnormalKeyword(item.content);
            }).length;

            const adherenceRate30d = totalRelevantLogs.length > 0
                ? Math.round((adheredLogs.length / totalRelevantLogs.length) * 100)
                : null;

            const { riskLevel, riskSummary } = buildRiskSummary(missed7d, abnormalFeedbackCount30d);
            setInsights({
                adherenceRate30d,
                missedDoseCount7d: missed7d,
                abnormalFeedbackCount30d,
                riskLevel,
                riskSummary,
                fetchedAt: new Date().toISOString(),
                source: 'cloud',
            });
        } catch (err) {
            console.error('[useMedicationInsights] load failed:', err);
            setError('云端洞察加载失败，已使用本地数据。');
            setInsights((prev) => ({
                ...prev,
                source: 'local',
                fetchedAt: new Date().toISOString(),
            }));
        } finally {
            setIsLoading(false);
        }
    }, [cloudEnabled, userId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {
        insights,
        isLoading,
        error,
        refresh,
    };
}

export default useMedicationInsights;
