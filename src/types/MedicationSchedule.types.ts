/**
 * @file MedicationSchedule.types.ts
 * @description 服药计划相关类型定义
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-18
 */

/**
 * 服药时间段
 */
export type MedicationTimeSlot = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

/**
 * 服药计划状态
 */
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'cancelled';

/**
 * 单个服药提醒时间
 */
export interface MedicationReminder {
    id: string;
    timeSlot: MedicationTimeSlot;
    time: string;           // HH:mm 格式
    dosage: string;         // 每次剂量
    taken: boolean;         // 今日是否已服用
    takenAt?: string;       // 服用时间
}

/**
 * 服药计划
 */
export interface MedicationSchedule {
    id: string;

    // 药物信息
    medicationName: string;
    medicationDosage: string;       // 总剂量
    instructions?: string;          // 用法说明

    // 计划设置
    frequency: string;              // 服用频率描述
    reminders: MedicationReminder[]; // 提醒时间列表
    durationDays?: number;          // 疗程天数

    // 状态
    status: ScheduleStatus;
    startDate: string;              // 开始日期
    endDate?: string;               // 结束日期

    // 关联
    sourceRecordId?: string;        // 来源病例ID

    // 时间戳
    createdAt: string;
    updatedAt: string;
}

/**
 * 服药计划表单数据
 */
export interface ScheduleFormData {
    medicationName: string;
    medicationDosage: string;
    frequency: string;
    instructions: string;
    reminderTimes: string[];        // HH:mm 格式的时间列表
    durationDays: string;
}

/**
 * 服药计划Hook返回值
 */
export interface UseMedicationScheduleReturn {
    // 状态
    schedules: MedicationSchedule[];
    isLoading: boolean;
    isSaving: boolean;
    error: string | null;

    // 方法
    loadSchedules: () => Promise<void>;
    createSchedule: (data: ScheduleFormData) => Promise<MedicationSchedule | null>;
    updateSchedule: (id: string, data: Partial<ScheduleFormData>) => Promise<boolean>;
    deleteSchedule: (id: string) => Promise<boolean>;
    markAsTaken: (scheduleId: string, reminderId: string) => Promise<boolean>;
    getTodaySchedules: () => MedicationSchedule[];
    clearError: () => void;
}
