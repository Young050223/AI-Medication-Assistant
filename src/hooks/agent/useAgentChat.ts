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

import { useState, useCallback, useRef, useEffect } from 'react';
import { chatWithAgent, fetchConversationMessages } from '../../services/agentApi';
import { useMedicationSchedule } from '../medication/useMedicationSchedule';
import { useAuth } from '../user/useAuth';

// =============================================
// 类型
// =============================================

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isError?: boolean;
}

export interface UseAgentChatReturn {
    messages: ChatMessage[];
    conversationId: string | null;
    isTyping: boolean;
    isLoadingConversation: boolean;
    error: string | null;
    sendMessage: (text: string) => Promise<void>;
    sendPreset: (text: string) => void;
    newConversation: () => void;
    loadConversation: (id: string) => Promise<boolean>;
}

// =============================================
// Hook 实现
// =============================================

export function useAgentChat(): UseAgentChatReturn {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [isTyping, setIsTyping] = useState(false);
    const [isLoadingConversation, setIsLoadingConversation] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { schedules } = useMedicationSchedule();
    const { user } = useAuth();

    // 获取当前用药列表
    const medicationNames = useRef<string[]>([]);
    useEffect(() => {
        medicationNames.current = schedules
            .filter(s => s.isActive)
            .map(s => s.medicationName);
    }, [schedules]);

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
        setIsTyping(true);

        try {
            // 2. 调用 Edge Function
            const response = await chatWithAgent({
                conversationId: conversationId || undefined,
                message: text.trim(),
                userId: user?.id,
                medications: medicationNames.current,
            });

            if (!response.success) {
                throw new Error(response.error || 'AI 回复失败');
            }

            // 3. 更新 conversationId（首条消息时）
            if (!conversationId && response.conversationId && response.conversationId !== 'local') {
                setConversationId(response.conversationId);
            }

            // 4. 添加 AI 回复到 UI
            const aiMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: response.reply,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, aiMsg]);

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
    }, [conversationId, isTyping, user?.id]);

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
                .filter((msg): msg is { id: string; role: 'user' | 'assistant'; content: string; createdAt: string } =>
                    msg.role === 'user' || msg.role === 'assistant'
                )
                .map(msg => ({
                    id: msg.id,
                    role: msg.role,
                    content: msg.content,
                    timestamp: new Date(msg.createdAt),
                }));

            setMessages(mapped);
            setConversationId(id);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : '加载历史消息失败');
            return false;
        } finally {
            setIsLoadingConversation(false);
        }
    }, []);

    return {
        messages,
        conversationId,
        isTyping,
        isLoadingConversation,
        error,
        sendMessage,
        sendPreset,
        newConversation,
        loadConversation,
    };
}

export default useAgentChat;
