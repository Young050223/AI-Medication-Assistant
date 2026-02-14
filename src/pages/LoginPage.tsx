/**
 * @file LoginPage.tsx
 * @description 登录页面 - 老年友好设计（大字体、高对比度、简洁布局）
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPill } from '../components/Icons';
import { useAuth } from '../hooks/user/useAuth';
import './LoginPage.css';

interface LoginPageProps {
    onNavigateToRegister: () => void;
    onLoginSuccess: () => void;
}

/**
 * 登录页面组件
 * 设计原则：老年友好 - 大字体、高对比度、简洁布局
 */
export function LoginPage({ onNavigateToRegister, onLoginSuccess }: LoginPageProps) {
    const { t } = useTranslation();
    const { login, isLoading, error, clearError } = useAuth();

    // 表单状态
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [formError, setFormError] = useState('');

    /**
     * 处理登录
     */
    const handleLogin = useCallback(async (e: FormEvent) => {
        e.preventDefault();
        setFormError('');
        clearError();

        // 表单验证
        if (!email.trim()) {
            setFormError(t('auth.emailRequired'));
            return;
        }
        if (!password) {
            setFormError(t('auth.passwordRequired'));
            return;
        }

        // 执行登录
        const success = await login({ email, password });
        if (success) {
            onLoginSuccess();
        }
    }, [email, password, login, clearError, onLoginSuccess, t]);

    return (
        <div className="login-page">
            {/* 顶部Logo区域 */}
            <div className="login-header">
                <div className="login-logo"><IconPill size={48} /></div>
                <h1 className="login-title">{t('app.name')}</h1>
                <p className="login-subtitle">{t('auth.loginSubtitle')}</p>
            </div>

            {/* 登录表单 */}
            <form className="login-form" onSubmit={handleLogin}>
                {/* 错误提示 */}
                {(error || formError) && (
                    <div className="error-message">
                        {formError || error}
                    </div>
                )}

                {/* 邮箱输入 */}
                <div className="form-group">
                    <label htmlFor="email" className="form-label">
                        {t('auth.email')}
                    </label>
                    <input
                        id="email"
                        type="email"
                        className="form-input"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('auth.email')}
                        autoComplete="email"
                        disabled={isLoading}
                    />
                </div>

                {/* 密码输入 */}
                <div className="form-group">
                    <label htmlFor="password" className="form-label">
                        {t('auth.password')}
                    </label>
                    <input
                        id="password"
                        type="password"
                        className="form-input"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('auth.password')}
                        autoComplete="current-password"
                        disabled={isLoading}
                    />
                </div>

                {/* 登录按钮 */}
                <button
                    type="submit"
                    className="login-button"
                    disabled={isLoading}
                >
                    {isLoading ? t('app.loading') : t('auth.login')}
                </button>
            </form>

            {/* 注册链接 */}
            <div className="login-footer">
                <span>{t('auth.noAccount')}</span>
                <button
                    type="button"
                    className="link-button"
                    onClick={onNavigateToRegister}
                    disabled={isLoading}
                >
                    {t('auth.register')}
                </button>
            </div>
        </div>
    );
}

export default LoginPage;
