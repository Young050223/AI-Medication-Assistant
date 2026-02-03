/**
 * @file BottomNavBar.tsx
 * @description 底部导航栏组件 - 固定于视口底部的Tab Bar
 * @author AI用药助手开发团队
 * @created 2026-01-28
 */

import { useTranslation } from 'react-i18next';
import './BottomNavBar.css';

// 导航项类型
export type NavItem = 'home' | 'records' | 'reminders' | 'profile';

interface BottomNavBarProps {
    currentTab: NavItem;
    onTabChange: (tab: NavItem) => void;
}

/**
 * 底部导航栏组件
 */
export function BottomNavBar({ currentTab, onTabChange }: BottomNavBarProps) {
    const { t } = useTranslation();

    const navItems: { id: NavItem; icon: string; label: string }[] = [
        { id: 'home', icon: '🏠', label: t('nav.home', '首页') },
        { id: 'records', icon: '📋', label: t('nav.records', '记录') },
        { id: 'reminders', icon: '⏰', label: t('nav.reminders', '提醒') },
        { id: 'profile', icon: '👤', label: t('nav.profile', '我的') },
    ];

    return (
        <nav className="bottom-nav-bar" role="navigation" aria-label="主导航">
            {navItems.map((item) => (
                <button
                    key={item.id}
                    className={`nav-item ${currentTab === item.id ? 'active' : ''}`}
                    onClick={() => onTabChange(item.id)}
                    aria-current={currentTab === item.id ? 'page' : undefined}
                >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                    {currentTab === item.id && <span className="nav-indicator" />}
                </button>
            ))}
        </nav>
    );
}

export default BottomNavBar;
