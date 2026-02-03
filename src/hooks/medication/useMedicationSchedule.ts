/**
 * @file useMedicationSchedule.ts
 * @description 服药计划Hook，提供服药计划的Supabase云端存储和管理
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-24
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { useLocalStorage } from '../common/useLocalStorage';
import { useAuth } from '../user/useAuth';
import type {
    MedicationSchedule,
    MedicationReminder,
    ScheduleFormData,
    UseMedicationScheduleReturn,
    MedicationTimeSlot,
} from '../../types/MedicationSchedule.types';

// 本地存储键（备用）
const SCHEDULES_KEY = 'medication_schedules';

/**
 * 根据时间获取时间段
 */
const getTimeSlot = (time: string): MedicationTimeSlot => {
    const hour = parseInt(time.split(':')[0], 10);
    if (hour >= 5 && hour < 9) return 'morning';
    if (hour >= 9 && hour < 14) return 'noon';
    if (hour >= 14 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 21) return 'evening';
    return 'night';
};

/**
 * 将Supabase记录转换为前端类型
 */
const transformFromSupabase = (record: any): MedicationSchedule => ({
    id: record.id,
    medicationName: record.medication_name,
    medicationDosage: record.medication_dosage || '',
    instructions: record.instructions || undefined,
    frequency: record.frequency || '',
    reminders: record.reminders || [],
    durationDays: record.duration_days || undefined,
    status: record.status || 'active',
    startDate: record.start_date,
    endDate: record.end_date || undefined,
    sourceRecordId: record.source_record_id || undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
});

/**
 * 将前端类型转换为Supabase记录
 */
const transformToSupabase = (schedule: MedicationSchedule, userId: string) => ({
    user_id: userId,
    medication_name: schedule.medicationName,
    medication_dosage: schedule.medicationDosage,
    instructions: schedule.instructions || null,
    frequency: schedule.frequency,
    reminders: schedule.reminders,
    duration_days: schedule.durationDays || null,
    status: schedule.status,
    start_date: schedule.startDate,
    end_date: schedule.endDate || null,
    source_record_id: schedule.sourceRecordId || null,
});

/**
 * 服药计划Hook
 * 优先使用Supabase云端存储，降级使用本地存储
 */
export function useMedicationSchedule(): UseMedicationScheduleReturn {
    const { user } = useAuth();
    const { getItem, setItem } = useLocalStorage();

    // 状态
    const [schedules, setSchedules] = useState<MedicationSchedule[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * 获取存储键
     */
    const getStorageKey = useCallback(() => {
        return `${SCHEDULES_KEY}_${user?.id || 'guest'}`;
    }, [user?.id]);

    /**
     * 从Supabase加载服药计划
     */
    const loadFromSupabase = useCallback(async (userId: string): Promise<MedicationSchedule[]> => {
        const { data, error } = await supabase
            .from('medication_schedules')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return (data || []).map(transformFromSupabase);
    }, []);

    /**
     * 加载所有服药计划（优先Supabase，降级本地）
     */
    const loadSchedules = useCallback(async () => {
        if (!user?.id) {
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);

            // 优先尝试Supabase
            if (isSupabaseConfigured()) {
                try {
                    const supabaseSchedules = await loadFromSupabase(user.id);
                    setSchedules(supabaseSchedules);
                    console.log('[useMedicationSchedule] Supabase: 加载成功:', supabaseSchedules.length, '个计划');
                    return;
                } catch (err: any) {
                    console.warn('[useMedicationSchedule] Supabase加载失败，降级到本地:', err.message);
                }
            }

            // 降级到本地存储
            const key = getStorageKey();
            const storedSchedules = await getItem<MedicationSchedule[]>(key);
            if (storedSchedules) {
                setSchedules(storedSchedules);
                console.log('[useMedicationSchedule] 本地: 加载成功:', storedSchedules.length, '个计划');
            } else {
                setSchedules([]);
            }
        } catch (err: any) {
            console.error('[useMedicationSchedule] 加载失败:', err);
            setError('加载服药计划失败');
        } finally {
            setIsLoading(false);
        }
    }, [user?.id, getStorageKey, getItem, loadFromSupabase]);

    /**
     * 保存到Supabase
     */
    const saveToSupabase = useCallback(async (schedule: MedicationSchedule, userId: string): Promise<MedicationSchedule> => {
        const record = transformToSupabase(schedule, userId);

        // 检查是否已存在（通过ID格式判断）
        const isNewRecord = schedule.id.startsWith('schedule_');

        if (isNewRecord) {
            // 插入新记录
            const { data, error } = await supabase
                .from('medication_schedules')
                .insert(record)
                .select()
                .single();

            if (error) throw error;
            console.log('[useMedicationSchedule] Supabase: 创建成功');
            return transformFromSupabase(data);
        } else {
            // 更新现有记录
            const { data, error } = await supabase
                .from('medication_schedules')
                .update(record)
                .eq('id', schedule.id)
                .select()
                .single();

            if (error) throw error;
            console.log('[useMedicationSchedule] Supabase: 更新成功');
            return transformFromSupabase(data);
        }
    }, []);

    /**
     * 保存到本地存储（降级方案）
     */
    const saveToLocal = useCallback(async (newSchedules: MedicationSchedule[]) => {
        const key = getStorageKey();
        await setItem(key, newSchedules);
        setSchedules(newSchedules);
        console.log('[useMedicationSchedule] 本地: 保存成功');
    }, [getStorageKey, setItem]);

    /**
     * 创建新服药计划
     */
    const createSchedule = useCallback(async (data: ScheduleFormData): Promise<MedicationSchedule | null> => {
        if (!user?.id) {
            setError('用户未登录');
            return null;
        }

        try {
            setIsSaving(true);
            setError(null);

            // 生成提醒列表
            const reminders: MedicationReminder[] = data.reminderTimes.map((time, index) => ({
                id: `reminder_${Date.now()}_${index}`,
                timeSlot: getTimeSlot(time),
                time,
                dosage: data.medicationDosage,
                taken: false,
            }));

            // 计算日期
            const startDate = new Date().toISOString().split('T')[0];
            const durationDays = parseInt(data.durationDays, 10) || undefined;
            let endDate: string | undefined;
            if (durationDays) {
                const end = new Date();
                end.setDate(end.getDate() + durationDays);
                endDate = end.toISOString().split('T')[0];
            }

            // 创建计划对象
            const newSchedule: MedicationSchedule = {
                id: `schedule_${Date.now()}`,
                medicationName: data.medicationName,
                medicationDosage: data.medicationDosage,
                instructions: data.instructions || undefined,
                frequency: data.frequency,
                reminders,
                durationDays,
                status: 'active',
                startDate,
                endDate,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            // 优先保存到Supabase
            if (isSupabaseConfigured()) {
                try {
                    const savedSchedule = await saveToSupabase(newSchedule, user.id);
                    setSchedules(prev => [savedSchedule, ...prev]);
                    return savedSchedule;
                } catch (err: any) {
                    console.warn('[useMedicationSchedule] Supabase保存失败，降级到本地:', err.message);
                }
            }

            // 降级到本地
            const newSchedules = [newSchedule, ...schedules];
            await saveToLocal(newSchedules);
            return newSchedule;
        } catch (err: any) {
            console.error('[useMedicationSchedule] 创建失败:', err);
            setError('创建服药计划失败');
            return null;
        } finally {
            setIsSaving(false);
        }
    }, [user?.id, schedules, saveToSupabase, saveToLocal]);

    /**
     * 更新服药计划
     */
    const updateSchedule = useCallback(async (id: string, data: Partial<ScheduleFormData>): Promise<boolean> => {
        if (!user?.id) return false;

        try {
            setIsSaving(true);
            setError(null);

            const index = schedules.findIndex(s => s.id === id);
            if (index === -1) {
                setError('未找到该服药计划');
                return false;
            }

            const updated: MedicationSchedule = { ...schedules[index] };
            if (data.medicationName) updated.medicationName = data.medicationName;
            if (data.medicationDosage) updated.medicationDosage = data.medicationDosage;
            if (data.frequency) updated.frequency = data.frequency;
            if (data.instructions !== undefined) updated.instructions = data.instructions;
            updated.updatedAt = new Date().toISOString();

            // 优先保存到Supabase
            if (isSupabaseConfigured()) {
                try {
                    const savedSchedule = await saveToSupabase(updated, user.id);
                    const newSchedules = [...schedules];
                    newSchedules[index] = savedSchedule;
                    setSchedules(newSchedules);
                    return true;
                } catch (err: any) {
                    console.warn('[useMedicationSchedule] Supabase更新失败，降级到本地:', err.message);
                }
            }

            // 降级到本地
            const newSchedules = [...schedules];
            newSchedules[index] = updated;
            await saveToLocal(newSchedules);
            return true;
        } catch (err: any) {
            console.error('[useMedicationSchedule] 更新失败:', err);
            setError('更新服药计划失败');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [user?.id, schedules, saveToSupabase, saveToLocal]);

    /**
     * 删除服药计划
     */
    const deleteSchedule = useCallback(async (id: string): Promise<boolean> => {
        if (!user?.id) return false;

        try {
            setIsSaving(true);
            setError(null);

            // 优先从Supabase删除
            if (isSupabaseConfigured() && !id.startsWith('schedule_')) {
                try {
                    const { error } = await supabase
                        .from('medication_schedules')
                        .delete()
                        .eq('id', id);

                    if (error) throw error;
                    console.log('[useMedicationSchedule] Supabase: 删除成功');
                } catch (err: any) {
                    console.warn('[useMedicationSchedule] Supabase删除失败:', err.message);
                }
            }

            // 更新本地状态
            const newSchedules = schedules.filter(s => s.id !== id);
            setSchedules(newSchedules);
            await saveToLocal(newSchedules);
            return true;
        } catch (err: any) {
            console.error('[useMedicationSchedule] 删除失败:', err);
            setError('删除服药计划失败');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [user?.id, schedules, saveToLocal]);

    /**
     * 标记为已服用
     */
    const markAsTaken = useCallback(async (scheduleId: string, reminderId: string): Promise<boolean> => {
        if (!user?.id) return false;

        try {
            setError(null);

            const scheduleIndex = schedules.findIndex(s => s.id === scheduleId);
            if (scheduleIndex === -1) return false;

            const schedule = { ...schedules[scheduleIndex] };
            const reminderIndex = schedule.reminders.findIndex(r => r.id === reminderId);
            if (reminderIndex === -1) return false;

            // 更新提醒状态
            schedule.reminders = [...schedule.reminders];
            schedule.reminders[reminderIndex] = {
                ...schedule.reminders[reminderIndex],
                taken: true,
                takenAt: new Date().toISOString(),
            };
            schedule.updatedAt = new Date().toISOString();

            // 优先保存到Supabase
            if (isSupabaseConfigured() && !scheduleId.startsWith('schedule_')) {
                try {
                    await saveToSupabase(schedule, user.id);
                } catch (err: any) {
                    console.warn('[useMedicationSchedule] Supabase标记失败:', err.message);
                }
            }

            // 更新状态
            const newSchedules = [...schedules];
            newSchedules[scheduleIndex] = schedule;
            setSchedules(newSchedules);
            await saveToLocal(newSchedules);

            console.log('[useMedicationSchedule] 标记已服用:', schedule.medicationName);
            return true;
        } catch (err: any) {
            console.error('[useMedicationSchedule] 标记失败:', err);
            setError('标记失败');
            return false;
        }
    }, [user?.id, schedules, saveToSupabase, saveToLocal]);

    /**
     * 获取今日服药计划
     */
    const getTodaySchedules = useCallback((): MedicationSchedule[] => {
        const today = new Date().toISOString().split('T')[0];
        return schedules.filter(s => {
            if (s.status !== 'active') return false;
            if (s.startDate > today) return false;
            if (s.endDate && s.endDate < today) return false;
            return true;
        });
    }, [schedules]);

    /**
     * 清除错误
     */
    const clearError = useCallback(() => {
        setError(null);
    }, []);

    // 初始化时加载计划
    useEffect(() => {
        loadSchedules();
    }, [loadSchedules]);

    return {
        schedules,
        isLoading,
        isSaving,
        error,
        loadSchedules,
        createSchedule,
        updateSchedule,
        deleteSchedule,
        markAsTaken,
        getTodaySchedules,
        clearError,
    };
}

export default useMedicationSchedule;
