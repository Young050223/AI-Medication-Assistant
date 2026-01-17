/**
 * @file RegisterPage.tsx
 * @description 注册页面 - 老年友好设计
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/user/useAuth';
import './RegisterPage.css';

interface RegisterPageProps {
    onNavigateToLogin: () => void;
    onRegisterSuccess: () => void;
}

/**
 * 注册页面组件
 * 设计原则：老年友好 - 大字体、高对比度、简洁布局
 */
export function RegisterPage({ onNavigateToLogin, onRegisterSuccess }: RegisterPageProps) {
    const { t } = useTranslation();
    const { register, isLoading, error, clearError } = useAuth();

    // 表单状态
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [formError, setFormError] = useState('');

    /**
     * 处理注册
     */
    const handleRegister = useCallback(async (e: FormEvent) => {
        e.preventDefault();
        setFormError('');
        clearError();

        // 表单验证
        if (!displayName.trim()) {
            setFormError(t('auth.nameRequired'));
            return;
        }
        if (!email.trim()) {
            setFormError(t('auth.emailRequired'));
            return;
        }
        if (!password) {
            setFormError(t('auth.passwordRequired'));
            return;
        }
        if (password !== confirmPassword) {
            setFormError(t('auth.passwordMismatch'));
            return;
        }

        // 执行注册
        const success = await register({ email, password, displayName });
        if (success) {
            onRegisterSuccess();
        }
    }, [displayName, email, password, confirmPassword, register, clearError, onRegisterSuccess, t]);

    return (
        <div className="register-page">
            {/* 顶部Logo区域 */}
            <div className="register-header">
                <div className="register-logo">💊</div>
                <h1 className="register-title">{t('auth.registerTitle')}</h1>
                <p className="register-subtitle">{t('auth.registerSubtitle')}</p>
            </div>

            {/* 注册表单 */}
            <form className="register-form" onSubmit={handleRegister}>
                {/* 错误提示 */}
                {(error || formError) && (
                    <div className="error-message">
                        {formError || error}
                    </div>
                )}

                {/* 姓名输入 */}
                <div className="form-group">
                    <label htmlFor="displayName" className="form-label">
                        {t('auth.displayName')}
                    </label>
                    <input
                        id="displayName"
                        type="text"
                        className="form-input"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t('auth.displayName')}
                        autoComplete="name"
                        disabled={isLoading}
                    />
                </div>

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
                        autoComplete="new-password"
                        disabled={isLoading}
                    />
                </div>

                {/* 确认密码 */}
                <div className="form-group">
                    <label htmlFor="confirmPassword" className="form-label">
                        {t('auth.confirmPassword')}
                    </label>
                    <input
                        id="confirmPassword"
                        type="password"
                        className="form-input"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={t('auth.confirmPassword')}
                        autoComplete="new-password"
                        disabled={isLoading}
                    />
                </div>

                {/* 注册按钮 */}
                <button
                    type="submit"
                    className="register-button"
                    disabled={isLoading}
                >
                    {isLoading ? t('app.loading') : t('auth.register')}
                </button>
            </form>

            {/* 登录链接 */}
            <div className="register-footer">
                <span>{t('auth.hasAccount')}</span>
                <button
                    type="button"
                    className="link-button"
                    onClick={onNavigateToLogin}
                    disabled={isLoading}
                >
                    {t('auth.login')}
                </button>
            </div>
        </div>
    );
}

export default RegisterPage;
