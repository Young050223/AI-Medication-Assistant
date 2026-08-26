import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { useAuth } from './useAuth';

export type AgentStyle = 'friendly' | 'efficient';

export const DEFAULT_AGENT_STYLE: AgentStyle = 'efficient';

const STORAGE_KEY_PREFIX = 'agent_style';

function isAgentStyle(value: unknown): value is AgentStyle {
    return value === 'friendly' || value === 'efficient';
}

function normalizeAgentStyle(value: unknown): AgentStyle {
    return isAgentStyle(value) ? value : DEFAULT_AGENT_STYLE;
}

function isMissingColumnError(error: { message?: string } | null | undefined, column: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('column') && message.includes(column.toLowerCase()) && message.includes('does not exist');
}

export function useAgentPreferences(): {
    agentStyle: AgentStyle;
    isLoading: boolean;
    isSaving: boolean;
    error: string | null;
    saveAgentStyle: (style: AgentStyle) => Promise<boolean>;
} {
    const { user } = useAuth();
    const storageKey = useMemo(
        () => `${STORAGE_KEY_PREFIX}_${user?.id || 'guest'}`,
        [user?.id]
    );

    const [agentStyle, setAgentStyle] = useState<AgentStyle>(() => {
        try {
            return normalizeAgentStyle(localStorage.getItem(storageKey));
        } catch {
            return DEFAULT_AGENT_STYLE;
        }
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        try {
            setAgentStyle(normalizeAgentStyle(localStorage.getItem(storageKey)));
        } catch {
            setAgentStyle(DEFAULT_AGENT_STYLE);
        }
    }, [storageKey]);

    useEffect(() => {
        let isCancelled = false;

        const loadPreference = async () => {
            setIsLoading(true);
            setError(null);

            let localStyle = DEFAULT_AGENT_STYLE;
            try {
                localStyle = normalizeAgentStyle(localStorage.getItem(storageKey));
                if (!isCancelled) {
                    setAgentStyle(localStyle);
                }
            } catch {
                if (!isCancelled) {
                    setAgentStyle(DEFAULT_AGENT_STYLE);
                }
            }

            if (!user?.id || !isSupabaseConfigured()) {
                if (!isCancelled) setIsLoading(false);
                return;
            }

            const { data, error: queryError } = await supabase
                .from('user_profiles')
                .select('agent_style')
                .eq('id', user.id)
                .maybeSingle();

            if (isCancelled) return;

            if (queryError) {
                if (!isMissingColumnError(queryError, 'agent_style')) {
                    console.warn('[useAgentPreferences] load agent_style failed:', queryError.message);
                }
                setIsLoading(false);
                return;
            }

            const nextStyle = normalizeAgentStyle(data?.agent_style);
            setAgentStyle(nextStyle);
            try {
                localStorage.setItem(storageKey, nextStyle);
            } catch {
                // ignore local storage sync error
            }
            setIsLoading(false);
        };

        void loadPreference();

        return () => {
            isCancelled = true;
        };
    }, [storageKey, user?.id]);

    const saveAgentStyle = useCallback(async (style: AgentStyle): Promise<boolean> => {
        const nextStyle = normalizeAgentStyle(style);
        setAgentStyle(nextStyle);
        setError(null);
        try {
            localStorage.setItem(storageKey, nextStyle);
        } catch {
            // ignore local storage sync error
        }

        if (!user?.id || !isSupabaseConfigured()) {
            return true;
        }

        setIsSaving(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                setError('请先登录后保存助手风格');
                return false;
            }

            const { error: saveError } = await supabase
                .from('user_profiles')
                .upsert(
                    {
                        id: user.id,
                        agent_style: nextStyle,
                    },
                    { onConflict: 'id' }
                );

            if (saveError) {
                if (!isMissingColumnError(saveError, 'agent_style')) {
                    console.warn('[useAgentPreferences] save agent_style failed:', saveError.message);
                    setError('保存助手风格失败');
                    return false;
                }
                return false;
            }

            return true;
        } catch (err) {
            console.warn('[useAgentPreferences] save agent_style error:', err);
            setError('保存助手风格失败');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [storageKey, user?.id]);

    return {
        agentStyle,
        isLoading,
        isSaving,
        error,
        saveAgentStyle,
    };
}

export default useAgentPreferences;
