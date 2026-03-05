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
import ConfirmDoseModal, { type DoseInfo } from '../components/ConfirmDoseModal';
import type { ScheduleFormData } from '../types/MedicationSchedule.types';
import { FREQUENCY_OPTIONS_KEYS } from '../types/MedicationFeedback.types';
import './MedicationSchedulePage.css';

interface MedicationSchedulePageProps {
    onBack: () => void;
    onNavigateToFeedback?: (medicationName: string, scheduleId: string) => void;
    autoOpenAdd?: boolean;
}

// 频率 → 每日次数映射
const FREQUENCY_COUNT: Record<string, number> = {
    onceDaily: 1,
    twiceDaily: 2,
    thriceDaily: 3,
    fourTimesDaily: 4,
    asNeeded: 1,
};

// 根据次数生成默认提醒时间
const getDefaultTimes = (count: number): string[] => {
    const times: Record<number, string[]> = {
        1: ['08:00'],
        2: ['08:00', '20:00'],
        3: ['08:00', '12:00', '18:00'],
        4: ['08:00', '12:00', '16:00', '20:00'],
    };
    return times[count] || ['08:00'];
};

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
export function MedicationSchedulePage({ onBack, autoOpenAdd }: MedicationSchedulePageProps) {
    const { t, i18n } = useTranslation();
    const {
        schedules,
        isLoading,
        isSaving,
        error,
        createSchedule,
        updateSchedule,
        deleteSchedule,
        markAsTaken,
        markAsMissed,
        getSchedulesForDate,
        setDateOverride,
    } = useMedicationSchedule();

    // 日历状态
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const [calendarYear, setCalendarYear] = useState(today.getFullYear());
    const [calendarMonth, setCalendarMonth] = useState(today.getMonth());
    const [selectedDate, setSelectedDate] = useState(today);

    // 表单状态
    const [showAddForm, setShowAddForm] = useState(autoOpenAdd === true);
    const [isEditing, setIsEditing] = useState(false);
    const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
    const [, setEditScope] = useState<'today' | 'future'>('future');
    const [showScopeDialog, setShowScopeDialog] = useState(false);
    const [confirmingDose, setConfirmingDose] = useState<DoseInfo | null>(null);
    const [statusToggle, setStatusToggle] = useState<{
        scheduleId: string;
        reminderId: string;
        schedule: any;
        reminder: any;
        currentStatus: 'taken' | 'missed' | 'pending';
        date: string;
    } | null>(null);
    const [formData, setFormData] = useState<ScheduleFormData>({
        medicationName: '',
        medicationDosage: '',
        frequency: 'thriceDaily',
        instructions: '',
        reminderTimes: ['08:00', '12:00', '18:00'],
        startDate: todayStr,
        durationDays: '7',
        graceMinutes: '',
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

    // 根据选中日期过滤计划（带 override & 日状态）
    const selectedDateKey = formatDateKey(selectedDate);
    const isToday = isSameDay(selectedDate, today);
    const filteredSchedules = useMemo(
        () => getSchedulesForDate(selectedDateKey),
        [getSchedulesForDate, selectedDateKey]
    );

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
    const weekdays = t('calendar.weekdays', {
        returnObjects: true,
        defaultValue: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    }) as string[];
    const monthNames = t('calendar.months', {
        returnObjects: true,
        defaultValue: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    }) as string[];
    const calendarTitle = t('calendar.yearMonth', {
        year: calendarYear,
        month: monthNames[calendarMonth],
        defaultValue: `${calendarYear}/${calendarMonth + 1}`,
    });
    const formatSelectedDate = (date: Date) => date.toLocaleDateString(
        i18n.language || 'en',
        { year: 'numeric', month: 'long', day: 'numeric' }
    );
    const normalizeFrequencyKey = (frequency: string) => {
        const fallbackMap: Record<string, string> = {
            '每日1次': 'onceDaily',
            '每日2次': 'twiceDaily',
            '每日3次': 'thriceDaily',
            '每日4次': 'fourTimesDaily',
            '需要时': 'asNeeded',
            '需要時': 'asNeeded',
            'Once daily': 'onceDaily',
            'Twice daily': 'twiceDaily',
            '3 times daily': 'thriceDaily',
            '4 times daily': 'fourTimesDaily',
            'As needed': 'asNeeded',
        };
        if (FREQUENCY_OPTIONS_KEYS.includes(frequency as typeof FREQUENCY_OPTIONS_KEYS[number])) {
            return frequency;
        }
        return fallbackMap[frequency] || frequency;
    };

    // 表单处理
    const handleInputChange = useCallback((field: keyof ScheduleFormData, value: string | string[]) => {
        setFormData(prev => {
            const updated = { ...prev, [field]: value };
            // 频率变化时自动同步提醒时间数量
            if (field === 'frequency' && typeof value === 'string') {
                const count = FREQUENCY_COUNT[value] || 1;
                updated.reminderTimes = getDefaultTimes(count);
            }
            return updated;
        });
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

    const isReminderMissed = useCallback((reminder: any, schedule: any, dateKey: string) => {
        if (reminder.taken) return false;
        if (reminder.missed) return true;
        const windowMinutes = schedule.allowWindowMinutes ?? schedule.graceMinutes ?? 0;
        const [h, m] = reminder.time.split(':').map(Number);
        const reminderMinutes = h * 60 + m;
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const todayKeyStr = todayStr;

        if (dateKey < todayKeyStr) return true;
        if (dateKey > todayKeyStr) return false;
        return nowMinutes > reminderMinutes + windowMinutes;
    }, [todayStr]);

    const startEdit = useCallback((schedule: any) => {
        const duration = schedule.endDate
            ? Math.max(1, Math.round((new Date(schedule.endDate).getTime() - new Date(schedule.startDate).getTime()) / 86400000))
            : parseInt(formData.durationDays) || 7;
        setFormData({
            medicationName: schedule.medicationName,
            medicationDosage: schedule.medicationDosage,
            frequency: schedule.frequency,
            instructions: schedule.instructions || '',
            reminderTimes: schedule.reminders.map((r: any) => r.time),
            startDate: schedule.startDate.split('T')[0],
            durationDays: String(duration),
            graceMinutes: schedule.allowWindowMinutes?.toString() || schedule.graceMinutes?.toString() || '',
        });
        setIsEditing(true);
        setEditingScheduleId(schedule.id);
        setEditScope('future');
        setShowAddForm(true);
    }, [formData.durationDays, setShowAddForm]);

    const resetForm = useCallback(() => {
        setFormData({
            medicationName: '',
            medicationDosage: '',
            frequency: 'thriceDaily',
            instructions: '',
            reminderTimes: ['08:00', '12:00', '18:00'],
            startDate: todayStr,
            durationDays: '7',
            graceMinutes: '',
        });
        setIsEditing(false);
        setEditingScheduleId(null);
        setEditScope('future');
    }, [todayStr]);

    const openConfirmModal = useCallback((schedule: any, reminder: any) => {
        setConfirmingDose({
            scheduleId: schedule.id,
            reminderId: reminder.id,
            medicationName: schedule.medicationName,
            dosage: reminder.dosage || schedule.medicationDosage,
            time: reminder.time,
        });
    }, []);

    const handleDoseConfirmed = useCallback(async (scheduleId: string, reminderId: string) => {
        await markAsTaken(scheduleId, reminderId, selectedDateKey);
        setConfirmingDose(null);
    }, [markAsTaken, selectedDateKey]);

    const handleStatusChange = useCallback(async (newStatus: 'taken' | 'missed') => {
        if (!statusToggle) return;
        const { scheduleId, reminderId, schedule, reminder, date } = statusToggle;
        if (newStatus === 'taken') {
            setStatusToggle(null);
            openConfirmModal(schedule, reminder);
        } else {
            await markAsMissed(scheduleId, reminderId, date);
            setStatusToggle(null);
        }
    }, [statusToggle, markAsMissed, openConfirmModal]);

    const doSave = useCallback(async (scope: 'today' | 'future') => {
        if (!formData.medicationName.trim()) return;

        const startDate = formData.startDate || todayStr;
        const durationDays = parseInt(formData.durationDays) || 7;
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + durationDays);
        const allowWindowMinutes = formData.graceMinutes ? parseInt(formData.graceMinutes, 10) : undefined;

        if (isEditing && editingScheduleId) {
            const overridePayload = {
                medicationName: formData.medicationName,
                medicationDosage: formData.medicationDosage,
                frequency: formData.frequency,
                instructions: formData.instructions,
                reminderTimes: formData.reminderTimes,
                allowWindowMinutes,
            };

            if (scope === 'today') {
                await setDateOverride(editingScheduleId, selectedDateKey, overridePayload);
            } else {
                const base = schedules.find(s => s.id === editingScheduleId);
                const newReminders = formData.reminderTimes.map((time, index) => ({
                    id: base?.reminders[index]?.id || crypto.randomUUID(),
                    time,
                    dosage: formData.medicationDosage,
                    taken: false,
                }));

                await updateSchedule(editingScheduleId, {
                    medicationName: formData.medicationName,
                    medicationDosage: formData.medicationDosage,
                    frequency: formData.frequency,
                    instructions: formData.instructions,
                    startDate,
                    endDate: endDate.toISOString().split('T')[0],
                    reminders: newReminders,
                    allowWindowMinutes,
                    graceMinutes: allowWindowMinutes,
                });
            }
            setShowAddForm(false);
            resetForm();
            return;
        }

        const scheduleData = {
            medicationName: formData.medicationName,
            medicationDosage: formData.medicationDosage,
            frequency: formData.frequency,
            instructions: formData.instructions,
            startDate: startDate,
            endDate: endDate.toISOString().split('T')[0],
            isActive: true,
            allowWindowMinutes,
            graceMinutes: allowWindowMinutes,
            reminders: formData.reminderTimes.map((time) => ({
                id: crypto.randomUUID(),
                time,
                dosage: formData.medicationDosage,
                taken: false,
            })),
        };

        await createSchedule(scheduleData);
        setShowAddForm(false);
        resetForm();
    }, [formData, createSchedule, t, todayStr, isEditing, editingScheduleId, setDateOverride, selectedDateKey, schedules, updateSchedule, resetForm]);

    const handleSubmit = useCallback(async () => {
        if (!formData.medicationName.trim()) {
            alert(t('schedule.medicationNameRequired'));
            return;
        }
        if (isEditing && editingScheduleId) {
            setShowScopeDialog(true);
            return;
        }
        await doSave('future');
    }, [formData.medicationName, t, isEditing, editingScheduleId, doSave]);

    const handleSubmitWithScope = useCallback(async (scope: 'today' | 'future') => {
        setEditScope(scope);
        setShowScopeDialog(false);
        await doSave(scope);
    }, [doSave]);

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
                <button
                    className="add-schedule-btn"
                    onClick={() => { resetForm(); setShowAddForm(true); }}
                >
                    +
                </button>
            </div>

            {/* Apple 原生风格日历 */}
            <div className="calendar-section">
                <div className="calendar-card">
                    <div className="calendar-nav">
                        <button className="calendar-arrow" onClick={handlePrevMonth}>‹</button>
                        <span className="calendar-month">
                            {calendarTitle}
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
                <><IconCalendar size={18} /> {isToday ? t('schedule.todayMedication') : formatSelectedDate(selectedDate)}</>
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
                                {(() => {
                                    const frequencyKey = normalizeFrequencyKey(schedule.frequency);
                                    const frequencyLabel = t(`frequency.${frequencyKey}`, schedule.frequency);
                                    return <span className="schedule-frequency">{frequencyLabel}</span>;
                                })()}
                            </div>

                            {schedule.medicationDosage && (
                                <p className="schedule-dosage">{schedule.medicationDosage}</p>
                            )}

                            {schedule.instructions && (
                                <p className="schedule-instructions">{schedule.instructions}</p>
                            )}

                            <div className="reminder-list">
                                {schedule.reminders.map(reminder => {
                                    const isMissed = isReminderMissed(reminder, schedule, selectedDateKey);
                                    const isTaken = reminder.taken;

                                    return (
                                        <div
                                            key={reminder.id}
                                            className={`reminder-row ${isTaken ? 'taken' : ''} ${isMissed ? 'missed' : ''}`}
                                        >
                                            <span className="reminder-time">{reminder.time}</span>
                                            <span className="reminder-dosage">{reminder.dosage}</span>

                                            {isTaken ? (
                                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                    <button
                                                        className="reminder-status taken"
                                                        onClick={() => setStatusToggle({ scheduleId: schedule.id, reminderId: reminder.id, schedule, reminder, currentStatus: 'taken', date: selectedDateKey })}
                                                    >
                                                        <IconCheck size={14} /> {t('schedule.taken')}
                                                    </button>
                                                    <button
                                                        className="take-btn feedback-btn"
                                                        onClick={() => openConfirmModal(schedule, reminder)}
                                                    >
                                                        <IconEdit size={14} />
                                                    </button>
                                                </div>
                                            ) : isMissed ? (
                                                <button
                                                    className="reminder-status missed"
                                                    onClick={() => setStatusToggle({ scheduleId: schedule.id, reminderId: reminder.id, schedule, reminder, currentStatus: 'missed', date: selectedDateKey })}
                                                >
                                                    {t('schedule.missed', '已错过')}
                                                </button>
                                            ) : isToday ? (
                                                <button
                                                    className="take-btn"
                                                    onClick={() => openConfirmModal(schedule, reminder)}
                                                >
                                                    {t('schedule.confirmTake')}
                                                </button>
                                            ) : (
                                                <button
                                                    className="reminder-status pending"
                                                    onClick={() => setStatusToggle({ scheduleId: schedule.id, reminderId: reminder.id, schedule, reminder, currentStatus: 'pending', date: selectedDateKey })}
                                                >
                                                    {t('schedule.pending', '待服用')}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="schedule-card-actions">
                                <button
                                    className="schedule-action-btn action-edit"
                                    onClick={() => startEdit(schedule)}
                                >
                                    <IconEdit size={14} /> {t('app.edit', '编辑')}
                                </button>
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

            {/* 添加计划弹窗 */}
            {showAddForm && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2>{isEditing ? t('schedule.editSchedule', '编辑服药计划') : t('schedule.addSchedule')}</h2>
                            <button className="close-btn" onClick={() => { setShowAddForm(false); resetForm(); }}><IconClose size={18} /></button>
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
                            <label>{t('schedule.allowWindow', '确认时间窗口（±分钟）')}</label>
                            <input
                                type="number"
                                className="form-input"
                                value={formData.graceMinutes}
                                onChange={(e) => handleInputChange('graceMinutes', e.target.value)}
                                placeholder="20"
                                min="0"
                            />
                        </div>

                        <div className="form-group">
                            <label>{t('schedule.startDate', '开始日期')}</label>
                            <input
                                type="date"
                                className="form-input"
                                value={formData.startDate}
                                onChange={(e) => handleInputChange('startDate', e.target.value)}
                            />
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

            {statusToggle && (
                <div className="dose-modal-overlay" onClick={() => setStatusToggle(null)}>
                    <div className="dose-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '340px' }}>
                        <div className="dose-step" style={{ padding: '24px 20px' }}>
                            <div className="dose-header" style={{ marginBottom: '16px' }}>
                                <h3 style={{ fontSize: '18px' }}>{t('schedule.changeStatus', '修改状态')}</h3>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <button
                                    className="status-option-btn status-taken"
                                    onClick={() => handleStatusChange('taken')}
                                >
                                    <IconCheck size={16} />
                                    <span>{t('schedule.taken')}</span>
                                </button>
                                <button
                                    className="status-option-btn status-missed"
                                    onClick={() => handleStatusChange('missed')}
                                >
                                    <span>{t('schedule.missed', '已错过')}</span>
                                </button>
                            </div>
                            <button
                                className="anim-close"
                                style={{ marginTop: '16px', width: '100%' }}
                                onClick={() => setStatusToggle(null)}
                            >
                                {t('app.cancel', '取消')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit scope confirmation dialog */}
            {showScopeDialog && (
                <div className="dose-modal-overlay" onClick={() => setShowScopeDialog(false)}>
                    <div className="dose-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '340px' }}>
                        <div className="dose-step" style={{ padding: '24px 20px' }}>
                            <div className="dose-header" style={{ marginBottom: '16px' }}>
                                <h3 style={{ fontSize: '18px' }}>{t('schedule.editScope', '应用范围')}</h3>
                                <p className="dose-meta">{t('schedule.scopePrompt', '此修改应用于哪些日期？')}</p>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <button
                                    className="status-option-btn status-taken"
                                    onClick={() => handleSubmitWithScope('today')}
                                >
                                    <span>{t('schedule.scopeToday', '仅今天')}</span>
                                </button>
                                <button
                                    className="status-option-btn status-taken"
                                    onClick={() => handleSubmitWithScope('future')}
                                >
                                    <span>{t('schedule.scopeFuture', '未来全部')}</span>
                                </button>
                            </div>
                            <button
                                className="anim-close"
                                style={{ marginTop: '16px', width: '100%' }}
                                onClick={() => setShowScopeDialog(false)}
                            >
                                {t('app.cancel', '取消')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 确认服药弹窗 */}
            {confirmingDose && (
                <ConfirmDoseModal
                    dose={confirmingDose}
                    onConfirm={handleDoseConfirmed}
                    onClose={() => setConfirmingDose(null)}
                />
            )}
        </div>
    );
}

export default MedicationSchedulePage;
