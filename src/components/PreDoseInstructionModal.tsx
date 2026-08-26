/**
 * @file PreDoseInstructionModal.tsx
 * @description 服药前说明确认弹窗（Step 1）
 */

import { useTranslation } from 'react-i18next';
import type { DoseInfo } from './ConfirmDoseModal';
import './ConfirmDoseModal.css';
import './PreDoseInstructionModal.css';

interface PreDoseInstructionModalProps {
    dose: DoseInfo;
    onBack: () => void;
    onConfirm: () => void;
}

export default function PreDoseInstructionModal({ dose, onBack, onConfirm }: PreDoseInstructionModalProps) {
    const { t } = useTranslation();
    const instructions = dose.instructions?.trim();

    return (
        <div className="dose-modal-overlay" onClick={onBack}>
            <div className="dose-modal" onClick={e => e.stopPropagation()}>
                <div className="dose-step pre-dose-step">
                    <div className="dose-header">
                        <h3>{dose.medicationName}</h3>
                        <p className="dose-meta">{dose.time} · {dose.dosage}</p>
                    </div>

                    <p className="pre-dose-title">
                        {t('confirmDose.preStepTitle', '请先确认用药说明')}
                    </p>

                    <div className="pre-dose-card">
                        <p className="pre-dose-label">
                            {t('confirmDose.instructionsLabel', '用药说明')}
                        </p>
                        <p className={`pre-dose-text ${instructions ? '' : 'empty'}`}>
                            {instructions || t('confirmDose.instructionsEmpty', '暂无用药说明')}
                        </p>
                    </div>

                    <div className="pre-dose-actions">
                        <button className="pre-dose-back" onClick={onBack}>
                            {t('confirmDose.backToPlan', '返回')}
                        </button>
                        <button className="pre-dose-confirm" onClick={onConfirm}>
                            {t('confirmDose.confirmAndContinue', '确认服用')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
