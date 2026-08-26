import type { AgentCommandName, AgentActionPriority, AgentThinkingMode } from './types.ts';

const ALWAYS_CONFIRM_COMMANDS = new Set<AgentCommandName>([
    'medication_plan.apply_change_set',
    'medication_plan.create',
    'medication_plan.update',
    'medication_plan.pause',
    'medication_plan.archive',
    'medication_log.confirm',
    'medication_log.miss',
    'medication_feedback.create',
    'medical_record.save',
    'medical_record.link',
    'health_profile.update',
    'settings.update',
]);

const READ_ONLY_COMMANDS = new Set<AgentCommandName>([
    'medication_log.query',
    'medication_feedback.query',
    'medication_feedback.summarize',
    'medical_record.extract',
    'health_profile.read',
    'health_profile.project',
    'settings.read',
    'me.read',
]);

export function isReadOnlyCommand(commandName: AgentCommandName): boolean {
    return READ_ONLY_COMMANDS.has(commandName);
}

export function requiresActionConfirmation(commandName: AgentCommandName): boolean {
    return ALWAYS_CONFIRM_COMMANDS.has(commandName);
}

export function inferThinkingModeForCommand(commandName: AgentCommandName): AgentThinkingMode {
    return isReadOnlyCommand(commandName) ? 'fast' : 'slow';
}

export function inferActionPriority(commandName: AgentCommandName): AgentActionPriority {
    if (
        commandName === 'medication_plan.apply_change_set' ||
        commandName === 'medication_plan.archive' ||
        commandName === 'medical_record.link' ||
        commandName === 'health_profile.update'
    ) {
        return 'high';
    }

    if (isReadOnlyCommand(commandName)) {
        return 'low';
    }

    return 'normal';
}

export function normalizeActionSummary(summary: string | null | undefined): string {
    const value = String(summary || '').trim();
    return value.length > 0 ? value : '';
}
