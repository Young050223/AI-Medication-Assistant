/**
 * @file useAuth.ts
 * @description 用户认证Hook，提供登录、注册、登出功能
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import type {
    User,
    AuthState,
    LoginCredentials,
    RegisterCredentials,
    UseAuthReturn
} from '../../types/Auth.types';

/**
 * 用户认证Hook
 * 提供完整的用户认证功能，包括登录、注册、登出
 * 
 * @returns {UseAuthReturn} 认证状态和方法
 * 
 * @example
 * const { user, isAuthenticated, login, logout } = useAuth();
 * 
 * // 登录
 * const success = await login({ email: 'user@example.com', password: '123456' });
 * 
 * // 登出
 * await logout();
 */
export function useAuth(): UseAuthReturn {
    // 认证状态
    const [state, setState] = useState<AuthState>({
        user: null,
        isAuthenticated: false,
        isLoading: true,
        error: null,
    });

    /**
     * 将Supabase用户转换为应用用户格式
     */
    const transformUser = useCallback((supabaseUser: any): User | null => {
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
    }, []);

    /**
     * 初始化：检查现有session
     */
    useEffect(() => {
        const initAuth = async () => {
            // 检查Supabase是否配置
            if (!isSupabaseConfigured()) {
                console.warn('[useAuth] Supabase未配置，使用模拟模式');
                setState(prev => ({ ...prev, isLoading: false }));
                return;
            }

            try {
                // 获取当前session
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('[useAuth] 获取session失败:', error);
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
                console.error('[useAuth] 初始化失败:', err);
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
                console.log('[useAuth] 认证状态变化:', event);

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
    }, [transformUser]);

    /**
     * 登录
     * @param credentials - 登录凭证（邮箱/手机号 + 密码）
     * @returns 是否登录成功
     */
    const login = useCallback(async (credentials: LoginCredentials): Promise<boolean> => {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            // 检查Supabase配置
            if (!isSupabaseConfigured()) {
                // 模拟模式：直接返回成功
                console.log('[useAuth] 模拟登录成功');
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
                    // 状态会通过onAuthStateChange自动更新
                    return true;
                }
            }

            // 使用手机号登录（需要配置SMS）
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
            console.error('[useAuth] 登录失败:', err);
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
     * @param credentials - 注册信息
     * @returns 是否注册成功
     */
    const register = useCallback(async (credentials: RegisterCredentials): Promise<boolean> => {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            // 检查Supabase配置
            if (!isSupabaseConfigured()) {
                // 模拟模式：直接返回成功
                console.log('[useAuth] 模拟注册成功');
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
                    return true;
                }
            }

            setState(prev => ({ ...prev, isLoading: false, error: '请提供邮箱' }));
            return false;
        } catch (err: any) {
            console.error('[useAuth] 注册失败:', err);
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
            console.error('[useAuth] 登出失败:', err);
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

    return {
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        isLoading: state.isLoading,
        error: state.error,
        login,
        register,
        logout,
        clearError,
    };
}

export default useAuth;
