/**
 * @file LandingPage.tsx
 * @description 首页 — 服药核心页
 * Hero FAB "确认服用" + 用药概览 + 快捷操作
 * @preserve 保留所有 useMedicationSchedule 业务逻辑
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMedicationSchedule, type MedicationSchedule, type MedicationReminder } from '../hooks/medication/useMedicationSchedule';
import { useMedicationInsights } from '../hooks/medication/useMedicationInsights';
import { useHealthProfile } from '../hooks/user/useHealthProfile';
import { prewarmAgentSuggestedQuestions } from '../services/agentApi';
import { IconPill, IconSun, IconCheck, IconCamera, IconGuide, IconPlus, IconClipboard } from '../components/Icons';
import ConfirmDoseModal, { type DoseInfo } from '../components/ConfirmDoseModal';
import PreDoseInstructionModal from '../components/PreDoseInstructionModal';
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
    dateKey: string;
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
const isMissed = (
    reminder: MedicationReminder,
    schedule: MedicationSchedule,
    targetDateKey: string,
    todayDateKey: string
): boolean => {
    if (reminder.taken) return false;
    if (reminder.missed) return true;
    if (targetDateKey > todayDateKey) return false;
    if (targetDateKey < todayDateKey) return true;
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

    const pending = reminders
        .filter(r => !r.taken && !r.missed)
        .map(r => {
            const scheduledAt = new Date(`${r.dateKey}T${r.time}:00`);
            return { ...r, scheduledAtMs: scheduledAt.getTime() };
        })
        .filter(r => Number.isFinite(r.scheduledAtMs) && r.scheduledAtMs >= now.getTime())
        .sort((a, b) => a.scheduledAtMs - b.scheduledAtMs);

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
    const { isLoading, markAsTaken, getTodaySchedules, getSchedulesForDate, syncState } = useMedicationSchedule();
    const { insights, isLoading: isInsightsLoading, error: insightsError } = useMedicationInsights();
    const { isProfileComplete } = useHealthProfile();
    const [preConfirmingDose, setPreConfirmingDose] = useState<DoseInfo | null>(null);
    const [confirmingDose, setConfirmingDose] = useState<DoseInfo | null>(null);
    const [justConfirmed, setJustConfirmed] = useState(false);
    const todayDateKey = formatLocalDateKey(new Date());

    // 今日所有提醒展开
    const todayReminders = useMemo((): FlatReminder[] => {
        const todaySchedules = getTodaySchedules();
        const reminders: FlatReminder[] = [];
        todaySchedules.forEach((schedule: MedicationSchedule) => {
            schedule.reminders.forEach((reminder: MedicationReminder) => {
                reminders.push({
                    scheduleId: schedule.id,
                    reminderId: reminder.id,
                    dateKey: todayDateKey,
                    name: schedule.medicationName,
                    time: reminder.time,
                    dosage: reminder.dosage,
                    taken: reminder.taken,
                    missed: isMissed(reminder, schedule, todayDateKey, todayDateKey),
                    instructions: schedule.instructions || undefined,
                });
            });
        });
        return reminders.sort((a, b) => a.time.localeCompare(b.time));
    }, [getTodaySchedules, todayDateKey]);

    const upcomingReminders = useMemo((): FlatReminder[] => {
        const today = new Date(`${todayDateKey}T00:00:00`);
        const tomorrowDate = new Date(today.getTime());
        tomorrowDate.setDate(today.getDate() + 1);
        const tomorrowDateKey = formatLocalDateKey(tomorrowDate);
        const targetDates = [todayDateKey, tomorrowDateKey];
        const reminders: FlatReminder[] = [];

        targetDates.forEach((dateKey) => {
            const dateSchedules = getSchedulesForDate(dateKey);
            dateSchedules.forEach((schedule) => {
                schedule.reminders.forEach((reminder) => {
                    reminders.push({
                        scheduleId: schedule.id,
                        reminderId: reminder.id,
                        dateKey,
                        name: schedule.medicationName,
                        time: reminder.time,
                        dosage: reminder.dosage,
                        taken: reminder.taken,
                        missed: isMissed(reminder, schedule, dateKey, todayDateKey),
                        instructions: schedule.instructions || undefined,
                    });
                });
            });
        });

        return reminders.sort((a, b) => `${a.dateKey}-${a.time}`.localeCompare(`${b.dateKey}-${b.time}`));
    }, [getSchedulesForDate, todayDateKey]);

    const stats = useMemo(() => ({
        total: todayReminders.length,
        taken: todayReminders.filter(r => r.taken).length,
        pending: todayReminders.filter(r => !r.taken && !r.missed).length,
        missed: todayReminders.filter(r => r.missed).length,
    }), [todayReminders]);

    const nextDose = useMemo(() => getNextDose(upcomingReminders), [upcomingReminders]);
    const isNextDoseToday = !!nextDose && nextDose.dateKey === todayDateKey;
    const upcomingPlanDetails = useMemo(() => {
        if (!nextDose) return [];
        const currentAtMs = new Date(`${nextDose.dateKey}T${nextDose.time}:00`).getTime();
        return upcomingReminders
            .map((item) => ({
                ...item,
                scheduledAtMs: new Date(`${item.dateKey}T${item.time}:00`).getTime(),
            }))
            .filter((item) => Number.isFinite(item.scheduledAtMs))
            .filter((item) => !item.taken && !item.missed && item.scheduledAtMs > currentAtMs)
            .slice(0, 3);
    }, [nextDose, upcomingReminders]);

    // 刷新时钟
    const [currentTime, setCurrentTime] = useState(new Date());
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const language = i18n.language === 'en'
            ? 'en'
            : i18n.language === 'zh-TW'
                ? 'zh-TW'
                : 'zh-CN';

        void prewarmAgentSuggestedQuestions({ language });
    }, [i18n.language]);

    const dateStr = new Intl.DateTimeFormat(i18n.language || 'en', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
    }).format(currentTime);

    // 确认服药流程
    const buildDoseInfo = useCallback((reminder: FlatReminder): DoseInfo => {
        return {
            scheduleId: reminder.scheduleId,
            reminderId: reminder.reminderId,
            medicationName: reminder.name,
            dosage: reminder.dosage,
            time: reminder.time,
            doseDate: formatLocalDateKey(new Date()),
            instructions: reminder.instructions || '',
        };
    }, []);

    const handleFABClick = useCallback(() => {
        if (nextDose && isNextDoseToday) {
            setPreConfirmingDose(buildDoseInfo(nextDose));
        }
    }, [nextDose, buildDoseInfo, isNextDoseToday]);

    const handlePreConfirmContinue = useCallback(() => {
        if (!preConfirmingDose) return;
        setConfirmingDose(preConfirmingDose);
        setPreConfirmingDose(null);
    }, [preConfirmingDose]);

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
                                {nextDose.dateKey === todayDateKey
                                    ? nextDose.time
                                    : `${t('landing.tomorrow', '明天')} ${nextDose.time}`} · {nextDose.dosage}
                            </p>
                            {nextDose.dateKey !== todayDateKey && (
                                <p className="hero-next-date">
                                    {t('landing.nextDateHint', '已切换到下一次计划日期')}: {nextDose.dateKey}
                                </p>
                            )}

                            {/* 用药提示 */}
                            {nextDose.instructions && (
                                <p className="hero-instructions">
                                    {nextDose.instructions}
                                </p>
                            )}

                            {/* 超大 FAB */}
                            <button
                                className={`fab-confirm ${justConfirmed ? 'confirmed' : ''}`}
                                onClick={isNextDoseToday ? handleFABClick : onNavigateToSchedules}
                                disabled={isNextDoseToday ? justConfirmed : false}
                            >
                                <span className="fab-icon">
                                    {justConfirmed ? <IconCheck size={36} /> : <IconPill size={36} />}
                                </span>
                                <span className="fab-text">
                                    {isNextDoseToday && justConfirmed
                                        ? t('landing.confirmed', '已确认')
                                        : (isNextDoseToday
                                            ? t('landing.confirmTake', '确认服用')
                                            : t('landing.viewPlan', '查看计划'))}
                                </span>
                            </button>

                            {/* 下方计划详情 */}
                            <div className="next-plan-detail">
                                {upcomingPlanDetails
                                    .map(r => (
                                        <div key={`${r.reminderId}-${r.dateKey}`} className="next-plan-item">
                                            <span className="plan-time">{r.dateKey === todayDateKey ? r.time : `${t('landing.tomorrow', '明天')} ${r.time}`}</span>
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

                <section className={`insight-card risk-${insights.riskLevel}`}>
                    <div className="insight-header">
                        <span className="insight-title">{t('landing.insightTitle', '云端用药洞察')}</span>
                        <span className="insight-source">
                            {t('landing.insightSource', '数据来源')}: {syncState === 'cloud' && insights.source === 'cloud'
                                ? t('landing.insightCloud', '云端聚合')
                                : t('landing.insightLocal', '本地缓存')}
                        </span>
                    </div>
                    <div className="insight-grid">
                        <div className="insight-item">
                            <span className="insight-label">{t('landing.nextDose', '下次服药')}</span>
                            <span className="insight-value">
                                {nextDose
                                    ? `${nextDose.dateKey === todayDateKey ? '' : `${t('landing.tomorrow', '明天')} `}${nextDose.time} ${nextDose.name}`
                                    : t('landing.noSchedule', '暂无用药计划')}
                            </span>
                        </div>
                        <div className="insight-item">
                            <span className="insight-label">{t('landing.adherence30d', '近30天依从率')}</span>
                            <span className="insight-value">
                                {isInsightsLoading
                                    ? t('app.loading', '加载中...')
                                    : (insights.adherenceRate30d === null
                                        ? t('landing.noData', '暂无数据')
                                        : `${insights.adherenceRate30d}%`)}
                            </span>
                        </div>
                    </div>
                    <p className="insight-risk-summary">{insights.riskSummary}</p>
                    {insightsError && <p className="insight-error">{insightsError}</p>}
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

            {/* 服药前说明弹窗 */}
            {preConfirmingDose && (
                <PreDoseInstructionModal
                    dose={preConfirmingDose}
                    onBack={() => setPreConfirmingDose(null)}
                    onConfirm={handlePreConfirmContinue}
                />
            )}

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
