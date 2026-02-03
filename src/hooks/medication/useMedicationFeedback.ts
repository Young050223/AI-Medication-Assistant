/**
 * @file useMedicationFeedback.ts
 * @description 服药反馈管理Hook
 * @author AI用药助手开发团队
 * @created 2026-01-28
 */

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useAuth } from '../user/useAuth';
import type {
    MedicationFeedback,
    FeedbackFormData
} from '../../types/MedicationFeedback.types';

/**
 * 服药反馈Hook返回值
 */
interface UseMedicationFeedbackReturn {
    /** 反馈列表 */
    feedbacks: MedicationFeedback[];
    /** 是否正在加载 */
    isLoading: boolean;
    /** 是否正在保存 */
    isSaving: boolean;
    /** 错误信息 */
    error: string | null;
    /** 创建反馈 */
    createFeedback: (data: FeedbackFormData) => Promise<MedicationFeedback | null>;
    /** 获取某药物的反馈 */
    getFeedbacksByMedication: (medicationName: string) => MedicationFeedback[];
    /** 获取最近反馈 */
    getRecentFeedbacks: (days?: number) => MedicationFeedback[];
    /** 删除反馈 */
    deleteFeedback: (id: string) => Promise<boolean>;
    /** 刷新列表 */
    refresh: () => Promise<void>;
}

/**
 * 服药反馈管理Hook
 */
export function useMedicationFeedback(): UseMedicationFeedbackReturn {
    const { user } = useAuth();
    const [feedbacks, setFeedbacks] = useState<MedicationFeedback[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * 加载反馈列表
     */
    const loadFeedbacks = useCallback(async () => {
        if (!user?.id) {
            setFeedbacks([]);
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);

            const { data, error: fetchError } = await supabase
                .from('medication_feedback')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (fetchError) {
                throw fetchError;
            }

            // 转换数据格式
            const formattedFeedbacks: MedicationFeedback[] = (data || []).map(item => ({
                id: item.id,
                userId: item.user_id,
                scheduleId: item.schedule_id,
                medicationName: item.medication_name,
                feedbackDate: item.feedback_date,
                feedbackType: item.feedback_type,
                content: item.content,
                mood: item.mood,
                sideEffects: item.side_effects,
                createdAt: item.created_at,
                updatedAt: item.updated_at,
            }));

            setFeedbacks(formattedFeedbacks);
        } catch (err) {
            console.error('[useMedicationFeedback] 加载失败:', err);
            setError('加载反馈记录失败');
        } finally {
            setIsLoading(false);
        }
    }, [user?.id]);

    // 初始加载
    useEffect(() => {
        loadFeedbacks();
    }, [loadFeedbacks]);

    /**
     * 创建反馈
     */
    const createFeedback = useCallback(async (
        data: FeedbackFormData
    ): Promise<MedicationFeedback | null> => {
        if (!user?.id) {
            setError('请先登录');
            return null;
        }

        try {
            setIsSaving(true);
            setError(null);

            const feedbackData = {
                user_id: user.id,
                schedule_id: data.scheduleId || null,
                medication_name: data.medicationName,
                feedback_date: new Date().toISOString().split('T')[0],
                feedback_type: data.feedbackType,
                content: data.content,
                mood: data.mood || null,
                side_effects: data.sideEffects || [],
            };

            const { data: inserted, error: insertError } = await supabase
                .from('medication_feedback')
                .insert(feedbackData)
                .select()
                .single();

            if (insertError) {
                throw insertError;
            }

            const newFeedback: MedicationFeedback = {
                id: inserted.id,
                userId: inserted.user_id,
                scheduleId: inserted.schedule_id,
                medicationName: inserted.medication_name,
                feedbackDate: inserted.feedback_date,
                feedbackType: inserted.feedback_type,
                content: inserted.content,
                mood: inserted.mood,
                sideEffects: inserted.side_effects,
                createdAt: inserted.created_at,
                updatedAt: inserted.updated_at,
            };

            setFeedbacks(prev => [newFeedback, ...prev]);
            return newFeedback;
        } catch (err) {
            console.error('[useMedicationFeedback] 创建失败:', err);
            setError('保存反馈失败');
            return null;
        } finally {
            setIsSaving(false);
        }
    }, [user?.id]);

    /**
     * 删除反馈
     */
    const deleteFeedback = useCallback(async (id: string): Promise<boolean> => {
        try {
            setError(null);

            const { error: deleteError } = await supabase
                .from('medication_feedback')
                .delete()
                .eq('id', id);

            if (deleteError) {
                throw deleteError;
            }

            setFeedbacks(prev => prev.filter(f => f.id !== id));
            return true;
        } catch (err) {
            console.error('[useMedicationFeedback] 删除失败:', err);
            setError('删除反馈失败');
            return false;
        }
    }, []);

    /**
     * 获取某药物的反馈
     */
    const getFeedbacksByMedication = useCallback((
        medicationName: string
    ): MedicationFeedback[] => {
        return feedbacks.filter(f =>
            f.medicationName.toLowerCase() === medicationName.toLowerCase()
        );
    }, [feedbacks]);

    /**
     * 获取最近反馈
     */
    const getRecentFeedbacks = useCallback((days: number = 7): MedicationFeedback[] => {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffStr = cutoffDate.toISOString().split('T')[0];

        return feedbacks.filter(f => f.feedbackDate >= cutoffStr);
    }, [feedbacks]);

    return {
        feedbacks,
        isLoading,
        isSaving,
        error,
        createFeedback,
        getFeedbacksByMedication,
        getRecentFeedbacks,
        deleteFeedback,
        refresh: loadFeedbacks,
    };
}

export default useMedicationFeedback;
