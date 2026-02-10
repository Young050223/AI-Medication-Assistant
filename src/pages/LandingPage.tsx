/**
 * @file LandingPage.tsx
 * @description Landing主页 - 用户登录后的首页
 * @author AI用药助手开发团队
 * @created 2026-01-28
 * @modified 2026-01-30 - 集成真实服药计划数据
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMedicationSchedule } from '../hooks/medication/useMedicationSchedule';
import './LandingPage.css';

interface LandingPageProps {
    userName?: string;
    onNavigateToUpload: () => void;
    onNavigateToSchedules: () => void;
    onNavigateToProfile: () => void;
    onNavigateToAgentAnalysis: () => void;
    onLogout: () => void;
}

// 今日药物提醒类型（包含状态）
interface TodayReminder {
    id: string;
    scheduleId: string;
    reminderId: string;
    name: string;
    time: string;
    dosage: string;
    taken: boolean;
    missed: boolean; // 已错过（过期超过2小时）
}

/**
 * 判断某个时间是否已过期超过2小时
 * @param timeStr 时间字符串，格式 "HH:mm"
 * @returns 是否已错过
 */
const isMissed = (timeStr: string): boolean => {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);

    const scheduledTime = new Date();
    scheduledTime.setHours(hours, minutes, 0, 0);

    const diffMs = now.getTime() - scheduledTime.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    return diffHours > 2;
};

/**
 * Landing主页组件
 */
export function LandingPage({
    userName,
    onNavigateToUpload,
    onNavigateToSchedules,
    onNavigateToProfile,
    onNavigateToAgentAnalysis,
    onLogout,
}: LandingPageProps) {
    const { t, i18n } = useTranslation();
    const [greeting, setGreeting] = useState('');
    const [currentDate, setCurrentDate] = useState('');
    const [currentTime, setCurrentTime] = useState(new Date());

    // 获取真实的服药计划数据
    const { schedules, getTodaySchedules, markAsTaken, isLoading, loadSchedules } = useMedicationSchedule();

    // 组件挂载时刷新数据（确保从其他页面返回时获取最新数据）
    useEffect(() => {
        loadSchedules();
    }, [loadSchedules]);

    // 设置问候语和日期
    useEffect(() => {
        const hour = new Date().getHours();
        if (hour < 12) {
            setGreeting(t('landing.goodMorning', '早上好'));
        } else if (hour < 18) {
            setGreeting(t('landing.goodAfternoon', '下午好'));
        } else {
            setGreeting(t('landing.goodEvening', '晚上好'));
        }

        // 根据当前语言设置日期格式
        const localeMap: Record<string, string> = {
            'zh-CN': 'zh-CN',
            'zh-TW': 'zh-TW',
            'en': 'en-US',
        };
        const currentLocale = localeMap[i18n.language] || i18n.language;

        const options: Intl.DateTimeFormatOptions = {
            month: 'long',
            day: 'numeric',
            weekday: 'long',
        };
        setCurrentDate(new Date().toLocaleDateString(currentLocale, options));
    }, [t, i18n.language]);

    // 每分钟更新一次当前时间（用于重新计算过期状态）
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 60000); // 每分钟更新
        return () => clearInterval(timer);
    }, []);

    // 构建今日提醒列表（从真实数据）
    const todayReminders = useMemo((): TodayReminder[] => {
        const todaySchedules = getTodaySchedules();
        const reminders: TodayReminder[] = [];

        todaySchedules.forEach(schedule => {
            schedule.reminders.forEach(reminder => {
                reminders.push({
                    id: `${schedule.id}_${reminder.id}`,
                    scheduleId: schedule.id,
                    reminderId: reminder.id,
                    name: schedule.medicationName,
                    time: reminder.time,
                    dosage: reminder.dosage || schedule.medicationDosage,
                    taken: reminder.taken,
                    missed: !reminder.taken && isMissed(reminder.time),
                });
            });
        });

        // 按时间排序
        reminders.sort((a, b) => a.time.localeCompare(b.time));

        return reminders;
    }, [getTodaySchedules, currentTime, schedules]);

    // 计算统计数据
    const pendingCount = todayReminders.filter(r => !r.taken && !r.missed).length;
    const completedCount = todayReminders.filter(r => r.taken).length;
    const missedCount = todayReminders.filter(r => r.missed).length;

    // 计算下次提醒（第一个未服用且未过期的）
    const nextReminder = useMemo(() => {
        // 找到下一个待服用的（未服用且未过期超过2小时）
        const next = todayReminders.find(r => !r.taken && !r.missed);

        if (next) {
            return { time: next.time, name: next.name, isToday: true };
        }

        // 如果今日全部完成或错过，显示明日第一次
        const todaySchedules = getTodaySchedules();
        if (todaySchedules.length > 0) {
            // 找到最早的提醒时间
            let earliestTime = '23:59';
            let earliestName = '';

            todaySchedules.forEach(schedule => {
                schedule.reminders.forEach(reminder => {
                    if (reminder.time < earliestTime) {
                        earliestTime = reminder.time;
                        earliestName = schedule.medicationName;
                    }
                });
            });

            if (earliestName) {
                return { time: earliestTime, name: earliestName, isToday: false };
            }
        }

        return null;
    }, [todayReminders, getTodaySchedules]);

    // 处理服药确认
    const handleTakeMedicine = async (scheduleId: string, reminderId: string) => {
        await markAsTaken(scheduleId, reminderId);
    };

    return (
        <div className="landing-page">
            {/* 顶部问候区 */}
            <header className="landing-header">
                <div className="greeting-section">
                    <h1 className="greeting-text">
                        {greeting}，{userName || t('landing.user', '用户')}
                    </h1>
                    <p className="date-text">{currentDate}</p>
                </div>
                <div className="header-avatar" onClick={onNavigateToProfile}>
                    <span className="avatar-icon">👤</span>
                </div>
            </header>

            {/* 用药提醒卡片 */}
            <section className="reminder-card">
                <div className="reminder-header">
                    <span className="reminder-icon">💊</span>
                    <h2 className="reminder-title">{t('landing.todayMedication', '今日用药')}</h2>
                </div>
                <div className="reminder-stats">
                    <div className="stat-item">
                        <span className="stat-number pending">{pendingCount}</span>
                        <span className="stat-label">{t('landing.pending', '待服用')}</span>
                    </div>
                    <div className="stat-divider" />
                    <div className="stat-item">
                        <span className="stat-number completed">{completedCount}</span>
                        <span className="stat-label">{t('landing.completed', '已完成')}</span>
                    </div>
                    {missedCount > 0 && (
                        <>
                            <div className="stat-divider" />
                            <div className="stat-item">
                                <span className="stat-number missed">{missedCount}</span>
                                <span className="stat-label">{t('landing.missed', '已错过')}</span>
                            </div>
                        </>
                    )}
                </div>
                {nextReminder ? (
                    <div className="next-reminder">
                        <span className="next-label">
                            {nextReminder.isToday
                                ? t('landing.nextReminder', '下次提醒')
                                : t('landing.tomorrowReminder', '明日提醒')}
                        </span>
                        <span className="next-time">
                            {nextReminder.time} - {nextReminder.name}
                        </span>
                    </div>
                ) : todayReminders.length === 0 ? (
                    <div className="next-reminder">
                        <span className="next-label">{t('landing.noSchedule', '暂无用药计划')}</span>
                    </div>
                ) : null}
            </section>

            {/* 快捷功能区 */}
            <section className="quick-actions">
                <h3 className="section-title">{t('landing.quickActions', '快捷操作')}</h3>
                <div className="actions-grid">
                    <button className="action-card" onClick={onNavigateToUpload}>
                        <span className="action-icon">📷</span>
                        <span className="action-label">{t('landing.scanRecord', '扫描病例')}</span>
                        <span className="action-desc">{t('landing.scanRecordDesc', '拍照识别处方')}</span>
                    </button>

                    <button className="action-card" onClick={onNavigateToSchedules}>
                        <span className="action-icon">⏰</span>
                        <span className="action-label">{t('landing.reminders', '用药提醒')}</span>
                        <span className="action-desc">{t('landing.remindersDesc', '管理服药计划')}</span>
                    </button>

                    <button className="action-card" onClick={onNavigateToProfile}>
                        <span className="action-icon">📊</span>
                        <span className="action-label">{t('landing.healthProfile', '健康档案')}</span>
                        <span className="action-desc">{t('landing.healthProfileDesc', '个人健康信息')}</span>
                    </button>

                    <button className="action-card" onClick={onNavigateToAgentAnalysis}>
                        <span className="action-icon">🔬</span>
                        <span className="action-label">{t('landing.drugGuide', '用药指南')}</span>
                        <span className="action-desc">{t('landing.drugGuideDesc', '药物知识库')}</span>
                    </button>
                </div>
            </section>

            {/* 最近用药记录 */}
            <section className="recent-records">
                <h3 className="section-title">{t('landing.recentRecords', '最近记录')}</h3>
                {isLoading ? (
                    <div className="loading-hint">{t('app.loading', '加载中...')}</div>
                ) : todayReminders.length === 0 ? (
                    <div className="empty-hint">{t('landing.noRecords', '暂无用药记录')}</div>
                ) : (
                    <div className="records-list">
                        {todayReminders.map((reminder) => (
                            <div
                                key={reminder.id}
                                className={`record-item ${reminder.taken ? 'taken' : ''} ${reminder.missed ? 'missed' : ''}`}
                            >
                                <div className="record-status">
                                    {reminder.taken ? (
                                        <span className="status-icon done">✓</span>
                                    ) : reminder.missed ? (
                                        <span className="status-icon missed">✗</span>
                                    ) : (
                                        <span className="status-icon pending">○</span>
                                    )}
                                </div>
                                <div className="record-info">
                                    <span className="record-name">{reminder.name}</span>
                                    <span className="record-time">
                                        {reminder.time}
                                        {reminder.missed && <span className="missed-tag"> (已错过)</span>}
                                    </span>
                                </div>
                                {!reminder.taken && !reminder.missed && (
                                    <button
                                        className="take-btn"
                                        onClick={() => handleTakeMedicine(reminder.scheduleId, reminder.reminderId)}
                                    >
                                        {t('landing.takeMedicine', '服用')}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* 退出登录按钮 */}
            <section className="logout-section">
                <button className="logout-btn" onClick={onLogout}>
                    <span className="logout-icon">🚪</span>
                    <span>{t('auth.logout', '退出登录')}</span>
                </button>
            </section>

            {/* 底部占位，避免内容被导航栏遮挡 */}
            <div className="nav-spacer" />
        </div>
    );
}

export default LandingPage;
