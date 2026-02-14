/**
 * @file MedicationSchedulePage.tsx
 * @description 服药计划页面 - 日历视图 + 提醒管理
 *
 * 🏛️ 架构师: 自定义 Apple 原生风格日历（避免第三方依赖），
 *   日历位于上半部分，选中日期过滤下方提醒列表
 * 🔧 工程师: 纯 React 实现月日历，用药日标注圆点，
 *   兼容现有 useMedicationSchedule 数据结构
 */

import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPill, IconBack, IconCalendar, IconCheck, IconEdit, IconTrash, IconClose } from '../components/Icons';
import { useMedicationSchedule } from '../hooks/medication/useMedicationSchedule';
import type { ScheduleFormData } from '../types/MedicationSchedule.types';
import { FREQUENCY_OPTIONS_KEYS } from '../types/MedicationFeedback.types';
import './MedicationSchedulePage.css';

interface MedicationSchedulePageProps {
    onBack: () => void;
    onNavigateToFeedback?: (medicationName: string, scheduleId: string) => void;
}

// 日历工具函数
function getDaysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
    return new Date(year, month, 1).getDay();
}

function isSameDay(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear()
        && d1.getMonth() === d2.getMonth()
        && d1.getDate() === d2.getDate();
}

function formatDateKey(date: Date): string {
    return date.toISOString().split('T')[0];
}

/**
 * 服药计划页面
 */
export function MedicationSchedulePage({ onBack, onNavigateToFeedback }: MedicationSchedulePageProps) {
    const { t } = useTranslation();
    const {
        schedules,
        isLoading,
        isSaving,
        error,
        createSchedule,
        deleteSchedule,
        markAsTaken,
        getTodaySchedules,
    } = useMedicationSchedule();

    // 日历状态
    const today = new Date();
    const [calendarYear, setCalendarYear] = useState(today.getFullYear());
    const [calendarMonth, setCalendarMonth] = useState(today.getMonth());
    const [selectedDate, setSelectedDate] = useState(today);

    // 表单状态
    const [showAddForm, setShowAddForm] = useState(false);
    const [formData, setFormData] = useState<ScheduleFormData>({
        medicationName: '',
        medicationDosage: '',
        frequency: 'thriceDaily',
        instructions: '',
        reminderTimes: ['08:00', '12:00', '18:00'],
        durationDays: '7',
    });

    // 计算有用药的日期集合
    const medicationDates = useMemo(() => {
        const dates = new Set<string>();
        schedules.filter(s => s.isActive).forEach(schedule => {
            const start = new Date(schedule.startDate);
            const end = schedule.endDate ? new Date(schedule.endDate) : new Date(start.getTime() + 30 * 86400000);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                dates.add(formatDateKey(new Date(d)));
            }
        });
        return dates;
    }, [schedules]);

    // 根据选中日期过滤计划
    const selectedDateKey = formatDateKey(selectedDate);
    const isToday = isSameDay(selectedDate, today);
    const filteredSchedules = isToday
        ? getTodaySchedules()
        : schedules.filter(schedule => {
            if (!schedule.isActive) return false;
            const startDate = schedule.startDate.split('T')[0];
            const endDate = schedule.endDate?.split('T')[0];
            if (selectedDateKey < startDate) return false;
            if (endDate && selectedDateKey > endDate) return false;
            return true;
        });

    // 日历导航
    const handlePrevMonth = useCallback(() => {
        setCalendarMonth(prev => {
            if (prev === 0) { setCalendarYear(y => y - 1); return 11; }
            return prev - 1;
        });
    }, []);

    const handleNextMonth = useCallback(() => {
        setCalendarMonth(prev => {
            if (prev === 11) { setCalendarYear(y => y + 1); return 0; }
            return prev + 1;
        });
    }, []);

    const handleDateSelect = useCallback((day: number) => {
        setSelectedDate(new Date(calendarYear, calendarMonth, day));
    }, [calendarYear, calendarMonth]);

    // 日历渲染数据
    const daysInMonth = getDaysInMonth(calendarYear, calendarMonth);
    const firstDay = getFirstDayOfMonth(calendarYear, calendarMonth);
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    // 表单处理
    const handleInputChange = useCallback((field: keyof ScheduleFormData, value: string | string[]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    }, []);

    const handleAddReminderTime = useCallback(() => {
        setFormData(prev => ({
            ...prev,
            reminderTimes: [...prev.reminderTimes, '12:00'],
        }));
    }, []);

    const handleUpdateReminderTime = useCallback((index: number, value: string) => {
        setFormData(prev => {
            const newTimes = [...prev.reminderTimes];
            newTimes[index] = value;
            return { ...prev, reminderTimes: newTimes };
        });
    }, []);

    const handleRemoveReminderTime = useCallback((index: number) => {
        setFormData(prev => ({
            ...prev,
            reminderTimes: prev.reminderTimes.filter((_, i) => i !== index),
        }));
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!formData.medicationName.trim()) {
            alert(t('schedule.medicationNameRequired'));
            return;
        }

        const frequencyText = t(`frequency.${formData.frequency}`);
        const todayStr = new Date().toISOString().split('T')[0];
        const durationDays = parseInt(formData.durationDays) || 7;
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + durationDays);

        const scheduleData = {
            medicationName: formData.medicationName,
            medicationDosage: formData.medicationDosage,
            frequency: frequencyText,
            instructions: formData.instructions,
            startDate: todayStr,
            endDate: endDate.toISOString().split('T')[0],
            isActive: true,
            reminders: formData.reminderTimes.map((time) => ({
                id: crypto.randomUUID(),
                time,
                dosage: formData.medicationDosage,
                taken: false,
            })),
        };

        await createSchedule(scheduleData);
        setShowAddForm(false);
        setFormData({
            medicationName: '',
            medicationDosage: '',
            frequency: 'thriceDaily',
            instructions: '',
            reminderTimes: ['08:00', '12:00', '18:00'],
            durationDays: '7',
        });
    }, [formData, createSchedule, t]);

    const handleMarkTaken = useCallback(async (scheduleId: string, reminderId: string) => {
        await markAsTaken(scheduleId, reminderId);
    }, [markAsTaken]);

    const handleDelete = useCallback(async (id: string) => {
        if (confirm(t('schedule.deleteConfirm'))) {
            await deleteSchedule(id);
        }
    }, [deleteSchedule, t]);

    if (isLoading) {
        return (
            <div className="schedule-page">
                <div className="schedule-loading">
                    <div className="loading-spinner"><IconPill size={32} /></div>
                    <p>{t('app.loading')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="schedule-page">
            {/* 头部 */}
            <div className="schedule-header">
                <button className="schedule-back-btn" onClick={onBack}><IconBack size={20} /></button>
                <h1 className="schedule-title">{t('schedule.title')}</h1>
            </div>

            {/* Apple 原生风格日历 */}
            <div className="calendar-section">
                <div className="calendar-card">
                    <div className="calendar-nav">
                        <button className="calendar-arrow" onClick={handlePrevMonth}>‹</button>
                        <span className="calendar-month">
                            {calendarYear}年{monthNames[calendarMonth]}
                        </span>
                        <button className="calendar-arrow" onClick={handleNextMonth}>›</button>
                    </div>

                    <div className="calendar-grid">
                        {weekdays.map(w => (
                            <span key={w} className="calendar-weekday">{w}</span>
                        ))}
                        {/* 空白填充 */}
                        {Array.from({ length: firstDay }).map((_, i) => (
                            <span key={`empty-${i}`} className="calendar-day inactive" />
                        ))}
                        {/* 日期 */}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const date = new Date(calendarYear, calendarMonth, day);
                            const dateKey = formatDateKey(date);
                            const isSelected = isSameDay(date, selectedDate);
                            const isTodayDate = isSameDay(date, today);
                            const hasMeds = medicationDates.has(dateKey);

                            let className = 'calendar-day';
                            if (isSelected) className += ' selected';
                            else if (isTodayDate) className += ' today';
                            if (hasMeds) className += ' has-meds';

                            return (
                                <button
                                    key={day}
                                    className={className}
                                    onClick={() => handleDateSelect(day)}
                                >
                                    {day}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 错误提示 */}
            {error && <div className="error-message" style={{ margin: '0 20px 12px' }}>{error}</div>}

            {/* 日期标题 */}
            <h2 className="section-title">
                <><IconCalendar size={18} /> {isToday ? t('schedule.todayMedication') : selectedDateKey}</>
            </h2>

            {/* 用药列表 */}
            <div className="schedule-content">
                {filteredSchedules.length === 0 ? (
                    <div className="schedule-empty">
                        <span className="schedule-empty-icon"><IconPill size={40} /></span>
                        <p className="schedule-empty-text">{t('schedule.noScheduleToday')}</p>
                    </div>
                ) : (
                    filteredSchedules.map(schedule => (
                        <div key={schedule.id} className="schedule-card">
                            <div className="schedule-card-header">
                                <h3 className="schedule-med-name">{schedule.medicationName}</h3>
                                <span className="schedule-frequency">{schedule.frequency}</span>
                            </div>

                            {schedule.medicationDosage && (
                                <p className="schedule-dosage">{schedule.medicationDosage}</p>
                            )}

                            {schedule.instructions && (
                                <p className="schedule-instructions">{schedule.instructions}</p>
                            )}

                            <div className="reminder-list">
                                {schedule.reminders.map(reminder => {
                                    const isMissed = !reminder.taken && isToday &&
                                        reminder.time < new Date().toTimeString().slice(0, 5);

                                    return (
                                        <div
                                            key={reminder.id}
                                            className={`reminder-row ${reminder.taken ? 'taken' : ''} ${isMissed ? 'missed' : ''}`}
                                        >
                                            <span className="reminder-time">{reminder.time}</span>
                                            <span className="reminder-dosage">{reminder.dosage}</span>

                                            {reminder.taken ? (
                                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                    <span className="reminder-status taken">
                                                        <IconCheck size={14} /> {t('schedule.taken')}
                                                    </span>
                                                    {onNavigateToFeedback && (
                                                        <button
                                                            className="take-btn"
                                                            style={{ fontSize: '12px', padding: '4px 10px' }}
                                                            onClick={() => onNavigateToFeedback(schedule.medicationName, schedule.id)}
                                                        >
                                                            <IconEdit size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            ) : isMissed ? (
                                                <span className="reminder-status missed">
                                                    {t('schedule.missed', '已错过')}
                                                </span>
                                            ) : isToday ? (
                                                <button
                                                    className="take-btn"
                                                    onClick={() => handleMarkTaken(schedule.id, reminder.id)}
                                                >
                                                    {t('schedule.confirmTake')}
                                                </button>
                                            ) : (
                                                <span className="reminder-status pending">
                                                    {t('schedule.pending', '待服用')}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="schedule-card-actions">
                                <button
                                    className="schedule-action-btn action-delete"
                                    onClick={() => handleDelete(schedule.id)}
                                >
                                    <IconTrash size={14} /> {t('app.delete', '删除')}
                                </button>
                            </div>
                        </div>
                    ))
                )}
                <div className="nav-spacer" />
            </div>

            {/* 添加按钮 (FAB) */}
            <button
                className="add-schedule-btn"
                onClick={() => setShowAddForm(true)}
            >
                +
            </button>

            {/* 添加计划弹窗 */}
            {showAddForm && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2>{t('schedule.addSchedule')}</h2>
                            <button className="close-btn" onClick={() => setShowAddForm(false)}><IconClose size={18} /></button>
                        </div>

                        <div className="form-group">
                            <label>{t('schedule.medicationName')} *</label>
                            <input
                                type="text"
                                className="form-input"
                                value={formData.medicationName}
                                onChange={(e) => handleInputChange('medicationName', e.target.value)}
                                placeholder={t('schedule.medicationNamePlaceholder')}
                            />
                        </div>

                        <div className="form-group">
                            <label>{t('schedule.dosage')}</label>
                            <input
                                type="text"
                                className="form-input"
                                value={formData.medicationDosage}
                                onChange={(e) => handleInputChange('medicationDosage', e.target.value)}
                                placeholder={t('schedule.dosagePlaceholder')}
                            />
                        </div>

                        <div className="form-group">
                            <label>{t('schedule.frequency')}</label>
                            <select
                                className="form-input"
                                value={formData.frequency}
                                onChange={(e) => handleInputChange('frequency', e.target.value)}
                            >
                                {FREQUENCY_OPTIONS_KEYS.map(key => (
                                    <option key={key} value={key}>
                                        {t(`frequency.${key}`)}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label>{t('schedule.reminderTime')}</label>
                            {formData.reminderTimes.map((time, index) => (
                                <div key={index} className="reminder-time-row">
                                    <input
                                        type="time"
                                        className="form-input time-input"
                                        value={time}
                                        onChange={(e) => handleUpdateReminderTime(index, e.target.value)}
                                    />
                                    {formData.reminderTimes.length > 1 && (
                                        <button
                                            className="remove-time-btn"
                                            onClick={() => handleRemoveReminderTime(index)}
                                        >
                                            <IconClose size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button className="add-time-btn" onClick={handleAddReminderTime}>
                                + {t('schedule.addReminderTime')}
                            </button>
                        </div>

                        <div className="form-group">
                            <label>{t('schedule.duration')}</label>
                            <input
                                type="number"
                                className="form-input"
                                value={formData.durationDays}
                                onChange={(e) => handleInputChange('durationDays', e.target.value)}
                                placeholder="7"
                                min="1"
                            />
                        </div>

                        <div className="form-group">
                            <label>{t('schedule.instructions')}</label>
                            <textarea
                                className="form-textarea"
                                value={formData.instructions}
                                onChange={(e) => handleInputChange('instructions', e.target.value)}
                                placeholder={t('schedule.instructionsPlaceholder')}
                                rows={2}
                            />
                        </div>

                        <div className="modal-actions">
                            <button className="secondary-button" onClick={() => setShowAddForm(false)}>
                                {t('app.cancel')}
                            </button>
                            <button className="primary-button" onClick={handleSubmit} disabled={isSaving}>
                                {isSaving ? t('app.saving') : t('app.save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default MedicationSchedulePage;
