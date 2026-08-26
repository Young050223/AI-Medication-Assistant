/**
 * @file SettingsPage.tsx
 * @description 我的 — 设置页面
 * 包含语言切换、健康档案、账号设置、UI主题、会员方案、安全隐私
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/user/useAuth';
import { useAgentPreferences } from '../hooks/user/useAgentPreferences';
import { IconProfile, IconLanguage, IconSun, IconHealthProfile, IconMembership, IconLock, IconChat } from '../components/Icons';
import {
    type FontSizePreset,
    type ThemeMode,
    getStoredFontSizePreset,
    getStoredThemeMode,
    persistFontSizePreset,
    persistThemeMode,
} from '../utils/displayPreferences';
import './SettingsPage.css';

interface SettingsPageProps {
    onNavigateToHealthProfile: () => void;
    onLogout: () => void;
}

export default function SettingsPage({ onNavigateToHealthProfile, onLogout }: SettingsPageProps) {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();
    const {
        agentStyle,
        isLoading: isAgentStyleLoading,
        isSaving: isAgentStyleSaving,
        error: agentStyleError,
        saveAgentStyle,
    } = useAgentPreferences();

    // 主题
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
        return getStoredThemeMode();
    });
    const [fontSizePreset, setFontSizePreset] = useState<FontSizePreset>(() => {
        return getStoredFontSizePreset();
    });

    const handleThemeChange = useCallback((mode: ThemeMode) => {
        setThemeMode(mode);
        persistThemeMode(mode);
    }, []);

    const handleFontSizeChange = useCallback((preset: FontSizePreset) => {
        setFontSizePreset(preset);
        persistFontSizePreset(preset);
    }, []);

    // 监听系统主题变化（auto模式下）
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            if (themeMode === 'auto') persistThemeMode('auto');
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [themeMode]);

    const handleLanguageChange = (lang: string) => {
        i18n.changeLanguage(lang);
    };

    const handleAgentStyleChange = useCallback((style: 'friendly' | 'efficient') => {
        void saveAgentStyle(style);
    }, [saveAgentStyle]);

    return (
        <div className="settings-page">
            <header className="settings-header">
                <h1 className="settings-title">{t('settings.title', '我的')}</h1>
            </header>

            {/* 用户信息卡 */}
            <div className="user-card">
                <div className="user-avatar">
                    <span><IconProfile size={28} /></span>
                </div>
                <div className="user-info">
                    <h2 className="user-name">{user?.displayName || t('settings.guest', '用户')}</h2>
                    <p className="user-email">{user?.email || ''}</p>
                </div>
            </div>

            {/* 设置列表 */}
            <div className="settings-section">
                <h3 className="section-label">{t('settings.general', '通用设置')}</h3>

                {/* 语言切换 */}
                <div className="setting-item">
                    <div className="setting-left">
                        <span className="setting-icon"><IconLanguage size={20} /></span>
                        <span className="setting-name">{t('settings.language', '语言')}</span>
                    </div>
                    <div className="lang-pills">
                        <button
                            className={`lang-pill ${i18n.language === 'zh-CN' ? 'active' : ''}`}
                            onClick={() => handleLanguageChange('zh-CN')}
                        >简</button>
                        <button
                            className={`lang-pill ${i18n.language === 'zh-TW' ? 'active' : ''}`}
                            onClick={() => handleLanguageChange('zh-TW')}
                        >繁</button>
                        <button
                            className={`lang-pill ${i18n.language === 'en' ? 'active' : ''}`}
                            onClick={() => handleLanguageChange('en')}
                        >EN</button>
                    </div>
                </div>

                {/* UI 主题 */}
                <div className="setting-item theme-setting">
                    <div className="setting-left">
                        <span className="setting-icon"><IconSun size={20} /></span>
                        <span className="setting-name">{t('settings.theme', '外观')}</span>
                    </div>
                    <div className="theme-options">
                        <button
                            className={`theme-option ${themeMode === 'light' ? 'active' : ''}`}
                            onClick={() => handleThemeChange('light')}
                        >
                            <img src="/images/theme-light.png" alt="Light" className="theme-preview" />
                            <span className="theme-label">{t('settings.themeLight', '浅色')}</span>
                        </button>
                        <button
                            className={`theme-option ${themeMode === 'dark' ? 'active' : ''}`}
                            onClick={() => handleThemeChange('dark')}
                        >
                            <img src="/images/theme-dark.png" alt="Dark" className="theme-preview" />
                            <span className="theme-label">{t('settings.themeDark', '深色')}</span>
                        </button>
                        <button
                            className={`theme-option ${themeMode === 'auto' ? 'active' : ''}`}
                            onClick={() => handleThemeChange('auto')}
                        >
                            <img src="/images/theme-auto.png" alt="Auto" className="theme-preview" />
                            <span className="theme-label">{t('settings.themeAuto', '自动')}</span>
                        </button>
                    </div>
                </div>

                <div className="setting-item font-size-setting">
                    <div className="setting-left">
                        <span className="setting-icon"><IconChat size={20} /></span>
                        <div className="setting-copy">
                            <span className="setting-name">{t('settings.fontSize', '字体大小')}</span>
                            <span className="setting-description">
                                {t('settings.fontSizeDesc', '调整全局阅读字号，默认中')}
                            </span>
                        </div>
                    </div>
                    <div className="font-size-options" aria-label={t('settings.fontSize', '字体大小')}>
                        <button
                            type="button"
                            className={`font-size-option ${fontSizePreset === 'small' ? 'active' : ''}`}
                            onClick={() => handleFontSizeChange('small')}
                        >
                            {t('settings.fontSizeSmall', '小')}
                        </button>
                        <button
                            type="button"
                            className={`font-size-option ${fontSizePreset === 'medium' ? 'active' : ''}`}
                            onClick={() => handleFontSizeChange('medium')}
                        >
                            {t('settings.fontSizeMedium', '中')}
                        </button>
                        <button
                            type="button"
                            className={`font-size-option ${fontSizePreset === 'large' ? 'active' : ''}`}
                            onClick={() => handleFontSizeChange('large')}
                        >
                            {t('settings.fontSizeLarge', '大')}
                        </button>
                    </div>
                </div>

                <div className="setting-item agent-style-setting">
                    <div className="setting-left">
                        <span className="setting-icon"><IconChat size={20} /></span>
                        <div className="setting-copy">
                            <span className="setting-name">{t('settings.agentStyle', '助手语气')}</span>
                            <span className="setting-description">
                                {t('settings.agentStyleDesc', '选择 AI 回答时默认呈现的表达风格')}
                            </span>
                        </div>
                    </div>

                    <div className="agent-style-options" aria-label={t('settings.agentStyle', '助手语气')}>
                        <button
                            type="button"
                            className={`agent-style-option ${agentStyle === 'friendly' ? 'active' : ''}`}
                            onClick={() => handleAgentStyleChange('friendly')}
                            disabled={isAgentStyleSaving}
                        >
                            <span className="agent-style-title">{t('settings.agentStyleFriendly', '亲和')}</span>
                            <span className="agent-style-body">
                                {t('settings.agentStyleFriendlyDesc', '温暖、协作、贴心')}
                            </span>
                        </button>
                        <button
                            type="button"
                            className={`agent-style-option ${agentStyle === 'efficient' ? 'active' : ''}`}
                            onClick={() => handleAgentStyleChange('efficient')}
                            disabled={isAgentStyleSaving}
                        >
                            <span className="agent-style-title">{t('settings.agentStyleEfficient', '务实')}</span>
                            <span className="agent-style-body">
                                {t('settings.agentStyleEfficientDesc', '简洁、专注、直接')}
                            </span>
                        </button>
                    </div>

                    <p className={`setting-status ${agentStyleError ? 'error' : ''}`}>
                        {agentStyleError
                            || (isAgentStyleSaving
                                ? t('settings.agentStyleSaving', '正在保存风格设置...')
                                : isAgentStyleLoading
                                    ? t('app.loading', '加载中...')
                                    : t('settings.agentStyleHint', '风格只影响表达方式，不影响医疗安全边界')
                            )}
                    </p>
                </div>
            </div>

            <div className="settings-section">
                <h3 className="section-label">{t('settings.account', '账号与数据')}</h3>

                {/* 健康档案 */}
                <button className="setting-item clickable" onClick={onNavigateToHealthProfile}>
                    <div className="setting-left">
                        <span className="setting-icon"><IconHealthProfile size={20} /></span>
                        <span className="setting-name">{t('settings.healthProfile', '健康档案')}</span>
                    </div>
                    <span className="setting-arrow">›</span>
                </button>

                {/* 会员方案 */}
                <button className="setting-item clickable">
                    <div className="setting-left">
                        <span className="setting-icon"><IconMembership size={20} /></span>
                        <span className="setting-name">{t('settings.membership', '会员方案')}</span>
                    </div>
                    <span className="setting-badge">{t('settings.free', '免费版')}</span>
                </button>

                {/* 安全隐私 */}
                <button className="setting-item clickable">
                    <div className="setting-left">
                        <span className="setting-icon"><IconLock size={20} /></span>
                        <span className="setting-name">{t('settings.privacy', '安全与隐私')}</span>
                    </div>
                    <span className="setting-arrow">›</span>
                </button>
            </div>

            {/* 退出登录 */}
            <div className="settings-section">
                <button className="logout-btn" onClick={onLogout}>
                    {t('settings.logout', '退出登录')}
                </button>
            </div>

            <div className="settings-footer">
                <p className="version-text">AI Medication Assistant v1.0</p>
            </div>

            <div className="nav-spacer" />
        </div>
    );
}
