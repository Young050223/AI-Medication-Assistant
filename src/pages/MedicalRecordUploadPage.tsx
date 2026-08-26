/**
 * @file MedicalRecordUploadPage.tsx
 * @description 病例上传页面 - 拍照/选择图片识别用药信息
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-30 - 国际化支持
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCamera } from '../hooks/common/useCamera';
import { useMedicationExtractor } from '../hooks/medication/useMedicationExtractor';
import { useHealthProfile } from '../hooks/user/useHealthProfile';
import {
    saveMedicalRecordWithItems,
    generateSchedulesFromPrescriptionItems,
    fetchSavedPrescriptionSummaries,
    type SavedPrescriptionSummary,
} from '../services/medicalRecordApi';
import { IconClipboard, IconBack, IconCamera, IconImage, IconEye, IconPill, IconClose } from '../components/Icons';
import type { ExtractedMedication } from '../types/MedicalRecord.types';
import './MedicalRecordUploadPage.css';

interface MedicalRecordUploadPageProps {
    onComplete: (medications: ExtractedMedication[]) => void;
    onBack: () => void;
}

/**
 * 病例上传页面
 * 老年友好设计：大按钮、清晰的步骤指引
 */
export function MedicalRecordUploadPage({ onComplete, onBack }: MedicalRecordUploadPageProps) {
    const { t, i18n } = useTranslation();
    const { imageUri, isCapturing, takePhoto, pickFromGallery, clearImage } = useCamera();
    const { status, result, error: extractError, extractFromImage, clearResult } = useMedicationExtractor();
    const { isProfileComplete } = useHealthProfile();

    // 编辑状态
    const [editedMedications, setEditedMedications] = useState<ExtractedMedication[]>([]);
    const [showResult, setShowResult] = useState(false);
    const [isPersisting, setIsPersisting] = useState(false);
    const [persistError, setPersistError] = useState<string | null>(null);
    const [persistSuccess, setPersistSuccess] = useState<string | null>(null);
    const [savedPrescriptions, setSavedPrescriptions] = useState<SavedPrescriptionSummary[]>([]);
    const [savedLoading, setSavedLoading] = useState(false);
    const [savedError, setSavedError] = useState<string | null>(null);

    /**
     * 处理拍照
     */
    const handleTakePhoto = useCallback(async () => {
        const uri = await takePhoto();
        if (uri) {
            setShowResult(false);
            clearResult();
        }
    }, [takePhoto, clearResult]);

    /**
     * 处理选择图片
     */
    const handlePickFromGallery = useCallback(async () => {
        const uri = await pickFromGallery();
        if (uri) {
            setShowResult(false);
            clearResult();
        }
    }, [pickFromGallery, clearResult]);

    /**
     * 开始识别
     */
    const handleRecognize = useCallback(async () => {
        if (!imageUri) return;

        const recognitionResult = await extractFromImage(imageUri);
        if (recognitionResult && recognitionResult.length > 0) {
            setEditedMedications(recognitionResult);
            setShowResult(true);
        }
    }, [imageUri, extractFromImage]);

    /**
     * 更新药物信息
     */
    const handleUpdateMedication = useCallback((index: number, field: keyof ExtractedMedication, value: string) => {
        setEditedMedications(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
    }, []);

    /**
     * 删除药物
     */
    const handleRemoveMedication = useCallback((index: number) => {
        setEditedMedications(prev => prev.filter((_, i) => i !== index));
    }, []);

    /**
     * 添加药物
     */
    const handleAddMedication = useCallback(() => {
        setEditedMedications(prev => [...prev, {
            name: '',
            dosage: '',
            frequency: '',
            confidence: 1,
        }]);
    }, []);

    const loadSavedPrescriptions = useCallback(async () => {
        setSavedLoading(true);
        setSavedError(null);

        try {
            const response = await fetchSavedPrescriptionSummaries(8);
            if (!response.success) {
                setSavedError(response.error || t('upload.loadSavedFailed', '读取已保存处方失败'));
                return;
            }
            setSavedPrescriptions(response.records);
        } catch (error) {
            setSavedError(error instanceof Error ? error.message : t('upload.loadSavedFailed', '读取已保存处方失败'));
        } finally {
            setSavedLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadSavedPrescriptions();
    }, [loadSavedPrescriptions]);

    const formatSavedTime = useCallback((value: string) => {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleString(i18n.language || 'zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }, [i18n.language]);

    const formatOcrStatus = useCallback((statusValue: string) => {
        if (statusValue === 'ocr_parsed') return t('upload.statusParsed', 'OCR识别');
        if (statusValue === 'manual_confirmed') return t('upload.statusManual', '手动确认');
        if (statusValue === 'ocr_failed') return t('upload.statusFailed', '识别失败后确认');
        return statusValue;
    }, [t]);

    /**
     * 确认并保存
     */
    const handleConfirm = useCallback(async (generatePlan: boolean) => {
        // 过滤掉空的药物
        const validMedications = editedMedications.filter(med => med.name.trim());
        if (validMedications.length === 0) {
            setPersistError(t('upload.noValidMedication', '请至少保留一条有效药物'));
            return;
        }

        setPersistError(null);
        setPersistSuccess(null);
        setIsPersisting(true);

        try {
            const saveResult = await saveMedicalRecordWithItems({
                imageUri,
                rawText: result?.rawText || '',
                medications: validMedications,
                ocrStatus: result?.provider === 'api' ? 'ocr_parsed' : 'manual_confirmed',
                ocrProvider: result?.provider === 'api' ? 'custom_api' : 'mock',
            });

            if (!saveResult.success || !saveResult.recordId) {
                setPersistError(saveResult.error || t('upload.saveFailed', '保存病历失败'));
                return;
            }

            if (generatePlan) {
                const scheduleResult = await generateSchedulesFromPrescriptionItems({
                    recordId: saveResult.recordId,
                    medications: validMedications,
                });

                if (!scheduleResult.success) {
                    setPersistError(scheduleResult.error || t('upload.generatePlanFailed', '生成用药计划失败'));
                    return;
                }

                setPersistSuccess(t('upload.saveAndGenerateSuccess', {
                    count: scheduleResult.createdCount || 0,
                    defaultValue: `已保存病历，并生成 ${scheduleResult.createdCount || 0} 条用药计划`,
                }));
            } else {
                setPersistSuccess(t('upload.saveOnlySuccess', '病历与处方已保存'));
            }

            void loadSavedPrescriptions();
            setTimeout(() => {
                onComplete(validMedications);
            }, 700);
        } finally {
            setIsPersisting(false);
        }
    }, [editedMedications, imageUri, loadSavedPrescriptions, onComplete, result?.provider, result?.rawText, t]);

    /**
     * 重新拍照
     */
    const handleRetake = useCallback(() => {
        clearImage();
        clearResult();
        setShowResult(false);
        setEditedMedications([]);
        setPersistError(null);
        setPersistSuccess(null);
    }, [clearImage, clearResult]);

    // 检查健康档案是否完整
    if (!isProfileComplete()) {
        return (
            <div className="record-upload-page">
                <div className="profile-required">
                    <div className="icon"><IconClipboard size={40} /></div>
                    <h2>{t('upload.profileRequired')}</h2>
                    <p>{t('upload.profileRequiredDesc')}</p>
                    <button className="primary-button" onClick={onBack}>
                        {t('upload.goToProfile')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="record-upload-page">
            {/* 头部 */}
            <div className="page-header">
                <button className="back-button" onClick={onBack}>
                    <IconBack size={16} /> {t('app.back')}
                </button>
                <h1 className="page-title">{t('upload.title')}</h1>
            </div>

            <div className="upload-container">
                {/* 步骤1：拍照/选择图片 */}
                {!imageUri && (
                    <div className="upload-section">
                        <h2 className="section-title"><IconCamera size={18} /> {t('upload.step1Title')}</h2>
                        <p className="section-hint">{t('upload.step1Hint')}</p>

                        <div className="upload-buttons">
                            <button
                                className="upload-button camera"
                                onClick={handleTakePhoto}
                                disabled={isCapturing}
                            >
                                <span className="icon"><IconCamera size={24} /></span>
                                <span className="label">{t('upload.takePhoto')}</span>
                            </button>

                            <button
                                className="upload-button gallery"
                                onClick={handlePickFromGallery}
                                disabled={isCapturing}
                            >
                                <span className="icon"><IconImage size={24} /></span>
                                <span className="label">{t('upload.fromGallery')}</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* 步骤2：预览和识别 */}
                {imageUri && !showResult && (
                    <div className="preview-section">
                        <h2 className="section-title"><IconEye size={18} /> {t('upload.step2Title')}</h2>

                        <div className="image-preview">
                            <img src={imageUri} alt="Medical record" />
                        </div>

                        <div className="preview-actions">
                            <button className="secondary-button" onClick={handleRetake}>
                                {t('upload.retake')}
                            </button>
                            <button
                                className="primary-button"
                                onClick={handleRecognize}
                                disabled={status === 'extracting'}
                            >
                                {status === 'extracting' ? t('upload.recognizing') : t('upload.startRecognize')}
                            </button>
                        </div>

                        {extractError && (
                            <div className="error-message">{extractError}</div>
                        )}
                    </div>
                )}

                {/* 步骤3：识别结果 */}
                {showResult && result && (
                    <div className="result-section">
                        <h2 className="section-title"><IconPill size={18} /> {t('upload.step3Title')}</h2>
                        <p className="section-hint">{t('upload.step3Hint')}</p>
                        {result.usedFallback && (
                            <p className="section-hint">
                                {t('upload.manualConfirmHint', 'OCR接口未接通，当前为手动确认保存模式。请核对后保存。')}
                            </p>
                        )}

                        {/* 药物列表 */}
                        <div className="medications-list">
                            {editedMedications.map((med, index) => (
                                <div key={index} className="medication-card">
                                    <div className="card-header">
                                        <span className="med-number">{t('upload.medicationNumber', { number: index + 1 })}</span>
                                        <button
                                            className="remove-button"
                                            onClick={() => handleRemoveMedication(index)}
                                        >
                                            <IconClose size={14} />
                                        </button>
                                    </div>

                                    <div className="form-group">
                                        <label>{t('upload.medicationName')}</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={med.name}
                                            onChange={(e) => handleUpdateMedication(index, 'name', e.target.value)}
                                            placeholder={t('upload.medicationNamePlaceholder')}
                                        />
                                    </div>

                                    <div className="form-row">
                                        <div className="form-group half">
                                            <label>{t('upload.dosage')}</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={med.dosage || ''}
                                                onChange={(e) => handleUpdateMedication(index, 'dosage', e.target.value)}
                                                placeholder={t('upload.dosagePlaceholder')}
                                            />
                                        </div>
                                        <div className="form-group half">
                                            <label>{t('upload.frequencyLabel')}</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={med.frequency || ''}
                                                onChange={(e) => handleUpdateMedication(index, 'frequency', e.target.value)}
                                                placeholder={t('upload.frequencyPlaceholder')}
                                            />
                                        </div>
                                    </div>

                                    {med.instructions && (
                                        <div className="form-group">
                                            <label>{t('upload.instructionsLabel')}</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={med.instructions || ''}
                                                onChange={(e) => handleUpdateMedication(index, 'instructions', e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* 添加药物按钮 */}
                            <button className="add-medication-button" onClick={handleAddMedication}>
                                + {t('upload.addMedication')}
                            </button>
                        </div>

                        {/* 确认按钮 */}
                        <div className="result-actions">
                            <button className="secondary-button" onClick={handleRetake}>
                                {t('upload.reupload')}
                            </button>
                            <button
                                className="secondary-button"
                                onClick={() => { void handleConfirm(false); }}
                                disabled={editedMedications.length === 0 || isPersisting}
                            >
                                {isPersisting
                                    ? t('upload.saving', '保存中...')
                                    : t('upload.saveOnly', '仅保存处方')}
                            </button>
                            <button
                                className="primary-button"
                                onClick={() => { void handleConfirm(true); }}
                                disabled={editedMedications.length === 0 || isPersisting}
                            >
                                {isPersisting
                                    ? t('upload.saving', '保存中...')
                                    : t('upload.confirmAndSavePlan', '保存并生成计划')}
                            </button>
                        </div>
                        {persistError && <div className="error-message">{persistError}</div>}
                        {persistSuccess && <div className="success-message">{persistSuccess}</div>}
                    </div>
                )}

                <div className="saved-prescriptions-section">
                    <div className="saved-prescriptions-header">
                        <h2 className="saved-prescriptions-title">
                            {t('upload.savedPrescriptionsTitle', '已保存处方')}
                        </h2>
                        <button
                            type="button"
                            className="saved-refresh-btn"
                            onClick={() => { void loadSavedPrescriptions(); }}
                            disabled={savedLoading}
                        >
                            {savedLoading ? t('app.loading', '加载中...') : t('app.retry', '刷新')}
                        </button>
                    </div>
                    <p className="saved-prescriptions-hint">
                        {t('upload.savedPrescriptionsHint', '用于确认已持久化到云端的处方内容')}
                    </p>
                    {savedError && <div className="saved-prescriptions-error">{savedError}</div>}
                    {!savedLoading && savedPrescriptions.length === 0 && (
                        <p className="saved-prescriptions-empty">
                            {t('upload.savedPrescriptionsEmpty', '暂未保存处方，保存后会展示在这里')}
                        </p>
                    )}
                    <div className="saved-prescription-list">
                        {savedPrescriptions.map((record) => (
                            <article key={record.recordId} className="saved-prescription-card">
                                <div className="saved-prescription-meta">
                                    <span>{formatSavedTime(record.recognizedAt)}</span>
                                    <span className={`saved-ocr-status status-${record.ocrStatus}`}>
                                        {formatOcrStatus(record.ocrStatus)}
                                    </span>
                                </div>
                                <p className="saved-prescription-count">
                                    {t('upload.savedPrescriptionCount', {
                                        count: record.itemCount,
                                        defaultValue: `共 ${record.itemCount} 种药物`,
                                    })}
                                </p>
                                <p className="saved-prescription-drugs">
                                    {record.medicationNames.join(' / ')}
                                </p>
                            </article>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default MedicalRecordUploadPage;
