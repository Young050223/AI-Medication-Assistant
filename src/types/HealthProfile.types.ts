/**
 * @file HealthProfile.types.ts
 * @description 健康档案相关类型定义
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

/**
 * 性别类型
 */
export type Gender = 'male' | 'female' | 'other';

/**
 * 健康档案数据
 */
export interface HealthProfile {
    id: string;
    userId: string;

    // 基本信息
    birthDate: string | null;
    gender: Gender | null;
    heightCm: number | null;
    weightKg: number | null;

    // 健康信息
    medicalHistory: string;      // 过往病史
    allergies: string;           // 过敏药物

    // 完整性标记
    isComplete: boolean;         // 档案是否完整

    // 时间戳
    createdAt: string;
    updatedAt: string;
}

/**
 * 健康档案表单数据
 */
export interface HealthProfileFormData {
    birthDate: string;
    gender: Gender | '';
    heightCm: string;
    weightKg: string;
    medicalHistory: string;
    allergies: string;
}

/**
 * 健康档案Hook返回值
 */
export interface UseHealthProfileReturn {
    // 状态
    profile: HealthProfile | null;
    isLoading: boolean;
    isSaving: boolean;
    error: string | null;

    // 方法
    loadProfile: () => Promise<void>;
    saveProfile: (data: HealthProfileFormData) => Promise<boolean>;
    isProfileComplete: () => boolean;
    clearError: () => void;
}
