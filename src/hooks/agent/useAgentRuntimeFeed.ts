import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ackAgentRuntimeEvent,
    fetchAgentRuntimeBootstrap,
    updateAgentRuntimeState,
    type AgentBackgroundTask,
    type AgentMemoryFact,
    type AgentRuntimeEvent,
    type AgentRuntimePendingAction,
    type AgentRuntimeState,
    type AgentThinkingPolicySummary,
} from '../../services/agentApi';
import { useAuth } from '../user/useAuth';

type RuntimeLanguage = 'zh-CN' | 'zh-TW' | 'en';

interface UseAgentRuntimeFeedOptions {
    enabled?: boolean;
    language?: RuntimeLanguage;
    pollMs?: number;
}

export interface UseAgentRuntimeFeedReturn {
    runtimeState: AgentRuntimeState | null;
    backgroundTasks: AgentBackgroundTask[];
    runtimeEvents: AgentRuntimeEvent[];
    memoryHighlights: AgentMemoryFact[];
    pendingActions: AgentRuntimePendingAction[];
    thinkingPolicy: AgentThinkingPolicySummary | null;
    isLoading: boolean;
    isSavingPreference: boolean;
    error: string | null;
    refresh: (preferCache?: boolean) => Promise<void>;
    acknowledgeEvent: (eventId: string) => Promise<boolean>;
    saveThinkingModePreference: (preference: 'auto' | 'fast' | 'slow') => Promise<boolean>;
}

export function useAgentRuntimeFeed(options: UseAgentRuntimeFeedOptions = {}): UseAgentRuntimeFeedReturn {
    const { user } = useAuth();
    const enabled = options.enabled !== false && !!user;
    const language = options.language || 'zh-CN';
    const pollMs = options.pollMs ?? 60_000;

    const [runtimeState, setRuntimeState] = useState<AgentRuntimeState | null>(null);
    const [backgroundTasks, setBackgroundTasks] = useState<AgentBackgroundTask[]>([]);
    const [runtimeEvents, setRuntimeEvents] = useState<AgentRuntimeEvent[]>([]);
    const [memoryHighlights, setMemoryHighlights] = useState<AgentMemoryFact[]>([]);
    const [pendingActions, setPendingActions] = useState<AgentRuntimePendingAction[]>([]);
    const [thinkingPolicy, setThinkingPolicy] = useState<AgentThinkingPolicySummary | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSavingPreference, setIsSavingPreference] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = useCallback(() => {
        setRuntimeState(null);
        setBackgroundTasks([]);
        setRuntimeEvents([]);
        setMemoryHighlights([]);
        setPendingActions([]);
        setThinkingPolicy(null);
        setError(null);
    }, []);

    const refresh = useCallback(async (preferCache: boolean = true) => {
        if (!enabled) {
            reset();
            return;
        }

        setIsLoading(true);
        setError(null);
        const result = await fetchAgentRuntimeBootstrap({
            language,
            preferCache,
        });
        setIsLoading(false);

        if (!result.success) {
            setError(result.error || 'Agent Runtime 加载失败');
            return;
        }

        setRuntimeState(result.runtimeState || null);
        setBackgroundTasks(result.backgroundTasks);
        setRuntimeEvents(result.runtimeEvents);
        setMemoryHighlights(result.memoryHighlights);
        setPendingActions(result.pendingActions);
        setThinkingPolicy(result.thinkingPolicy || null);
    }, [enabled, language, reset]);

    const acknowledgeEvent = useCallback(async (eventId: string): Promise<boolean> => {
        const result = await ackAgentRuntimeEvent(eventId);
        if (!result.success) {
            setError(result.error || '事件确认失败');
            return false;
        }
        setRuntimeEvents((prev) => prev.filter((event) => event.id !== eventId));
        void refresh(false);
        return true;
    }, [refresh]);

    const saveThinkingModePreference = useCallback(async (preference: 'auto' | 'fast' | 'slow'): Promise<boolean> => {
        setIsSavingPreference(true);
        const result = await updateAgentRuntimeState({ thinkingModePreference: preference });
        setIsSavingPreference(false);
        if (!result.success) {
            setError(result.error || '思考模式保存失败');
            return false;
        }
        await refresh(false);
        return true;
    }, [refresh]);

    useEffect(() => {
        void refresh(true);
    }, [refresh]);

    useEffect(() => {
        if (!enabled || pollMs <= 0) return;
        const timer = window.setInterval(() => {
            void refresh(false);
        }, pollMs);
        return () => window.clearInterval(timer);
    }, [enabled, pollMs, refresh]);

    return useMemo(() => ({
        runtimeState,
        backgroundTasks,
        runtimeEvents,
        memoryHighlights,
        pendingActions,
        thinkingPolicy,
        isLoading,
        isSavingPreference,
        error,
        refresh,
        acknowledgeEvent,
        saveThinkingModePreference,
    }), [
        runtimeState,
        backgroundTasks,
        runtimeEvents,
        memoryHighlights,
        pendingActions,
        thinkingPolicy,
        isLoading,
        isSavingPreference,
        error,
        refresh,
        acknowledgeEvent,
        saveThinkingModePreference,
    ]);
}

export default useAgentRuntimeFeed;
