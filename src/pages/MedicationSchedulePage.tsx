/**
 * @file MedicationSchedulePage.tsx
 * @description 服药计划页面 - 查看和管理服药计划
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-30 - 国际化支持
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMedicationSchedule } from '../hooks/medication/useMedicationSchedule';
import type { ScheduleFormData } from '../types/MedicationSchedule.types';
import { FREQUENCY_OPTIONS_KEYS } from '../types/MedicationFeedback.types';
import './MedicationSchedulePage.css';

interface MedicationSchedulePageProps {
    onBack: () => void;
    onNavigateToFeedback?: (medicationName: string, scheduleId: string) => void;
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

    // 状态
    const [showAddForm, setShowAddForm] = useState(false);
    const [formData, setFormData] = useState<ScheduleFormData>({
        medicationName: '',
        medicationDosage: '',
        frequency: 'thriceDaily',
        instructions: '',
        reminderTimes: ['08:00', '12:00', '18:00'],
        durationDays: '7',
    });

    const todaySchedules = getTodaySchedules();

    /**
     * 处理表单输入
     */
    const handleInputChange = useCallback((field: keyof ScheduleFormData, value: string | string[]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    }, []);

    /**
     * 添加提醒时间
     */
    const handleAddReminderTime = useCallback(() => {
        setFormData(prev => ({
            ...prev,
            reminderTimes: [...prev.reminderTimes, '12:00'],
        }));
    }, []);

    /**
     * 更新提醒时间
     */
    const handleUpdateReminderTime = useCallback((index: number, value: string) => {
        setFormData(prev => {
            const newTimes = [...prev.reminderTimes];
            newTimes[index] = value;
            return { ...prev, reminderTimes: newTimes };
        });
    }, []);

    /**
     * 删除提醒时间
     */
    const handleRemoveReminderTime = useCallback((index: number) => {
        setFormData(prev => ({
            ...prev,
            reminderTimes: prev.reminderTimes.filter((_, i) => i !== index),
        }));
    }, []);

    /**
     * 提交表单
     */
    const handleSubmit = useCallback(async () => {
        if (!formData.medicationName.trim()) {
            alert(t('schedule.medicationNameRequired'));
            return;
        }

        // 将 frequency key 转换为显示文本用于存储
        const frequencyText = t(`frequency.${formData.frequency}`);
        const submitData = {
            ...formData,
            frequency: frequencyText,
        };

        const result = await createSchedule(submitData);
        if (result) {
            setShowAddForm(false);
            setFormData({
                medicationName: '',
                medicationDosage: '',
                frequency: 'thriceDaily',
                instructions: '',
                reminderTimes: ['08:00', '12:00', '18:00'],
                durationDays: '7',
            });
        }
    }, [formData, createSchedule, t]);

    /**
     * 标记服药
     */
    const handleMarkTaken = useCallback(async (scheduleId: string, reminderId: string) => {
        await markAsTaken(scheduleId, reminderId);
    }, [markAsTaken]);

    /**
     * 删除计划
     */
    const handleDelete = useCallback(async (id: string) => {
        if (confirm(t('schedule.deleteConfirm'))) {
            await deleteSchedule(id);
        }
    }, [deleteSchedule, t]);

    // 加载中
    if (isLoading) {
        return (
            <div className="schedule-page-loading">
                <div className="loading-spinner">💊</div>
                <p>{t('app.loading')}</p>
            </div>
        );
    }

    return (
        <div className="schedule-page">
            {/* 头部 */}
            <div className="page-header schedule-header">
                <button className="back-button" onClick={onBack}>
                    ← {t('app.back')}
                </button>
                <h1 className="page-title">{t('schedule.title')}</h1>
                <button
                    className="add-button"
                    onClick={() => setShowAddForm(true)}
                >
                    +
                </button>
            </div>

            {/* 错误提示 */}
            {error && <div className="error-message">{error}</div>}

            {/* 今日计划 */}
            <div className="schedule-container">
                <section className="schedule-section">
                    <h2 className="section-title">📅 {t('schedule.todayMedication')}</h2>

                    {todaySchedules.length === 0 ? (
                        <div className="empty-state">
                            <p>{t('schedule.noScheduleToday')}</p>
                            <button
                                className="primary-button"
                                onClick={() => setShowAddForm(true)}
                            >
                                {t('schedule.addSchedule')}
                            </button>
                        </div>
                    ) : (
                        <div className="schedule-list">
                            {todaySchedules.map(schedule => (
                                <div key={schedule.id} className="schedule-card">
                                    <div className="card-header">
                                        <h3 className="med-name">{schedule.medicationName}</h3>
                                        <button
                                            className="delete-btn"
                                            onClick={() => handleDelete(schedule.id)}
                                        >
                                            🗑️
                                        </button>
                                    </div>

                                    <p className="med-info">{schedule.medicationDosage} · {schedule.frequency}</p>

                                    {schedule.instructions && (
                                        <p className="med-instructions">{schedule.instructions}</p>
                                    )}

                                    <div className="reminders-list">
                                        {schedule.reminders.map(reminder => (
                                            <div
                                                key={reminder.id}
                                                className={`reminder-item ${reminder.taken ? 'taken' : ''}`}
                                            >
                                                <span className="reminder-time">{reminder.time}</span>
                                                <span className="reminder-dosage">{reminder.dosage}</span>
                                                {reminder.taken ? (
                                                    <div className="taken-actions">
                                                        <span className="taken-badge">✓ {t('schedule.taken')}</span>
                                                        {onNavigateToFeedback && (
                                                            <button
                                                                className="feedback-btn"
                                                                onClick={() => onNavigateToFeedback(schedule.medicationName, schedule.id)}
                                                            >
                                                                📝 {t('schedule.feedback')}
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <button
                                                        className="take-btn"
                                                        onClick={() => handleMarkTaken(schedule.id, reminder.id)}
                                                    >
                                                        {t('schedule.confirmTake')}
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* 所有计划 */}
                {schedules.length > todaySchedules.length && (
                    <section className="schedule-section">
                        <h2 className="section-title">📋 {t('schedule.allSchedules')}</h2>
                        <p className="section-hint">
                            {t('schedule.scheduleCount', { total: schedules.length, active: todaySchedules.length })}
                        </p>
                    </section>
                )}
            </div>

            {/* 添加计划弹窗 */}
            {showAddForm && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2>{t('schedule.addSchedule')}</h2>
                            <button
                                className="close-btn"
                                onClick={() => setShowAddForm(false)}
                            >
                                ✕
                            </button>
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
                                            ✕
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button
                                className="add-time-btn"
                                onClick={handleAddReminderTime}
                            >
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
                            <button
                                className="secondary-button"
                                onClick={() => setShowAddForm(false)}
                            >
                                {t('app.cancel')}
                            </button>
                            <button
                                className="primary-button"
                                onClick={handleSubmit}
                                disabled={isSaving}
                            >
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
