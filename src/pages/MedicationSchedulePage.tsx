/**
 * @file MedicationSchedulePage.tsx
 * @description 服药计划页面 - 日历视图 + 提醒管理
 *
 * 🏛️ 架构师: 自定义 Apple 原生风格日历（避免第三方依赖），
 *   日历位于上半部分，选中日期过滤下方提醒列表
 * 🔧 工程师: 纯 React 实现月日历，用药日标注圆点，
 *   兼容现有 useMedicationSchedule 数据结构
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPill, IconBack, IconCalendar, IconCheck, IconEdit, IconTrash, IconClose } from '../components/Icons';
import { useMedicationSchedule } from '../hooks/medication/useMedicationSchedule';
import ConfirmDoseModal, { type DoseInfo } from '../components/ConfirmDoseModal';
import type { ScheduleFormData } from '../types/MedicationSchedule.types';
import { FREQUENCY_OPTIONS_KEYS } from '../types/MedicationFeedback.types';
import { formatLocalDateKey, normalizeDateKey, parseDateKeyAsLocalDate } from '../utils/dateKey';
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

function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
}

function toOverrideReminder(reminder: any, fallbackDosage: string) {
    return {
        id: reminder.id || crypto.randomUUID(),
        time: reminder.time,
        dosage: reminder.dosage || fallbackDosage,
    };
}

function getDateRangeKeys(startKey: string, endKey: string): string[] {
    const keys: string[] = [];
    const cursor = parseDateKeyAsLocalDate(startKey);
    const end = parseDateKeyAsLocalDate(endKey);
    while (cursor <= end) {
        keys.push(formatLocalDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
}

/**
 * 服药计划页面
 */
export function MedicationSchedulePage({ onBack, autoOpenAdd }: MedicationSchedulePageProps) {
    const { t, i18n } = useTranslation();
    const {
        schedules,
        anchorDate,
        isLoading,
        isSaving,
        error,
        createSchedule,
        updateSchedule,
        deleteSchedule,
        setDateOverride,
        markAsTaken,
        markAsMissed,
        getSchedulesForDate,
    } = useMedicationSchedule();

    // 日历状态
    const today = new Date();
    const todayStr = formatLocalDateKey(today);
    const [calendarYear, setCalendarYear] = useState(today.getFullYear());
    const [calendarMonth, setCalendarMonth] = useState(today.getMonth());
    const [selectedDate, setSelectedDate] = useState(
        new Date(today.getFullYear(), today.getMonth(), today.getDate())
    );
    const [appliedAnchorDate, setAppliedAnchorDate] = useState<string | null>(null);

    // 表单状态
    const [showAddForm, setShowAddForm] = useState(autoOpenAdd === true);
    const [isEditing, setIsEditing] = useState(false);
    const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
    const [, setEditScope] = useState<'today' | 'future'>('future');
    const [showScopeDialog, setShowScopeDialog] = useState(false);
    const [showDeleteScopeDialog, setShowDeleteScopeDialog] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{
        scheduleId: string;
        dateKey: string;
    } | null>(null);
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

    useEffect(() => {
        if (isLoading) return;
        const anchorDateKey = normalizeDateKey(anchorDate) || todayStr;
        if (appliedAnchorDate === anchorDateKey) return;
        // 日历默认定位到今天，而非用药周期锚点
        const calendarTarget = parseDateKeyAsLocalDate(todayStr);
        setSelectedDate(calendarTarget);
        setCalendarYear(calendarTarget.getFullYear());
        setCalendarMonth(calendarTarget.getMonth());
        setAppliedAnchorDate(anchorDateKey);
        setFormData(prev => ({ ...prev, startDate: todayStr }));
    }, [isLoading, anchorDate, todayStr, appliedAnchorDate]);

    // 计算有用药的日期集合
    const medicationDates = useMemo(() => {
        const dates = new Set<string>();
        schedules.filter(s => s.isActive).forEach(schedule => {
            const startKey = normalizeDateKey(schedule.startDate) || schedule.startDate.split('T')[0];
            const start = parseDateKeyAsLocalDate(startKey);
            const endKey = schedule.endDate
                ? (normalizeDateKey(schedule.endDate) || schedule.endDate.split('T')[0])
                : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 30);
            const end = typeof endKey === 'string'
                ? parseDateKeyAsLocalDate(endKey)
                : endKey;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateKey = formatLocalDateKey(d);
                if (schedule.dateOverrides?.[dateKey]?.isDeleted) continue;
                dates.add(dateKey);
            }
        });
        return dates;
    }, [schedules]);

    // 根据选中日期过滤计划（带 override & 日状态）
    const selectedDateKey = formatLocalDateKey(selectedDate);
    const isToday = isSameDay(selectedDate, today);
    const filteredSchedules = useMemo(
        () => {
            const result = getSchedulesForDate(selectedDateKey);
            console.log('[filteredSchedules] selectedDateKey=', selectedDateKey, 'count=', result.length, 'names=', result.map(s => s.medicationName));
            return result;
        },
        [getSchedulesForDate, selectedDateKey]
    );

    const getCalendarDotClass = useCallback((dateKey: string, isTodayDate: boolean): string => {
        if (!medicationDates.has(dateKey)) return '';
        if (isTodayDate) return '';
        if (dateKey > todayStr) return 'has-meds dot-future';
        const schedulesForDate = getSchedulesForDate(dateKey);
        const allTaken = schedulesForDate.length > 0
            && schedulesForDate.every(schedule =>
                schedule.reminders.every(reminder => reminder.taken)
            );
        return allTaken ? 'has-meds dot-complete' : 'has-meds dot-incomplete';
    }, [medicationDates, todayStr, getSchedulesForDate]);

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

    const getReminderStatus = useCallback((reminder: any, schedule: any, dateKey: string): 'taken' | 'missed' | 'pending' => {
        if (reminder.taken) return 'taken';
        if (isReminderMissed(reminder, schedule, dateKey)) return 'missed';
        return 'pending';
    }, [isReminderMissed]);

    const getConfirmableReminderId = useCallback((schedule: any, dateKey: string): string | null => {
        if (dateKey !== todayStr) return null;
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const nearestPending = schedule.reminders
            .filter((reminder: any) => getReminderStatus(reminder, schedule, dateKey) === 'pending')
            .sort((a: any, b: any) => {
                const aDist = Math.abs(timeToMinutes(a.time) - nowMinutes);
                const bDist = Math.abs(timeToMinutes(b.time) - nowMinutes);
                if (aDist !== bDist) return aDist - bDist;
                return timeToMinutes(a.time) - timeToMinutes(b.time);
            })[0];
        return nearestPending?.id ?? null;
    }, [todayStr, getReminderStatus]);

    const startEdit = useCallback((schedule: any) => {
        const duration = schedule.endDate
            ? Math.max(1, Math.round(
                (
                    parseDateKeyAsLocalDate(schedule.endDate.split('T')[0]).getTime()
                    - parseDateKeyAsLocalDate(schedule.startDate.split('T')[0]).getTime()
                ) / 86400000
            ))
            : parseInt(formData.durationDays) || 7;
        setFormData({
            medicationName: schedule.medicationName,
            medicationDosage: schedule.medicationDosage,
            frequency: schedule.frequency,
            instructions: schedule.instructions || '',
            reminderTimes: schedule.reminders.map((r: any) => r.time),
            startDate: normalizeDateKey(schedule.startDate) || schedule.startDate.split('T')[0],
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

    const openConfirmModal = useCallback((schedule: any, reminder: any, doseDate: string) => {
        setConfirmingDose({
            scheduleId: schedule.id,
            reminderId: reminder.id,
            medicationName: schedule.medicationName,
            dosage: reminder.dosage || schedule.medicationDosage,
            time: reminder.time,
            doseDate,
        });
    }, []);

    const handleDoseConfirmed = useCallback(async (scheduleId: string, reminderId: string) => {
        const doseDate = confirmingDose?.doseDate || selectedDateKey;
        await markAsTaken(scheduleId, reminderId, doseDate);
    }, [markAsTaken, selectedDateKey, confirmingDose]);

    const handleStatusChange = useCallback(async (newStatus: 'taken' | 'missed') => {
        if (!statusToggle) return;
        const { scheduleId, reminderId, schedule, reminder, date } = statusToggle;
        if (newStatus === 'taken') {
            setStatusToggle(null);
            openConfirmModal(schedule, reminder, date);
        } else {
            await markAsMissed(scheduleId, reminderId, date);
            setStatusToggle(null);
        }
    }, [statusToggle, markAsMissed, openConfirmModal]);

    const doSave = useCallback(async (scope: 'today' | 'future') => {
        console.log('[doSave] ENTER scope=', scope, 'isEditing=', isEditing, 'editingScheduleId=', editingScheduleId, 'formData=', JSON.stringify(formData));
        if (!formData.medicationName.trim()) return;

        const startDate = normalizeDateKey(formData.startDate) || todayStr;
        const durationDays = parseInt(formData.durationDays) || 7;
        const endDate = parseDateKeyAsLocalDate(startDate);
        endDate.setDate(endDate.getDate() + durationDays);
        const endDateKey = formatLocalDateKey(endDate);
        const allowWindowMinutes = formData.graceMinutes ? parseInt(formData.graceMinutes, 10) : undefined;

        if (isEditing && editingScheduleId) {
            const base = schedules.find(s => s.id === editingScheduleId);
            if (!base) { console.log('[doSave] base NOT FOUND for', editingScheduleId); return; }

            const baseOverrides = base.dateOverrides || {};

            // Build new reminders from form data, reusing existing IDs where possible
            const newReminders = formData.reminderTimes.map((time, index) => ({
                id: base.reminders[index]?.id || crypto.randomUUID(),
                time,
                dosage: formData.medicationDosage,
                taken: false,
            }));

            // Today override: full overwrite with user's edited data
            const todayOverride = {
                medicationName: formData.medicationName,
                medicationDosage: formData.medicationDosage,
                frequency: formData.frequency,
                instructions: formData.instructions,
                reminderTimes: formData.reminderTimes,
                reminders: newReminders.map(({ id, time, dosage }) => ({ id, time, dosage })),
                allowWindowMinutes,
            };

            if (scope === 'today') {
                // ── Apply to today only ──
                // Write a dateOverride for today; base schedule + future dates unchanged
                await updateSchedule(editingScheduleId, {
                    dateOverrides: {
                        ...baseOverrides,
                        [todayStr]: todayOverride,
                    },
                });
                console.log('[doSave] TODAY scope done. todayStr=', todayStr, 'override=', JSON.stringify(todayOverride).substring(0, 300));
            } else {
                // ── Apply to today + all future ──
                // 1. Freeze past dates (before today) with old base data
                const pastOverrides: Record<string, any> = {};
                const baseStartKey = normalizeDateKey(base.startDate) || base.startDate.split('T')[0];
                const yesterday = parseDateKeyAsLocalDate(todayStr);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayKey = formatLocalDateKey(yesterday);

                if (baseStartKey <= yesterdayKey) {
                    const baseEndKey = base.endDate
                        ? (normalizeDateKey(base.endDate) || base.endDate.split('T')[0])
                        : yesterdayKey;
                    const freezeUntil = baseEndKey < yesterdayKey ? baseEndKey : yesterdayKey;
                    const pastKeys = getDateRangeKeys(baseStartKey, freezeUntil);
                    const oldReminderSnapshot = base.reminders.map((reminder: any) => toOverrideReminder(reminder, base.medicationDosage));
                    pastKeys.forEach(dateKey => {
                        // Keep existing override if present, otherwise snapshot old base data
                        pastOverrides[dateKey] = baseOverrides[dateKey] || {
                            medicationName: base.medicationName,
                            medicationDosage: base.medicationDosage,
                            frequency: base.frequency,
                            instructions: base.instructions,
                            reminderTimes: oldReminderSnapshot.map((r: any) => r.time),
                            reminders: oldReminderSnapshot.map((r: any) => ({ ...r })),
                            allowWindowMinutes: base.allowWindowMinutes ?? base.graceMinutes,
                        };
                    });
                }

                // 2. Update base schedule with new data; dateOverrides only contain past dates
                //    so today + future use the new base directly
                await updateSchedule(editingScheduleId, {
                    medicationName: formData.medicationName,
                    medicationDosage: formData.medicationDosage,
                    frequency: formData.frequency,
                    instructions: formData.instructions,
                    startDate,
                    endDate: endDateKey,
                    reminders: newReminders,
                    allowWindowMinutes,
                    graceMinutes: allowWindowMinutes,
                    dateOverrides: pastOverrides,
                });
                console.log('[doSave] FUTURE scope done. todayStr=', todayStr, 'pastOverrides keys=', Object.keys(pastOverrides), 'base name=', formData.medicationName);
            }
            setShowAddForm(false);
            // DEBUG: inspect localStorage after save
            const debugKey = Object.keys(localStorage).find(k => k.startsWith('medication_schedules_'));
            if (debugKey) {
                const saved = JSON.parse(localStorage.getItem(debugKey) || '[]');
                const target = saved.find((s: any) => s.id === editingScheduleId);
                console.log('[doSave] localStorage after save:', JSON.stringify(target?.dateOverrides).substring(0, 500));
                console.log('[doSave] localStorage base name:', target?.medicationName);
            }
            resetForm();
            return;
        }

        const scheduleData = {
            medicationName: formData.medicationName,
            medicationDosage: formData.medicationDosage,
            frequency: formData.frequency,
            instructions: formData.instructions,
            startDate,
            endDate: endDateKey,
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
    }, [
        formData,
        createSchedule,
        todayStr,
        selectedDateKey,
        isEditing,
        editingScheduleId,
        schedules,
        updateSchedule,
        resetForm,
        getSchedulesForDate,
        getReminderStatus,
        getConfirmableReminderId,
    ]);

    const handleSubmit = useCallback(async () => {
        if (!formData.medicationName.trim()) {
            alert(t('schedule.medicationNameRequired'));
            return;
        }
        if (isEditing && editingScheduleId) {
            setShowAddForm(false);
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

    const closeDeleteScopeDialog = useCallback(() => {
        setShowDeleteScopeDialog(false);
        setPendingDelete(null);
    }, []);

    const handleDelete = useCallback((scheduleId: string) => {
        setPendingDelete({
            scheduleId,
            dateKey: selectedDateKey,
        });
        setShowDeleteScopeDialog(true);
    }, [selectedDateKey]);

    const handleDeleteWithScope = useCallback(async (scope: 'today' | 'future') => {
        if (!pendingDelete) return;
        const { scheduleId, dateKey } = pendingDelete;
        const target = schedules.find(s => s.id === scheduleId);
        if (!target) {
            closeDeleteScopeDialog();
            return;
        }

        if (scope === 'today') {
            await setDateOverride(scheduleId, dateKey, {
                isDeleted: true,
                reminderTimes: [],
                reminders: [],
            });
            closeDeleteScopeDialog();
            return;
        }

        const startDateKey = normalizeDateKey(target.startDate) || target.startDate.split('T')[0];
        const endDateKey = target.endDate
            ? (normalizeDateKey(target.endDate) || target.endDate.split('T')[0])
            : null;

        if (dateKey <= startDateKey) {
            await deleteSchedule(scheduleId);
            closeDeleteScopeDialog();
            return;
        }

        if (endDateKey && dateKey > endDateKey) {
            closeDeleteScopeDialog();
            return;
        }

        const previousDate = parseDateKeyAsLocalDate(dateKey);
        previousDate.setDate(previousDate.getDate() - 1);
        const trimmedOverrides = Object.entries(target.dateOverrides || {}).reduce<Record<string, NonNullable<typeof target.dateOverrides>[string]>>((acc, [key, value]) => {
            if (key < dateKey) {
                acc[key] = value;
            }
            return acc;
        }, {});

        await updateSchedule(scheduleId, {
            endDate: formatLocalDateKey(previousDate),
            dateOverrides: trimmedOverrides,
        });
        closeDeleteScopeDialog();
    }, [pendingDelete, schedules, setDateOverride, closeDeleteScopeDialog, deleteSchedule, updateSchedule]);

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
                            const dateKey = formatLocalDateKey(date);
                            const isSelected = isSameDay(date, selectedDate);
                            const isTodayDate = isSameDay(date, today);
                            const dotClass = getCalendarDotClass(dateKey, isTodayDate);

                            let className = 'calendar-day';
                            if (isSelected) className += ' selected';
                            else if (isTodayDate) className += ' today';
                            if (dotClass) className += ` ${dotClass}`;

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
                    filteredSchedules.map(schedule => {
                        const confirmableReminderId = isToday ? getConfirmableReminderId(schedule, selectedDateKey) : null;

                        return (
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
                                        const isConfirmableToday = isToday
                                            && !isTaken
                                            && !isMissed
                                            && confirmableReminderId === reminder.id;

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
                                                            onClick={() => openConfirmModal(schedule, reminder, selectedDateKey)}
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
                                                ) : isConfirmableToday ? (
                                                    <button
                                                        className="take-btn"
                                                        onClick={() => openConfirmModal(schedule, reminder, selectedDateKey)}
                                                    >
                                                        {t('schedule.confirmTake')}
                                                    </button>
                                                ) : isToday ? (
                                                    <button
                                                        className="reminder-status pending"
                                                        disabled
                                                    >
                                                        {t('schedule.pending', '待服用')}
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
                        );
                    })
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
                <div className="dose-modal-overlay" style={{ zIndex: 2600 }} onClick={() => setShowScopeDialog(false)}>
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

            {showDeleteScopeDialog && pendingDelete && (
                <div className="dose-modal-overlay" style={{ zIndex: 2600 }} onClick={closeDeleteScopeDialog}>
                    <div className="dose-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '340px' }}>
                        <div className="dose-step" style={{ padding: '24px 20px' }}>
                            <div className="dose-header" style={{ marginBottom: '16px' }}>
                                <h3 style={{ fontSize: '18px' }}>{t('schedule.deleteScope', '删除范围')}</h3>
                                <p className="dose-meta">{t('schedule.deleteScopePrompt', '删除这个计划的哪些日期？')}</p>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <button
                                    className="status-option-btn status-taken"
                                    onClick={() => handleDeleteWithScope('today')}
                                >
                                    <span>{t('schedule.deleteTodayOnly', '仅删除当天')}</span>
                                </button>
                                <button
                                    className="status-option-btn status-taken"
                                    onClick={() => handleDeleteWithScope('future')}
                                >
                                    <span>{t('schedule.deleteFutureAll', '删除未来全部')}</span>
                                </button>
                            </div>
                            <button
                                className="anim-close"
                                style={{ marginTop: '16px', width: '100%' }}
                                onClick={closeDeleteScopeDialog}
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
