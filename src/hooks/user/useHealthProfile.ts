/**
 * @file useHealthProfile.ts
 * @description 健康档案Hook，提供健康档案的本地加密存储和管理
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { useState, useEffect, useCallback } from 'react';
import { useLocalStorage } from '../common/useLocalStorage';
import { useAuth } from './useAuth';
import type {
    HealthProfile,
    HealthProfileFormData,
    UseHealthProfileReturn
} from '../../types/HealthProfile.types';

// 存储键
const HEALTH_PROFILE_KEY = 'health_profile';

/**
 * 健康档案Hook
 * 提供健康档案的增删改查功能，数据本地加密存储
 * 
 * @returns {UseHealthProfileReturn} 健康档案状态和方法
 * 
 * @example
 * const { profile, saveProfile, isProfileComplete } = useHealthProfile();
 * 
 * // 保存档案
 * await saveProfile(formData);
 * 
 * // 检查档案完整性
 * if (!isProfileComplete()) {
 *   // 提示用户完成档案
 * }
 */
export function useHealthProfile(): UseHealthProfileReturn {
    const { user } = useAuth();
    const { getItem, setItem } = useLocalStorage();

    // 状态
    const [profile, setProfile] = useState<HealthProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * 加载健康档案
     */
    const loadProfile = useCallback(async () => {
        if (!user?.id) {
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);

            // 使用用户ID作为存储键的一部分，支持多用户
            const key = `${HEALTH_PROFILE_KEY}_${user.id}`;
            const storedProfile = await getItem<HealthProfile>(key);

            if (storedProfile) {
                setProfile(storedProfile);
                console.log('[useHealthProfile] 成功加载健康档案');
            } else {
                console.log('[useHealthProfile] 未找到健康档案');
            }
        } catch (err: any) {
            console.error('[useHealthProfile] 加载失败:', err);
            setError('加载健康档案失败');
        } finally {
            setIsLoading(false);
        }
    }, [user?.id, getItem]);

    /**
     * 保存健康档案
     * @param data - 表单数据
     * @returns 是否保存成功
     */
    const saveProfile = useCallback(async (data: HealthProfileFormData): Promise<boolean> => {
        if (!user?.id) {
            setError('用户未登录');
            return false;
        }

        try {
            setIsSaving(true);
            setError(null);

            // 检查档案完整性
            // 必填项：出生日期、性别、身高、体重
            const isComplete = !!(
                data.birthDate &&
                data.gender &&
                data.heightCm &&
                data.weightKg
            );

            // 构建档案对象
            const newProfile: HealthProfile = {
                id: profile?.id || `profile_${Date.now()}`,
                userId: user.id,
                birthDate: data.birthDate || null,
                gender: data.gender || null,
                heightCm: data.heightCm ? parseFloat(data.heightCm) : null,
                weightKg: data.weightKg ? parseFloat(data.weightKg) : null,
                medicalHistory: data.medicalHistory || '',
                allergies: data.allergies || '',
                isComplete,
                createdAt: profile?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            // 保存到本地存储
            const key = `${HEALTH_PROFILE_KEY}_${user.id}`;
            await setItem(key, newProfile);

            setProfile(newProfile);
            console.log('[useHealthProfile] 健康档案保存成功');

            return true;
        } catch (err: any) {
            console.error('[useHealthProfile] 保存失败:', err);
            setError('保存健康档案失败');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [user?.id, profile, setItem]);

    /**
     * 检查档案是否完整
     * 根据项目宪法：上传病例前必须完成健康档案
     */
    const isProfileComplete = useCallback((): boolean => {
        return profile?.isComplete ?? false;
    }, [profile]);

    /**
     * 清除错误
     */
    const clearError = useCallback(() => {
        setError(null);
    }, []);

    // 初始化时加载档案
    useEffect(() => {
        loadProfile();
    }, [loadProfile]);

    return {
        profile,
        isLoading,
        isSaving,
        error,
        loadProfile,
        saveProfile,
        isProfileComplete,
        clearError,
    };
}

export default useHealthProfile;
