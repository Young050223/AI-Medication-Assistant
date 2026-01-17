/**
 * @file supabase.ts
 * @description Supabase客户端配置和初始化
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase配置
// 注意: 这些值需要替换为实际的Supabase项目配置
// 可以从 https://supabase.com/dashboard 获取
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

/**
 * Supabase客户端单例
 * 用于与Supabase后端服务交互（仅限非敏感数据）
 */
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        // 自动刷新token
        autoRefreshToken: true,
        // 持久化session
        persistSession: true,
        // 检测session变化
        detectSessionInUrl: true,
    },
});

/**
 * 检查Supabase是否已正确配置
 * @returns 配置是否有效
 */
export const isSupabaseConfigured = (): boolean => {
    return (
        SUPABASE_URL !== 'https://your-project.supabase.co' &&
        SUPABASE_ANON_KEY !== 'your-anon-key'
    );
};

export default supabase;
