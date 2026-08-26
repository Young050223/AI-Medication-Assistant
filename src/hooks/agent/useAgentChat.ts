/**
 * @file useAgentChat.ts
 * @description AI Agent 多轮对话 Hook
 *
 * 🏛️ 架构师: 该 Hook 封装所有对话状态与 API 交互，
 *   AgentChatPage 只需关心 UI 展示。
 *
 * 🔧 工程师: 使用 agentApi.chatWithAgent 调用 Edge Function，
 *   对话历史由后端管理，前端仅维持当前会话消息列表。
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { chatWithAgent, fetchConversationMessages } from '../../services/agentApi';
import {
    cancelAgentActionRequest,
    confirmAgentActionRequest,
    type AgentEditableMedicationPlan,
    type AgentPendingAction,
} from '../../services/agentCommandApi';
import { MEDICATION_SCHEDULES_INVALIDATED_EVENT, useMedicationSchedule } from '../medication/useMedicationSchedule';
import { useAuth } from '../user/useAuth';
import { useAgentPreferences } from '../user/useAgentPreferences';
import { normalizeDateKey } from '../../utils/dateKey';

// =============================================
// 类型
// =============================================

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    contextUsed?: string[];
    thoughtMode?: 'fast' | 'slow';
    reasoningSummary?: string;
    thinkingReasonCodes?: string[];
    isError?: boolean;
}

interface PersistedChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    contextUsed?: string[];
    thoughtMode?: 'fast' | 'slow';
    reasoningSummary?: string;
    thinkingReasonCodes?: string[];
    isError?: boolean;
}

interface PersistedChatState {
    conversationId: string | null;
    messages: PersistedChatMessage[];
    pendingAction: AgentPendingAction | null;
    updatedAt: string;
}

export interface UseAgentChatReturn {
    messages: ChatMessage[];
    conversationId: string | null;
    pendingAction: AgentPendingAction | null;
    isTyping: boolean;
    isLoadingConversation: boolean;
    isConfirmingAction: boolean;
    error: string | null;
    sendMessage: (text: string) => Promise<void>;
    sendPreset: (text: string) => void;
    newConversation: () => void;
    loadConversation: (id: string) => Promise<boolean>;
    confirmPendingAction: (editedPlan?: AgentEditableMedicationPlan) => Promise<boolean>;
    cancelPendingAction: () => Promise<boolean>;
}

const CHAT_CACHE_KEY_PREFIX = 'agent_chat_state';
const CHAT_CACHE_MAX_MESSAGES = 120;

function toPersistedMessage(message: ChatMessage): PersistedChatMessage {
    return {
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp.toISOString(),
        contextUsed: message.contextUsed || [],
        thoughtMode: message.thoughtMode,
        reasoningSummary: message.reasoningSummary,
        thinkingReasonCodes: message.thinkingReasonCodes || [],
        isError: !!message.isError,
    };
}

function fromPersistedMessage(message: PersistedChatMessage): ChatMessage | null {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) return null;
    if (!message.id || !message.content) return null;

    const parsedDate = new Date(message.timestamp);
    return {
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
        contextUsed: Array.isArray(message.contextUsed) ? message.contextUsed : [],
        thoughtMode: message.thoughtMode === 'slow' ? 'slow' : message.thoughtMode === 'fast' ? 'fast' : undefined,
        reasoningSummary: typeof message.reasoningSummary === 'string' ? message.reasoningSummary : undefined,
        thinkingReasonCodes: Array.isArray(message.thinkingReasonCodes) ? message.thinkingReasonCodes : [],
        isError: !!message.isError,
    };
}

// =============================================
// Hook 实现
// =============================================

export function useAgentChat(): UseAgentChatReturn {
    const { user } = useAuth();
    const { agentStyle } = useAgentPreferences();
    const cacheKey = useMemo(
        () => (user?.id ? `${CHAT_CACHE_KEY_PREFIX}_${user.id}` : null),
        [user?.id]
    );

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<AgentPendingAction | null>(null);
    const [isTyping, setIsTyping] = useState(false);
    const [isLoadingConversation, setIsLoadingConversation] = useState(false);
    const [isConfirmingAction, setIsConfirmingAction] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isHydrated, setIsHydrated] = useState(false);
    const { schedules } = useMedicationSchedule();

    // 获取当前用药列表
    const medicationNames = useRef<string[]>([]);
    useEffect(() => {
        const currentDateKey = normalizeDateKey(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
        medicationNames.current = schedules
            .filter((schedule) => {
                if (!schedule.isActive) return false;
                const startDate = normalizeDateKey(schedule.startDate) || schedule.startDate.split('T')[0];
                const endDate = schedule.endDate
                    ? (normalizeDateKey(schedule.endDate) || schedule.endDate.split('T')[0])
                    : null;
                return startDate <= currentDateKey && (!endDate || endDate >= currentDateKey);
            })
            .map(s => s.medicationName);
    }, [schedules]);

    useEffect(() => {
        setIsHydrated(false);
        setMessages([]);
        setConversationId(null);
        setPendingAction(null);
        setError(null);
        setIsTyping(false);
        setIsConfirmingAction(false);

        if (!cacheKey) {
            setIsHydrated(true);
            return;
        }

        try {
            const raw = localStorage.getItem(cacheKey);
            if (!raw) {
                setIsHydrated(true);
                return;
            }

            const parsed = JSON.parse(raw) as PersistedChatState;
            const safeMessages = Array.isArray(parsed?.messages)
                ? parsed.messages
                    .map((item) => fromPersistedMessage(item))
                    .filter((item): item is ChatMessage => !!item)
                : [];

            setMessages(safeMessages);
            setConversationId(
                typeof parsed?.conversationId === 'string' && parsed.conversationId.trim()
                    ? parsed.conversationId
                    : null
            );
            setPendingAction(parsed?.pendingAction || null);
        } catch (cacheError) {
            console.warn('[useAgentChat] restore cached conversation failed:', cacheError);
        } finally {
            setIsHydrated(true);
        }
    }, [cacheKey]);

    useEffect(() => {
        if (!isHydrated || !cacheKey) return;

        const payload: PersistedChatState = {
            conversationId,
            messages: messages
                .slice(-CHAT_CACHE_MAX_MESSAGES)
                .map((message) => toPersistedMessage(message)),
            pendingAction,
            updatedAt: new Date().toISOString(),
        };
        localStorage.setItem(cacheKey, JSON.stringify(payload));
    }, [cacheKey, conversationId, messages, pendingAction, isHydrated]);

    /**
     * 发送消息并获取 AI 回复
     */
    const sendMessage = useCallback(async (text: string) => {
        if (!text.trim() || isTyping) return;

        setError(null);

        // 1. 立即添加用户消息到 UI
        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: text.trim(),
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMsg]);
        setPendingAction(null);
        setIsTyping(true);

        try {
            // 2. 调用 Edge Function
            const response = await chatWithAgent({
                conversationId: conversationId || undefined,
                message: text.trim(),
                medications: medicationNames.current,
                agentStyle,
            });

            if (!response.success) {
                throw new Error(response.error || 'AI 回复失败');
            }

            // 3. 更新 conversationId（首条消息时）
            if (!conversationId && response.conversationId && response.conversationId !== 'local') {
                setConversationId(response.conversationId);
            }

            // 4. 添加 AI 回复到 UI。待确认弹窗流程允许后端返回空回复，此时只展示弹窗。
            const assistantReply = String(response.reply || '').trim();
            if (assistantReply) {
                const aiMsg: ChatMessage = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: assistantReply,
                    timestamp: new Date(),
                    contextUsed: response.contextUsed?.sourceTags || [],
                    thoughtMode: response.thoughtMode,
                    reasoningSummary: response.thinkingPolicy?.reasoningSummary,
                    thinkingReasonCodes: response.thinkingPolicy?.reasonCodes || [],
                };
                setMessages(prev => [...prev, aiMsg]);
            }
            setPendingAction(response.pendingAction || null);

        } catch (err) {
            const errMsg = err instanceof Error ? err.message : '网络错误，请稍后重试';
            setError(errMsg);

            // 添加错误消息到 UI
            const errorMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `⚠️ ${errMsg}`,
                timestamp: new Date(),
                isError: true,
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsTyping(false);
        }
    }, [agentStyle, conversationId, isTyping]);

    /**
     * 发送预设问题（快捷方式）
     */
    const sendPreset = useCallback((text: string) => {
        sendMessage(text);
    }, [sendMessage]);

    /**
     * 开始新对话
     */
    const newConversation = useCallback(() => {
        setMessages([]);
        setConversationId(null);
        setPendingAction(null);
        setError(null);
        setIsTyping(false);
    }, []);

    /**
     * 加载历史会话消息
     */
    const loadConversation = useCallback(async (id: string): Promise<boolean> => {
        if (!id) return false;
        setIsLoadingConversation(true);
        setError(null);

        try {
            const result = await fetchConversationMessages(id);
            if (!result.success) {
                setError(result.error || '加载历史消息失败');
                return false;
            }

            const mapped: ChatMessage[] = (result.messages || [])
                .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
                .map(msg => ({
                    id: msg.id,
                    role: msg.role as 'user' | 'assistant',
                    content: msg.content,
                    timestamp: new Date(msg.createdAt),
                    contextUsed: msg.contextUsed?.sourceTags || [],
                    thoughtMode: msg.thoughtMode,
                    reasoningSummary: msg.thinkingPolicy?.reasoningSummary,
                    thinkingReasonCodes: msg.thinkingPolicy?.reasonCodes || [],
                }));

            setMessages(mapped);
            setConversationId(id);
            setPendingAction(null);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : '加载历史消息失败');
            return false;
        } finally {
            setIsLoadingConversation(false);
        }
    }, []);

    const confirmPendingAction = useCallback(async (editedPlan?: AgentEditableMedicationPlan): Promise<boolean> => {
        if (!pendingAction?.requestId || isConfirmingAction) return false;

        setIsConfirmingAction(true);
        setError(null);
        try {
            const result = await confirmAgentActionRequest(pendingAction.requestId, editedPlan);
            if (!result.success) {
                throw new Error(result.error || '确认执行失败');
            }

            setPendingAction(result.pendingAction || null);
            window.dispatchEvent(new Event(MEDICATION_SCHEDULES_INVALIDATED_EVENT));
            setMessages((prev) => [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: result.message || '已完成该操作。',
                timestamp: new Date(),
            }]);
            return true;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : '确认执行失败';
            setError(errMsg);
            setMessages((prev) => [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `⚠️ ${errMsg}`,
                timestamp: new Date(),
                isError: true,
            }]);
            return false;
        } finally {
            setIsConfirmingAction(false);
        }
    }, [isConfirmingAction, pendingAction]);

    const cancelPendingAction = useCallback(async (): Promise<boolean> => {
        if (!pendingAction?.requestId || isConfirmingAction) return false;

        setIsConfirmingAction(true);
        setError(null);
        try {
            const result = await cancelAgentActionRequest(pendingAction.requestId);
            if (!result.success) {
                throw new Error(result.error || '取消失败');
            }

            setPendingAction(null);
            setMessages((prev) => [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: result.message || '已取消该操作。',
                timestamp: new Date(),
            }]);
            return true;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : '取消失败';
            setError(errMsg);
            setMessages((prev) => [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `⚠️ ${errMsg}`,
                timestamp: new Date(),
                isError: true,
            }]);
            return false;
        } finally {
            setIsConfirmingAction(false);
        }
    }, [isConfirmingAction, pendingAction]);

    return {
        messages,
        conversationId,
        pendingAction,
        isTyping,
        isLoadingConversation,
        isConfirmingAction,
        error,
        sendMessage,
        sendPreset,
        newConversation,
        loadConversation,
        confirmPendingAction,
        cancelPendingAction,
    };
}

export default useAgentChat;
