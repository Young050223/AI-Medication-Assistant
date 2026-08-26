/**
 * @file AgentActionConfirmModal.tsx
 * @description Agent 动作二次确认弹窗
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    AgentEditableMedicationPlan,
    AgentEditableMedicationPlanOperation,
} from '../services/agentCommandApi';
import { FREQUENCY_OPTIONS_KEYS } from '../types/MedicationFeedback.types';
import './AgentActionConfirmModal.css';

export type AgentActionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface EditableMedicationPlanOperationDraft extends AgentEditableMedicationPlanOperation {
    localId: string;
    reminderTimes: string[];
}

type EditableDraftTextField =
    | 'operationKind'
    | 'medicationName'
    | 'medicationDosage'
    | 'frequency'
    | 'startDate'
    | 'endDate'
    | 'instructions'
    | 'notes';

export interface AgentActionConfirmModalProps {
    title: string;
    summary: string;
    impactDescription: string;
    riskLevel: AgentActionRiskLevel;
    onConfirm: (editedPlan?: AgentEditableMedicationPlan) => void | Promise<unknown>;
    onCancel: () => void | Promise<unknown>;
    confirmLabel?: string;
    cancelLabel?: string;
    modifyLabel?: string;
    confirmBusy?: boolean;
    confirmHint?: string;
    impactPoints?: string[];
    previewSections?: Array<{
        title: string;
        items: string[];
    }>;
    editablePlan?: AgentEditableMedicationPlan;
}

function getRiskLabel(riskLevel: AgentActionRiskLevel, t: (key: string, defaultValue: string) => string): string {
    switch (riskLevel) {
        case 'critical':
            return t('agentAction.riskCritical', '严重');
        case 'high':
            return t('agentAction.riskHigh', '高');
        case 'medium':
            return t('agentAction.riskMedium', '中');
        case 'low':
        default:
            return t('agentAction.riskLow', '低');
    }
}

function toDraftOperation(operation: AgentEditableMedicationPlanOperation): EditableMedicationPlanOperationDraft {
    return {
        ...operation,
        localId: operation.draftId || operation.changeItemId || crypto.randomUUID(),
        reminderTimes: Array.isArray(operation.reminderTimes)
            ? operation.reminderTimes
                .map((item) => String(item || '').trim())
                .filter(Boolean)
            : [],
    };
}

function createEmptyDraftOperation(): EditableMedicationPlanOperationDraft {
    return {
        localId: crypto.randomUUID(),
        draftId: crypto.randomUUID(),
        operationKind: 'create',
        medicationName: '',
        medicationDosage: '',
        frequency: 'onceDaily',
        instructions: '',
        reminderTimes: ['08:00'],
        startDate: '',
        endDate: '',
        notes: '',
    };
}

function sanitizeDateValue(value?: string): string | undefined {
    const safeValue = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(safeValue) ? safeValue : undefined;
}

function sanitizeReminderTimes(reminderTimes: string[]): string[] {
    const uniqueTimes = new Set<string>();
    reminderTimes.forEach((item) => {
        const safeValue = String(item || '').trim();
        if (/^\d{2}:\d{2}$/.test(safeValue)) {
            uniqueTimes.add(safeValue);
        }
    });
    return Array.from(uniqueTimes);
}

function normalizeDraftOperation(
    operation: EditableMedicationPlanOperationDraft
): AgentEditableMedicationPlanOperation | null {
    const operationKind = String(operation.operationKind || '').trim() as AgentEditableMedicationPlanOperation['operationKind'];
    if (!['create', 'update', 'pause', 'archive', 'keep'].includes(operationKind)) {
        return null;
    }

    const targetScheduleId = String(operation.targetScheduleId || '').trim() || undefined;
    const medicationName = String(operation.medicationName || '').trim() || undefined;
    const targetMedicationName = String(operation.targetMedicationName || '').trim() || undefined;

    return {
        changeItemId: String(operation.changeItemId || '').trim() || undefined,
        draftId: String(operation.draftId || '').trim() || operation.localId,
        operationKind,
        targetMedicationName,
        targetScheduleId,
        medicationName,
        medicationDosage: String(operation.medicationDosage || '').trim() || undefined,
        frequency: String(operation.frequency || '').trim() || undefined,
        instructions: String(operation.instructions || '').trim() || undefined,
        reminderTimes: sanitizeReminderTimes(operation.reminderTimes),
        startDate: sanitizeDateValue(operation.startDate),
        endDate: sanitizeDateValue(operation.endDate),
        notes: String(operation.notes || '').trim() || undefined,
    };
}

function buildPreviewSectionsFromOperations(
    operations: AgentEditableMedicationPlanOperation[],
    t: (key: string, defaultValue: string) => string
): Array<{ title: string; items: string[] }> {
    const groups: Array<{
        title: string;
        operationKinds: AgentEditableMedicationPlanOperation['operationKind'][];
    }> = [
        {
            title: t('agent.action.previewStop', '将停用的计划'),
            operationKinds: ['archive', 'pause'],
        },
        {
            title: t('agent.action.previewCreate', '将新增的计划'),
            operationKinds: ['create'],
        },
        {
            title: t('agent.action.previewUpdate', '将更新的计划'),
            operationKinds: ['update'],
        },
        {
            title: t('agent.action.previewKeep', '将保留的计划'),
            operationKinds: ['keep'],
        },
    ];

    return groups
        .map((group) => {
            const items = operations
                .filter((operation) => group.operationKinds.includes(operation.operationKind))
                .map((operation) => {
                    const name = operation.medicationName || operation.targetMedicationName || t('agent.action.unnamedMedication', '未命名药物');
                    const detailParts = [
                        operation.medicationDosage ? t('agent.action.previewDosage', '剂量 {{value}}').replace('{{value}}', operation.medicationDosage) : '',
                        operation.frequency ? t(`frequency.${operation.frequency}`, operation.frequency) : '',
                        Array.isArray(operation.reminderTimes) && operation.reminderTimes.length > 0
                            ? t('agent.action.previewReminders', '提醒 {{value}}').replace('{{value}}', operation.reminderTimes.join(', '))
                            : '',
                        operation.notes || '',
                    ].filter(Boolean);

                    return detailParts.length > 0 ? `${name}：${detailParts.join('，')}` : name;
                });

            return items.length > 0
                ? {
                    title: group.title,
                    items,
                }
                : null;
        })
        .filter((section): section is { title: string; items: string[] } => !!section);
}

function getOperationKindLabel(
    operationKind: AgentEditableMedicationPlanOperation['operationKind'],
    t: (key: string, defaultValue: string) => string
): string {
    switch (operationKind) {
        case 'archive':
            return t('agent.action.operationArchive', '归档');
        case 'pause':
            return t('agent.action.operationPause', '停用');
        case 'update':
            return t('agent.action.operationUpdate', '更新');
        case 'keep':
            return t('agent.action.operationKeep', '保留');
        case 'create':
        default:
            return t('agent.action.operationCreate', '新增');
    }
}

function getEditableKindOptions(
    operation: EditableMedicationPlanOperationDraft,
    t: (key: string, defaultValue: string) => string
): Array<{ value: AgentEditableMedicationPlanOperation['operationKind']; label: string }> {
    if (operation.targetScheduleId) {
        return [
            { value: 'update', label: getOperationKindLabel('update', t) },
            { value: 'pause', label: getOperationKindLabel('pause', t) },
            { value: 'archive', label: getOperationKindLabel('archive', t) },
            { value: 'keep', label: getOperationKindLabel('keep', t) },
        ];
    }

    return [
        { value: 'create', label: getOperationKindLabel('create', t) },
    ];
}

export default function AgentActionConfirmModal({
    title,
    summary,
    impactDescription,
    riskLevel,
    onConfirm,
    onCancel,
    confirmLabel,
    cancelLabel,
    modifyLabel,
    confirmBusy = false,
    confirmHint,
    impactPoints = [],
    previewSections = [],
    editablePlan,
}: AgentActionConfirmModalProps) {
    const { t } = useTranslation();
    const supportsEditing = Boolean(editablePlan && Array.isArray(editablePlan.operations));
    const [isEditing, setIsEditing] = useState(false);
    const [effectiveDate, setEffectiveDate] = useState<string>(String(editablePlan?.effectiveDate || '').trim());
    const [draftOperations, setDraftOperations] = useState<EditableMedicationPlanOperationDraft[]>(
        () => Array.isArray(editablePlan?.operations)
            ? editablePlan.operations.map((operation) => toDraftOperation(operation))
            : []
    );
    const [editError, setEditError] = useState<string | null>(null);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                if (supportsEditing && isEditing) {
                    setIsEditing(false);
                    setEditError(null);
                    return;
                }
                onCancel();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isEditing, onCancel, supportsEditing]);

    useEffect(() => {
        setIsEditing(false);
        setEditError(null);
        setEffectiveDate(String(editablePlan?.effectiveDate || '').trim());
        setDraftOperations(
            Array.isArray(editablePlan?.operations)
                ? editablePlan.operations.map((operation) => toDraftOperation(operation))
                : []
        );
    }, [editablePlan, title]);

    const riskLabel = getRiskLabel(riskLevel, t);
    const safeSummary = summary.trim();
    const safeImpactDescription = impactDescription.trim();
    const safeImpactPoints = impactPoints.map((item) => item.trim()).filter(Boolean);
    const normalizedDraftOperations = useMemo(
        () => draftOperations
            .map((operation) => normalizeDraftOperation(operation))
            .filter((operation): operation is AgentEditableMedicationPlanOperation => !!operation),
        [draftOperations]
    );
    const safePreviewSections = useMemo(() => {
        if (supportsEditing) {
            return buildPreviewSectionsFromOperations(normalizedDraftOperations, t);
        }

        return previewSections
            .map((section) => ({
                title: section.title.trim(),
                items: section.items.map((item) => item.trim()).filter(Boolean),
            }))
            .filter((section) => section.title || section.items.length > 0);
    }, [normalizedDraftOperations, previewSections, supportsEditing, t]);

    const handleDraftOperationChange = (
        localId: string,
        field: EditableDraftTextField,
        value: string
    ) => {
        setDraftOperations((prev) => prev.map((operation) => {
            if (operation.localId !== localId) return operation;
            return {
                ...operation,
                [field]: value,
            };
        }));
        setEditError(null);
    };

    const handleReminderTimeChange = (localId: string, index: number, value: string) => {
        setDraftOperations((prev) => prev.map((operation) => {
            if (operation.localId !== localId) return operation;
            const nextReminderTimes = [...operation.reminderTimes];
            nextReminderTimes[index] = value;
            return {
                ...operation,
                reminderTimes: nextReminderTimes,
            };
        }));
        setEditError(null);
    };

    const handleAddReminderTime = (localId: string) => {
        setDraftOperations((prev) => prev.map((operation) => {
            if (operation.localId !== localId) return operation;
            return {
                ...operation,
                reminderTimes: [...operation.reminderTimes, '08:00'],
            };
        }));
        setEditError(null);
    };

    const handleRemoveReminderTime = (localId: string, index: number) => {
        setDraftOperations((prev) => prev.map((operation) => {
            if (operation.localId !== localId) return operation;
            return {
                ...operation,
                reminderTimes: operation.reminderTimes.filter((_, reminderIndex) => reminderIndex !== index),
            };
        }));
        setEditError(null);
    };

    const handleRemoveOperation = (localId: string) => {
        setDraftOperations((prev) => prev.filter((operation) => operation.localId !== localId));
        setEditError(null);
    };

    const handleAddOperation = () => {
        setDraftOperations((prev) => [...prev, createEmptyDraftOperation()]);
        setIsEditing(true);
        setEditError(null);
    };

    const handleConfirm = async () => {
        if (supportsEditing) {
            if (normalizedDraftOperations.length === 0) {
                setEditError(t('agent.action.validationAtLeastOne', '至少保留一项计划调整后再确认。'));
                return;
            }

            await onConfirm({
                effectiveDate: sanitizeDateValue(effectiveDate),
                operations: normalizedDraftOperations,
            });
            return;
        }

        await onConfirm();
    };

    return (
        <div className="agent-action-modal-overlay" onClick={onCancel}>
            <div
                className={`agent-action-modal agent-risk-${riskLevel}`}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="agent-action-modal-title"
            >
                <div className="agent-action-modal-step">
                    <div className="agent-action-modal-header">
                        <span className={`agent-action-risk-badge agent-risk-${riskLevel}`}>
                            {riskLabel}
                        </span>
                        <h3 id="agent-action-modal-title">{title}</h3>
                        <p className="agent-action-modal-subtitle">
                            {t('agentAction.confirmTitle', '请确认此次操作')}
                        </p>
                    </div>

                    <div className="agent-action-modal-section">
                        <p className="agent-action-modal-label">
                            {t('agentAction.summaryLabel', '动作摘要')}
                        </p>
                        <p className={`agent-action-modal-text ${safeSummary ? '' : 'empty'}`}>
                            {safeSummary || t('agentAction.summaryEmpty', '暂无摘要')}
                        </p>
                    </div>

                    <div className="agent-action-modal-section">
                        <p className="agent-action-modal-label">
                            {t('agentAction.impactLabel', '影响说明')}
                        </p>
                        <p className={`agent-action-modal-text ${safeImpactDescription ? '' : 'empty'}`}>
                            {safeImpactDescription || t('agentAction.impactEmpty', '暂无影响说明')}
                        </p>
                        {safeImpactPoints.length > 0 && (
                            <ul className="agent-action-modal-list">
                                {safeImpactPoints.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {supportsEditing && isEditing && (
                        <div className="agent-action-modal-section agent-action-modal-edit-section">
                            <div className="agent-action-modal-edit-header">
                                <div>
                                    <p className="agent-action-modal-label">
                                        {t('agent.action.editTitle', '手动修改用药计划')}
                                    </p>
                                    <p className="agent-action-modal-edit-hint">
                                        {t('agent.action.editHint', '修改后点击确认，系统会直接按当前内容执行，不再追加第 3 轮确认。')}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="agent-action-edit-add"
                                    onClick={handleAddOperation}
                                    disabled={confirmBusy}
                                >
                                    {t('agent.action.addOperation', '新增调整项')}
                                </button>
                            </div>

                            <label className="agent-action-edit-field full">
                                <span>{t('agent.action.effectiveDate', '生效日期')}</span>
                                <input
                                    type="date"
                                    value={effectiveDate}
                                    onChange={(event) => {
                                        setEffectiveDate(event.target.value);
                                        setEditError(null);
                                    }}
                                    disabled={confirmBusy}
                                />
                            </label>

                            {draftOperations.length === 0 ? (
                                <p className="agent-action-modal-text empty">
                                    {t('agent.action.emptyOperations', '当前没有调整项，请先新增后再确认。')}
                                </p>
                            ) : (
                                <div className="agent-action-edit-list">
                                    {draftOperations.map((operation) => {
                                        const displayName = operation.medicationName || operation.targetMedicationName || t('agent.action.unnamedMedication', '未命名药物');
                                        const kindOptions = getEditableKindOptions(operation, t);
                                        return (
                                            <div key={operation.localId} className="agent-action-edit-card">
                                                <div className="agent-action-edit-card-header">
                                                    <div className="agent-action-edit-card-title">
                                                        <span className="agent-action-edit-badge">
                                                            {getOperationKindLabel(operation.operationKind, t)}
                                                        </span>
                                                        <strong>{displayName}</strong>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="agent-action-edit-remove"
                                                        onClick={() => handleRemoveOperation(operation.localId)}
                                                        disabled={confirmBusy}
                                                    >
                                                        {t('agent.action.removeOperation', '删除')}
                                                    </button>
                                                </div>

                                                {operation.targetScheduleId && (
                                                    <p className="agent-action-edit-target">
                                                        {t('agent.action.targetPlan', '关联当前计划')}：{operation.targetMedicationName || displayName}
                                                    </p>
                                                )}

                                                <div className="agent-action-edit-grid">
                                                    <label className="agent-action-edit-field">
                                                        <span>{t('agent.action.operationKind', '调整类型')}</span>
                                                        <select
                                                            value={operation.operationKind}
                                                            onChange={(event) => handleDraftOperationChange(operation.localId, 'operationKind', event.target.value)}
                                                            disabled={confirmBusy}
                                                        >
                                                            {kindOptions.map((option) => (
                                                                <option key={`${operation.localId}-${option.value}`} value={option.value}>
                                                                    {option.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>

                                                    <label className="agent-action-edit-field">
                                                        <span>{t('agent.action.medicationName', '药物名称')}</span>
                                                        <input
                                                            type="text"
                                                            value={operation.medicationName || ''}
                                                            onChange={(event) => handleDraftOperationChange(operation.localId, 'medicationName', event.target.value)}
                                                            placeholder={t('schedule.medicationName', '药物名称')}
                                                            disabled={confirmBusy}
                                                        />
                                                    </label>

                                                    <label className="agent-action-edit-field">
                                                        <span>{t('agent.action.medicationDosage', '剂量')}</span>
                                                        <input
                                                            type="text"
                                                            value={operation.medicationDosage || ''}
                                                            onChange={(event) => handleDraftOperationChange(operation.localId, 'medicationDosage', event.target.value)}
                                                            placeholder={t('agent.action.medicationDosagePlaceholder', '如：1片 / 5ml')}
                                                            disabled={confirmBusy}
                                                        />
                                                    </label>

                                                    <label className="agent-action-edit-field">
                                                        <span>{t('agent.action.frequency', '频率')}</span>
                                                        <select
                                                            value={operation.frequency || 'onceDaily'}
                                                            onChange={(event) => handleDraftOperationChange(operation.localId, 'frequency', event.target.value)}
                                                            disabled={confirmBusy}
                                                        >
                                                            {FREQUENCY_OPTIONS_KEYS.map((key) => (
                                                                <option key={`${operation.localId}-${key}`} value={key}>
                                                                    {t(`frequency.${key}`, key)}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>

                                                    <label className="agent-action-edit-field">
                                                        <span>{t('agent.action.startDate', '开始日期')}</span>
                                                        <input
                                                            type="date"
                                                            value={operation.startDate || ''}
                                                            onChange={(event) => handleDraftOperationChange(operation.localId, 'startDate', event.target.value)}
                                                            disabled={confirmBusy}
                                                        />
                                                    </label>

                                                    <label className="agent-action-edit-field">
                                                        <span>{t('agent.action.endDate', '结束日期')}</span>
                                                        <input
                                                            type="date"
                                                            value={operation.endDate || ''}
                                                            onChange={(event) => handleDraftOperationChange(operation.localId, 'endDate', event.target.value)}
                                                            disabled={confirmBusy}
                                                        />
                                                    </label>
                                                </div>

                                                <label className="agent-action-edit-field full">
                                                    <span>{t('agent.action.instructions', '服用说明')}</span>
                                                    <textarea
                                                        value={operation.instructions || ''}
                                                        onChange={(event) => handleDraftOperationChange(operation.localId, 'instructions', event.target.value)}
                                                        rows={3}
                                                        disabled={confirmBusy}
                                                    />
                                                </label>

                                                <label className="agent-action-edit-field full">
                                                    <span>{t('agent.action.notes', '备注')}</span>
                                                    <textarea
                                                        value={operation.notes || ''}
                                                        onChange={(event) => handleDraftOperationChange(operation.localId, 'notes', event.target.value)}
                                                        rows={2}
                                                        disabled={confirmBusy}
                                                    />
                                                </label>

                                                <div className="agent-action-edit-field full">
                                                    <span>{t('agent.action.reminderTimes', '提醒时间')}</span>
                                                    <div className="agent-action-edit-time-list">
                                                        {operation.reminderTimes.map((reminderTime, index) => (
                                                            <div key={`${operation.localId}-time-${index}`} className="agent-action-edit-time-row">
                                                                <input
                                                                    type="time"
                                                                    value={reminderTime}
                                                                    onChange={(event) => handleReminderTimeChange(operation.localId, index, event.target.value)}
                                                                    disabled={confirmBusy}
                                                                />
                                                                <button
                                                                    type="button"
                                                                    className="agent-action-edit-time-remove"
                                                                    onClick={() => handleRemoveReminderTime(operation.localId, index)}
                                                                    disabled={confirmBusy}
                                                                >
                                                                    {t('agent.action.removeReminderTime', '删除时间')}
                                                                </button>
                                                            </div>
                                                        ))}
                                                        <button
                                                            type="button"
                                                            className="agent-action-edit-add-time"
                                                            onClick={() => handleAddReminderTime(operation.localId)}
                                                            disabled={confirmBusy}
                                                        >
                                                            {t('agent.action.addReminderTime', '新增提醒时间')}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {editError && (
                                <p className="agent-action-modal-error">{editError}</p>
                            )}
                        </div>
                    )}

                    {safePreviewSections.length > 0 && (
                        <div className="agent-action-modal-section">
                            <p className="agent-action-modal-label">
                                {supportsEditing && isEditing
                                    ? t('agent.action.livePreview', '实时变更预览')
                                    : t('agentAction.previewLabel', '统一变更预览')}
                            </p>
                            <div className="agent-action-preview-sections">
                                {safePreviewSections.map((section) => (
                                    <div
                                        key={`${section.title}-${section.items.join('|')}`}
                                        className="agent-action-preview-block"
                                    >
                                        {section.title && (
                                            <p className="agent-action-preview-title">{section.title}</p>
                                        )}
                                        {section.items.length > 0 && (
                                            <ul className="agent-action-modal-list compact">
                                                {section.items.map((item) => (
                                                    <li key={`${section.title}-${item}`}>{item}</li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {confirmHint && (
                        <p className="agent-action-modal-hint">{confirmHint}</p>
                    )}

                    <div className={`agent-action-modal-actions${supportsEditing ? ' has-modify' : ''}`}>
                        <button
                            type="button"
                            className="agent-action-modal-cancel"
                            onClick={onCancel}
                            disabled={confirmBusy}
                        >
                            {cancelLabel || t('common.cancel', '取消')}
                        </button>

                        {supportsEditing && (
                            <button
                                type="button"
                                className="agent-action-modal-modify"
                                onClick={() => {
                                    setIsEditing((prev) => !prev);
                                    setEditError(null);
                                }}
                                disabled={confirmBusy}
                            >
                                {isEditing
                                    ? t('agent.action.backToPreview', '返回预览')
                                    : (modifyLabel || t('agent.action.modify', '修改'))
                                }
                            </button>
                        )}

                        <button
                            type="button"
                            className="agent-action-modal-confirm"
                            onClick={() => {
                                void handleConfirm();
                            }}
                            disabled={confirmBusy}
                        >
                            {confirmBusy
                                ? t('agentAction.confirming', '执行中...')
                                : (confirmLabel || t('common.confirm', '确认'))
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
