/**
 * @file HealthProfilePage.tsx
 * @description 健康档案页面 - 老年友好设计（大字体、简洁表单）
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useHealthProfile } from '../hooks/user/useHealthProfile';
import type { HealthProfileFormData, Gender } from '../types/HealthProfile.types';
import './HealthProfilePage.css';

interface HealthProfilePageProps {
    onComplete: () => void;
}

/**
 * 健康档案页面
 * 老年友好设计：大字体、简洁布局、清晰的输入提示
 */
export function HealthProfilePage({ onComplete }: HealthProfilePageProps) {
    const { t } = useTranslation();
    const {
        profile,
        isLoading,
        isSaving,
        error,
        saveProfile,
        clearError
    } = useHealthProfile();

    // 表单状态
    const [formData, setFormData] = useState<HealthProfileFormData>({
        birthDate: '',
        gender: '',
        heightCm: '',
        weightKg: '',
        medicalHistory: '',
        allergies: '',
    });
    const [formError, setFormError] = useState('');
    const [showSuccess, setShowSuccess] = useState(false);

    // 加载已有数据
    useEffect(() => {
        if (profile) {
            setFormData({
                birthDate: profile.birthDate || '',
                gender: profile.gender || '',
                heightCm: profile.heightCm?.toString() || '',
                weightKg: profile.weightKg?.toString() || '',
                medicalHistory: profile.medicalHistory || '',
                allergies: profile.allergies || '',
            });
        }
    }, [profile]);

    /**
     * 处理输入变化
     */
    const handleInputChange = useCallback((
        field: keyof HealthProfileFormData,
        value: string
    ) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setFormError('');
        clearError();
    }, [clearError]);

    /**
     * 处理保存
     */
    const handleSave = useCallback(async (e: FormEvent) => {
        e.preventDefault();
        setFormError('');
        setShowSuccess(false);

        // 验证必填项
        if (!formData.birthDate) {
            setFormError(t('healthProfile.birthDateRequired'));
            return;
        }
        if (!formData.gender) {
            setFormError(t('healthProfile.genderRequired'));
            return;
        }
        if (!formData.heightCm) {
            setFormError(t('healthProfile.heightRequired'));
            return;
        }
        if (!formData.weightKg) {
            setFormError(t('healthProfile.weightRequired'));
            return;
        }

        // 保存
        const success = await saveProfile(formData);
        if (success) {
            setShowSuccess(true);
            // 2秒后跳转
            setTimeout(() => {
                onComplete();
            }, 1500);
        }
    }, [formData, saveProfile, onComplete]);

    // 加载中
    if (isLoading) {
        return (
            <div className="health-profile-loading">
                <div className="loading-spinner">📋</div>
                <p>{t('app.loading')}</p>
            </div>
        );
    }

    return (
        <div className="health-profile-page">
            <div className="health-profile-container">
                {/* 头部 */}
                <div className="health-profile-header">
                    <h1 className="page-title">{t('healthProfile.title')}</h1>
                    <p className="page-subtitle">{t('healthProfile.subtitle')}</p>
                </div>

                {/* 表单 */}
                <form className="health-profile-form" onSubmit={handleSave}>
                    {/* 错误提示 */}
                    {(error || formError) && (
                        <div className="error-message">
                            {formError || error}
                        </div>
                    )}

                    {/* 成功提示 */}
                    {showSuccess && (
                        <div className="success-message">
                            {t('healthProfile.saveSuccess')}
                        </div>
                    )}

                    {/* 基本信息区域 */}
                    <div className="form-section">
                        <h2 className="section-title">{t('healthProfile.basicInfo')}</h2>

                        {/* 出生日期 */}
                        <div className="form-group">
                            <label className="form-label">{t('healthProfile.birthDate')}</label>
                            <input
                                type="date"
                                className="form-input"
                                value={formData.birthDate}
                                onChange={(e) => handleInputChange('birthDate', e.target.value)}
                                disabled={isSaving}
                            />
                        </div>

                        {/* 性别 */}
                        <div className="form-group">
                            <label className="form-label">{t('healthProfile.gender')}</label>
                            <div className="gender-options">
                                {(['male', 'female', 'other'] as Gender[]).map((g) => (
                                    <button
                                        key={g}
                                        type="button"
                                        className={`gender-btn ${formData.gender === g ? 'active' : ''}`}
                                        onClick={() => handleInputChange('gender', g)}
                                        disabled={isSaving}
                                    >
                                        {t(`healthProfile.${g}`)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 身高和体重 */}
                        <div className="form-row">
                            <div className="form-group half">
                                <label className="form-label">{t('healthProfile.height')}</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    value={formData.heightCm}
                                    onChange={(e) => handleInputChange('heightCm', e.target.value)}
                                    placeholder="170"
                                    min="50"
                                    max="250"
                                    disabled={isSaving}
                                />
                            </div>
                            <div className="form-group half">
                                <label className="form-label">{t('healthProfile.weight')}</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    value={formData.weightKg}
                                    onChange={(e) => handleInputChange('weightKg', e.target.value)}
                                    placeholder="60"
                                    min="20"
                                    max="300"
                                    disabled={isSaving}
                                />
                            </div>
                        </div>
                    </div>

                    {/* 健康信息区域 */}
                    <div className="form-section">
                        {/* 过往病史 */}
                        <div className="form-group">
                            <label className="form-label">{t('healthProfile.medicalHistory')}</label>
                            <textarea
                                className="form-textarea"
                                value={formData.medicalHistory}
                                onChange={(e) => handleInputChange('medicalHistory', e.target.value)}
                                placeholder={t('healthProfile.medicalHistoryHint')}
                                rows={4}
                                disabled={isSaving}
                            />
                        </div>

                        {/* 过敏药物 */}
                        <div className="form-group">
                            <label className="form-label">{t('healthProfile.allergies')}</label>
                            <textarea
                                className="form-textarea"
                                value={formData.allergies}
                                onChange={(e) => handleInputChange('allergies', e.target.value)}
                                placeholder={t('healthProfile.allergiesHint')}
                                rows={3}
                                disabled={isSaving}
                            />
                        </div>
                    </div>

                    {/* 保存按钮 */}
                    <button
                        type="submit"
                        className="save-button"
                        disabled={isSaving}
                    >
                        {isSaving ? t('app.loading') : t('app.save')}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default HealthProfilePage;
