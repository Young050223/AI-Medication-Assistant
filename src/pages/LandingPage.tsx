/**
 * @file LandingPage.tsx
 * @description 首页 — 服药核心页
 * Hero FAB "确认服用" + 用药概览 + 快捷操作
 * @preserve 保留所有 useMedicationSchedule 业务逻辑
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMedicationSchedule, type MedicationSchedule, type MedicationReminder } from '../hooks/medication/useMedicationSchedule';
import { IconPill, IconSun, IconCheck, IconCamera, IconGuide } from '../components/Icons';
import './LandingPage.css';

interface LandingPageProps {
    userName?: string;
    onNavigateToUpload: () => void;
    onNavigateToSchedules: () => void;
    onNavigateToAgentAnalysis: () => void;
    onLogout: () => void;
    onNavigateToFeedback?: (medicationName: string, scheduleId: string) => void;
}

// 展开的提醒类型
interface FlatReminder {
    scheduleId: string;
    reminderId: string;
    name: string;
    time: string;
    dosage: string;
    taken: boolean;
    missed: boolean;
}

/**
 * 判断某个时间是否已过期超过2小时
 */
const isMissed = (timeStr: string): boolean => {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const scheduled = new Date();
    scheduled.setHours(hours, minutes, 0, 0);
    return (now.getTime() - scheduled.getTime()) / (1000 * 60 * 60) > 2;
};

/**
 * 获取时段问候语
 */
const getGreeting = (t: (key: string, fallback: string) => string): string => {
    const hour = new Date().getHours();
    if (hour < 6) return t('landing.greeting.night', '夜深了');
    if (hour < 12) return t('landing.greeting.morning', '早上好');
    if (hour < 18) return t('landing.greeting.afternoon', '下午好');
    return t('landing.greeting.evening', '晚上好');
};

/**
 * 获取下一个待服药的提醒
 */
const getNextDose = (reminders: FlatReminder[]): FlatReminder | null => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const pending = reminders
        .filter(r => !r.taken && !r.missed)
        .map(r => {
            const [h, m] = r.time.split(':').map(Number);
            return { ...r, totalMinutes: h * 60 + m };
        })
        .filter(r => r.totalMinutes >= currentMinutes)
        .sort((a, b) => a.totalMinutes - b.totalMinutes);

    return pending.length > 0 ? pending[0] : null;
};

export default function LandingPage({
    userName,
    onNavigateToUpload,
    onNavigateToSchedules,
    onNavigateToAgentAnalysis,
    onNavigateToFeedback,
}: LandingPageProps) {
    const { t } = useTranslation();
    const { schedules, isLoading, markAsTaken, getTodaySchedules } = useMedicationSchedule();
    const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
    const [confirmingDose, setConfirmingDose] = useState<FlatReminder | null>(null);
    const [feedbackText, setFeedbackText] = useState('');
    const [justConfirmed, setJustConfirmed] = useState(false);

    // 今日所有提醒展开
    const todayReminders = useMemo((): FlatReminder[] => {
        const todaySchedules = getTodaySchedules();
        const reminders: FlatReminder[] = [];
        todaySchedules.forEach((schedule: MedicationSchedule) => {
            schedule.reminders.forEach((reminder: MedicationReminder) => {
                reminders.push({
                    scheduleId: schedule.id,
                    reminderId: reminder.id,
                    name: schedule.medicationName,
                    time: reminder.time,
                    dosage: reminder.dosage,
                    taken: reminder.taken,
                    missed: !reminder.taken && isMissed(reminder.time),
                });
            });
        });
        return reminders.sort((a, b) => a.time.localeCompare(b.time));
    }, [schedules, getTodaySchedules]);

    const stats = useMemo(() => ({
        total: todayReminders.length,
        taken: todayReminders.filter(r => r.taken).length,
        pending: todayReminders.filter(r => !r.taken && !r.missed).length,
        missed: todayReminders.filter(r => r.missed).length,
    }), [todayReminders]);

    const nextDose = useMemo(() => getNextDose(todayReminders), [todayReminders]);

    // 刷新时钟
    const [currentTime, setCurrentTime] = useState(new Date());
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    const dateStr = currentTime.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric',
        weekday: 'long',
    });

    // 确认服药流程
    const handleFABClick = useCallback(() => {
        if (nextDose) {
            setConfirmingDose(nextDose);
            setShowFeedbackSheet(true);
            setFeedbackText('');
        }
    }, [nextDose]);

    const handleConfirmDose = useCallback(async () => {
        if (!confirmingDose) return;
        await markAsTaken(confirmingDose.scheduleId, confirmingDose.reminderId);
        setShowFeedbackSheet(false);
        setJustConfirmed(true);
        setTimeout(() => setJustConfirmed(false), 2000);

        // 如果有反馈内容，可以导航到完整反馈页
        if (feedbackText.trim() && onNavigateToFeedback) {
            onNavigateToFeedback(confirmingDose.name, confirmingDose.scheduleId);
        }
    }, [confirmingDose, feedbackText, markAsTaken, onNavigateToFeedback]);

    const cancelFeedback = () => {
        setShowFeedbackSheet(false);
        setConfirmingDose(null);
        setFeedbackText('');
    };

    if (isLoading) {
        return (
            <div className="landing-loading">
                <div className="loading-spinner"><IconPill size={32} /></div>
                <p>{t('landing.loading', '加载中...')}</p>
            </div>
        );
    }

    return (
        <div className="landing-page">
            {/* 顶部 Header */}
            <header className="landing-header">
                <div className="greeting-section">
                    <h1 className="greeting-text">
                        {getGreeting(t)}{userName ? `，${userName}` : ''}
                    </h1>
                    <p className="date-text">{dateStr}</p>
                </div>
                {/* 天气占位 */}
                <div className="weather-badge">
                    <span className="weather-icon"><IconSun size={18} /></span>
                    <span className="weather-temp">23°</span>
                </div>
            </header>

            {/* Hero Section — 下次服药 */}
            <section className="hero-section">
                <div className="hero-bg">
                    {nextDose ? (
                        <>
                            <p className="hero-label">
                                {t('landing.nextDose', '下次服药')}
                            </p>
                            <p className="hero-med-name">{nextDose.name}</p>
                            <p className="hero-time">
                                <span className="time-icon">⏱</span>
                                {nextDose.time} · {nextDose.dosage}
                            </p>

                            {/* 超大 FAB */}
                            <button
                                className={`fab-confirm ${justConfirmed ? 'confirmed' : ''}`}
                                onClick={handleFABClick}
                                disabled={justConfirmed}
                            >
                                <span className="fab-icon">
                                    {justConfirmed ? <IconCheck size={36} /> : <IconPill size={36} />}
                                </span>
                                <span className="fab-text">
                                    {justConfirmed
                                        ? t('landing.confirmed', '已确认')
                                        : t('landing.confirmTake', '确认服用')}
                                </span>
                            </button>

                            {/* 下方计划详情 */}
                            <div className="next-plan-detail">
                                {todayReminders
                                    .filter(r => !r.taken && !r.missed && r.reminderId !== nextDose.reminderId)
                                    .slice(0, 3)
                                    .map(r => (
                                        <div key={r.reminderId} className="next-plan-item">
                                            <span className="plan-time">{r.time}</span>
                                            <span className="plan-name">{r.name}</span>
                                            <span className="plan-dosage">{r.dosage}</span>
                                        </div>
                                    ))}
                            </div>
                        </>
                    ) : (
                        <div className="hero-empty">
                            <span className="hero-empty-icon"><IconCheck size={40} /></span>
                            <p className="hero-empty-text">
                                {stats.total > 0
                                    ? t('landing.allDone', '今日用药已全部完成！')
                                    : t('landing.noSchedule', '暂无用药计划')}
                            </p>
                        </div>
                    )}
                </div>
            </section>

            {/* 用药概览卡片 — 点击跳转 */}
            {stats.total > 0 && (
                <section
                    className="summary-card"
                    onClick={onNavigateToSchedules}
                    role="button"
                    tabIndex={0}
                >
                    <div className="summary-header">
                        <span className="summary-title">
                            {t('landing.todayPlan', '今日用药')}
                        </span>
                        <span className="summary-arrow">›</span>
                    </div>
                    <div className="summary-stats">
                        <div className="summary-stat">
                            <span className="stat-num completed">{stats.taken}</span>
                            <span className="stat-lbl">{t('landing.taken', '已服用')}</span>
                        </div>
                        <div className="summary-divider" />
                        <div className="summary-stat">
                            <span className="stat-num pending">{stats.pending}</span>
                            <span className="stat-lbl">{t('landing.pending', '待服用')}</span>
                        </div>
                        {stats.missed > 0 && (
                            <>
                                <div className="summary-divider" />
                                <div className="summary-stat">
                                    <span className="stat-num missed">{stats.missed}</span>
                                    <span className="stat-lbl">{t('landing.missed', '已错过')}</span>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="summary-progress">
                        <div
                            className="progress-fill"
                            style={{ width: `${stats.total > 0 ? (stats.taken / stats.total) * 100 : 0}%` }}
                        />
                    </div>
                </section>
            )}

            {/* 快捷操作 — 仅保留 2 个 */}
            <section className="quick-actions">
                <button className="quick-card" onClick={onNavigateToUpload}>
                    <span className="quick-icon"><IconCamera size={24} /></span>
                    <div className="quick-info">
                        <span className="quick-label">{t('landing.scanRecord', '扫描病例')}</span>
                        <span className="quick-desc">{t('landing.scanDesc', '拍照识别药物信息')}</span>
                    </div>
                </button>
                <button className="quick-card" onClick={onNavigateToAgentAnalysis}>
                    <span className="quick-icon"><IconGuide size={24} /></span>
                    <div className="quick-info">
                        <span className="quick-label">{t('landing.medGuide', '用药指南')}</span>
                        <span className="quick-desc">{t('landing.guideDesc', 'AI 智能药物分析')}</span>
                    </div>
                </button>
            </section>

            {/* 底部留白 */}
            <div className="nav-spacer" />

            {/* 反馈浮层 */}
            {showFeedbackSheet && confirmingDose && (
                <div className="feedback-overlay" onClick={cancelFeedback}>
                    <div className="feedback-sheet" onClick={e => e.stopPropagation()}>
                        <div className="sheet-header">
                            <h3>{t('landing.feedbackTitle', '服药反馈')}</h3>
                            <p className="sheet-med">
                                {confirmingDose.name} · {confirmingDose.time}
                            </p>
                        </div>

                        <div className="sheet-moods">
                            {[
                                { label: t('feedback.good', '正常') },
                                { label: t('feedback.dizzy', '头晕') },
                                { label: t('feedback.nausea', '恶心') },
                            ].map(mood => (
                                <button
                                    key={mood.label}
                                    className={`mood-chip ${feedbackText === mood.label ? 'active' : ''}`}
                                    onClick={() => setFeedbackText(mood.label)}
                                >
                                    <span>{mood.label}</span>
                                </button>
                            ))}
                        </div>

                        <textarea
                            className="sheet-textarea"
                            placeholder={t('landing.feedbackPlaceholder', '还有其他感受吗？（可选）')}
                            value={feedbackText.startsWith('正常') || feedbackText.startsWith('头晕') || feedbackText.startsWith('恶心') ? '' : feedbackText}
                            onChange={e => setFeedbackText(e.target.value)}
                            rows={3}
                        />

                        <div className="sheet-actions">
                            <button className="sheet-cancel" onClick={cancelFeedback}>
                                {t('common.cancel', '取消')}
                            </button>
                            <button className="sheet-confirm" onClick={handleConfirmDose}>
                                {t('landing.confirmTake', '确认服用')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
