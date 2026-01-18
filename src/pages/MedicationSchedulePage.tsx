/**
 * @file MedicationSchedulePage.tsx
 * @description 服药计划页面 - 查看和管理服药计划
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-18
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMedicationSchedule } from '../hooks/medication/useMedicationSchedule';
import type { ScheduleFormData } from '../types/MedicationSchedule.types';
import './MedicationSchedulePage.css';

interface MedicationSchedulePageProps {
    onBack: () => void;
}

/**
 * 服药计划页面
 */
export function MedicationSchedulePage({ onBack }: MedicationSchedulePageProps) {
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
        frequency: '每日3次',
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
            alert('请输入药物名称');
            return;
        }

        const result = await createSchedule(formData);
        if (result) {
            setShowAddForm(false);
            setFormData({
                medicationName: '',
                medicationDosage: '',
                frequency: '每日3次',
                instructions: '',
                reminderTimes: ['08:00', '12:00', '18:00'],
                durationDays: '7',
            });
        }
    }, [formData, createSchedule]);

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
        if (confirm('确定要删除这个服药计划吗？')) {
            await deleteSchedule(id);
        }
    }, [deleteSchedule]);

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
                    ← 返回
                </button>
                <h1 className="page-title">服药计划</h1>
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
                    <h2 className="section-title">📅 今日用药</h2>

                    {todaySchedules.length === 0 ? (
                        <div className="empty-state">
                            <p>今日暂无用药计划</p>
                            <button
                                className="primary-button"
                                onClick={() => setShowAddForm(true)}
                            >
                                添加服药计划
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
                                                    <span className="taken-badge">✓ 已服用</span>
                                                ) : (
                                                    <button
                                                        className="take-btn"
                                                        onClick={() => handleMarkTaken(schedule.id, reminder.id)}
                                                    >
                                                        确认服用
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
                        <h2 className="section-title">📋 所有计划</h2>
                        <p className="section-hint">共 {schedules.length} 个计划，今日活跃 {todaySchedules.length} 个</p>
                    </section>
                )}
            </div>

            {/* 添加计划弹窗 */}
            {showAddForm && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2>添加服药计划</h2>
                            <button
                                className="close-btn"
                                onClick={() => setShowAddForm(false)}
                            >
                                ✕
                            </button>
                        </div>

                        <div className="form-group">
                            <label>药物名称 *</label>
                            <input
                                type="text"
                                className="form-input"
                                value={formData.medicationName}
                                onChange={(e) => handleInputChange('medicationName', e.target.value)}
                                placeholder="如：阿莫西林胶囊"
                            />
                        </div>

                        <div className="form-group">
                            <label>剂量</label>
                            <input
                                type="text"
                                className="form-input"
                                value={formData.medicationDosage}
                                onChange={(e) => handleInputChange('medicationDosage', e.target.value)}
                                placeholder="如：0.5g / 每次1粒"
                            />
                        </div>

                        <div className="form-group">
                            <label>服用频率</label>
                            <select
                                className="form-input"
                                value={formData.frequency}
                                onChange={(e) => handleInputChange('frequency', e.target.value)}
                            >
                                <option value="每日1次">每日1次</option>
                                <option value="每日2次">每日2次</option>
                                <option value="每日3次">每日3次</option>
                                <option value="每日4次">每日4次</option>
                                <option value="需要时">需要时</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label>提醒时间</label>
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
                                + 添加提醒时间
                            </button>
                        </div>

                        <div className="form-group">
                            <label>疗程（天）</label>
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
                            <label>用法说明</label>
                            <textarea
                                className="form-textarea"
                                value={formData.instructions}
                                onChange={(e) => handleInputChange('instructions', e.target.value)}
                                placeholder="如：饭后服用"
                                rows={2}
                            />
                        </div>

                        <div className="modal-actions">
                            <button
                                className="secondary-button"
                                onClick={() => setShowAddForm(false)}
                            >
                                取消
                            </button>
                            <button
                                className="primary-button"
                                onClick={handleSubmit}
                                disabled={isSaving}
                            >
                                {isSaving ? '保存中...' : '保存'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default MedicationSchedulePage;
