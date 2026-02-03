/**
 * @file MedicationFeedbackPage.tsx
 * @description 服药反馈页面 - 支持语音和文字输入
 * @author AI用药助手开发团队
 * @created 2026-01-28
 * @modified 2026-01-30 - 国际化支持
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSpeechRecognition } from '../hooks/common/useSpeechRecognition';
import { useMedicationFeedback } from '../hooks/medication/useMedicationFeedback';
import { useMedicationSchedule } from '../hooks/medication/useMedicationSchedule';
import {
    MOOD_CONFIG,
    COMMON_SIDE_EFFECTS_KEYS,
    type MoodType,
    type FeedbackFormData,
    type SideEffectKey
} from '../types/MedicationFeedback.types';
import './MedicationFeedbackPage.css';

interface MedicationFeedbackPageProps {
    /** 返回上一页 */
    onBack: () => void;
    /** 预选的药物名称 */
    preselectedMedication?: string;
    /** 预选的计划ID */
    preselectedScheduleId?: string;
}

/**
 * 服药反馈页面
 */
export function MedicationFeedbackPage({
    onBack,
    preselectedMedication,
    preselectedScheduleId
}: MedicationFeedbackPageProps) {
    const { t } = useTranslation();
    const { schedules } = useMedicationSchedule();
    const { createFeedback, isSaving, error: saveError } = useMedicationFeedback();
    const {
        isListening,
        transcript,
        hasPermission,
        isAvailable,
        error: speechError,
        isLoading: speechLoading,
        startListening,
        stopListening,
        requestPermission,
        clearTranscript,
    } = useSpeechRecognition();

    // 表单状态
    const [selectedMedication, setSelectedMedication] = useState(preselectedMedication || '');
    const [selectedScheduleId, setSelectedScheduleId] = useState(preselectedScheduleId || '');
    const [content, setContent] = useState('');
    const [selectedMood, setSelectedMood] = useState<MoodType | null>(null);
    const [selectedSideEffects, setSelectedSideEffects] = useState<SideEffectKey[]>([]);
    const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');
    const [showSuccess, setShowSuccess] = useState(false);

    // 同步语音识别结果到内容
    useEffect(() => {
        if (transcript) {
            setContent(transcript);
        }
    }, [transcript]);

    /**
     * 处理药物选择
     */
    const handleMedicationChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        setSelectedMedication(value);

        // 查找对应的计划ID
        const schedule = schedules.find(s => s.medicationName === value);
        if (schedule) {
            setSelectedScheduleId(schedule.id);
        }
    }, [schedules]);

    /**
     * 切换副作用选择
     */
    const toggleSideEffect = useCallback((effect: SideEffectKey) => {
        setSelectedSideEffects(prev =>
            prev.includes(effect)
                ? prev.filter(e => e !== effect)
                : [...prev, effect]
        );
    }, []);

    /**
     * 处理语音按钮
     */
    const handleVoiceButton = useCallback(async () => {
        if (isListening) {
            await stopListening();
        } else {
            if (!hasPermission) {
                await requestPermission();
            }
            clearTranscript();
            await startListening();
        }
    }, [isListening, hasPermission, startListening, stopListening, requestPermission, clearTranscript]);

    /**
     * 提交反馈
     */
    const handleSubmit = useCallback(async () => {
        if (!selectedMedication) {
            alert(t('feedback.medicationRequired'));
            return;
        }

        if (!content.trim()) {
            alert(t('feedback.contentRequired'));
            return;
        }

        const formData: FeedbackFormData = {
            medicationName: selectedMedication,
            scheduleId: selectedScheduleId || undefined,
            content: content.trim(),
            feedbackType: inputMode,
            mood: selectedMood || undefined,
            sideEffects: selectedSideEffects.length > 0 ? selectedSideEffects : undefined,
        };

        const result = await createFeedback(formData);
        if (result) {
            setShowSuccess(true);
            setTimeout(() => {
                onBack();
            }, 1500);
        }
    }, [
        selectedMedication,
        selectedScheduleId,
        content,
        inputMode,
        selectedMood,
        selectedSideEffects,
        createFeedback,
        onBack,
        t
    ]);

    // 成功提示
    if (showSuccess) {
        return (
            <div className="feedback-page">
                <div className="success-overlay">
                    <div className="success-icon">✓</div>
                    <p className="success-text">{t('feedback.saved')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="feedback-page">
            {/* 头部 */}
            <div className="page-header feedback-header">
                <button className="back-button" onClick={onBack}>
                    ← {t('app.back')}
                </button>
                <h1 className="page-title">{t('feedback.title')}</h1>
                <div className="header-spacer" />
            </div>

            {/* 错误提示 */}
            {(saveError || speechError) && (
                <div className="error-message">
                    {saveError || speechError}
                </div>
            )}

            <div className="feedback-container">
                {/* 药物选择 */}
                <section className="feedback-section">
                    <label className="section-label">{t('feedback.selectMedication')}</label>
                    <select
                        className="medication-select"
                        value={selectedMedication}
                        onChange={handleMedicationChange}
                    >
                        <option value="">{t('feedback.selectMedicationPlaceholder')}</option>
                        {schedules.map(schedule => (
                            <option key={schedule.id} value={schedule.medicationName}>
                                {schedule.medicationName}
                            </option>
                        ))}
                    </select>
                </section>

                {/* 心情选择 */}
                <section className="feedback-section">
                    <label className="section-label">{t('feedback.howDoYouFeel')}</label>
                    <div className="mood-selector">
                        {(Object.entries(MOOD_CONFIG) as [MoodType, typeof MOOD_CONFIG['good']][]).map(
                            ([mood, config]) => (
                                <button
                                    key={mood}
                                    className={`mood-btn ${selectedMood === mood ? 'selected' : ''}`}
                                    style={{
                                        borderColor: selectedMood === mood ? config.color : undefined,
                                        backgroundColor: selectedMood === mood ? `${config.color}20` : undefined,
                                    }}
                                    onClick={() => setSelectedMood(mood)}
                                >
                                    <span className="mood-emoji">{config.emoji}</span>
                                    <span className="mood-label">{t(config.labelKey)}</span>
                                </button>
                            )
                        )}
                    </div>
                </section>

                {/* 输入方式切换 */}
                <section className="feedback-section">
                    <div className="input-mode-toggle">
                        <button
                            className={`mode-btn ${inputMode === 'voice' ? 'active' : ''}`}
                            onClick={() => setInputMode('voice')}
                        >
                            🎤 {t('feedback.voiceInput')}
                        </button>
                        <button
                            className={`mode-btn ${inputMode === 'text' ? 'active' : ''}`}
                            onClick={() => setInputMode('text')}
                        >
                            ⌨️ {t('feedback.textInput')}
                        </button>
                    </div>
                </section>

                {/* 语音输入区 */}
                {inputMode === 'voice' && (
                    <section className="feedback-section voice-section">
                        <label className="section-label">{t('feedback.pressToSpeak')}</label>

                        {!isAvailable && !speechLoading && (
                            <div className="voice-unavailable">
                                <p>{t('feedback.voiceUnavailable')}</p>
                                <button
                                    className="switch-to-text-btn"
                                    onClick={() => setInputMode('text')}
                                >
                                    {t('feedback.useTextInput')}
                                </button>
                            </div>
                        )}

                        {isAvailable && (
                            <>
                                <button
                                    className={`voice-btn ${isListening ? 'listening' : ''}`}
                                    onMouseDown={handleVoiceButton}
                                    onMouseUp={() => isListening && stopListening()}
                                    onTouchStart={handleVoiceButton}
                                    onTouchEnd={() => isListening && stopListening()}
                                >
                                    <span className="voice-icon">{isListening ? '🔴' : '🎤'}</span>
                                    <span className="voice-text">
                                        {isListening ? t('feedback.recording') : t('feedback.tapToRecord')}
                                    </span>
                                </button>

                                {isListening && (
                                    <div className="listening-indicator">
                                        <div className="pulse-ring" />
                                        <p>{t('feedback.speakYourFeelings')}</p>
                                    </div>
                                )}
                            </>
                        )}

                        {/* 识别结果预览 */}
                        {content && (
                            <div className="transcript-preview">
                                <p className="transcript-text">{content}</p>
                                <button
                                    className="clear-btn"
                                    onClick={() => { clearTranscript(); setContent(''); }}
                                >
                                    {t('feedback.clear')}
                                </button>
                            </div>
                        )}
                    </section>
                )}

                {/* 文字输入区 */}
                {inputMode === 'text' && (
                    <section className="feedback-section">
                        <label className="section-label">{t('feedback.describeFeelings')}</label>
                        <textarea
                            className="feedback-textarea"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={t('feedback.textPlaceholder')}
                            rows={4}
                        />
                    </section>
                )}

                {/* 副作用标签 */}
                <section className="feedback-section">
                    <label className="section-label">{t('feedback.sideEffectsTitle')}</label>
                    <div className="side-effects-grid">
                        {COMMON_SIDE_EFFECTS_KEYS.map(effectKey => (
                            <button
                                key={effectKey}
                                className={`side-effect-tag ${selectedSideEffects.includes(effectKey) ? 'selected' : ''}`}
                                onClick={() => toggleSideEffect(effectKey)}
                            >
                                {t(`sideEffects.${effectKey}`)}
                            </button>
                        ))}
                    </div>
                </section>

                {/* 提交按钮 */}
                <section className="feedback-section submit-section">
                    <button
                        className="submit-btn"
                        onClick={handleSubmit}
                        disabled={isSaving || !selectedMedication || !content.trim()}
                    >
                        {isSaving ? t('app.saving') : t('feedback.save')}
                    </button>
                </section>
            </div>
        </div>
    );
}

export default MedicationFeedbackPage;
