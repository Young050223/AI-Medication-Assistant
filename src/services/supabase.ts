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
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52eGp2Ymt5bnh1emlneHphZXZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NDMwMjQsImV4cCI6MjA4NDIxOTAyNH0.bk194WU7YwEQhvYNsNgQ0f0ibtaZX1co4UUvt6W3M5Q';

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
 * 注意：anon key 应该是 JWT 格式（以 eyJ 开头）
 * @returns 配置是否有效
 */
export const isSupabaseConfigured = (): boolean => {
    // 临时强制使用模拟模式进行测试
    // 设置为 true 可启用真实 Supabase 后端
    const USE_MOCK_MODE = false;
    if (USE_MOCK_MODE) {
        console.log('[Supabase] 使用模拟模式');
        return false;
    }

    // JWT token 应该以 eyJ 开头
    const isValidKey = SUPABASE_ANON_KEY.startsWith('eyJ') && SUPABASE_ANON_KEY.length > 100;
    const isValidUrl = SUPABASE_URL.includes('supabase.co');
    return isValidUrl && isValidKey;
};

const getSupabaseRef = (url: string): string | null => {
    try {
        const host = new URL(url).hostname;
        return host.split('.')[0] || null;
    } catch {
        return null;
    }
};

const logSupabaseStartupInfo = () => {
    const ref = getSupabaseRef(SUPABASE_URL);
    console.info('[Supabase] 启动自检:', {
        ref: ref || 'unknown',
        url: SUPABASE_URL,
        configured: isSupabaseConfigured(),
    });
};

// 启动时打印一次当前连接的项目 ref/URL，方便排查环境问题
if (typeof window !== 'undefined') {
    logSupabaseStartupInfo();
}

export default supabase;
