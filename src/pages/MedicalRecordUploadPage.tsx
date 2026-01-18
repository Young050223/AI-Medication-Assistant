/**
 * @file MedicalRecordUploadPage.tsx
 * @description 病例上传页面 - 拍照/选择图片识别用药信息
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-18
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useCamera } from '../hooks/common/useCamera';
import { useMedicationExtractor } from '../hooks/medication/useMedicationExtractor';
import { useHealthProfile } from '../hooks/user/useHealthProfile';
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
    useTranslation();
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
        if (recognitionResult) {
            setEditedMedications(recognitionResult.medications);
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
                    <div className="icon">📋</div>
                    <h2>请先完成健康档案</h2>
                    <p>上传病例前，需要先填写您的基本健康信息</p>
                    <button className="primary-button" onClick={onBack}>
                        去填写健康档案
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
                    ← 返回
                </button>
                <h1 className="page-title">上传病例</h1>
            </div>

            <div className="upload-container">
                {/* 步骤1：拍照/选择图片 */}
                {!imageUri && (
                    <div className="upload-section">
                        <h2 className="section-title">📸 第一步：上传病例照片</h2>
                        <p className="section-hint">请拍摄或选择您的处方单、病历照片</p>

                        <div className="upload-buttons">
                            <button
                                className="upload-button camera"
                                onClick={handleTakePhoto}
                                disabled={isCapturing}
                            >
                                <span className="icon">📷</span>
                                <span className="label">拍照</span>
                            </button>

                            <button
                                className="upload-button gallery"
                                onClick={handlePickFromGallery}
                                disabled={isCapturing}
                            >
                                <span className="icon">🖼️</span>
                                <span className="label">从相册选择</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* 步骤2：预览和识别 */}
                {imageUri && !showResult && (
                    <div className="preview-section">
                        <h2 className="section-title">👁️ 第二步：确认照片</h2>

                        <div className="image-preview">
                            <img src={imageUri} alt="病例照片" />
                        </div>

                        <div className="preview-actions">
                            <button className="secondary-button" onClick={handleRetake}>
                                重新拍照
                            </button>
                            <button
                                className="primary-button"
                                onClick={handleRecognize}
                                disabled={status === 'processing'}
                            >
                                {status === 'processing' ? '识别中...' : '开始识别'}
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
                        <h2 className="section-title">💊 第三步：确认用药信息</h2>
                        <p className="section-hint">请核对以下识别结果，可以手动修改</p>

                        {/* 药物列表 */}
                        <div className="medications-list">
                            {editedMedications.map((med, index) => (
                                <div key={index} className="medication-card">
                                    <div className="card-header">
                                        <span className="med-number">药物 {index + 1}</span>
                                        <button
                                            className="remove-button"
                                            onClick={() => handleRemoveMedication(index)}
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    <div className="form-group">
                                        <label>药物名称</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={med.name}
                                            onChange={(e) => handleUpdateMedication(index, 'name', e.target.value)}
                                            placeholder="请输入药物名称"
                                        />
                                    </div>

                                    <div className="form-row">
                                        <div className="form-group half">
                                            <label>剂量</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={med.dosage || ''}
                                                onChange={(e) => handleUpdateMedication(index, 'dosage', e.target.value)}
                                                placeholder="如：0.5g"
                                            />
                                        </div>
                                        <div className="form-group half">
                                            <label>服用频率</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={med.frequency || ''}
                                                onChange={(e) => handleUpdateMedication(index, 'frequency', e.target.value)}
                                                placeholder="如：每日3次"
                                            />
                                        </div>
                                    </div>

                                    {med.instructions && (
                                        <div className="form-group">
                                            <label>用法说明</label>
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
                                + 手动添加药物
                            </button>
                        </div>

                        {/* 确认按钮 */}
                        <div className="result-actions">
                            <button className="secondary-button" onClick={handleRetake}>
                                重新上传
                            </button>
                            <button
                                className="primary-button"
                                onClick={handleConfirm}
                                disabled={editedMedications.length === 0}
                            >
                                确认并保存
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default MedicalRecordUploadPage;
