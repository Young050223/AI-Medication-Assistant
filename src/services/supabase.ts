/**
 * @file supabase.ts
 * @description Supabase客户端配置和初始化
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase配置
// 优先从环境变量读取，否则使用默认值
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://nvxjvbkynxuzigxzaevq.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_tQSczX4Vmf-YSqqdl6rIAA_L67TfK5T';

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
    return SUPABASE_URL.includes('supabase.co') && SUPABASE_ANON_KEY.length > 10;
};

export default supabase;
