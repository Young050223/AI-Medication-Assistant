/**
 * @file ConfirmDoseModal.tsx
 * @description 统一的"确认服用"反馈弹窗组件
 * 3 步流程：感受选择 → 反馈输入（文字+语音）→ 鼓励/提醒动画
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import useMedicationFeedback from '../hooks/medication/useMedicationFeedback';
import { useSpeechRecognition } from '../hooks/common/useSpeechRecognition';
import './ConfirmDoseModal.css';

export interface DoseInfo {
    scheduleId: string;
    reminderId: string;
    medicationName: string;
    dosage: string;
    time: string;
    doseDate: string;
}

interface ConfirmDoseModalProps {
    dose: DoseInfo;
    onConfirm: (scheduleId: string, reminderId: string) => Promise<void>;
    onClose: () => void;
}

type Step = 'loading' | 'feeling' | 'feedback' | 'animation' | 'review';
type Feeling = 'good' | 'mild' | 'severe';

export default function ConfirmDoseModal({ dose, onConfirm, onClose }: ConfirmDoseModalProps) {
    const { t } = useTranslation();
    const { createFeedback, getFeedbackHistory } = useMedicationFeedback();
    const {
        isListening,
        transcript,
        isAvailable: voiceAvailable,
        startListening,
        stopListening,
    } = useSpeechRecognition();

    const [step, setStep] = useState<Step>('loading');
    const [feeling, setFeeling] = useState<Feeling | null>(null);
    const [feedbackText, setFeedbackText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [existingFeedback, setExistingFeedback] = useState<{ mood: string; content: string } | null>(null);

    // Check for existing feedback on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const history = await getFeedbackHistory(dose.medicationName);
            if (cancelled) return;
            const matchedFeedback = [...history].reverse().find(f =>
                f.scheduleId === dose.scheduleId
                && f.reminderId === dose.reminderId
                && f.doseDate === dose.doseDate
            );
            if (matchedFeedback) {
                setExistingFeedback({ mood: matchedFeedback.mood, content: matchedFeedback.content });
                if (matchedFeedback.mood === 'good') {
                    setFeeling('good');
                    setStep('animation');
                } else {
                    setFeeling(matchedFeedback.mood === 'neutral' ? 'mild' : 'severe');
                    setStep('review');
                }
            } else {
                setStep('feeling');
            }
        })();
        return () => { cancelled = true; };
    }, [dose.medicationName, dose.scheduleId, dose.reminderId, dose.doseDate, getFeedbackHistory]);

    // Sync speech transcript to feedbackText
    useEffect(() => {
        if (transcript) {
            setFeedbackText(transcript);
        }
    }, [transcript]);

    // Animation auto-close timer
    useEffect(() => {
        if (step === 'animation') {
            const timer = setTimeout(() => onClose(), 3000);
            return () => clearTimeout(timer);
        }
    }, [step, onClose]);

    // Stop listening on unmount
    useEffect(() => {
        return () => {
            if (isListening) {
                stopListening();
            }
        };
    }, [isListening, stopListening]);

    // Step 1: Select feeling
    const handleFeeling = useCallback(async (f: Feeling) => {
        setFeeling(f);
        setIsSubmitting(true);

        // Mark as taken
        await onConfirm(dose.scheduleId, dose.reminderId);

        if (f === 'good') {
            await createFeedback({
                scheduleId: dose.scheduleId,
                reminderId: dose.reminderId,
                doseDate: dose.doseDate,
                medicationName: dose.medicationName,
                mood: 'good',
                content: '',
                sideEffects: [],
            });
            setIsSubmitting(false);
            setStep('animation');
        } else {
            setIsSubmitting(false);
            setStep('feedback');
        }
    }, [dose, onConfirm, createFeedback]);

    // Step 2: Submit feedback text
    const handleSubmitFeedback = useCallback(async () => {
        if (!feeling) return;
        if (isListening) await stopListening();
        setIsSubmitting(true);

        await createFeedback({
            scheduleId: dose.scheduleId,
            reminderId: dose.reminderId,
            doseDate: dose.doseDate,
            medicationName: dose.medicationName,
            mood: feeling === 'mild' ? 'neutral' : 'bad',
            content: feedbackText.trim(),
            sideEffects: [],
        });

        setIsSubmitting(false);
        setStep('animation');
    }, [feeling, feedbackText, dose, createFeedback, isListening, stopListening]);

    // Toggle voice recording
    const toggleVoice = useCallback(async () => {
        if (isListening) {
            await stopListening();
        } else {
            await startListening();
        }
    }, [isListening, startListening, stopListening]);

    return (
        <div className="dose-modal-overlay" onClick={onClose}>
            <div className="dose-modal" onClick={e => e.stopPropagation()}>

                {/* ===== Loading ===== */}
                {step === 'loading' && (
                    <div className="dose-step" style={{ padding: '40px', textAlign: 'center' }}>
                        <p className="dose-submitting">{t('app.loading', '加载中...')}</p>
                    </div>
                )}

                {/* ===== Step 1: Feeling Selection ===== */}
                {step === 'feeling' && (
                    <div className="dose-step dose-step-feeling">
                        <div className="dose-header">
                            <h3>{dose.medicationName}</h3>
                            <p className="dose-meta">{dose.time} · {dose.dosage}</p>
                        </div>

                        <p className="dose-question">
                            {t('confirmDose.howDoYouFeel', '服药后感觉如何？')}
                        </p>

                        <div className="feeling-options">
                            <button
                                className="feeling-btn feeling-good"
                                onClick={() => handleFeeling('good')}
                                disabled={isSubmitting}
                            >
                                <span className="feeling-icon">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                                        <line x1="9" y1="9" x2="9.01" y2="9" />
                                        <line x1="15" y1="9" x2="15.01" y2="9" />
                                    </svg>
                                </span>
                                <span className="feeling-label">
                                    {t('confirmDose.feelGood', '感受良好')}
                                </span>
                            </button>

                            <button
                                className="feeling-btn feeling-mild"
                                onClick={() => handleFeeling('mild')}
                                disabled={isSubmitting}
                            >
                                <span className="feeling-icon">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="8" y1="15" x2="16" y2="15" />
                                        <line x1="9" y1="9" x2="9.01" y2="9" />
                                        <line x1="15" y1="9" x2="15.01" y2="9" />
                                    </svg>
                                </span>
                                <span className="feeling-label">
                                    {t('confirmDose.feelMild', '略有不适')}
                                </span>
                            </button>

                            <button
                                className="feeling-btn feeling-severe"
                                onClick={() => handleFeeling('severe')}
                                disabled={isSubmitting}
                            >
                                <span className="feeling-icon">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
                                        <line x1="9" y1="9" x2="9.01" y2="9" />
                                        <line x1="15" y1="9" x2="15.01" y2="9" />
                                    </svg>
                                </span>
                                <span className="feeling-label">
                                    {t('confirmDose.feelSevere', '非常难受')}
                                </span>
                            </button>
                        </div>

                        {isSubmitting && (
                            <p className="dose-submitting">{t('app.saving', '保存中...')}</p>
                        )}
                    </div>
                )}

                {/* ===== Step 2: Feedback Input (Text + Voice) ===== */}
                {step === 'feedback' && (
                    <div className="dose-step dose-step-feedback">
                        <div className="dose-header">
                            <h3>{t('confirmDose.describeSymptomsTitle', '描述您的症状')}</h3>
                            <p className="dose-meta">{dose.medicationName} · {dose.time}</p>
                        </div>

                        <textarea
                            className="feedback-textarea"
                            placeholder={t('confirmDose.feedbackPlaceholder', '请描述您的不适症状...')}
                            value={feedbackText}
                            onChange={e => setFeedbackText(e.target.value)}
                            rows={4}
                            autoFocus
                        />

                        {/* Voice Input Button */}
                        <div className="voice-input-area">
                            <button
                                className={`voice-btn ${isListening ? 'listening' : ''}`}
                                onClick={toggleVoice}
                                disabled={!voiceAvailable}
                                title={isListening
                                    ? t('confirmDose.tapToStop', '点击结束录音')
                                    : t('confirmDose.tapToSpeak', '点击开始讲话')
                                }
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    <line x1="12" y1="19" x2="12" y2="23" />
                                    <line x1="8" y1="23" x2="16" y2="23" />
                                </svg>
                                {isListening && <span className="voice-pulse" />}
                            </button>
                            <span className="voice-hint">
                                {isListening
                                    ? t('confirmDose.recording', '正在录音，点击结束...')
                                    : t('confirmDose.tapToSpeak', '点击开始讲话')
                                }
                            </span>
                        </div>

                        <div className="feedback-actions">
                            <button
                                className="feedback-skip"
                                onClick={handleSubmitFeedback}
                                disabled={isSubmitting}
                            >
                                {t('confirmDose.skip', '跳过')}
                            </button>
                            <button
                                className="feedback-submit"
                                onClick={handleSubmitFeedback}
                                disabled={isSubmitting}
                            >
                                {isSubmitting
                                    ? t('app.saving', '保存中...')
                                    : t('confirmDose.submit', '提交')
                                }
                            </button>
                        </div>
                    </div>
                )}

                {/* ===== Review: Show existing feedback ===== */}
                {step === 'review' && existingFeedback && (
                    <div className="dose-step dose-step-animation">
                        <div className="anim-advisory">
                            <div className="dose-header">
                                <h3>{dose.medicationName}</h3>
                                <p className="dose-meta">{dose.time} · {dose.dosage}</p>
                            </div>
                            <div style={{ margin: '16px 0', padding: '16px', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
                                <p style={{ fontWeight: 700, marginBottom: '8px', color: existingFeedback.mood === 'good' ? 'var(--color-success)' : existingFeedback.mood === 'neutral' ? 'var(--color-warning)' : '#E53935' }}>
                                    {existingFeedback.mood === 'good'
                                        ? t('confirmDose.feelGood', '感受良好')
                                        : existingFeedback.mood === 'neutral'
                                            ? t('confirmDose.feelMild', '略有不适')
                                            : t('confirmDose.feelSevere', '非常难受')
                                    }
                                </p>
                                {existingFeedback.content && (
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
                                        {existingFeedback.content}
                                    </p>
                                )}
                            </div>
                        </div>
                        <button className="anim-close" onClick={onClose}>
                            {t('app.close', '关闭')}
                        </button>
                    </div>
                )}

                {/* ===== Step 3: Animation ===== */}
                {step === 'animation' && (
                    <div className="dose-step dose-step-animation">
                        {feeling === 'good' ? (
                            <div className="anim-encourage">
                                <div className="anim-checkmark">
                                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                        <polyline points="22 4 12 14.01 9 11.01" />
                                    </svg>
                                </div>
                                <h3>{t('confirmDose.greatJob', '做得很好！')}</h3>
                                <p>{t('confirmDose.keepItUp', '坚持按时服药，健康每一天')}</p>
                            </div>
                        ) : (
                            <div className="anim-advisory">
                                <div className="anim-icon">
                                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                        <line x1="12" y1="9" x2="12" y2="13" />
                                        <line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                </div>
                                <h3>{t('confirmDose.alreadyRecorded', '已记录您的反馈')}</h3>
                                <p>{t('confirmDose.consultDoctor', '建议及时咨询医生的专业意见，适当调整药量')}</p>
                            </div>
                        )}
                        <button className="anim-close" onClick={onClose}>
                            {t('app.close', '关闭')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
