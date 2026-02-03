/**
 * @file MedicationFeedback.types.ts
 * @description 服药反馈相关类型定义
 * @author AI用药助手开发团队
 * @created 2026-01-28
 * @modified 2026-01-30 - 国际化支持
 */

/**
 * 心情类型
 */
export type MoodType = 'good' | 'neutral' | 'bad';

/**
 * 反馈输入类型
 */
export type FeedbackInputType = 'voice' | 'text';

/**
 * 常见副作用标签 - 使用 i18n key
 * 在组件中通过 t(`sideEffects.${key}`) 获取翻译
 */
export const COMMON_SIDE_EFFECTS_KEYS = [
    'dizziness',
    'nausea',
    'fatigue',
    'insomnia',
    'appetiteLoss',
    'rash',
    'diarrhea',
    'constipation',
    'dryMouth',
    'other',
] as const;

export type SideEffectKey = typeof COMMON_SIDE_EFFECTS_KEYS[number];

/**
 * 服药反馈数据
 */
export interface MedicationFeedback {
    /** 唯一标识 */
    id: string;
    /** 用户ID */
    userId: string;
    /** 关联的服药计划ID（可选） */
    scheduleId?: string;
    /** 药物名称 */
    medicationName: string;
    /** 反馈日期 */
    feedbackDate: string;
    /** 输入方式 */
    feedbackType: FeedbackInputType;
    /** 反馈内容（语音转文字后的文本） */
    content: string;
    /** 心情标记 */
    mood?: MoodType;
    /** 副作用标签（存储 key） */
    sideEffects?: SideEffectKey[];
    /** 创建时间 */
    createdAt: string;
    /** 更新时间 */
    updatedAt?: string;
}

/**
 * 创建反馈表单数据
 */
export interface FeedbackFormData {
    /** 药物名称 */
    medicationName: string;
    /** 关联的服药计划ID */
    scheduleId?: string;
    /** 反馈内容 */
    content: string;
    /** 输入方式 */
    feedbackType: FeedbackInputType;
    /** 心情 */
    mood?: MoodType;
    /** 副作用（存储 key） */
    sideEffects?: SideEffectKey[];
}

/**
 * 心情配置 - 使用 i18n key
 * 在组件中通过 t(config.labelKey) 获取翻译
 */
export const MOOD_CONFIG: Record<MoodType, { emoji: string; labelKey: string; color: string }> = {
    good: { emoji: '😊', labelKey: 'mood.good', color: '#4CAF50' },
    neutral: { emoji: '😐', labelKey: 'mood.neutral', color: '#FF9800' },
    bad: { emoji: '😟', labelKey: 'mood.bad', color: '#f44336' },
};

/**
 * 服用频率选项 - 使用 i18n key
 * 在组件中通过 t(`frequency.${key}`) 获取翻译
 */
export const FREQUENCY_OPTIONS_KEYS = [
    'onceDaily',
    'twiceDaily',
    'thriceDaily',
    'fourTimesDaily',
    'asNeeded',
] as const;

export type FrequencyKey = typeof FREQUENCY_OPTIONS_KEYS[number];
