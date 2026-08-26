/**
 * @file useMedicationFeedback.ts
 * @description 服药反馈管理 Hook
 * @author AI用药助手开发团队
 * @created 2026-02-03
 */

import { useState, useCallback, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { vectorizeDocument } from '../../services/agentApi';
import { useAuth } from '../user/useAuth';

// 类型定义
export interface MedicationFeedback {
    id: string;
    scheduleId?: string;
    reminderId?: string;
    doseDate?: string;
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

const STORAGE_KEY_PREFIX = 'medication_feedback';
const CLOUD_MIGRATION_MARKER_PREFIX = 'medication_feedback_cloud_migrated';

/**
 * 服药反馈管理 Hook
 */
export function useMedicationFeedback(): UseMedicationFeedbackReturn {
    const { user } = useAuth();
    const userId = user?.id || null;
    const cloudEnabled = useMemo(() => Boolean(userId) && isSupabaseConfigured(), [userId]);
    const storageKey = useMemo(
        () => (userId ? `${STORAGE_KEY_PREFIX}_${userId}` : STORAGE_KEY_PREFIX),
        [userId]
    );
    const cloudMigrationMarkerKey = useMemo(
        () => (userId ? `${CLOUD_MIGRATION_MARKER_PREFIX}_${userId}` : null),
        [userId]
    );
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const readLocalCache = useCallback((): MedicationFeedback[] => {
        try {
            const stored = localStorage.getItem(storageKey);
            if (!stored) return [];
            const parsed = JSON.parse(stored);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }, [storageKey]);

    const writeLocalCache = useCallback((items: MedicationFeedback[]) => {
        localStorage.setItem(storageKey, JSON.stringify(items));
    }, [storageKey]);

    const migrateLocalFeedbackToCloudIfNeeded = useCallback(async (): Promise<void> => {
        if (!cloudEnabled || !userId || !cloudMigrationMarkerKey) return;
        if (localStorage.getItem(cloudMigrationMarkerKey) === 'done') return;

        const localItems = readLocalCache();
        if (localItems.length === 0) {
            localStorage.setItem(cloudMigrationMarkerKey, 'done');
            return;
        }

        const payload = localItems.map((item) => ({
            id: item.id,
            user_id: userId,
            schedule_id: item.scheduleId || null,
            medication_name: item.medicationName,
            mood: item.mood,
            content: item.content,
            side_effects: item.sideEffects,
            feedback_date: (item.doseDate || item.createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
            created_at: item.createdAt || new Date().toISOString(),
            feedback_type: 'text',
        }));

        const chunkSize = 300;
        for (let i = 0; i < payload.length; i += chunkSize) {
            const chunk = payload.slice(i, i + chunkSize);
            const { error: upsertError } = await supabase
                .from('medication_feedback')
                .upsert(chunk, { onConflict: 'id' });
            if (upsertError) {
                throw new Error(`migrate medication_feedback failed: ${upsertError.message}`);
            }
        }

        localStorage.setItem(cloudMigrationMarkerKey, 'done');
        console.log('[useMedicationFeedback] local feedback migrated to cloud');
    }, [cloudEnabled, userId, cloudMigrationMarkerKey, readLocalCache]);

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
            let savedFeedback = newFeedback;

            if (cloudEnabled && userId) {
                try {
                    await migrateLocalFeedbackToCloudIfNeeded();

                    const { data: insertedFeedback, error: insertError } = await supabase
                        .from('medication_feedback')
                        .insert({
                            user_id: userId,
                            schedule_id: feedback.scheduleId || null,
                            medication_name: feedback.medicationName,
                            mood: feedback.mood,
                            content: feedback.content,
                            side_effects: feedback.sideEffects,
                        })
                        .select('id, created_at')
                        .single();

                    if (insertError) {
                        throw insertError;
                    }

                    savedFeedback = {
                        ...newFeedback,
                        id: insertedFeedback?.id || newFeedback.id,
                        createdAt: insertedFeedback?.created_at || newFeedback.createdAt,
                    };

                    const sideEffectsText = feedback.sideEffects.length
                        ? feedback.sideEffects.join(', ')
                        : '无';
                    const ragContent = [
                        `药物: ${feedback.medicationName}`,
                        `感受: ${feedback.mood}`,
                        `副作用标签: ${sideEffectsText}`,
                        `反馈内容: ${feedback.content}`,
                    ].join('\n');

                    void vectorizeDocument({
                        userId,
                        sourceType: 'medication_feedback',
                        sourceId: insertedFeedback?.id,
                        content: ragContent,
                        metadata: {
                            medication_name: feedback.medicationName,
                            mood: feedback.mood,
                            side_effects: feedback.sideEffects,
                            schedule_id: feedback.scheduleId || null,
                            reminder_id: feedback.reminderId || null,
                            dose_date: feedback.doseDate || null,
                        },
                    }).then((result) => {
                        if (!result.success) {
                            console.warn('[useMedicationFeedback] Vectorize failed:', result.error);
                        }
                    }).catch((vectorErr) => {
                        console.warn('[useMedicationFeedback] Vectorize error:', vectorErr);
                    });
                } catch (syncError) {
                    console.warn('[useMedicationFeedback] cloud save failed, fallback local:', syncError);
                    setError('云端保存失败，已保存在本地缓存');
                }
            }

            const existing = readLocalCache().filter((item) => item.id !== savedFeedback.id);
            writeLocalCache([...existing, savedFeedback]);
            return true;
        } catch (err) {
            console.error('[useMedicationFeedback] Submit error:', err);
            setError('提交反馈失败');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [cloudEnabled, userId, readLocalCache, writeLocalCache, migrateLocalFeedbackToCloudIfNeeded]);

    /**
     * 获取反馈历史
     */
    const getFeedbackHistory = useCallback(async (
        medicationName?: string
    ): Promise<MedicationFeedback[]> => {
        try {
            if (cloudEnabled && userId) {
                try {
                    await migrateLocalFeedbackToCloudIfNeeded();
                } catch (migrationError) {
                    console.warn('[useMedicationFeedback] local->cloud migration failed, continue with cloud query:', migrationError);
                    setError('本地反馈迁移到云端失败，已继续加载现有数据');
                }

                const { data, error: queryError } = await supabase
                    .from('medication_feedback')
                    .select('id, schedule_id, medication_name, mood, content, side_effects, created_at')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(500);

                if (!queryError && Array.isArray(data)) {
                    const cloudFeedbacks: MedicationFeedback[] = data.map((item) => ({
                        id: item.id,
                        scheduleId: item.schedule_id || undefined,
                        medicationName: item.medication_name,
                        mood: item.mood as MedicationFeedback['mood'],
                        content: item.content,
                        sideEffects: Array.isArray(item.side_effects) ? item.side_effects : [],
                        createdAt: item.created_at,
                    }));

                    writeLocalCache(cloudFeedbacks);
                    if (medicationName) {
                        return cloudFeedbacks.filter((feedbackItem) => feedbackItem.medicationName === medicationName);
                    }
                    return cloudFeedbacks;
                }

                if (queryError) {
                    console.warn('[useMedicationFeedback] cloud history load failed, fallback local:', queryError.message);
                }
            }

            const feedbacks = readLocalCache();
            if (medicationName) {
                return feedbacks.filter(f => f.medicationName === medicationName);
            }
            return feedbacks;
        } catch {
            return [];
        }
    }, [cloudEnabled, userId, readLocalCache, writeLocalCache, migrateLocalFeedbackToCloudIfNeeded]);

    return {
        isSaving,
        error,
        createFeedback,
        getFeedbackHistory,
    };
}

export default useMedicationFeedback;
