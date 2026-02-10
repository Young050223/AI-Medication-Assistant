/**
 * @file useMedicationSchedule.ts
 * @description 服药计划管理 Hook
 * @author AI用药助手开发团队
 * @created 2026-02-03
 */

import { useState, useEffect, useCallback } from 'react';

// 类型定义
export interface MedicationReminder {
    id: string;
    time: string;
    dosage: string;
    taken: boolean;
    takenAt?: string;
}

export interface MedicationSchedule {
    id: string;
    medicationName: string;
    medicationDosage: string;
    frequency: string;
    instructions?: string;
    startDate: string;
    endDate?: string;
    reminders: MedicationReminder[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface UseMedicationScheduleReturn {
    schedules: MedicationSchedule[];
    isLoading: boolean;
    isSaving: boolean;
    error: string | null;
    loadSchedules: () => Promise<void>;
    addSchedule: (schedule: Omit<MedicationSchedule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    createSchedule: (schedule: Omit<MedicationSchedule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateSchedule: (id: string, updates: Partial<MedicationSchedule>) => Promise<void>;
    deleteSchedule: (id: string) => Promise<void>;
    markAsTaken: (scheduleId: string, reminderId: string) => Promise<void>;
    getTodaySchedules: () => MedicationSchedule[];
}

const STORAGE_KEY = 'medication_schedules';

/**
 * 服药计划管理 Hook
 */
export function useMedicationSchedule(): UseMedicationScheduleReturn {
    const [schedules, setSchedules] = useState<MedicationSchedule[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * 从本地存储加载计划
     */
    const loadSchedules = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                setSchedules(parsed);
            }
        } catch (err) {
            console.error('[useMedicationSchedule] Load error:', err);
            setError('加载服药计划失败');
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * 保存到本地存储
     */
    const saveSchedules = useCallback((newSchedules: MedicationSchedule[]) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newSchedules));
        setSchedules(newSchedules);
    }, []);

    /**
     * 添加计划
     */
    const addSchedule = useCallback(async (
        schedule: Omit<MedicationSchedule, 'id' | 'createdAt' | 'updatedAt'>
    ) => {
        const newSchedule: MedicationSchedule = {
            ...schedule,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        saveSchedules([...schedules, newSchedule]);
    }, [schedules, saveSchedules]);

    /**
     * 更新计划
     */
    const updateSchedule = useCallback(async (id: string, updates: Partial<MedicationSchedule>) => {
        const updated = schedules.map(s =>
            s.id === id
                ? { ...s, ...updates, updatedAt: new Date().toISOString() }
                : s
        );
        saveSchedules(updated);
    }, [schedules, saveSchedules]);

    /**
     * 删除计划
     */
    const deleteSchedule = useCallback(async (id: string) => {
        const filtered = schedules.filter(s => s.id !== id);
        saveSchedules(filtered);
    }, [schedules, saveSchedules]);

    /**
     * 标记已服用
     */
    const markAsTaken = useCallback(async (scheduleId: string, reminderId: string) => {
        const updated = schedules.map(schedule => {
            if (schedule.id !== scheduleId) return schedule;

            return {
                ...schedule,
                reminders: schedule.reminders.map(reminder =>
                    reminder.id === reminderId
                        ? { ...reminder, taken: true, takenAt: new Date().toISOString() }
                        : reminder
                ),
                updatedAt: new Date().toISOString(),
            };
        });

        saveSchedules(updated);
    }, [schedules, saveSchedules]);

    /**
     * 获取今日计划
     */
    const getTodaySchedules = useCallback((): MedicationSchedule[] => {
        const today = new Date().toISOString().split('T')[0];

        return schedules.filter(schedule => {
            if (!schedule.isActive) return false;

            const startDate = schedule.startDate.split('T')[0];
            const endDate = schedule.endDate?.split('T')[0];

            if (today < startDate) return false;
            if (endDate && today > endDate) return false;

            return true;
        });
    }, [schedules]);

    // 初始加载
    useEffect(() => {
        loadSchedules();
    }, [loadSchedules]);

    return {
        schedules,
        isLoading,
        isSaving,
        error,
        loadSchedules,
        addSchedule,
        createSchedule: addSchedule,
        updateSchedule,
        deleteSchedule,
        markAsTaken,
        getTodaySchedules,
    };
}

export default useMedicationSchedule;
