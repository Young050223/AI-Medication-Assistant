import type {
    AgentModelReasoningEffort,
    AgentThinkingMode,
    AgentThinkingModePreference,
    AgentThinkingPolicy,
} from './types.ts';

interface SelectAgentThinkingPolicyInput {
    message: string;
    preference?: AgentThinkingModePreference | string | null;
    forceSlowSignals?: string[];
    hasPendingAction?: boolean;
}

const PERSONAL_CONTEXT_SIGNALS = [
    '我', '我的', '帮我', '替我', '今天', '昨天', '最近', '档案', '病史', '过敏', '记录', '反馈',
    'my', 'for me', 'help me', 'my profile', 'my medication', 'recently',
];

const MEDICATION_WORKFLOW_SIGNALS = [
    '用药计划', '服药计划', '提醒', '漏服', '补服', '打卡', '新增', '修改', '更新', '暂停', '删除', '停掉',
    'schedule', 'reminder', 'missed dose', 'add medication', 'update', 'change', 'stop taking',
];

const SAFETY_SIGNALS = [
    '相互作用', '禁忌', '副作用', '不良反应', '过量', '怀孕', '肝', '肾', '急诊',
    'interaction', 'contraindication', 'side effect', 'adverse', 'overdose', 'pregnant', 'kidney', 'liver',
];

function normalizePreference(value: unknown): AgentThinkingModePreference {
    if (value === 'fast' || value === 'slow') return value;
    return 'auto';
}

function includesAny(content: string, signals: string[]): boolean {
    return signals.some((signal) => content.includes(signal.toLowerCase()));
}

function buildReasoningSummary(mode: AgentThinkingMode, reasonCodes: string[]): string {
    if (mode === 'slow') {
        if (reasonCodes.includes('preference_slow')) return '用户偏好慢思考，已加载完整个人上下文。';
        if (reasonCodes.includes('safety_signal')) return '问题涉及用药安全信号，已进入慢思考并扩大上下文。';
        if (reasonCodes.includes('workflow_signal')) return '问题可能影响用药计划或记录，已进入慢思考。';
        return '问题需要结合个人历史与上下文，已进入慢思考。';
    }

    if (reasonCodes.includes('preference_fast')) return '用户偏好快思考，本次仅使用最小必要上下文。';
    return '问题可用通用知识快速回答，本次仅使用最小必要上下文。';
}

export function selectAgentThinkingPolicy(input: SelectAgentThinkingPolicyInput): AgentThinkingPolicy {
    const content = String(input.message || '').trim().toLowerCase();
    const preference = normalizePreference(input.preference);
    const reasonCodes = new Set<string>();

    const forceSlowSignals = (input.forceSlowSignals || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    forceSlowSignals.forEach((signal) => reasonCodes.add(signal));

    const hasPersonalSignal = includesAny(content, PERSONAL_CONTEXT_SIGNALS);
    const hasWorkflowSignal = includesAny(content, MEDICATION_WORKFLOW_SIGNALS);
    const hasSafetySignal = includesAny(content, SAFETY_SIGNALS);

    if (preference === 'fast') reasonCodes.add('preference_fast');
    if (preference === 'slow') reasonCodes.add('preference_slow');
    if (hasPersonalSignal) reasonCodes.add('personal_context_signal');
    if (hasWorkflowSignal) reasonCodes.add('workflow_signal');
    if (hasSafetySignal) reasonCodes.add('safety_signal');
    if (input.hasPendingAction) reasonCodes.add('pending_action_context');

    const safetyOrWorkflowOverride = hasSafetySignal || hasWorkflowSignal || input.hasPendingAction || forceSlowSignals.length > 0;
    const shouldSlow =
        preference === 'slow'
        || safetyOrWorkflowOverride
        || (preference === 'auto' && hasPersonalSignal);

    const mode: AgentThinkingMode = preference === 'fast' && !safetyOrWorkflowOverride
        ? 'fast'
        : shouldSlow
            ? 'slow'
            : 'fast';

    const modelReasoningEffort: AgentModelReasoningEffort = mode === 'slow' ? 'minimal' : 'none';
    const finalReasonCodes = Array.from(reasonCodes);

    return {
        mode,
        preference,
        reasonCodes: finalReasonCodes,
        contextBudget: mode === 'slow' ? 'full' : 'minimal',
        shouldLoadPersonalContext: mode === 'slow',
        shouldPlanAction: mode === 'slow' && (hasWorkflowSignal || input.hasPendingAction || forceSlowSignals.length > 0),
        modelReasoningEffort,
        reasoningSummary: buildReasoningSummary(mode, finalReasonCodes),
    };
}

export function mapThinkingPolicyToOpenAIReasoningEffort(
    policy: Pick<AgentThinkingPolicy, 'modelReasoningEffort'>
): AgentModelReasoningEffort {
    return policy.modelReasoningEffort;
}
