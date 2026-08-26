export type AgentActionStatus =
    | 'pending'
    | 'ready'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'skipped';

export type AgentConfirmationState =
    | 'pending'
    | 'required'
    | 'confirmed'
    | 'rejected'
    | 'cancelled'
    | 'skipped';

export type AgentThinkingMode = 'fast' | 'slow';
export type AgentThinkingModePreference = 'auto' | 'fast' | 'slow';
export type AgentModelReasoningEffort = 'none' | 'minimal';

export type AgentLifecycleStatus =
    | 'idle'
    | 'warming'
    | 'ready'
    | 'thinking'
    | 'waiting_confirmation'
    | 'acting'
    | 'error';

export type AgentBackgroundTaskStatus =
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled';

export interface AgentThinkingPolicy {
    mode: AgentThinkingMode;
    preference: AgentThinkingModePreference;
    reasonCodes: string[];
    contextBudget: 'minimal' | 'full';
    shouldLoadPersonalContext: boolean;
    shouldPlanAction: boolean;
    modelReasoningEffort: AgentModelReasoningEffort;
    reasoningSummary: string;
}

export interface AgentRuntimeStateRecord {
    userId: string;
    lifecycleStatus: 'idle' | 'warming' | 'ready' | 'thinking' | 'waiting_confirmation' | 'acting' | 'error';
    thinkingModePreference: AgentThinkingModePreference;
    currentThinkingMode: AgentThinkingMode;
    lastContextSummary: string;
    lastContextTags: string[];
    lastTriggerSignals: string[];
    activeTaskCount: number;
    pendingActionCount: number;
    backgroundStatus: Record<string, unknown>;
    lastError?: string | null;
    lastBootstrappedAt?: string | null;
    lastInteractionAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AgentMemoryFactRecord {
    id: string;
    userId: string;
    memoryType: 'profile' | 'medication' | 'preference' | 'follow_up' | 'safety' | 'conversation';
    factStatus: 'active' | 'stale' | 'revoked';
    content: string;
    sourceTable?: string | null;
    sourceId?: string | null;
    confidence: number;
    expiresAt?: string | null;
    revokedAt?: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface AgentBackgroundTaskRecord {
    id: string;
    userId: string;
    conversationId?: string | null;
    taskType: string;
    taskStatus: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    priority: AgentActionPriority;
    title: string;
    summary: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    error?: string | null;
    scheduledAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    lockedAt?: string | null;
    attemptCount: number;
    maxAttempts: number;
    createdAt: string;
    updatedAt: string;
}

export interface AgentRuntimeEventRecord {
    id: string;
    userId: string;
    sourceTaskId?: string | null;
    sourceRequestId?: string | null;
    eventType: string;
    eventStatus: 'new' | 'seen' | 'acknowledged' | 'archived' | 'expired';
    severity: 'info' | 'success' | 'warning' | 'critical';
    title: string;
    body: string;
    payload: Record<string, unknown>;
    visibleAt: string;
    acknowledgedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

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

export type AgentActionPriority = 'low' | 'normal' | 'high' | 'critical';

export interface AgentPreviewSection {
    title: string;
    items: string[];
}

export interface AgentActionRequestPayload {
    conversationId?: string | null;
    commandName: AgentCommandName;
    thinkingMode: AgentThinkingMode;
    confirmationState: AgentConfirmationState;
    priority?: AgentActionPriority;
    title: string;
    summary?: string;
    payload?: Record<string, unknown>;
    contextSnapshot?: Record<string, unknown>;
    requiresConfirmation?: boolean;
}

export interface AgentActionResultPayload {
    success: boolean;
    message?: string;
    data?: Record<string, unknown>;
    error?: string;
}

export interface AgentActionRecord {
    id: string;
    userId: string;
    conversationId?: string | null;
    commandName: AgentCommandName;
    thinkingMode: AgentThinkingMode;
    confirmationState: AgentConfirmationState;
    requestStatus: AgentActionStatus;
    priority: AgentActionPriority;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
    contextSnapshot: Record<string, unknown>;
    requiresConfirmation: boolean;
    result: Record<string, unknown>;
    failureReason?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AgentActionLogRecord {
    id: string;
    userId: string;
    requestId: string;
    commandName: AgentCommandName;
    actionStatus: AgentActionStatus | 'started';
    message: string;
    detail: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface AgentContextAccessRecord {
    id: string;
    userId: string;
    requestId?: string | null;
    conversationId?: string | null;
    thinkingMode: AgentThinkingMode;
    accessScope: string;
    sourceTag: string;
    accessReason: string;
    accessedAt: string;
    createdAt: string;
    updatedAt: string;
}
