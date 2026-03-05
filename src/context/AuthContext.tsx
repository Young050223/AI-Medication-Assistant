/**
 * @file AuthContext.tsx
 * @description 全局用户认证状态管理
 * @author AI用药助手开发团队
 * @created 2026-01-19
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import type {
    User,
    AuthState,
    LoginCredentials,
    RegisterCredentials,
    UseAuthReturn
} from '../types/Auth.types';

// 创建Context
const AuthContext = createContext<UseAuthReturn | null>(null);

/**
 * 将 Supabase 英文错误翻译为中文
 */
const translateError = (msg: string): string => {
    const map: Record<string, string> = {
        'User already registered': '该邮箱已被注册',
        'Invalid login credentials': '邮箱或密码错误',
        'Email not confirmed': '邮箱尚未验证，请查收验证邮件',
        'Password should be at least 6 characters': '密码至少需要6个字符',
        'Unable to validate email address: invalid format': '邮箱格式不正确',
        'Signup requires a valid password': '请输入有效密码',
        'Email rate limit exceeded': '请求过于频繁，请稍后再试',
        'For security purposes, you can only request this once every 60 seconds': '出于安全考虑，请60秒后再试',
    };
    for (const [en, zh] of Object.entries(map)) {
        if (msg.toLowerCase().includes(en.toLowerCase())) return zh;
    }
    return msg;
};

/**
 * 将Supabase用户转换为应用用户格式
 */
const transformUser = (supabaseUser: any): User | null => {
    if (!supabaseUser) return null;

    return {
        id: supabaseUser.id,
        email: supabaseUser.email || null,
        phone: supabaseUser.phone || null,
        displayName: supabaseUser.user_metadata?.display_name || null,
        avatarUrl: supabaseUser.user_metadata?.avatar_url || null,
        language: supabaseUser.user_metadata?.language || 'zh-CN',
        createdAt: supabaseUser.created_at,
        lastLoginAt: supabaseUser.last_sign_in_at || null,
    };
};

/**
 * AuthProvider组件
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // 认证状态
    const [state, setState] = useState<AuthState>({
        user: null,
        isAuthenticated: false,
        isLoading: true,
        error: null,
    });

    /**
     * 初始化：检查现有session
     */
    useEffect(() => {
        let retryCount = 0;
        const MAX_RETRIES = 2;

        const initAuth = async () => {
            // 检查Supabase是否配置
            if (!isSupabaseConfigured()) {
                console.warn('[AuthProvider] Supabase未配置，使用模拟模式');
                setState(prev => ({ ...prev, isLoading: false }));
                return;
            }

            try {
                // 获取当前session
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error) {
                    // 网络不可达时优雅降级，不无限重试
                    const isNetworkError =
                        error.name === 'AuthRetryableFetchError' ||
                        ('status' in error && (error as any).status === 0);

                    if (isNetworkError) {
                        console.warn(`[AuthProvider] 网络不可达 (${retryCount + 1}/${MAX_RETRIES + 1})，将离线启动`);
                        if (retryCount < MAX_RETRIES) {
                            retryCount++;
                            // 2秒后重试
                            setTimeout(initAuth, 2000);
                            return;
                        }
                        // 超过重试次数，离线模式启动
                        setState(prev => ({ ...prev, isLoading: false, error: null }));
                        return;
                    }

                    console.error('[AuthProvider] 获取session失败:', error.message || error);
                    setState(prev => ({ ...prev, isLoading: false, error: translateError(error.message) }));
                    return;
                }

                if (session?.user) {
                    const user = transformUser(session.user);
                    setState({
                        user,
                        isAuthenticated: true,
                        isLoading: false,
                        error: null,
                    });
                } else {
                    setState(prev => ({ ...prev, isLoading: false }));
                }
            } catch (err: any) {
                const isNetworkError =
                    err?.name === 'AuthRetryableFetchError' ||
                    err?.status === 0 ||
                    err?.message?.includes('fetch');

                if (isNetworkError && retryCount < MAX_RETRIES) {
                    console.warn(`[AuthProvider] 网络错误，${retryCount + 1}/${MAX_RETRIES} 次重试...`);
                    retryCount++;
                    setTimeout(initAuth, 2000);
                    return;
                }

                console.warn('[AuthProvider] 初始化失败，离线启动:', err?.message || '网络不可达');
                setState(prev => ({
                    ...prev,
                    isLoading: false,
                    error: null, // 不显示错误，用户可以在有网时重试登录
                }));
            }
        };

        initAuth();

        // 监听认证状态变化
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                console.log('[AuthProvider] 认证状态变化:', event);

                if (session?.user) {
                    const user = transformUser(session.user);
                    setState({
                        user,
                        isAuthenticated: true,
                        isLoading: false,
                        error: null,
                    });
                } else {
                    setState({
                        user: null,
                        isAuthenticated: false,
                        isLoading: false,
                        error: null,
                    });
                }
            }
        );

        // 清理订阅
        return () => {
            subscription.unsubscribe();
        };
    }, []);

    /**
     * 登录
     */
    const login = useCallback(async (credentials: LoginCredentials): Promise<boolean> => {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            // 检查Supabase配置
            if (!isSupabaseConfigured()) {
                // 模拟模式：直接返回成功
                console.log('[AuthProvider] 模拟登录成功');
                const mockUser: User = {
                    id: 'mock-user-id',
                    email: credentials.email || null,
                    phone: credentials.phone || null,
                    displayName: '测试用户',
                    avatarUrl: null,
                    language: 'zh-CN',
                    createdAt: new Date().toISOString(),
                    lastLoginAt: new Date().toISOString(),
                };
                setState({
                    user: mockUser,
                    isAuthenticated: true,
                    isLoading: false,
                    error: null,
                });
                return true;
            }

            // 使用邮箱登录
            if (credentials.email) {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: credentials.email,
                    password: credentials.password,
                });

                if (error) {
                    setState(prev => ({ ...prev, isLoading: false, error: translateError(error.message) }));
                    return false;
                }

                if (data.user) {
                    return true;
                }
            }

            // 使用手机号登录
            if (credentials.phone) {
                const { data, error } = await supabase.auth.signInWithPassword({
                    phone: credentials.phone,
                    password: credentials.password,
                });

                if (error) {
                    setState(prev => ({ ...prev, isLoading: false, error: translateError(error.message) }));
                    return false;
                }

                if (data.user) {
                    return true;
                }
            }

            setState(prev => ({ ...prev, isLoading: false, error: '请提供邮箱或手机号' }));
            return false;
        } catch (err: any) {
            console.error('[AuthProvider] 登录失败:', err);
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: err.message || '登录失败，请稍后重试'
            }));
            return false;
        }
    }, []);

    /**
     * 注册
     */
    const register = useCallback(async (credentials: RegisterCredentials): Promise<boolean> => {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            // 检查Supabase配置
            if (!isSupabaseConfigured()) {
                // 模拟模式：直接返回成功
                console.log('[AuthProvider] 模拟注册成功');
                const mockUser: User = {
                    id: 'mock-user-id',
                    email: credentials.email || null,
                    phone: credentials.phone || null,
                    displayName: credentials.displayName,
                    avatarUrl: null,
                    language: 'zh-CN',
                    createdAt: new Date().toISOString(),
                    lastLoginAt: new Date().toISOString(),
                };
                setState({
                    user: mockUser,
                    isAuthenticated: true,
                    isLoading: false,
                    error: null,
                });
                return true;
            }

            // 使用邮箱注册
            if (credentials.email) {
                const { data, error } = await supabase.auth.signUp({
                    email: credentials.email,
                    password: credentials.password,
                    options: {
                        data: {
                            display_name: credentials.displayName,
                            language: 'zh-CN',
                        },
                    },
                });

                if (error) {
                    setState(prev => ({ ...prev, isLoading: false, error: translateError(error.message) }));
                    return false;
                }

                if (data.user) {
                    // 注册成功，设置用户状态
                    const user = transformUser(data.user);
                    setState({
                        user,
                        isAuthenticated: true,
                        isLoading: false,
                        error: null,
                    });
                    console.log('[AuthProvider] 注册成功:', data.user.email);
                    return true;
                }
            }

            setState(prev => ({ ...prev, isLoading: false, error: '请提供邮箱' }));
            return false;
        } catch (err: any) {
            console.error('[AuthProvider] 注册失败:', err);
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: err.message || '注册失败，请稍后重试'
            }));
            return false;
        }
    }, []);

    /**
     * 登出
     */
    const logout = useCallback(async (): Promise<void> => {
        setState(prev => ({ ...prev, isLoading: true }));

        try {
            if (isSupabaseConfigured()) {
                await supabase.auth.signOut();
            }

            setState({
                user: null,
                isAuthenticated: false,
                isLoading: false,
                error: null,
            });
        } catch (err: any) {
            console.error('[AuthProvider] 登出失败:', err);
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: err.message || '登出失败'
            }));
        }
    }, []);

    /**
     * 清除错误
     */
    const clearError = useCallback(() => {
        setState(prev => ({ ...prev, error: null }));
    }, []);

    const value: UseAuthReturn = {
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        isLoading: state.isLoading,
        error: state.error,
        login,
        register,
        logout,
        clearError,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * 导出useAuth Hook，现在它只负责消费Context
 */
export const useAuthContext = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuthContext must be used within an AuthProvider');
    }
    return context;
};
