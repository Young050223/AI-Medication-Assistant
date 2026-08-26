/**
 * @file agent-command/index.ts
 * @description Agent 命令执行入口，负责确认/取消待执行动作
 * @endpoint POST /functions/v1/agent-command
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type {
    AgentActionPriority,
    AgentActionStatus,
    AgentCommandName,
    AgentConfirmationState,
    AgentLifecycleStatus,
} from '../_shared/agent_runtime/index.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt, x-trace-id',
};

type CommandAction = 'confirm' | 'cancel' | 'get';
type MedicationPlanOperationKind = 'create' | 'update' | 'pause' | 'archive' | 'keep';

interface AgentCommandRequest {
    action: CommandAction;
    requestId: string;
    editedPlan?: EditableMedicationPlan;
}

interface AgentActionRequestRow {
    id: string;
    user_id: string;
    conversation_id: string | null;
    command_name: AgentCommandName;
    thinking_mode: 'fast' | 'slow';
    confirmation_state: AgentConfirmationState;
    request_status: AgentActionStatus;
    priority: AgentActionPriority;
    title: string;
    summary: string;
    payload: Record<string, unknown> | null;
    context_snapshot: Record<string, unknown> | null;
    requires_confirmation: boolean;
    failure_reason: string | null;
    result: Record<string, unknown> | null;
}

interface PendingActionResponse {
    requestId: string;
    changeSetId?: string;
    commandName: AgentCommandName;
    status: AgentActionStatus;
    confirmationState: AgentConfirmationState;
    title: string;
    summary: string;
    impactDescription: string;
    impactPoints: string[];
    previewSections?: Array<{ title: string; items: string[] }>;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    confirmHint?: string;
    editablePlan?: EditableMedicationPlan;
}

interface EditableMedicationPlanOperation {
    changeItemId?: string;
    draftId?: string;
    operationKind: MedicationPlanOperationKind;
    targetMedicationName?: string;
    targetScheduleId?: string;
    medicationName?: string;
    medicationDosage?: string;
    frequency?: string;
    instructions?: string;
    reminderTimes?: string[];
    startDate?: string;
    endDate?: string;
    notes?: string;
}

interface EditableMedicationPlan {
    effectiveDate?: string;
    operations: EditableMedicationPlanOperation[];
}

interface CommandExecutionResult {
    success: boolean;
    message: string;
    data?: Record<string, unknown>;
    error?: string;
}

function getSupabaseClient() {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return null;
    return createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

function normalizeToken(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const value = raw.trim();
    if (!value) return null;
    const matched = value.match(/^Bearer\s+(.+)$/i);
    const token = matched ? matched[1] : value;
    return token.trim() || null;
}

function getBearerToken(req: Request): string | null {
    const userJwtHeader = normalizeToken(req.headers.get('x-user-jwt') || req.headers.get('X-User-Jwt'));
    if (userJwtHeader) return userJwtHeader;

    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader) return null;
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return normalizeToken(token);
}

async function getAuthenticatedUserId(
    supabase: ReturnType<typeof getSupabaseClient>,
    token: string | null
): Promise<string | null> {
    if (!supabase || !token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
}

function isMissingRelationError(error: { message?: string } | null | undefined, relation: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('relation') && message.includes(relation.toLowerCase()) && message.includes('does not exist');
}

async function countPendingActions(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
}): Promise<number> {
    const { supabase, userId } = params;
    if (!supabase) return 0;
    const { count, error } = await supabase
        .from('agent_action_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('request_status', ['pending', 'ready', 'running']);

    if (error) return 0;
    return Number(count || 0);
}

async function updateAgentRuntimeState(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    lifecycleStatus: AgentLifecycleStatus;
    lastError?: string | null;
}) {
    const { supabase, userId, lifecycleStatus, lastError } = params;
    if (!supabase) return;

    const pendingActionCount = await countPendingActions({ supabase, userId });
    const { error } = await supabase
        .from('agent_runtime_states')
        .upsert({
            user_id: userId,
            lifecycle_status: lifecycleStatus,
            pending_action_count: pendingActionCount,
            background_status: {
                pendingActionCount,
            },
            last_error: lastError || null,
            last_interaction_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

    if (error && !isMissingRelationError(error, 'agent_runtime_states')) {
        console.warn('[agent-command] update runtime state failed:', error.message);
    }
}

function normalizeDate(input?: string | null): string {
    const value = String(input || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Date().toISOString().slice(0, 10);
}

function toReminderArray(reminderTimes: unknown, dosage: string, scheduleId: string) {
    const safeTimes = Array.isArray(reminderTimes)
        ? reminderTimes
            .map((item) => String(item || '').trim())
            .filter((item) => /^\d{2}:\d{2}$/.test(item))
        : [];

    return safeTimes.map((time, index) => ({
        id: `${scheduleId}-agent-${time}-${index}`,
        time,
        dosage,
    }));
}

function normalizeOptionalString(value: unknown): string | undefined {
    const safeValue = String(value || '').trim();
    return safeValue || undefined;
}

function firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
        const safeValue = String(value || '').trim();
        if (safeValue) return safeValue;
    }
    return '';
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function normalizeMedicationFeedbackPayload(payload: Record<string, unknown>) {
    const medicationName = firstNonEmptyString(
        payload.medicationName,
        payload.medication_name,
        payload.medication,
        payload.drugName,
        payload.drug_name
    );
    const content = firstNonEmptyString(
        payload.content,
        payload.feedbackContent,
        payload.feedback_content,
        payload.feedback,
        payload.note,
        payload.notes,
        payload.symptomDescription,
        payload.symptoms
    );

    return {
        medicationName,
        content,
        scheduleId: firstNonEmptyString(payload.scheduleId, payload.schedule_id),
        feedbackDate: firstNonEmptyString(payload.feedbackDate, payload.feedback_date, payload.date),
        mood: firstNonEmptyString(payload.mood, payload.feeling),
        sideEffects: normalizeStringList(payload.sideEffects ?? payload.side_effects),
    };
}

function sanitizeReminderTimes(reminderTimes: unknown): string[] {
    const uniqueTimes = Array.isArray(reminderTimes)
        ? reminderTimes
            .map((item) => String(item || '').trim())
            .filter((item) => /^\d{2}:\d{2}$/.test(item))
        : [];

    return Array.from(new Set(uniqueTimes));
}

function normalizeEditableMedicationPlanOperation(value: unknown): EditableMedicationPlanOperation | null {
    if (!value || typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const operationKind = String(record.operationKind || '').trim() as MedicationPlanOperationKind;
    if (!['create', 'update', 'pause', 'archive', 'keep'].includes(operationKind)) {
        return null;
    }

    return {
        changeItemId: normalizeOptionalString(record.changeItemId),
        draftId: normalizeOptionalString(record.draftId),
        operationKind,
        targetMedicationName: normalizeOptionalString(record.targetMedicationName),
        targetScheduleId: normalizeOptionalString(record.targetScheduleId),
        medicationName: normalizeOptionalString(record.medicationName),
        medicationDosage: normalizeOptionalString(record.medicationDosage),
        frequency: normalizeOptionalString(record.frequency),
        instructions: normalizeOptionalString(record.instructions),
        reminderTimes: sanitizeReminderTimes(record.reminderTimes),
        startDate: normalizeOptionalString(record.startDate),
        endDate: normalizeOptionalString(record.endDate),
        notes: normalizeOptionalString(record.notes),
    };
}

function normalizeEditableMedicationPlan(value: unknown): EditableMedicationPlan | null {
    if (!value || typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const operations = Array.isArray(record.operations)
        ? record.operations
            .map((item) => normalizeEditableMedicationPlanOperation(item))
            .filter((item): item is EditableMedicationPlanOperation => !!item)
        : [];

    if (operations.length === 0) return null;

    return {
        effectiveDate: normalizeOptionalString(record.effectiveDate),
        operations,
    };
}

function buildMedicationPlanPreviewSections(
    plan: EditableMedicationPlan
): Array<{ title: string; items: string[] }> {
    const groups: Array<{ title: string; kinds: MedicationPlanOperationKind[] }> = [
        { title: '将停用的计划', kinds: ['archive', 'pause'] },
        { title: '将新增的计划', kinds: ['create'] },
        { title: '将更新的计划', kinds: ['update'] },
        { title: '将保留的计划', kinds: ['keep'] },
    ];

    return groups
        .map((group) => {
            const items = plan.operations
                .filter((operation) => group.kinds.includes(operation.operationKind))
                .map((operation) => {
                    const name = operation.medicationName || operation.targetMedicationName || '未命名药物';
                    const detailParts = [
                        operation.medicationDosage ? `剂量 ${operation.medicationDosage}` : '',
                        operation.frequency ? `频率 ${operation.frequency}` : '',
                        Array.isArray(operation.reminderTimes) && operation.reminderTimes.length > 0
                            ? `提醒 ${operation.reminderTimes.join(', ')}`
                            : '',
                        operation.notes || '',
                    ].filter(Boolean);
                    return detailParts.length > 0 ? `${name}：${detailParts.join('，')}` : name;
                });

            return items.length > 0 ? { title: group.title, items } : null;
        })
        .filter((section): section is { title: string; items: string[] } => !!section);
}

function buildMedicationPlanImpactPoints(plan: EditableMedicationPlan): string[] {
    const counts = {
        create: 0,
        update: 0,
        pause: 0,
        archive: 0,
        keep: 0,
    };

    plan.operations.forEach((operation) => {
        counts[operation.operationKind] += 1;
    });

    return [
        counts.create > 0 ? `新增 ${counts.create} 项计划` : '',
        counts.update > 0 ? `更新 ${counts.update} 项计划` : '',
        counts.pause > 0 ? `停用 ${counts.pause} 项计划` : '',
        counts.archive > 0 ? `归档 ${counts.archive} 项计划` : '',
        counts.keep > 0 ? `保留 ${counts.keep} 项计划` : '',
    ].filter(Boolean);
}

function buildMedicationPlanImpactDescription(plan: EditableMedicationPlan): string {
    const effectiveDate = normalizeDate(plan.effectiveDate);
    return `将按确认后的最终内容执行 ${plan.operations.length} 项用药计划调整，预计从 ${effectiveDate} 起生效。`;
}

function buildMedicationPlanSuccessMessage(data: Record<string, unknown>, changeSetId: string): string {
    const createdCount = Number(data.createdCount || 0);
    const updatedCount = Number(data.updatedCount || 0);
    const pausedCount = Number(data.pausedCount || 0);
    const archivedCount = Number(data.archivedCount || 0);
    const keptCount = Number(data.keptCount || 0);

    const parts = [
        createdCount > 0 ? `新增 ${createdCount} 项` : '',
        updatedCount > 0 ? `更新 ${updatedCount} 项` : '',
        pausedCount > 0 ? `停用 ${pausedCount} 项` : '',
        archivedCount > 0 ? `归档 ${archivedCount} 项` : '',
        keptCount > 0 ? `保留 ${keptCount} 项` : '',
    ].filter(Boolean);

    if (parts.length === 0) {
        return `已执行用药计划变更（变更集 ${changeSetId}）。`;
    }

    return `已完成用药计划调整：${parts.join('，')}。`;
}

function buildPendingAction(row: AgentActionRequestRow): PendingActionResponse {
    const snapshot = row.context_snapshot || {};
    const preview = typeof snapshot.ui === 'object' && snapshot.ui
        ? snapshot.ui as Record<string, unknown>
        : snapshot;

    const impactPoints = Array.isArray(preview.impactPoints)
        ? preview.impactPoints.map((item) => String(item)).filter(Boolean)
        : [];
    const previewSections = Array.isArray(preview.previewSections)
        ? preview.previewSections
            .filter((item) => !!item && typeof item === 'object')
            .map((item) => {
                const record = item as Record<string, unknown>;
                return {
                    title: String(record.title || ''),
                    items: Array.isArray(record.items)
                        ? record.items.map((entry) => String(entry)).filter(Boolean)
                        : [],
                };
            })
        : [];
    const editablePlan = normalizeEditableMedicationPlan(preview.editablePlan);

    return {
        requestId: row.id,
        changeSetId: String((row.payload?.changeSetId || row.payload?.change_set_id || '') || '') || undefined,
        commandName: row.command_name,
        status: row.request_status,
        confirmationState: row.confirmation_state,
        title: row.title,
        summary: row.summary,
        impactDescription: String(preview.impactDescription || row.summary || ''),
        impactPoints,
        previewSections,
        riskLevel: (String(preview.riskLevel || 'medium') as PendingActionResponse['riskLevel']),
        confirmHint: String(preview.confirmHint || '') || undefined,
        editablePlan: editablePlan || undefined,
    };
}

async function appendActionLog(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    requestId: string;
    commandName: AgentCommandName;
    actionStatus: 'started' | AgentActionStatus;
    message: string;
    detail?: Record<string, unknown>;
    executedBy?: string | null;
}) {
    const { supabase, userId, requestId, commandName, actionStatus, message, detail, executedBy } = params;
    if (!supabase) return;
    await supabase.from('agent_action_logs').insert({
        user_id: userId,
        request_id: requestId,
        command_name: commandName,
        action_status: actionStatus,
        message,
        detail: detail || {},
        executed_by: executedBy || null,
    });
}

async function applyEditedMedicationPlan(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    request: AgentActionRequestRow;
    editedPlan: EditableMedicationPlan;
}): Promise<{ ok: boolean; error?: string }> {
    const { supabase, userId, request, editedPlan } = params;
    if (!supabase) {
        return { ok: false, error: '服务不可用' };
    }

    const changeSetId = String(request.payload?.changeSetId || request.payload?.change_set_id || '').trim();
    if (!changeSetId) {
        return { ok: false, error: '缺少变更集 ID' };
    }

    const { data: existingChangeSet, error: changeSetError } = await supabase
        .from('medication_plan_change_sets')
        .select('id, preview_payload, change_status')
        .eq('id', changeSetId)
        .eq('user_id', userId)
        .maybeSingle();

    if (changeSetError) {
        return { ok: false, error: changeSetError.message };
    }

    if (!existingChangeSet?.id) {
        return { ok: false, error: '未找到对应的变更集' };
    }

    if (String(existingChangeSet.change_status || '') === 'applied') {
        return { ok: false, error: '该变更集已执行完成，无法再编辑' };
    }

    if (String(existingChangeSet.change_status || '') === 'cancelled') {
        return { ok: false, error: '该变更集已取消，无法再编辑' };
    }

    const previewSections = buildMedicationPlanPreviewSections(editedPlan);
    const existingPreview = existingChangeSet.preview_payload && typeof existingChangeSet.preview_payload === 'object'
        ? existingChangeSet.preview_payload as Record<string, unknown>
        : {};
    const impactDescription = buildMedicationPlanImpactDescription(editedPlan);
    const impactPoints = buildMedicationPlanImpactPoints(editedPlan);

    const nextItemRows = editedPlan.operations.map((operation, index) => ({
        id: operation.changeItemId || crypto.randomUUID(),
        change_set_id: changeSetId,
        user_id: userId,
        sort_order: index,
        operation_kind: operation.operationKind,
        target_schedule_id: operation.targetScheduleId || null,
        medication_name: operation.medicationName || operation.targetMedicationName || null,
        medication_dosage: operation.medicationDosage || null,
        frequency: operation.frequency || null,
        instructions: operation.instructions || null,
        reminder_times: operation.reminderTimes || [],
        start_date: operation.startDate ? normalizeDate(operation.startDate) : normalizeDate(editedPlan.effectiveDate),
        end_date: operation.endDate ? normalizeDate(operation.endDate) : null,
        status_after: operation.operationKind === 'archive'
            ? 'completed'
            : operation.operationKind === 'pause'
                ? 'paused'
                : 'active',
        notes: operation.notes || null,
        payload: {
            targetMedicationName: operation.targetMedicationName || null,
            draftId: operation.draftId || null,
        },
    }));

    const nextItemIds = nextItemRows.map((row) => row.id);
    const { data: existingItems, error: existingItemsError } = await supabase
        .from('medication_plan_change_items')
        .select('id')
        .eq('change_set_id', changeSetId)
        .eq('user_id', userId);

    if (existingItemsError) {
        return { ok: false, error: existingItemsError.message };
    }

    const { error: upsertError } = await supabase
        .from('medication_plan_change_items')
        .upsert(nextItemRows, { onConflict: 'id' });

    if (upsertError) {
        return { ok: false, error: upsertError.message };
    }

    const staleItemIds = Array.isArray(existingItems)
        ? existingItems
            .map((item) => String(item.id || '').trim())
            .filter((itemId) => itemId && !nextItemIds.includes(itemId))
        : [];

    if (staleItemIds.length > 0) {
        const { error: deleteError } = await supabase
            .from('medication_plan_change_items')
            .delete()
            .eq('change_set_id', changeSetId)
            .eq('user_id', userId)
            .in('id', staleItemIds);

        if (deleteError) {
            return { ok: false, error: deleteError.message };
        }
    }

    const nextEditablePlan: EditableMedicationPlan = {
        effectiveDate: normalizeDate(editedPlan.effectiveDate),
        operations: nextItemRows.map((row, index) => ({
            changeItemId: row.id,
            draftId: normalizeOptionalString(editedPlan.operations[index]?.draftId) || crypto.randomUUID(),
            operationKind: row.operation_kind as MedicationPlanOperationKind,
            targetMedicationName: normalizeOptionalString(row.payload?.targetMedicationName),
            targetScheduleId: normalizeOptionalString(row.target_schedule_id),
            medicationName: normalizeOptionalString(row.medication_name),
            medicationDosage: normalizeOptionalString(row.medication_dosage),
            frequency: normalizeOptionalString(row.frequency),
            instructions: normalizeOptionalString(row.instructions),
            reminderTimes: Array.isArray(row.reminder_times) ? row.reminder_times.map((item) => String(item)) : [],
            startDate: normalizeOptionalString(row.start_date),
            endDate: normalizeOptionalString(row.end_date),
            notes: normalizeOptionalString(row.notes),
        })),
    };

    const currentSnapshot = request.context_snapshot || {};
    const currentUi = currentSnapshot.ui && typeof currentSnapshot.ui === 'object'
        ? currentSnapshot.ui as Record<string, unknown>
        : {};

    const nextUi = {
        ...currentUi,
        impactDescription,
        impactPoints,
        previewSections,
        editablePlan: nextEditablePlan,
        confirmHint: normalizeOptionalString(currentUi.confirmHint) || '',
        riskLevel: normalizeOptionalString(currentUi.riskLevel) || 'medium',
    };

    const { error: requestUpdateError } = await supabase
        .from('agent_action_requests')
        .update({
            context_snapshot: {
                ...currentSnapshot,
                ui: nextUi,
            },
        })
        .eq('id', request.id)
        .eq('user_id', userId);

    if (requestUpdateError) {
        return { ok: false, error: requestUpdateError.message };
    }

    const { error: changeSetUpdateError } = await supabase
        .from('medication_plan_change_sets')
        .update({
            effective_date: normalizeDate(editedPlan.effectiveDate),
            preview_payload: {
                ...existingPreview,
                impactDescription,
                impactPoints,
                previewSections,
                editablePlan: nextEditablePlan,
            },
        })
        .eq('id', changeSetId)
        .eq('user_id', userId);

    if (changeSetUpdateError) {
        return { ok: false, error: changeSetUpdateError.message };
    }

    return { ok: true };
}

async function executeCommand(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    request: AgentActionRequestRow;
}): Promise<CommandExecutionResult> {
    const { supabase, userId, request } = params;
    if (!supabase) {
        return { success: false, message: '服务不可用', error: 'supabase_missing' };
    }

    const payload = request.payload || {};

    switch (request.command_name) {
        case 'medication_log.confirm':
        case 'medication_log.miss': {
            const medicationName = String(payload.medicationName || '').trim();
            if (!medicationName) {
                return { success: false, message: '缺少药物名称', error: 'missing_medication_name' };
            }

            const now = new Date().toISOString();
            const scheduledDate = normalizeDate(String(payload.scheduledDate || ''));
            const status = request.command_name === 'medication_log.confirm' ? 'taken' : 'skipped';
            const row = {
                user_id: userId,
                schedule_id: String(payload.scheduleId || '') || null,
                medication_name: medicationName,
                dosage: String(payload.dosage || '') || null,
                scheduled_time: String(payload.scheduledTime || '') || null,
                scheduled_date: scheduledDate,
                taken_at: request.command_name === 'medication_log.confirm' ? now : null,
                status,
                confirmed_by: 'agent',
                notes: String(payload.note || '') || null,
            };

            const { data, error } = await supabase
                .from('medication_logs')
                .insert(row)
                .select('id, status, medication_name, scheduled_date')
                .single();

            if (error) {
                return { success: false, message: '记录用药状态失败', error: error.message };
            }

            return {
                success: true,
                message: request.command_name === 'medication_log.confirm'
                    ? `已记录 ${medicationName} 为已服药。`
                    : `已记录 ${medicationName} 为漏服。`,
                data: data as Record<string, unknown>,
            };
        }

        case 'medication_feedback.create': {
            const feedbackPayload = normalizeMedicationFeedbackPayload(payload);
            if (!feedbackPayload.medicationName || !feedbackPayload.content) {
                return { success: false, message: '反馈内容不完整', error: 'missing_feedback_fields' };
            }

            const { data, error } = await supabase
                .from('medication_feedback')
                .insert({
                    user_id: userId,
                    schedule_id: feedbackPayload.scheduleId || null,
                    medication_name: feedbackPayload.medicationName,
                    feedback_date: normalizeDate(feedbackPayload.feedbackDate),
                    feedback_type: 'text',
                    content: feedbackPayload.content,
                    mood: feedbackPayload.mood || null,
                    side_effects: feedbackPayload.sideEffects,
                })
                .select('id, medication_name, created_at')
                .single();

            if (error) {
                return { success: false, message: '保存反馈失败', error: error.message };
            }

            return {
                success: true,
                message: `已保存 ${feedbackPayload.medicationName} 的用药反馈。`,
                data: data as Record<string, unknown>,
            };
        }

        case 'health_profile.update': {
            const birthDate = String(payload.birthDate || '') || null;
            const gender = String(payload.gender || '') || null;
            const heightCm = Number(payload.heightCm);
            const weightKg = Number(payload.weightKg);
            const medicalHistory = String(payload.medicalHistory || '');
            const allergies = String(payload.allergies || '');
            const isComplete = Boolean(birthDate && gender && Number.isFinite(heightCm) && Number.isFinite(weightKg));

            const { data, error } = await supabase
                .from('health_profiles')
                .upsert({
                    user_id: userId,
                    birth_date: birthDate,
                    gender,
                    height_cm: Number.isFinite(heightCm) ? heightCm : null,
                    weight_kg: Number.isFinite(weightKg) ? weightKg : null,
                    medical_history: medicalHistory,
                    allergies,
                    is_complete: isComplete,
                }, { onConflict: 'user_id' })
                .select('id, user_id, updated_at')
                .single();

            if (error) {
                return { success: false, message: '更新健康档案失败', error: error.message };
            }

            return {
                success: true,
                message: '已更新健康档案。',
                data: data as Record<string, unknown>,
            };
        }

        case 'medication_plan.apply_change_set': {
            const changeSetId = String(payload.changeSetId || payload.change_set_id || '').trim();
            if (!changeSetId) {
                return { success: false, message: '缺少变更集 ID', error: 'missing_change_set_id' };
            }

            const { data, error } = await supabase
                .rpc('apply_medication_plan_change_set', {
                    p_change_set_id: changeSetId,
                    p_user_id: userId,
                });

            if (error) {
                return { success: false, message: '执行计划变更集失败', error: error.message };
            }

            const resultData = {
                changeSetId,
                ...(data && typeof data === 'object' ? data as Record<string, unknown> : {}),
                invalidatedResources: ['medication_schedule', 'home_summary', 'agent_context'],
            };

            return {
                success: true,
                message: buildMedicationPlanSuccessMessage(resultData, changeSetId),
                data: resultData,
            };
        }

        case 'medication_plan.create': {
            const medicationName = String(payload.medicationName || '').trim();
            if (!medicationName) {
                return { success: false, message: '缺少药物名称', error: 'missing_medication_name' };
            }

            const scheduleId = crypto.randomUUID();
            const dosage = String(payload.medicationDosage || '');
            const frequency = String(payload.frequency || 'onceDaily');
            const reminders = toReminderArray(payload.reminderTimes, dosage, scheduleId);
            const row = {
                id: scheduleId,
                user_id: userId,
                medication_name: medicationName,
                medication_dosage: dosage || null,
                instructions: String(payload.instructions || '') || null,
                frequency,
                reminders,
                status: 'active',
                start_date: normalizeDate(String(payload.startDate || '')),
                end_date: String(payload.endDate || '') || null,
                source_record_id: String(payload.sourceRecordId || '') || null,
            };

            const { data, error } = await supabase
                .from('medication_schedules')
                .insert(row)
                .select('id, medication_name, start_date, status')
                .single();

            if (error) {
                return { success: false, message: '创建用药计划失败', error: error.message };
            }

            return {
                success: true,
                message: `已新增 ${medicationName} 的用药计划。`,
                data: data as Record<string, unknown>,
            };
        }

        case 'medication_plan.pause': {
            const scheduleId = String(payload.scheduleId || '').trim();
            if (!scheduleId) {
                return { success: false, message: '缺少计划 ID', error: 'missing_schedule_id' };
            }

            const { data, error } = await supabase
                .from('medication_schedules')
                .update({ status: 'paused' })
                .eq('id', scheduleId)
                .eq('user_id', userId)
                .select('id, medication_name, status')
                .single();

            if (error) {
                return { success: false, message: '暂停用药计划失败', error: error.message };
            }

            return {
                success: true,
                message: `已暂停 ${String(data?.medication_name || '该药物')} 的用药计划。`,
                data: data as Record<string, unknown>,
            };
        }

        case 'settings.update': {
            const updatePayload: Record<string, unknown> = {
                id: userId,
            };
            if (typeof payload.language === 'string' && payload.language.trim()) {
                updatePayload.language = payload.language.trim();
            }
            if (typeof payload.agentStyle === 'string' && payload.agentStyle.trim()) {
                updatePayload.agent_style = payload.agentStyle.trim();
            }

            const { data, error } = await supabase
                .from('user_profiles')
                .upsert(updatePayload, { onConflict: 'id' })
                .select('id, language, agent_style')
                .single();

            if (error) {
                return { success: false, message: '更新设置失败', error: error.message };
            }

            return {
                success: true,
                message: '已更新个人设置。',
                data: data as Record<string, unknown>,
            };
        }

        default:
            return {
                success: false,
                message: `暂不支持执行命令 ${request.command_name}`,
                error: 'unsupported_command',
            };
    }
}

serve(async (req) => {
    const respond = (status: number, payload: Record<string, unknown>) => new Response(
        JSON.stringify(payload),
        {
            status,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
            },
        }
    );

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return respond(405, { success: false, error: 'Method not allowed' });
    }

    try {
        const supabase = getSupabaseClient();
        if (!supabase) {
            return respond(500, { success: false, error: '服务配置错误' });
        }

        const body = await req.json() as AgentCommandRequest;
        if (!body.requestId || !body.action) {
            return respond(400, { success: false, error: '缺少请求参数' });
        }

        const userId = await getAuthenticatedUserId(supabase, getBearerToken(req));
        if (!userId) {
            return respond(401, { success: false, error: '未授权访问' });
        }

        const { data: row, error: requestError } = await supabase
            .from('agent_action_requests')
            .select('id, user_id, conversation_id, command_name, thinking_mode, confirmation_state, request_status, priority, title, summary, payload, context_snapshot, requires_confirmation, failure_reason, result')
            .eq('id', body.requestId)
            .eq('user_id', userId)
            .maybeSingle();

        if (requestError) {
            return respond(500, { success: false, error: requestError.message });
        }

        if (!row) {
            return respond(404, { success: false, error: '未找到该待执行动作' });
        }

        const requestRow = row as AgentActionRequestRow;

        if (body.action === 'get') {
            return respond(200, {
                success: true,
                requestId: requestRow.id,
                status: requestRow.request_status,
                confirmationState: requestRow.confirmation_state,
                pendingAction: buildPendingAction(requestRow),
            });
        }

        if (body.action === 'cancel') {
            const changeSetId = String(requestRow.payload?.changeSetId || requestRow.payload?.change_set_id || '').trim();
            const { error: cancelError } = await supabase
                .from('agent_action_requests')
                .update({
                    request_status: 'cancelled',
                    confirmation_state: 'cancelled',
                    cancelled_at: new Date().toISOString(),
                    cancelled_by: userId,
                })
                .eq('id', requestRow.id)
                .eq('user_id', userId);

            if (cancelError) {
                return respond(500, { success: false, error: cancelError.message });
            }

            if (changeSetId) {
                await supabase
                    .from('medication_plan_change_sets')
                    .update({
                        change_status: 'cancelled',
                    })
                    .eq('id', changeSetId)
                    .eq('user_id', userId);
            }

            await appendActionLog({
                supabase,
                userId,
                requestId: requestRow.id,
                commandName: requestRow.command_name,
                actionStatus: 'cancelled',
                message: '用户取消了 Agent 操作。',
                executedBy: userId,
            });
            await updateAgentRuntimeState({
                supabase,
                userId,
                lifecycleStatus: 'ready',
            });

            return respond(200, {
                success: true,
                requestId: requestRow.id,
                status: 'cancelled',
                confirmationState: 'cancelled',
                message: '已取消该操作。',
            });
        }

        const normalizedEditedPlan = body.editedPlan
            ? normalizeEditableMedicationPlan(body.editedPlan)
            : null;
        if (body.editedPlan && !normalizedEditedPlan) {
            return respond(400, { success: false, error: '编辑后的用药计划无效' });
        }

        if (requestRow.request_status === 'succeeded') {
            return respond(200, {
                success: true,
                requestId: requestRow.id,
                status: requestRow.request_status,
                confirmationState: requestRow.confirmation_state,
                message: String(requestRow.result?.message || '该操作已执行完成。'),
                data: requestRow.result || {},
            });
        }

        if (normalizedEditedPlan && requestRow.command_name === 'medication_plan.apply_change_set') {
            const editResult = await applyEditedMedicationPlan({
                supabase,
                userId,
                request: requestRow,
                editedPlan: normalizedEditedPlan,
            });

            if (!editResult.ok) {
                return respond(400, {
                    success: false,
                    requestId: requestRow.id,
                    error: editResult.error || '更新编辑后的用药计划失败',
                });
            }
        }

        await supabase
            .from('agent_action_requests')
            .update({
                confirmation_state: 'confirmed',
                request_status: 'running',
                confirmed_at: new Date().toISOString(),
                confirmed_by: userId,
                approved_at: new Date().toISOString(),
                approved_by: userId,
                executed_at: new Date().toISOString(),
            })
            .eq('id', requestRow.id)
            .eq('user_id', userId);

        await appendActionLog({
            supabase,
            userId,
            requestId: requestRow.id,
            commandName: requestRow.command_name,
            actionStatus: 'started',
            message: '用户已确认，开始执行 Agent 操作。',
            executedBy: userId,
        });
        await updateAgentRuntimeState({
            supabase,
            userId,
            lifecycleStatus: 'acting',
        });

        const result = await executeCommand({
            supabase,
            userId,
            request: requestRow,
        });

        const nextStatus: AgentActionStatus = result.success ? 'succeeded' : 'failed';
        const nextConfirmationState: AgentConfirmationState = result.success ? 'confirmed' : 'rejected';

        await supabase
            .from('agent_action_requests')
            .update({
                request_status: nextStatus,
                confirmation_state: nextConfirmationState,
                completed_at: new Date().toISOString(),
                failure_reason: result.error || null,
                result: {
                    message: result.message,
                    data: result.data || {},
                    error: result.error || null,
                },
            })
            .eq('id', requestRow.id)
            .eq('user_id', userId);

        await appendActionLog({
            supabase,
            userId,
            requestId: requestRow.id,
            commandName: requestRow.command_name,
            actionStatus: nextStatus,
            message: result.message,
            detail: result.data || {},
            executedBy: userId,
        });
        await updateAgentRuntimeState({
            supabase,
            userId,
            lifecycleStatus: result.success ? 'ready' : 'error',
            lastError: result.error || null,
        });

        return respond(result.success ? 200 : 500, {
            success: result.success,
            requestId: requestRow.id,
            status: nextStatus,
            confirmationState: nextConfirmationState,
            message: result.message,
            data: result.data || {},
            error: result.error,
        });
    } catch (error) {
        return respond(500, {
            success: false,
            error: error instanceof Error ? error.message : '命令执行失败',
        });
    }
});
