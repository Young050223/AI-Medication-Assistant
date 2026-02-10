/**
 * @file useMedicationFeedback.ts
 * @description 服药反馈管理 Hook
 * @author AI用药助手开发团队
 * @created 2026-02-03
 */

import { useState, useCallback } from 'react';
import { supabase } from '../../services/supabase';

// 类型定义
export interface MedicationFeedback {
    id: string;
    scheduleId?: string;
    medicationName: string;
    mood: 'good' | 'neutral' | 'bad';
    content: string;
    sideEffects: string[];
    createdAt: string;
}

export interface UseMedicationFeedbackReturn {
    isSaving: boolean;
    error: string | null;
    createFeedback: (feedback: Omit<MedicationFeedback, 'id' | 'createdAt'>) => Promise<boolean>;
    getFeedbackHistory: (medicationName?: string) => Promise<MedicationFeedback[]>;
}

const STORAGE_KEY = 'medication_feedback';

/**
 * 服药反馈管理 Hook
 */
export function useMedicationFeedback(): UseMedicationFeedbackReturn {
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * 提交反馈
     */
    const createFeedback = useCallback(async (
        feedback: Omit<MedicationFeedback, 'id' | 'createdAt'>
    ): Promise<boolean> => {
        setIsSaving(true);
        setError(null);

        try {
            const newFeedback: MedicationFeedback = {
                ...feedback,
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
            };

            // 保存到本地存储
            const stored = localStorage.getItem(STORAGE_KEY);
            const existing = stored ? JSON.parse(stored) : [];
            localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, newFeedback]));

            // 尝试同步到Supabase
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    await supabase.from('medication_feedback').insert({
                        user_id: user.id,
                        schedule_id: feedback.scheduleId,
                        medication_name: feedback.medicationName,
                        mood: feedback.mood,
                        content: feedback.content,
                        side_effects: feedback.sideEffects,
                    });
                }
            } catch (syncError) {
                console.warn('[useMedicationFeedback] Sync to cloud failed:', syncError);
            }

            return true;
        } catch (err) {
            console.error('[useMedicationFeedback] Submit error:', err);
            setError('提交反馈失败');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, []);

    /**
     * 获取反馈历史
     */
    const getFeedbackHistory = useCallback(async (
        medicationName?: string
    ): Promise<MedicationFeedback[]> => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return [];

            const feedbacks: MedicationFeedback[] = JSON.parse(stored);

            if (medicationName) {
                return feedbacks.filter(f => f.medicationName === medicationName);
            }

            return feedbacks;
        } catch {
            return [];
        }
    }, []);

    return {
        isSaving,
        error,
        createFeedback,
        getFeedbackHistory,
    };
}

export default useMedicationFeedback;
