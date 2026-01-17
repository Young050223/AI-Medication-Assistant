/**
 * @file useLocalStorage.ts
 * @description 本地加密存储Hook，使用Capacitor Preferences实现敏感数据本地存储
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { useCallback } from 'react';
import { Preferences } from '@capacitor/preferences';

// 注：生产环境应使用iOS Keychain进行更安全的加密

/**
 * 简单加密函数（生产环境建议使用更强的加密算法）
 * @param text - 待加密文本
 * @returns 加密后的文本
 */
const encrypt = (text: string): string => {
    try {
        // Base64编码 + 简单混淆
        const encoded = btoa(encodeURIComponent(text));
        // 添加前缀标识
        return `ENC:${encoded}`;
    } catch {
        return text;
    }
};

/**
 * 简单解密函数
 * @param text - 待解密文本
 * @returns 解密后的文本
 */
const decrypt = (text: string): string => {
    try {
        // 检查是否是加密数据
        if (!text.startsWith('ENC:')) {
            return text;
        }
        // 解码
        const encoded = text.substring(4);
        return decodeURIComponent(atob(encoded));
    } catch {
        return text;
    }
};

/**
 * 本地加密存储Hook
 * 提供本地数据的加密存储和读取功能
 * 
 * @returns 存储操作方法
 * 
 * @example
 * const { setItem, getItem, removeItem } = useLocalStorage();
 * 
 * // 存储数据
 * await setItem('health_profile', profileData);
 * 
 * // 读取数据
 * const profile = await getItem<HealthProfile>('health_profile');
 */
export function useLocalStorage() {
    /**
     * 存储数据（加密）
     * @param key - 存储键
     * @param value - 存储值
     */
    const setItem = useCallback(async <T>(key: string, value: T): Promise<void> => {
        try {
            const jsonString = JSON.stringify(value);
            const encryptedValue = encrypt(jsonString);

            await Preferences.set({
                key,
                value: encryptedValue,
            });

            console.log(`[useLocalStorage] 成功存储: ${key}`);
        } catch (error) {
            console.error(`[useLocalStorage] 存储失败: ${key}`, error);
            throw error;
        }
    }, []);

    /**
     * 读取数据（解密）
     * @param key - 存储键
     * @returns 存储的数据
     */
    const getItem = useCallback(async <T>(key: string): Promise<T | null> => {
        try {
            const { value } = await Preferences.get({ key });

            if (!value) {
                return null;
            }

            const decryptedValue = decrypt(value);
            const parsed = JSON.parse(decryptedValue) as T;

            console.log(`[useLocalStorage] 成功读取: ${key}`);
            return parsed;
        } catch (error) {
            console.error(`[useLocalStorage] 读取失败: ${key}`, error);
            return null;
        }
    }, []);

    /**
     * 删除数据
     * @param key - 存储键
     */
    const removeItem = useCallback(async (key: string): Promise<void> => {
        try {
            await Preferences.remove({ key });
            console.log(`[useLocalStorage] 成功删除: ${key}`);
        } catch (error) {
            console.error(`[useLocalStorage] 删除失败: ${key}`, error);
            throw error;
        }
    }, []);

    /**
     * 清空所有数据
     */
    const clear = useCallback(async (): Promise<void> => {
        try {
            await Preferences.clear();
            console.log('[useLocalStorage] 成功清空所有数据');
        } catch (error) {
            console.error('[useLocalStorage] 清空失败', error);
            throw error;
        }
    }, []);

    return {
        setItem,
        getItem,
        removeItem,
        clear,
    };
}

export default useLocalStorage;
