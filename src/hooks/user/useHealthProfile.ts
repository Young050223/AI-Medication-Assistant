/**
 * @file useHealthProfile.ts
 * @description 健康档案Hook，提供健康档案的Supabase云端存储和管理
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-24
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { useLocalStorage } from '../common/useLocalStorage';
import { useAuth } from './useAuth';
import type {
    HealthProfile,
    HealthProfileFormData,
    UseHealthProfileReturn
} from '../../types/HealthProfile.types';

// 本地存储键（备用）
const HEALTH_PROFILE_KEY = 'health_profile';

/**
 * 健康档案Hook
 * 优先使用Supabase云端存储，降级使用本地存储
 * 
 * @returns {UseHealthProfileReturn} 健康档案状态和方法
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
     * 从Supabase加载健康档案
     */
    const loadFromSupabase = useCallback(async (userId: string): Promise<HealthProfile | null> => {
        const { data, error } = await supabase
            .from('health_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) {
            // PGRST116 表示没有找到记录，这是正常的
            if (error.code === 'PGRST116') {
                console.log('[useHealthProfile] Supabase: 未找到健康档案');
                return null;
            }
            throw error;
        }

        // 转换Supabase格式到应用格式
        return {
            id: data.id,
            userId: data.user_id,
            birthDate: data.birth_date,
            gender: data.gender,
            heightCm: data.height_cm ? parseFloat(data.height_cm) : null,
            weightKg: data.weight_kg ? parseFloat(data.weight_kg) : null,
            medicalHistory: data.medical_history || '',
            allergies: data.allergies || '',
            isComplete: data.is_complete || false,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
        };
    }, []);

    /**
     * 保存到Supabase
     */
    const saveToSupabase = useCallback(async (userId: string, data: HealthProfileFormData, existingId?: string): Promise<HealthProfile> => {
        const isComplete = !!(
            data.birthDate &&
            data.gender &&
            data.heightCm &&
            data.weightKg
        );

        const profileData = {
            user_id: userId,
            birth_date: data.birthDate || null,
            gender: data.gender || null,
            height_cm: data.heightCm ? parseFloat(data.heightCm) : null,
            weight_kg: data.weightKg ? parseFloat(data.weightKg) : null,
            medical_history: data.medicalHistory || '',
            allergies: data.allergies || '',
            is_complete: isComplete,
        };

        let result;

        if (existingId) {
            // 更新现有记录
            const { data: updated, error } = await supabase
                .from('health_profiles')
                .update(profileData)
                .eq('id', existingId)
                .select()
                .single();

            if (error) throw error;
            result = updated;
        } else {
            // 插入新记录
            const { data: inserted, error } = await supabase
                .from('health_profiles')
                .insert(profileData)
                .select()
                .single();

            if (error) throw error;
            result = inserted;
        }

        // 转换回应用格式
        return {
            id: result.id,
            userId: result.user_id,
            birthDate: result.birth_date,
            gender: result.gender,
            heightCm: result.height_cm ? parseFloat(result.height_cm) : null,
            weightKg: result.weight_kg ? parseFloat(result.weight_kg) : null,
            medicalHistory: result.medical_history || '',
            allergies: result.allergies || '',
            isComplete: result.is_complete || false,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
        };
    }, []);

    /**
     * 加载健康档案（优先Supabase，降级本地）
     */
    const loadProfile = useCallback(async () => {
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
                    const supabaseProfile = await loadFromSupabase(user.id);
                    if (supabaseProfile) {
                        setProfile(supabaseProfile);
                        console.log('[useHealthProfile] Supabase: 成功加载健康档案');
                        return;
                    }
                } catch (err: any) {
                    console.warn('[useHealthProfile] Supabase加载失败，降级到本地:', err.message);
                }
            }

            // 降级到本地存储
            const key = `${HEALTH_PROFILE_KEY}_${user.id}`;
            const storedProfile = await getItem<HealthProfile>(key);

            if (storedProfile) {
                setProfile(storedProfile);
                console.log('[useHealthProfile] 本地: 成功加载健康档案');
            } else {
                console.log('[useHealthProfile] 未找到健康档案');
            }
        } catch (err: any) {
            console.error('[useHealthProfile] 加载失败:', err);
            setError('加载健康档案失败');
        } finally {
            setIsLoading(false);
        }
    }, [user?.id, getItem, loadFromSupabase]);

    /**
     * 保存健康档案（优先Supabase，同时保存本地）
     */
    const saveProfile = useCallback(async (data: HealthProfileFormData): Promise<boolean> => {
        if (!user?.id) {
            setError('用户未登录');
            return false;
        }

        try {
            setIsSaving(true);
            setError(null);

            let savedProfile: HealthProfile;

            // 优先尝试Supabase
            if (isSupabaseConfigured()) {
                try {
                    savedProfile = await saveToSupabase(user.id, data, profile?.id);
                    console.log('[useHealthProfile] Supabase: 健康档案保存成功');
                } catch (err: any) {
                    console.warn('[useHealthProfile] Supabase保存失败，降级到本地:', err.message);
                    // 降级到本地保存
                    savedProfile = await saveToLocal(user.id, data);
                }
            } else {
                // 直接本地保存
                savedProfile = await saveToLocal(user.id, data);
            }

            setProfile(savedProfile);
            return true;
        } catch (err: any) {
            console.error('[useHealthProfile] 保存失败:', err);
            setError('保存健康档案失败');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [user?.id, profile, saveToSupabase]);

    /**
     * 本地保存（降级方案）
     */
    const saveToLocal = async (userId: string, data: HealthProfileFormData): Promise<HealthProfile> => {
        const isComplete = !!(
            data.birthDate &&
            data.gender &&
            data.heightCm &&
            data.weightKg
        );

        const newProfile: HealthProfile = {
            id: profile?.id || `profile_${Date.now()}`,
            userId: userId,
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

        const key = `${HEALTH_PROFILE_KEY}_${userId}`;
        await setItem(key, newProfile);
        console.log('[useHealthProfile] 本地: 健康档案保存成功');

        return newProfile;
    };

    /**
     * 检查档案是否完整
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
