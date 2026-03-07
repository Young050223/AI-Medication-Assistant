/**
 * @file LandingPage.tsx
 * @description 首页 — 服药核心页
 * Hero FAB "确认服用" + 用药概览 + 快捷操作
 * @preserve 保留所有 useMedicationSchedule 业务逻辑
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMedicationSchedule, type MedicationSchedule, type MedicationReminder } from '../hooks/medication/useMedicationSchedule';
import { useHealthProfile } from '../hooks/user/useHealthProfile';
import { IconPill, IconSun, IconCheck, IconCamera, IconGuide, IconPlus, IconClipboard } from '../components/Icons';
import ConfirmDoseModal, { type DoseInfo } from '../components/ConfirmDoseModal';
import { formatLocalDateKey } from '../utils/dateKey';
import './LandingPage.css';

interface LandingPageProps {
    userName?: string;
    onNavigateToUpload: () => void;
    onNavigateToSchedules: () => void;
    onNavigateToAddSchedule: () => void;
    onNavigateToAgentAnalysis: () => void;
    onNavigateToHealthProfile: () => void;
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
    instructions?: string;
}

/**
 * 判断某个提醒是否已错过（包含自定义允许窗口）
 */
const isMissed = (reminder: MedicationReminder, schedule: MedicationSchedule): boolean => {
    if (reminder.taken) return false;
    if (reminder.missed) return true;
    const windowMinutes = schedule.allowWindowMinutes ?? schedule.graceMinutes ?? 0;
    const [hours, minutes] = reminder.time.split(':').map(Number);
    const scheduledMinutes = hours * 60 + minutes;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return nowMinutes > scheduledMinutes + windowMinutes;
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
 * 根据温度给出穿衣建议
 */
const getClothingAdvice = (temp: number, t: (key: string, fallback: string) => string): string => {
    if (temp <= 5) return t('landing.clothing.heavy', '注意保暖，穿厚外套');
    if (temp <= 10) return t('landing.clothing.warm', '天气较冷，穿毛衣外套');
    if (temp <= 18) return t('landing.clothing.light', '适合穿薄外套或长袖');
    if (temp <= 25) return t('landing.clothing.tshirt', '温度舒适，穿短袖即可');
    return t('landing.clothing.hot', '天气炎热，注意防晒补水');
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
    onNavigateToAddSchedule,
    onNavigateToAgentAnalysis,
    onNavigateToHealthProfile,
}: LandingPageProps) {
    const { t, i18n } = useTranslation();
    const { schedules, isLoading, markAsTaken, getTodaySchedules } = useMedicationSchedule();
    const { isProfileComplete } = useHealthProfile();
    const [confirmingDose, setConfirmingDose] = useState<DoseInfo | null>(null);
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
                    missed: isMissed(reminder, schedule),
                    instructions: schedule.instructions || undefined,
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

    const dateStr = new Intl.DateTimeFormat(i18n.language || 'en', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
    }).format(currentTime);

    // 确认服药流程
    const handleFABClick = useCallback(() => {
        if (nextDose) {
            setConfirmingDose({
                scheduleId: nextDose.scheduleId,
                reminderId: nextDose.reminderId,
                medicationName: nextDose.name,
                dosage: nextDose.dosage,
                time: nextDose.time,
                doseDate: formatLocalDateKey(new Date()),
            });
        }
    }, [nextDose]);

    const handleDoseConfirmed = useCallback(async (scheduleId: string, reminderId: string) => {
        const doseDate = confirmingDose?.doseDate || formatLocalDateKey(new Date());
        await markAsTaken(scheduleId, reminderId, doseDate);
        setJustConfirmed(true);
        setTimeout(() => setJustConfirmed(false), 2000);
    }, [markAsTaken, confirmingDose]);

    const handleModalClose = useCallback(() => {
        setConfirmingDose(null);
    }, []);

    if (isLoading) {
        return (
            <div className="landing-loading">
                <div className="loading-spinner"><IconPill size={32} /></div>
                <p>{t('landing.loading', '加载中...')}</p>
            </div>
        );
    }

    const currentTemp = 23; // TODO: 接入真实天气 API

    return (
        <div className="landing-page">
            {/* 健康档案未完善提醒 Banner */}
            {!isProfileComplete() && (
                <div className="profile-banner" onClick={onNavigateToHealthProfile}>
                    <span className="profile-banner-icon"><IconClipboard size={20} /></span>
                    <div className="profile-banner-text">
                        <span className="profile-banner-title">{t('landing.profileBannerTitle', '健康档案未完善')}</span>
                        <span className="profile-banner-desc">{t('landing.profileBannerDesc', '完善健康档案以获得更精准的用药建议')}</span>
                    </div>
                    <span className="profile-banner-action">{t('landing.profileBannerAction', '去完善')} ›</span>
                </div>
            )}

            {/* 顶部 Header */}
            <header className="landing-header">
                <div className="greeting-section">
                    <h1 className="greeting-text">
                        {getGreeting(t)}{userName ? `${i18n.language.startsWith('zh') ? '，' : ', '}${userName}` : ''}
                    </h1>
                    <p className="date-text">{dateStr}</p>
                </div>
                {/* 天气 + 穿衣建议 */}
                <div className="weather-badge">
                    <div className="weather-main">
                        <span className="weather-icon"><IconSun size={18} /></span>
                        <span className="weather-temp">{currentTemp}°</span>
                    </div>
                    <span className="weather-advice">{getClothingAdvice(currentTemp, t)}</span>
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
                                {nextDose.time} · {nextDose.dosage}
                            </p>

                            {/* 用药提示 */}
                            {nextDose.instructions && (
                                <p className="hero-instructions">
                                    {nextDose.instructions}
                                </p>
                            )}

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

            {/* 主体区域 — flex 填充 */}
            <div className="landing-body">
                {/* 用药概览卡片 — 始终显示，点击跳转 */}
                <section
                    className="summary-card"
                    onClick={stats.total > 0 ? onNavigateToSchedules : onNavigateToAddSchedule}
                    role="button"
                    tabIndex={0}
                >
                    {stats.total > 0 ? (
                        <>
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
                        </>
                    ) : (
                        <div className="summary-empty">
                            <div className="summary-empty-icon">
                                <IconPlus size={28} />
                            </div>
                            <div className="summary-empty-content">
                                <span className="summary-title">
                                    {t('landing.todayPlan', '今日用药')}
                                </span>
                                <span className="summary-empty-cta">
                                    {t('landing.addPlanCta', '点击添加用药计划')}
                                </span>
                            </div>
                            <span className="summary-arrow">›</span>
                        </div>
                    )}
                </section>

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
            </div>

            {/* 底部留白 */}
            <div className="nav-spacer" />

            {/* 确认服药弹窗 */}
            {confirmingDose && (
                <ConfirmDoseModal
                    dose={confirmingDose}
                    onConfirm={handleDoseConfirmed}
                    onClose={handleModalClose}
                />
            )}
        </div>
    );
}
