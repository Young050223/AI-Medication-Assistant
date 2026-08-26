export type AgentRolloutStage =
    | 'off'
    | 'cloud_storage'
    | 'suggestions'
    | 'personalized';

const STAGE_ORDER: Record<AgentRolloutStage, number> = {
    off: 0,
    cloud_storage: 1,
    suggestions: 2,
    personalized: 3,
};

function normalizeBoolean(raw: string | undefined, defaultValue: boolean): boolean {
    if (!raw || raw.trim() === '') return defaultValue;
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizeStage(raw: string | undefined, fallback: AgentRolloutStage): AgentRolloutStage {
    if (!raw || raw.trim() === '') return fallback;
    const normalized = raw.trim().toLowerCase().replace(/[-\s]/g, '_');

    if (normalized === 'off' || normalized === '0' || normalized === 'disabled') return 'off';
    if (normalized === 'cloud' || normalized === 'cloud_storage' || normalized === '1') return 'cloud_storage';
    if (normalized === 'suggestion' || normalized === 'suggestions' || normalized === '2') return 'suggestions';
    if (
        normalized === 'personalized'
        || normalized === 'full'
        || normalized === 'full_personalized'
        || normalized === '3'
    ) return 'personalized';
    return fallback;
}

export function isFeatureEnabled(envKey: string, defaultValue: boolean = true): boolean {
    return normalizeBoolean(Deno.env.get(envKey), defaultValue);
}

export function getAgentRolloutStage(defaultStage: AgentRolloutStage = 'personalized'): AgentRolloutStage {
    return normalizeStage(Deno.env.get('AGENT_ROLLOUT_STAGE'), defaultStage);
}

export function isAgentStageAtLeast(
    required: AgentRolloutStage,
    current: AgentRolloutStage = getAgentRolloutStage()
): boolean {
    return STAGE_ORDER[current] >= STAGE_ORDER[required];
}

export function isAgentSuggestionsEnabled(): boolean {
    const stage = getAgentRolloutStage();
    const stageAllows = isAgentStageAtLeast('suggestions', stage);
    return isFeatureEnabled('FEATURE_AGENT_SUGGESTIONS_ENABLED', stageAllows);
}

export function isAgentPersonalizationEnabled(): boolean {
    const stage = getAgentRolloutStage();
    const stageAllows = isAgentStageAtLeast('personalized', stage);
    return isFeatureEnabled('FEATURE_AGENT_PERSONALIZED_CONTEXT_ENABLED', stageAllows);
}
