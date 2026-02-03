/**
 * @file useAuth.ts
 * @description 用户认证Hook，提供登录、注册、登出功能
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-19
 */

import { useAuthContext } from '../../context/AuthContext';
import type { UseAuthReturn } from '../../types/Auth.types';

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
    return useAuthContext();
}

export default useAuth;
