import { supabase } from './supabase';

export type AgentActionRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AgentActionStatus = 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
export type AgentConfirmationState = 'pending' | 'required' | 'confirmed' | 'rejected' | 'cancelled' | 'skipped';
export type MedicationPlanOperationKind = 'create' | 'update' | 'pause' | 'archive' | 'keep';
export type AgentCommandName =
    | 'medication_plan.apply_change_set'
    | 'medication_plan.create'
    | 'medication_plan.update'
    | 'medication_plan.pause'
    | 'medication_plan.archive'
    | 'medication_log.confirm'
    | 'medication_log.miss'
    | 'medication_log.query'
    | 'medication_feedback.create'
    | 'medication_feedback.query'
    | 'medication_feedback.summarize'
    | 'medical_record.save'
    | 'medical_record.extract'
    | 'medical_record.link'
    | 'health_profile.read'
    | 'health_profile.update'
    | 'health_profile.project'
    | 'settings.read'
    | 'settings.update'
    | 'me.read';

export interface AgentPreviewSection {
    title: string;
    items: string[];
}

export interface AgentEditableMedicationPlanOperation {
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

export interface AgentEditableMedicationPlan {
    effectiveDate?: string;
    operations: AgentEditableMedicationPlanOperation[];
}

export interface AgentPendingAction {
    requestId: string;
    changeSetId?: string;
    commandName: AgentCommandName;
    status: AgentActionStatus;
    confirmationState: AgentConfirmationState;
    title: string;
    summary: string;
    impactDescription: string;
    impactPoints: string[];
    previewSections?: AgentPreviewSection[];
    riskLevel: AgentActionRiskLevel;
    confirmHint?: string;
    editablePlan?: AgentEditableMedicationPlan;
}

export interface AgentCommandExecutionResponse {
    success: boolean;
    requestId: string;
    status?: AgentActionStatus;
    confirmationState?: AgentConfirmationState;
    message?: string;
    data?: Record<string, unknown>;
    pendingAction?: AgentPendingAction;
    error?: string;
}

function getEdgeFunctionUrl(functionName: string): string {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://nvxjvbkynxuzigxzaevq.supabase.co';
    return `${supabaseUrl}/functions/v1/${functionName}`;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
    };

    if (session?.access_token) {
        headers['x-user-jwt'] = session.access_token;
    }

    return headers;
}

async function postAgentCommand(body: Record<string, unknown>): Promise<AgentCommandExecutionResponse> {
    try {
        const url = getEdgeFunctionUrl('agent-command');
        const headers = await getAuthHeaders();

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                requestId: String(body.requestId || ''),
                error: data.error || `请求失败: ${response.status}`,
            };
        }

        return data as AgentCommandExecutionResponse;
    } catch (error) {
        return {
            success: false,
            requestId: String(body.requestId || ''),
            error: error instanceof Error ? error.message : '网络请求失败',
        };
    }
}

export async function confirmAgentActionRequest(
    requestId: string,
    editedPlan?: AgentEditableMedicationPlan
): Promise<AgentCommandExecutionResponse> {
    return postAgentCommand({
        action: 'confirm',
        requestId,
        ...(editedPlan ? { editedPlan } : {}),
    });
}

export async function cancelAgentActionRequest(
    requestId: string
): Promise<AgentCommandExecutionResponse> {
    return postAgentCommand({
        action: 'cancel',
        requestId,
    });
}

export async function getAgentActionRequest(
    requestId: string
): Promise<AgentCommandExecutionResponse> {
    return postAgentCommand({
        action: 'get',
        requestId,
    });
}

export default {
    confirmAgentActionRequest,
    cancelAgentActionRequest,
    getAgentActionRequest,
};
