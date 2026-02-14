/**
 * @file Icons.tsx
 * @description 高级 SVG 图标系统 — 替换所有 emoji
 *
 * 🏛️ 架构师: 统一图标接口，所有图标通过此组件引用，
 *   确保风格一致性和可维护性
 * 🔧 工程师: 纯 SVG inline 图标，无第三方依赖，
 *   支持 size/color/className 自定义
 */

import React from 'react';

interface IconProps {
    size?: number;
    color?: string;
    className?: string;
}

// 通用 SVG 包裹器
const Svg: React.FC<IconProps & { children: React.ReactNode; viewBox?: string }> = ({
    size = 24, color = 'currentColor', className = '', children, viewBox = '0 0 24 24'
}) => (
    <svg width={size} height={size} viewBox={viewBox} fill="none"
        stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        className={`icon ${className}`} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
        {children}
    </svg>
);

// ===== Navigation =====

export const IconHome: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" /><polyline points="9 22 9 12 15 12 15 22" /></Svg>
);

export const IconAgent: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M12 2a4 4 0 014 4v1a4 4 0 01-8 0V6a4 4 0 014-4z" fill={p.color || 'currentColor'} stroke="none" /><rect x="4" y="10" width="16" height="10" rx="2" /><line x1="9" y1="14" x2="9" y2="14.01" strokeWidth="2.5" /><line x1="15" y1="14" x2="15" y2="14.01" strokeWidth="2.5" /><path d="M9 18c.6.6 1.5 1 3 1s2.4-.4 3-1" /></Svg>
);

export const IconSchedule: React.FC<IconProps> = (p) => (
    <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /></Svg>
);

export const IconProfile: React.FC<IconProps> = (p) => (
    <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 10-16 0" /></Svg>
);

// ===== Medical =====

export const IconPill: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M10.5 1.5l-8.5 8.5a4.95 4.95 0 107 7l8.5-8.5a4.95 4.95 0 10-7-7z" />
        <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" strokeDasharray="2 2" />
    </Svg>
);

export const IconCamera: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></Svg>
);

export const IconClipboard: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></Svg>
);

export const IconStethoscope: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M4.8 2.6A2 2 0 013 4.5V10a6 6 0 0012 0V4.5a2 2 0 00-1.8-1.9" /><path d="M12 10v2a4 4 0 008 0v-1a2 2 0 10-4 0v1" /></Svg>
);

// ===== Actions =====

export const IconSend: React.FC<IconProps> = (p) => (
    <Svg {...p}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" fill={p.color || 'currentColor'} stroke="none" /></Svg>
);

export const IconCheck: React.FC<IconProps> = (p) => (
    <Svg {...p}><polyline points="20 6 9 17 4 12" /></Svg>
);

export const IconClose: React.FC<IconProps> = (p) => (
    <Svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>
);

export const IconTrash: React.FC<IconProps> = (p) => (
    <Svg {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></Svg>
);

export const IconEdit: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></Svg>
);

export const IconBack: React.FC<IconProps> = (p) => (
    <Svg {...p}><polyline points="15 18 9 12 15 6" /></Svg>
);

export const IconPlus: React.FC<IconProps> = (p) => (
    <Svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>
);

export const IconNew: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></Svg>
);

// ===== Status =====

export const IconSun: React.FC<IconProps> = (p) => (
    <Svg {...p}><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></Svg>
);

export const IconMoon: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></Svg>
);

export const IconWarning: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12" y2="17.01" /></Svg>
);

export const IconLock: React.FC<IconProps> = (p) => (
    <Svg {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></Svg>
);

export const IconChat: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></Svg>
);

export const IconSparkle: React.FC<IconProps> = (p) => (
    <Svg {...p} viewBox="0 0 24 24">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" fill={p.color || 'currentColor'} stroke="none" />
    </Svg>
);

export const IconImage: React.FC<IconProps> = (p) => (
    <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></Svg>
);

export const IconEye: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Svg>
);

export const IconKeyboard: React.FC<IconProps> = (p) => (
    <Svg {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><line x1="6" y1="8" x2="6" y2="8.01" strokeWidth="2" /><line x1="10" y1="8" x2="10" y2="8.01" strokeWidth="2" /><line x1="14" y1="8" x2="14" y2="8.01" strokeWidth="2" /><line x1="18" y1="8" x2="18" y2="8.01" strokeWidth="2" /><line x1="6" y1="12" x2="6" y2="12.01" strokeWidth="2" /><line x1="18" y1="12" x2="18" y2="12.01" strokeWidth="2" /><line x1="8" y1="16" x2="16" y2="16" /></Svg>
);

export const IconCalendar: React.FC<IconProps> = (p) => (
    <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Svg>
);

export const IconFood: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M18 8h1a4 4 0 010 8h-1" /><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></Svg>
);

export const IconLogout: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></Svg>
);

export const IconThermometer: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z" /></Svg>
);

export const IconGuide: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></Svg>
);

export const IconLanguage: React.FC<IconProps> = (p) => (
    <Svg {...p}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></Svg>
);

export const IconMembership: React.FC<IconProps> = (p) => (
    <Svg {...p}><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></Svg>
);

export const IconHealthProfile: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7z" /></Svg>
);

export const IconMic: React.FC<IconProps> = (p) => (
    <Svg {...p}><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></Svg>
);
