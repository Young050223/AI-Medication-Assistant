/**
 * @file SettingsPage.tsx
 * @description 我的 — 设置页面
 * 包含语言切换、健康档案、账号设置、UI主题、会员方案、安全隐私
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/user/useAuth';
import { IconProfile, IconLanguage, IconSun, IconMoon, IconHealthProfile, IconMembership, IconLock } from '../components/Icons';
import './SettingsPage.css';

interface SettingsPageProps {
    onNavigateToHealthProfile: () => void;
    onLogout: () => void;
}

export default function SettingsPage({ onNavigateToHealthProfile, onLogout }: SettingsPageProps) {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();

    // 主题切换
    const [isDark, setIsDark] = useState(
        () => document.documentElement.getAttribute('data-theme') === 'dark'
    );

    const toggleTheme = () => {
        const next = !isDark;
        setIsDark(next);
        document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
        localStorage.setItem('theme', next ? 'dark' : 'light');
    };

    const handleLanguageChange = (lang: string) => {
        i18n.changeLanguage(lang);
    };

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
                <div className="setting-item">
                    <div className="setting-left">
                        <span className="setting-icon">{isDark ? <IconMoon size={20} /> : <IconSun size={20} />}</span>
                        <span className="setting-name">{t('settings.theme', '外观')}</span>
                    </div>
                    <button className="theme-toggle" onClick={toggleTheme}>
                        <span className={`toggle-track ${isDark ? 'dark' : ''}`}>
                            <span className="toggle-thumb" />
                        </span>
                    </button>
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
