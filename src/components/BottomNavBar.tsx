/**
 * @file BottomNavBar.tsx
 * @description 底部导航栏 — 4 Tabs (首页, Agent, 用药计划, 我的)
 *
 * 🏛️ 架构师: 使用 SVG 图标替代 emoji，提升应用的专业感
 * 🔧 工程师: 引用统一的 Icons 组件
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconHome, IconAgent, IconSchedule, IconProfile } from './Icons';
import './BottomNavBar.css';

export type NavItem = 'home' | 'agent' | 'schedule' | 'me';

interface BottomNavBarProps {
    currentTab: NavItem;
    onTabChange: (tab: NavItem) => void;
}

const navIconMap: Record<NavItem, React.FC<{ size?: number; color?: string }>> = {
    home: IconHome,
    agent: IconAgent,
    schedule: IconSchedule,
    me: IconProfile,
};

export function BottomNavBar({ currentTab, onTabChange }: BottomNavBarProps) {
    const { t } = useTranslation();

    const navItems: { id: NavItem; label: string }[] = [
        { id: 'home', label: t('nav.home', '首页') },
        { id: 'agent', label: t('nav.agent', 'Agent') },
        { id: 'schedule', label: t('nav.schedule', '用药计划') },
        { id: 'me', label: t('nav.me', '我的') },
    ];

    return (
        <nav className="bottom-nav-bar" role="navigation" aria-label="主导航">
            {navItems.map((item) => {
                const IconComponent = navIconMap[item.id];
                const isActive = currentTab === item.id;
                return (
                    <button
                        key={item.id}
                        className={`nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => onTabChange(item.id)}
                        aria-current={isActive ? 'page' : undefined}
                    >
                        <span className="nav-icon">
                            <IconComponent size={22} />
                        </span>
                        <span className="nav-label">{item.label}</span>
                        {isActive && <span className="nav-indicator" />}
                    </button>
                );
            })}
        </nav>
    );
}

export default BottomNavBar;
