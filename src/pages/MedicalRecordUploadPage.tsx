/**
 * @file MedicalRecordUploadPage.tsx
 * @description 病例上传页面 - 拍照/选择图片识别用药信息
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-30 - 国际化支持
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useCamera } from '../hooks/common/useCamera';
import { useMedicationExtractor } from '../hooks/medication/useMedicationExtractor';
import { useHealthProfile } from '../hooks/user/useHealthProfile';
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
    const { t } = useTranslation();
    const { imageUri, isCapturing, takePhoto, pickFromGallery, clearImage } = useCamera();
    const { status, result, error: extractError, extractFromImage, clearResult } = useMedicationExtractor();
    const { isProfileComplete } = useHealthProfile();

    // 编辑状态
    const [editedMedications, setEditedMedications] = useState<ExtractedMedication[]>([]);
    const [showResult, setShowResult] = useState(false);

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

    /**
     * 确认并保存
     */
    const handleConfirm = useCallback(() => {
        // 过滤掉空的药物
        const validMedications = editedMedications.filter(med => med.name.trim());
        onComplete(validMedications);
    }, [editedMedications, onComplete]);

    /**
     * 重新拍照
     */
    const handleRetake = useCallback(() => {
        clearImage();
        clearResult();
        setShowResult(false);
        setEditedMedications([]);
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
                                className="primary-button"
                                onClick={handleConfirm}
                                disabled={editedMedications.length === 0}
                            >
                                {t('upload.confirmAndSave')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default MedicalRecordUploadPage;
