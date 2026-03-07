/**
 * @file AgentChatPage.tsx
 * @description Agent 聊天页面 — Gemini 风格 AI 对话界面
 *
 * 🏛️ 架构师: 页面只负责 UI 渲染，所有状态和 API 交互由 useAgentChat Hook 管理
 * 🔧 工程师: 使用 SVG 图标替代所有 emoji，提升专业感
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMedicationSchedule } from '../hooks/medication/useMedicationSchedule';
import { useAgentChat } from '../hooks/agent/useAgentChat';
import { useConversationHistory } from '../hooks/agent/useConversationHistory';
import { IconSparkle, IconChat, IconNew, IconSend, IconTrash, IconClose, IconMenu } from '../components/Icons';
import './AgentChatPage.css';

interface AgentChatPageProps {
    onNavigateToUpload?: () => void;
}

export default function AgentChatPage(_props: AgentChatPageProps) {
    const { t, i18n } = useTranslation();
    const { schedules } = useMedicationSchedule();
    const {
        messages,
        conversationId,
        isTyping,
        isLoadingConversation,
        sendMessage,
        sendPreset,
        newConversation,
        loadConversation,
    } = useAgentChat();
    const {
        conversations,
        isLoading: isHistoryLoading,
        isLoadingMore: isHistoryLoadingMore,
        deletingId,
        error: historyError,
        hasMore,
        refresh,
        loadMore,
        deleteById,
    } = useConversationHistory();

    const [inputText, setInputText] = useState('');
    const [historyOpen, setHistoryOpen] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    const presetQuestions = schedules.length > 0
        ? [
            t('agent.preset.interaction', {
                drug: schedules[0]?.medicationName || t('schedule.medicationName', '药物'),
                defaultValue: `${schedules[0]?.medicationName || '药物'}有什么禁忌吗？`,
            }),
            t('agent.preset.sideEffects', '这些药物有什么副作用？'),
            t('agent.preset.foodInteraction', '服药期间有什么饮食注意事项？'),
        ]
        : [
            t('agent.preset.howToUse', '如何添加我的用药计划？'),
            t('agent.preset.scanHelp', '如何扫描病例？'),
        ];

    const conflictStatus: 'green' | 'yellow' | 'red' =
        schedules.length > 5 ? 'red' : schedules.length > 2 ? 'yellow' : 'green';

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    const handleSend = useCallback(() => {
        if (!inputText.trim() || isTyping) return;
        sendMessage(inputText.trim());
        setInputText('');
    }, [inputText, isTyping, sendMessage]);

    const handlePresetClick = useCallback((question: string) => {
        setInputText('');
        sendPreset(question);
    }, [sendPreset]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    const formatConversationTime = useCallback((dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString(i18n.language || 'zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }, [i18n.language]);

    const openHistoryDrawer = useCallback(() => {
        setHistoryOpen(true);
        void refresh();
    }, [refresh]);

    const closeHistoryDrawer = useCallback(() => {
        setHistoryOpen(false);
    }, []);

    const handleConversationSelect = useCallback(async (id: string) => {
        const loaded = await loadConversation(id);
        if (loaded) {
            closeHistoryDrawer();
        }
    }, [loadConversation, closeHistoryDrawer]);

    const handleDeleteConversation = useCallback(async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!window.confirm(t('agent.history.deleteConfirm', '确定删除这条对话吗？'))) {
            return;
        }

        const deleted = await deleteById(id);
        if (deleted && conversationId === id) {
            newConversation();
        }
    }, [deleteById, conversationId, newConversation, t]);

    return (
        <div className="agent-page">
            {historyOpen && <button type="button" className="history-backdrop" onClick={closeHistoryDrawer} aria-label="close history" />}

            <aside className={`history-drawer ${historyOpen ? 'open' : ''}`}>
                <div className="history-header">
                    <h3>{t('agent.history.title', '历史对话')}</h3>
                    <button type="button" className="history-close-btn" onClick={closeHistoryDrawer}>
                        <IconClose size={16} />
                    </button>
                </div>

                {historyError && <p className="history-error">{historyError}</p>}

                {isHistoryLoading ? (
                    <p className="history-loading">{t('app.loading')}</p>
                ) : conversations.length === 0 ? (
                    <p className="history-empty">{t('agent.history.empty', '暂无历史对话')}</p>
                ) : (
                    <div className="history-list">
                        {conversations.map((item) => (
                            <div
                                key={item.id}
                                className={`history-item ${conversationId === item.id ? 'active' : ''}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => handleConversationSelect(item.id)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        void handleConversationSelect(item.id);
                                    }
                                }}
                            >
                                <div className="history-item-main">
                                    <p className="history-item-title">{item.title || t('agent.history.untitled', '新对话')}</p>
                                    <p className="history-item-preview">
                                        {item.lastMessage || t('agent.history.noMessages', '暂无消息')}
                                    </p>
                                    <p className="history-item-time">{formatConversationTime(item.updatedAt)}</p>
                                </div>
                                <button
                                    className="history-delete-btn"
                                    type="button"
                                    aria-label="delete conversation"
                                    onClick={(e) => handleDeleteConversation(e, item.id)}
                                >
                                    {deletingId === item.id ? '...' : <IconTrash size={14} />}
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {hasMore && (
                    <button className="history-load-more" onClick={() => void loadMore()} disabled={isHistoryLoadingMore}>
                        {isHistoryLoadingMore
                            ? t('agent.history.loadingMore', '加载中...')
                            : t('agent.history.loadMore', '加载更多')}
                    </button>
                )}
            </aside>

            {/* 顶部导航栏 */}
            <div className="agent-topbar">
                <button type="button" className="topbar-menu-btn" onClick={openHistoryDrawer} title={t('agent.history.open', '历史对话')}>
                    <IconMenu size={22} />
                </button>
                {messages.length > 0 && (
                    <button type="button" className="topbar-new-btn" onClick={newConversation} title="新对话">
                        <IconNew size={20} />
                    </button>
                )}
            </div>

            {/* 用药冲突 Banner */}
            <div className={`conflict-banner conflict-${conflictStatus}`}>
                <span className="conflict-light" />
                <span className="conflict-text">
                    {conflictStatus === 'green' && t('agent.noConflict', '用药安全，暂无冲突')}
                    {conflictStatus === 'yellow' && t('agent.possibleConflict', '可能存在用药相互作用，建议咨询医生')}
                    {conflictStatus === 'red' && t('agent.conflict', '检测到用药冲突！请立即咨询医生')}
                </span>
            </div>

            {/* 聊天区域 */}
            <div className="chat-area">
                {messages.length === 0 ? (
                    <div className="chat-empty">
                        <div className="gemini-logo">
                            <IconSparkle size={32} color="white" />
                        </div>
                        <h2 className="chat-empty-title">
                            {t('agent.welcome', '你好，我是您的 AI 用药助手')}
                        </h2>
                        <p className="chat-empty-desc">
                            {t('agent.welcomeDesc', '您可以向我咨询用药相关的问题')}
                        </p>

                        <div className="preset-questions">
                            {presetQuestions.map((q, i) => (
                                <button
                                    key={i}
                                    className="preset-btn"
                                    onClick={() => handlePresetClick(q)}
                                >
                                    <span className="preset-icon"><IconChat size={18} /></span>
                                    <span className="preset-text">{q}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="chat-messages">
                        {isLoadingConversation && (
                            <div className="chat-loading-overlay">{t('agent.history.loadingConversation', '正在加载对话...')}</div>
                        )}
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`chat-bubble ${msg.role}${msg.isError ? ' error' : ''}`}
                            >
                                {msg.role === 'assistant' && (
                                    <span className="bubble-avatar">
                                        <IconSparkle size={16} color="white" />
                                    </span>
                                )}
                                <div className="bubble-content">
                                    <p>{msg.content}</p>
                                </div>
                            </div>
                        ))}
                        {isTyping && (
                            <div className="chat-bubble assistant">
                                <span className="bubble-avatar">
                                    <IconSparkle size={16} color="white" />
                                </span>
                                <div className="bubble-content typing">
                                    <span className="dot" /><span className="dot" /><span className="dot" />
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>
                )}
            </div>

            {/* 输入区域 */}
            <div className="chat-input-area">
                <div className="chat-input-wrapper">
                    <input
                        type="text"
                        className="chat-input"
                        placeholder={t('agent.inputPlaceholder', '请输入您的问题')}
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isTyping}
                    />
                    <button
                        className="chat-send-btn"
                        onClick={handleSend}
                        disabled={!inputText.trim() || isTyping}
                    >
                        <IconSend size={18} color="white" />
                    </button>
                </div>
                <p className="chat-disclaimer">
                    {t('agent.disclaimer', 'AI 建议仅供参考，具体用药请遵医嘱')}
                </p>
            </div>
        </div>
    );
}
