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
        const initAuth = async () => {
            // 检查Supabase是否配置
            if (!isSupabaseConfigured()) {
                console.warn('[AuthProvider] Supabase未配置，使用模拟模式');
                // 模拟模式下，默认不登录，等待用户操作
                setState(prev => ({ ...prev, isLoading: false }));
                return;
            }

            try {
                // 获取当前session
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('[AuthProvider] 获取session失败:', error);
                    setState(prev => ({ ...prev, isLoading: false, error: error.message }));
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
            } catch (err) {
                console.error('[AuthProvider] 初始化失败:', err);
                setState(prev => ({
                    ...prev,
                    isLoading: false,
                    error: '认证初始化失败'
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
                    setState(prev => ({ ...prev, isLoading: false, error: error.message }));
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
                    setState(prev => ({ ...prev, isLoading: false, error: error.message }));
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
                    setState(prev => ({ ...prev, isLoading: false, error: error.message }));
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
