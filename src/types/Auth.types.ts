/**
 * @file Auth.types.ts
 * @description 认证相关类型定义
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

/**
 * 用户基本信息
 */
export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  language: 'zh-CN' | 'zh-TW' | 'en';
  createdAt: string;
  lastLoginAt: string | null;
}

/**
 * 认证状态
 */
export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * 登录参数
 */
export interface LoginCredentials {
  email?: string;
  phone?: string;
  password: string;
}

/**
 * 注册参数
 */
export interface RegisterCredentials {
  email?: string;
  phone?: string;
  password: string;
  displayName: string;
}

/**
 * 认证Hook返回值
 */
export interface UseAuthReturn {
  // 状态
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // 方法
  login: (credentials: LoginCredentials) => Promise<boolean>;
  register: (credentials: RegisterCredentials) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}
