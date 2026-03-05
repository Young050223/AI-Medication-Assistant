/**
 * @file RegisterPage.tsx
 * @description 注册页面 - 老年友好设计
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-03-05 - 添加用户名和邮箱重复检测
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPill } from '../components/Icons';
import { useAuth } from '../hooks/user/useAuth';
import { supabase } from '../services/supabase';
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

    // 用户名重复检测
    const [usernameDuplicate, setUsernameDuplicate] = useState(false);
    const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
    const usernameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 邮箱重复弹窗
    const [showEmailModal, setShowEmailModal] = useState(false);

    // 生成用户名建议
    const generateUsernameSuggestions = (name: string): string[] => {
        const year = new Date().getFullYear().toString().slice(-2);
        const rand = Math.floor(Math.random() * 90 + 10);
        return [`${name}${year}`, `${name}${rand}`];
    };

    // 防抖检查用户名
    const checkUsername = useCallback(async (name: string) => {
        if (!name.trim() || name.length < 2) {
            setUsernameDuplicate(false);
            return;
        }
        try {
            const { data } = await supabase
                .from('user_profiles')
                .select('display_name')
                .eq('display_name', name.trim())
                .limit(1);
            if (data && data.length > 0) {
                setUsernameDuplicate(true);
                setUsernameSuggestions(generateUsernameSuggestions(name.trim()));
            } else {
                setUsernameDuplicate(false);
            }
        } catch {
            // 静默失败
        }
    }, []);

    // 用户名输入变化时防抖检查
    useEffect(() => {
        if (usernameTimerRef.current) {
            clearTimeout(usernameTimerRef.current);
        }
        if (displayName.trim().length >= 2) {
            usernameTimerRef.current = setTimeout(() => {
                checkUsername(displayName);
            }, 600);
        } else {
            setUsernameDuplicate(false);
        }
        return () => {
            if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
        };
    }, [displayName, checkUsername]);

    // 监听 auth error 变化，检测邮箱重复
    useEffect(() => {
        if (error && (error.toLowerCase().includes('already') || error.toLowerCase().includes('registered') || error.includes('已注册'))) {
            setShowEmailModal(true);
        }
    }, [error]);

    /**
     * 处理注册
     */
    const handleRegister = useCallback(async (e: FormEvent | React.MouseEvent) => {
        e.preventDefault();

        if (isLoading) return;

        setFormError('');
        clearError();

        // 表单验证
        if (!displayName.trim()) {
            setFormError(t('auth.nameRequired', '请输入用户名'));
            return;
        }
        if (usernameDuplicate) {
            setFormError(t('auth.usernameTaken', '该用户名已被使用，请选择其他用户名'));
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
        try {
            const success = await register({ email, password, displayName });
            if (success) {
                onRegisterSuccess();
            }
            // error 变化由 useEffect 监听处理
        } catch (err: any) {
            const msg = err.message || '';
            if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
                setShowEmailModal(true);
            }
        }
    }, [displayName, email, password, confirmPassword, register, clearError, onRegisterSuccess, t, usernameDuplicate]);

    return (
        <div className="register-page">
            {/* 顶部Logo区域 */}
            <div className="register-header">
                <div className="register-logo"><IconPill size={48} /></div>
                <h1 className="register-title">{t('auth.registerTitle')}</h1>
                <p className="register-subtitle">{t('auth.registerSubtitle')}</p>
            </div>

            {/* 注册表单 */}
            <form className="register-form" onSubmit={handleRegister}>
                {/* 错误提示 */}
                {(error || formError) && !showEmailModal && (
                    <div className="error-message">
                        {formError || error}
                    </div>
                )}

                {/* 用户名输入 */}
                <div className="form-group">
                    <label htmlFor="displayName" className="form-label">
                        {t('auth.username', '用户名')}
                    </label>
                    <input
                        id="displayName"
                        type="text"
                        className="form-input"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t('auth.username', '用户名')}
                        autoComplete="username"
                        disabled={isLoading}
                    />
                    {usernameDuplicate && usernameSuggestions.length > 0 && (
                        <div className="username-duplicate-hint">
                            <span className="hint-label">{t('auth.usernameTaken', '该用户名已被使用，试试：')}</span>
                            {usernameSuggestions.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    className="username-suggestion"
                                    onClick={() => {
                                        setDisplayName(s);
                                        setUsernameDuplicate(false);
                                    }}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
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
                    type="button"
                    onClick={handleRegister}
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

            {/* 邮箱已注册弹窗 */}
            {showEmailModal && (
                <div className="email-modal-overlay">
                    <div className="email-modal">
                        <div className="email-modal-icon">📧</div>
                        <h3 className="email-modal-title">
                            {t('auth.emailAlreadyRegistered', '该邮箱已注册')}
                        </h3>
                        <p className="email-modal-desc">
                            {t('auth.emailAlreadyRegisteredDesc', '该邮箱已有账户，请直接登录。')}
                        </p>
                        <button
                            type="button"
                            className="email-modal-login-btn"
                            onClick={onNavigateToLogin}
                        >
                            {t('auth.goToLogin', '前往登录')}
                        </button>
                        <button
                            type="button"
                            className="email-modal-close-btn"
                            onClick={() => setShowEmailModal(false)}
                        >
                            {t('auth.changeEmail', '更换邮箱')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default RegisterPage;
