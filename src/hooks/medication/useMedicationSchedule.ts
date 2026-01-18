/**
 * @file useMedicationSchedule.ts
 * @description 服药计划Hook，提供服药计划的本地加密存储和管理
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-18
 */

import { useState, useEffect, useCallback } from 'react';
import { useLocalStorage } from '../common/useLocalStorage';
import { useAuth } from '../user/useAuth';
import type {
    MedicationSchedule,
    MedicationReminder,
    ScheduleFormData,
    UseMedicationScheduleReturn,
    MedicationTimeSlot,
} from '../../types/MedicationSchedule.types';

// 存储键
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
 * 服药计划Hook
 * 提供服药计划的增删改查功能，数据本地加密存储
 * 
 * @returns {UseMedicationScheduleReturn} 服药计划状态和方法
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
     * 加载所有服药计划
     */
    const loadSchedules = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const key = getStorageKey();
            const storedSchedules = await getItem<MedicationSchedule[]>(key);

            if (storedSchedules) {
                setSchedules(storedSchedules);
                console.log('[useMedicationSchedule] 加载成功:', storedSchedules.length, '个计划');
            } else {
                setSchedules([]);
                console.log('[useMedicationSchedule] 未找到服药计划');
            }
        } catch (err: any) {
            console.error('[useMedicationSchedule] 加载失败:', err);
            setError('加载服药计划失败');
        } finally {
            setIsLoading(false);
        }
    }, [getStorageKey, getItem]);

    /**
     * 保存所有服药计划到本地存储
     */
    const saveSchedules = useCallback(async (newSchedules: MedicationSchedule[]) => {
        try {
            const key = getStorageKey();
            await setItem(key, newSchedules);
            setSchedules(newSchedules);
        } catch (err) {
            console.error('[useMedicationSchedule] 保存失败:', err);
            throw err;
        }
    }, [getStorageKey, setItem]);

    /**
     * 创建新服药计划
     */
    const createSchedule = useCallback(async (data: ScheduleFormData): Promise<MedicationSchedule | null> => {
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

            // 计算结束日期
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

            // 保存
            const newSchedules = [...schedules, newSchedule];
            await saveSchedules(newSchedules);

            console.log('[useMedicationSchedule] 创建成功:', newSchedule.medicationName);
            return newSchedule;
        } catch (err: any) {
            console.error('[useMedicationSchedule] 创建失败:', err);
            setError('创建服药计划失败');
            return null;
        } finally {
            setIsSaving(false);
        }
    }, [schedules, saveSchedules]);

    /**
     * 更新服药计划
     */
    const updateSchedule = useCallback(async (id: string, data: Partial<ScheduleFormData>): Promise<boolean> => {
        try {
            setIsSaving(true);
            setError(null);

            const index = schedules.findIndex(s => s.id === id);
            if (index === -1) {
                setError('未找到该服药计划');
                return false;
            }

            const updated = { ...schedules[index] };
            if (data.medicationName) updated.medicationName = data.medicationName;
            if (data.medicationDosage) updated.medicationDosage = data.medicationDosage;
            if (data.frequency) updated.frequency = data.frequency;
            if (data.instructions !== undefined) updated.instructions = data.instructions;
            updated.updatedAt = new Date().toISOString();

            const newSchedules = [...schedules];
            newSchedules[index] = updated;
            await saveSchedules(newSchedules);

            console.log('[useMedicationSchedule] 更新成功:', updated.medicationName);
            return true;
        } catch (err: any) {
            console.error('[useMedicationSchedule] 更新失败:', err);
            setError('更新服药计划失败');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [schedules, saveSchedules]);

    /**
     * 删除服药计划
     */
    const deleteSchedule = useCallback(async (id: string): Promise<boolean> => {
        try {
            setIsSaving(true);
            setError(null);

            const newSchedules = schedules.filter(s => s.id !== id);
            await saveSchedules(newSchedules);

            console.log('[useMedicationSchedule] 删除成功');
            return true;
        } catch (err: any) {
            console.error('[useMedicationSchedule] 删除失败:', err);
            setError('删除服药计划失败');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [schedules, saveSchedules]);

    /**
     * 标记为已服用
     */
    const markAsTaken = useCallback(async (scheduleId: string, reminderId: string): Promise<boolean> => {
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

            const newSchedules = [...schedules];
            newSchedules[scheduleIndex] = schedule;
            await saveSchedules(newSchedules);

            console.log('[useMedicationSchedule] 标记已服用:', schedule.medicationName);
            return true;
        } catch (err: any) {
            console.error('[useMedicationSchedule] 标记失败:', err);
            setError('标记失败');
            return false;
        }
    }, [schedules, saveSchedules]);

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
