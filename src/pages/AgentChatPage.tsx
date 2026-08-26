/**
 * @file AgentChatPage.tsx
 * @description Agent 聊天页面 — Gemini 风格 AI 对话界面
 *
 * 🏛️ 架构师: 页面只负责 UI 渲染，所有状态和 API 交互由 useAgentChat Hook 管理
 * 🔧 工程师: 使用 SVG 图标替代所有 emoji，提升专业感
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMedicationSchedule } from '../hooks/medication/useMedicationSchedule';
import { useAgentChat } from '../hooks/agent/useAgentChat';
import { useAgentRuntimeFeed } from '../hooks/agent/useAgentRuntimeFeed';
import { useConversationHistory } from '../hooks/agent/useConversationHistory';
import { useAudioRecorder } from '../hooks/common/useAudioRecorder';
import { fetchAgentSuggestedQuestions, transcribeAgentVoice } from '../services/agentApi';
import AgentActionConfirmModal from '../components/AgentActionConfirmModal';
import { IconSparkle, IconChat, IconNew, IconSend, IconTrash, IconClose, IconMenu, IconMic, IconBack } from '../components/Icons';
import { AGENT_THINKING_WORDS } from '../constants/agentThinkingWords';
import { normalizeDateKey } from '../utils/dateKey';
import './AgentChatPage.css';

interface AgentChatPageProps {
    onNavigateToUpload?: () => void;
    onBack?: () => void;
}

type AgentVoiceLanguage = 'zh-CN' | 'zh-TW' | 'en';

const AUTO_SCROLL_THRESHOLD_PX = 88;
const THINKING_WORD_INTERVAL_MS = 1200;
const LATEST_CONTENT_GAP_PX = 20;
const MAX_COMPOSER_LINES = 3;

const assistantMarkdownComponents: Components = {
    h1({ children }) {
        return <h2>{children}</h2>;
    },
    a({ children, href, title }) {
        return (
            <a href={href} title={title} target="_blank" rel="noreferrer">
                {children}
            </a>
        );
    },
};

function mapAgentVoiceLanguage(language: string): AgentVoiceLanguage {
    const normalized = language.toLowerCase();
    if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk')) return 'zh-TW';
    if (normalized.startsWith('en')) return 'en';
    return 'zh-CN';
}

function renderAssistantMessageContent(content: string) {
    return (
        <div className="assistant-markdown">
            <ReactMarkdown
                components={assistantMarkdownComponents}
                remarkPlugins={[remarkGfm]}
                skipHtml
                disallowedElements={['img']}
            >
                {content.trim()}
            </ReactMarkdown>
        </div>
    );
}

function distanceFromBottom(node: HTMLElement): number {
    return node.scrollHeight - node.scrollTop - node.clientHeight;
}

function resizeComposer(node: HTMLTextAreaElement | null, maxLines: number = MAX_COMPOSER_LINES) {
    if (!node) return;

    const computedStyle = window.getComputedStyle(node);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const borderTop = Number.parseFloat(computedStyle.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(computedStyle.borderBottomWidth) || 0;
    const verticalChrome = paddingTop + paddingBottom + borderTop + borderBottom;
    const minHeight = Math.ceil(lineHeight + verticalChrome);
    const maxHeight = Math.ceil(lineHeight * maxLines + verticalChrome);

    node.style.height = 'auto';
    const nextHeight = Math.max(
        minHeight,
        Math.min(node.scrollHeight, maxHeight)
    );
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function pickNextThinkingWord(currentWord?: string): string {
    if (AGENT_THINKING_WORDS.length <= 1) {
        return AGENT_THINKING_WORDS[0] || 'Thinking';
    }

    let nextWord = currentWord || AGENT_THINKING_WORDS[0];
    while (nextWord === currentWord) {
        nextWord = AGENT_THINKING_WORDS[Math.floor(Math.random() * AGENT_THINKING_WORDS.length)];
    }
    return nextWord;
}

function formatRuntimeTag(tag: string): string {
    const labels: Record<string, string> = {
        health_profile: '健康档案',
        doctor_prescription: '医生处方',
        medication_schedule: '用药计划',
        medication_logs: '服药记录',
        medication_feedback: '用药反馈',
        chat_history: '历史对话',
        chat_history_detail: '对话细节',
        rag_retrieval: '私有记录',
        conversation_summary: '对话摘要',
        drug_knowledge_rag: '药物知识',
        drug_label_api: '说明书',
    };
    return labels[tag] || tag.replace(/_/g, ' ');
}

function formatRuntimeSignal(signal: string): string {
    const labels: Record<string, string> = {
        new_medication: '新药',
        prescription_change: '处方变化',
        next_dose: '下次服药',
        conversation_theme: '历史主题',
        conversation_follow_up: '待跟进',
        medication_plan_question: '计划问题',
        historical_medication_context: '历史用药',
        personal_context_signal: '个人上下文',
        workflow_signal: '计划/记录',
        safety_signal: '安全信号',
    };
    if (signal.startsWith('pending_action:')) return '待确认动作';
    if (signal.startsWith('policy:')) return labels[signal.slice('policy:'.length)] || '策略路由';
    return labels[signal] || signal.replace(/_/g, ' ');
}

export default function AgentChatPage({ onBack }: AgentChatPageProps) {
    const { t, i18n } = useTranslation();
    const { schedules } = useMedicationSchedule();
    const agentVoiceLanguage = mapAgentVoiceLanguage(i18n.language || 'zh-CN');
    const {
        messages,
        conversationId,
        pendingAction,
        isTyping,
        isLoadingConversation,
        isConfirmingAction,
        sendMessage,
        newConversation,
        loadConversation,
        confirmPendingAction,
        cancelPendingAction,
    } = useAgentChat();
    const {
        runtimeState,
        backgroundTasks,
        pendingActions: pendingRuntimeActions,
        isLoading: isRuntimeLoading,
        error: runtimeError,
        runtimeEvents,
        memoryHighlights,
        refresh: refreshRuntime,
        acknowledgeEvent,
    } = useAgentRuntimeFeed({
        language: agentVoiceLanguage,
        pollMs: 45_000,
    });
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
    const {
        isAvailable: isVoiceRecorderAvailable,
        isRecording: isVoiceRecording,
        mimeType: voiceMimeType,
        error: voiceRecorderError,
        startRecording: startVoiceRecording,
        stopRecording: stopVoiceRecording,
        clearError: clearVoiceRecorderError,
    } = useAudioRecorder();

    const [inputText, setInputText] = useState('');
    const [historyOpen, setHistoryOpen] = useState(false);
    const [personalizedPresets, setPersonalizedPresets] = useState<string[]>([]);
    const [isPresetLoading, setIsPresetLoading] = useState(false);
    const [isVoiceTranscribing, setIsVoiceTranscribing] = useState(false);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const [inputAreaHeight, setInputAreaHeight] = useState(220);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);
    const [currentThinkingWord, setCurrentThinkingWord] = useState<string>(() => AGENT_THINKING_WORDS[0] || 'Thinking');
    const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height || window.innerHeight);
    const chatAreaRef = useRef<HTMLDivElement>(null);
    const latestContentRef = useRef<HTMLDivElement>(null);
    const chatInputAreaRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLTextAreaElement>(null);
    const voiceChunksRef = useRef<Blob[]>([]);
    const isVoiceRecordingRef = useRef(false);
    const activeSchedules = useMemo(() => {
        const currentDateKey = normalizeDateKey(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
        return schedules.filter((schedule) => {
            if (!schedule.isActive) return false;
            const startDate = normalizeDateKey(schedule.startDate) || schedule.startDate.split('T')[0];
            const endDate = schedule.endDate
                ? (normalizeDateKey(schedule.endDate) || schedule.endDate.split('T')[0])
                : null;
            return startDate <= currentDateKey && (!endDate || endDate >= currentDateKey);
        });
    }, [schedules]);
    const activeScheduleFingerprint = useMemo(() => {
        return activeSchedules
            .map((schedule) => [
                schedule.id,
                schedule.medicationName,
                schedule.medicationDosage,
                schedule.startDate,
                schedule.endDate || '',
                schedule.reminders.map((reminder) => `${reminder.time}/${reminder.dosage}`).join(','),
            ].join('::'))
            .sort()
            .join('|') || 'no-active-schedules';
    }, [activeSchedules]);
    const fallbackPresetQuestions = useMemo(() => {
        if (activeSchedules.length > 0) {
            return [
                t('agent.preset.interaction', {
                    drug: activeSchedules[0]?.medicationName || t('schedule.medicationName', '药物'),
                    defaultValue: `${activeSchedules[0]?.medicationName || '药物'}有什么禁忌吗？`,
                }),
                t('agent.preset.sideEffects', '这些药物有什么副作用？'),
                t('agent.preset.foodInteraction', '服药期间有什么饮食注意事项？'),
            ];
        }

        return [
            t('agent.preset.howToUse', '如何添加我的用药计划？'),
            t('agent.preset.scanHelp', '如何扫描病例？'),
        ];
    }, [activeSchedules, t]);
    const presetQuestions = personalizedPresets.length > 0
        ? personalizedPresets
        : fallbackPresetQuestions;
    const compactPresetQuestions = useMemo(
        () => presetQuestions.slice(0, 2),
        [presetQuestions]
    );
    const composerHelperText = useMemo(() => {
        if (isTyping) {
            return t('agent.thinking.subtitle', '已收到你的问题，正在持续处理');
        }

        if ((i18n.language || '').toLowerCase().startsWith('en')) {
            return 'Shift + Enter for a new line';
        }

        if ((i18n.language || '').toLowerCase().startsWith('zh-tw')) {
            return 'Shift + Enter 換行';
        }

        return 'Shift + Enter 换行';
    }, [i18n.language, isTyping, t]);
    const runtimeStatusLabel = useMemo(() => {
        if (runtimeError) return null;
        if (isRuntimeLoading && !runtimeState) return t('agent.runtime.loading', '正在预读取上下文');
        switch (runtimeState?.lifecycleStatus) {
            case 'warming':
                return t('agent.runtime.warming', '正在预读取上下文');
            case 'thinking':
                return t('agent.runtime.thinking', '正在处理本轮问题');
            case 'waiting_confirmation':
                return t('agent.runtime.waitingConfirmation', '等待你确认动作');
            case 'acting':
                return t('agent.runtime.acting', '正在执行已确认动作');
            case 'error':
                return null;
            case 'ready':
                return t('agent.runtime.ready', '上下文已就绪');
            case 'idle':
            default:
                return t('agent.runtime.idle', 'Agent 待命中');
        }
    }, [isRuntimeLoading, runtimeError, runtimeState, t]);
    const runtimeContextTags = (runtimeState?.lastContextTags || []).slice(0, 4);
    const runtimeSignals = (runtimeState?.lastTriggerSignals || [])
        .filter((signal) => signal !== 'preference_fast' && signal !== 'preference_slow')
        .slice(0, 3);
    const activeRuntimeTask = backgroundTasks.find((task) =>
        task.taskStatus === 'queued' || task.taskStatus === 'running'
    ) || backgroundTasks[0];

    const conflictStatus: 'green' | 'yellow' | 'red' =
        activeSchedules.length > 5 ? 'red' : activeSchedules.length > 2 ? 'yellow' : 'green';
    const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const container = chatAreaRef.current;
        const latestNode = latestContentRef.current;
        if (!container || !latestNode) return;

        const containerRect = container.getBoundingClientRect();
        const latestRect = latestNode.getBoundingClientRect();
        const latestBottom = container.scrollTop + (latestRect.bottom - containerRect.top);
        const nextScrollTop = Math.max(
            latestBottom - container.clientHeight + LATEST_CONTENT_GAP_PX,
            0
        );

        container.scrollTo({ top: nextScrollTop, behavior });
        setShowJumpToLatest(false);
    }, []);

    useEffect(() => {
        resizeComposer(chatInputRef.current);
    }, [inputText, viewportHeight]);

    useEffect(() => {
        const updateViewportHeight = () => {
            const nextHeight = window.visualViewport?.height || window.innerHeight;
            setViewportHeight(Math.round(nextHeight));
        };

        updateViewportHeight();
        window.addEventListener('resize', updateViewportHeight);
        window.visualViewport?.addEventListener('resize', updateViewportHeight);
        window.visualViewport?.addEventListener('scroll', updateViewportHeight);

        return () => {
            window.removeEventListener('resize', updateViewportHeight);
            window.visualViewport?.removeEventListener('resize', updateViewportHeight);
            window.visualViewport?.removeEventListener('scroll', updateViewportHeight);
        };
    }, []);

    useEffect(() => {
        const node = chatInputAreaRef.current;
        if (!node) return;

        const updateHeight = () => {
            setInputAreaHeight(node.getBoundingClientRect().height);
        };

        updateHeight();
        const observer = new ResizeObserver(() => updateHeight());
        observer.observe(node);

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const shouldShow = !shouldAutoScroll && (messages.length > 0 || isTyping);
        setShowJumpToLatest(shouldShow);

        if (!shouldAutoScroll) return;

        const rafId = window.requestAnimationFrame(() => {
            scrollToLatest(isTyping ? 'auto' : messages.length > 1 ? 'smooth' : 'auto');
        });

        return () => window.cancelAnimationFrame(rafId);
    }, [currentThinkingWord, inputAreaHeight, isTyping, messages.length, scrollToLatest, shouldAutoScroll]);

    useEffect(() => {
        if (!isTyping) {
            return;
        }

        const initialWord = pickNextThinkingWord();
        setCurrentThinkingWord(initialWord);

        const wordTimer = window.setInterval(() => {
            setCurrentThinkingWord((previousWord) => {
                return pickNextThinkingWord(previousWord);
            });
        }, THINKING_WORD_INTERVAL_MS);

        return () => {
            window.clearInterval(wordTimer);
        };
    }, [isTyping]);

    useEffect(() => {
        isVoiceRecordingRef.current = isVoiceRecording;
    }, [isVoiceRecording]);

    useEffect(() => {
        return () => {
            if (isVoiceRecordingRef.current) {
                void stopVoiceRecording();
            }
        };
    }, [stopVoiceRecording]);

    const loadPresetQuestions = useCallback(async (forceRefresh: boolean = false) => {
        setIsPresetLoading(true);

        const language = i18n.language === 'en'
            ? 'en'
            : i18n.language === 'zh-TW'
                ? 'zh-TW'
                : 'zh-CN';

        const result = await fetchAgentSuggestedQuestions({
            language,
            forceRefresh,
            contextKey: activeScheduleFingerprint,
        });

        if (result.success && result.questions.length > 0) {
            setPersonalizedPresets(result.questions.slice(0, 4));
        } else {
            setPersonalizedPresets(fallbackPresetQuestions.slice(0, 4));
        }

        void refreshRuntime(false);

        setIsPresetLoading(false);
    }, [activeScheduleFingerprint, fallbackPresetQuestions, i18n.language, refreshRuntime]);

    useEffect(() => {
        void loadPresetQuestions(false);
    }, [loadPresetQuestions]);

    const handleSend = useCallback(() => {
        if (!inputText.trim() || isTyping) return;
        setShouldAutoScroll(true);
        setShowJumpToLatest(false);
        void sendMessage(inputText.trim()).finally(() => {
            void refreshRuntime();
        });
        setInputText('');
    }, [inputText, isTyping, refreshRuntime, sendMessage]);

    const handlePresetClick = useCallback((question: string) => {
        setShouldAutoScroll(true);
        setShowJumpToLatest(false);
        setInputText('');
        void sendMessage(question).finally(() => {
            void refreshRuntime();
        });
    }, [refreshRuntime, sendMessage]);

    const handleRefreshSuggestions = useCallback(() => {
        void loadPresetQuestions(true);
    }, [loadPresetQuestions]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    const handleChatScroll = useCallback(() => {
        const node = chatAreaRef.current;
        if (!node) return;

        const isNearBottom = distanceFromBottom(node) <= AUTO_SCROLL_THRESHOLD_PX;
        setShouldAutoScroll(isNearBottom);
        setShowJumpToLatest(!isNearBottom && (messages.length > 0 || isTyping));
    }, [isTyping, messages.length]);

    const handleJumpToLatest = useCallback(() => {
        setShouldAutoScroll(true);
        setShowJumpToLatest(false);
        scrollToLatest('smooth');
    }, [scrollToLatest]);

    const handleVoiceStart = useCallback(async () => {
        setVoiceError(null);
        clearVoiceRecorderError();
        voiceChunksRef.current = [];

        await startVoiceRecording({
            // 长于常见单句输入的上限，确保 stop 时返回完整 blob
            timesliceMs: 60_000,
            onChunk: (chunk) => {
                voiceChunksRef.current.push(chunk);
            },
        });
    }, [clearVoiceRecorderError, startVoiceRecording]);

    const handleVoiceStop = useCallback(async () => {
        setVoiceError(null);
        await stopVoiceRecording();
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        const audioChunks = voiceChunksRef.current;
        voiceChunksRef.current = [];

        const audioBlob = new Blob(audioChunks, {
            type: voiceMimeType || audioChunks[0]?.type || 'audio/webm',
        });

        if (audioBlob.size <= 0) {
            setVoiceError(t('agent.voice.empty', '未检测到有效语音，请重试'));
            return;
        }

        setIsVoiceTranscribing(true);
        const result = await transcribeAgentVoice({
            audio: audioBlob,
            language: agentVoiceLanguage,
            source: 'agent-chat',
        });
        setIsVoiceTranscribing(false);

        if (!result.success) {
            setVoiceError(result.error || t('agent.voice.failed', '语音转写失败，请重试'));
            return;
        }

        const transcript = (result.transcript || '').trim();
        if (!transcript) {
            setVoiceError(t('agent.voice.empty', '未检测到有效语音，请重试'));
            return;
        }

        setInputText((prev) => {
            const base = prev.trim();
            return base ? `${base} ${transcript}` : transcript;
        });
        window.requestAnimationFrame(() => chatInputRef.current?.focus());
    }, [agentVoiceLanguage, stopVoiceRecording, t, voiceMimeType]);

    const toggleVoiceInput = useCallback(async () => {
        if (isVoiceTranscribing || isTyping) return;

        if (isVoiceRecording) {
            await handleVoiceStop();
            return;
        }

        await handleVoiceStart();
    }, [handleVoiceStart, handleVoiceStop, isTyping, isVoiceRecording, isVoiceTranscribing]);

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
            setShouldAutoScroll(true);
            setShowJumpToLatest(false);
            closeHistoryDrawer();
        }
    }, [loadConversation, closeHistoryDrawer]);

    const handleNewConversation = useCallback(() => {
        setShouldAutoScroll(true);
        setShowJumpToLatest(false);
        newConversation();
        window.requestAnimationFrame(() => {
            resizeComposer(chatInputRef.current);
            chatInputRef.current?.focus();
        });
    }, [newConversation]);

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

    const handleConfirmPendingAction = useCallback(async (editedPlan?: Parameters<typeof confirmPendingAction>[0]) => {
        const ok = await confirmPendingAction(editedPlan);
        void refreshRuntime();
        return ok;
    }, [confirmPendingAction, refreshRuntime]);

    const handleCancelPendingAction = useCallback(async () => {
        const ok = await cancelPendingAction();
        void refreshRuntime();
        return ok;
    }, [cancelPendingAction, refreshRuntime]);

    const renderPresetSection = (questions: string[], compact: boolean = false) => (
        <div className={`preset-questions${compact ? ' compact' : ''}`}>
            <div className="preset-actions">
                {compact && (
                    <span className="preset-section-label">
                        {t('agent.preset.quickActions', '快捷建议')}
                    </span>
                )}
                <button
                    type="button"
                    className="preset-refresh-btn"
                    onClick={handleRefreshSuggestions}
                    disabled={isPresetLoading}
                >
                    {isPresetLoading
                        ? t('agent.preset.refreshing', '刷新中...')
                        : t('agent.preset.refresh', '刷新推荐问题')}
                </button>
            </div>
            {!compact && isPresetLoading && (
                <p className="preset-loading-text">{t('agent.preset.loading', '正在生成个性化推荐问题...')}</p>
            )}
            {questions.map((question, index) => (
                <button
                    key={`${compact ? 'compact' : 'full'}-${index}`}
                    type="button"
                    className="preset-btn"
                    onClick={() => handlePresetClick(question)}
                >
                    <span className="preset-icon"><IconChat size={18} /></span>
                    <span className="preset-text">{question}</span>
                </button>
            ))}
        </div>
    );

    return (
        <div className="agent-page" style={{ height: `${viewportHeight}px` }}>
            {pendingAction && (
                <AgentActionConfirmModal
                    title={pendingAction.title}
                    summary={pendingAction.summary}
                    impactDescription={pendingAction.impactDescription}
                    impactPoints={pendingAction.impactPoints}
                    previewSections={pendingAction.previewSections}
                    editablePlan={pendingAction.editablePlan}
                    riskLevel={pendingAction.riskLevel}
                    confirmHint={pendingAction.confirmHint}
                    confirmBusy={isConfirmingAction}
                    confirmLabel={t('agent.action.confirm', '确认执行')}
                    modifyLabel={t('agent.action.modify', '修改')}
                    cancelLabel={t('agent.action.cancel', '暂不执行')}
                    onConfirm={handleConfirmPendingAction}
                    onCancel={handleCancelPendingAction}
                />
            )}
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
                <button type="button" className="topbar-back-btn" onClick={onBack} title={t('common.back', '返回')}>
                    <IconBack size={22} />
                </button>
                <div className="agent-topbar-actions">
                    <button
                        type="button"
                        className="topbar-new-btn"
                        onClick={handleNewConversation}
                        title={t('agent.newConversation', '新增对话')}
                    >
                        <IconNew size={20} />
                    </button>
                    <button type="button" className="topbar-menu-btn" onClick={openHistoryDrawer} title={t('agent.history.open', '历史对话')}>
                        <IconMenu size={22} />
                    </button>
                </div>
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

            {runtimeStatusLabel && (
                <section className={`agent-runtime-strip status-${runtimeState?.lifecycleStatus || 'idle'}`}>
                    <div className="agent-runtime-main">
                        <span className="agent-runtime-dot" />
                        <div className="agent-runtime-copy">
                            <p className="agent-runtime-title">{runtimeStatusLabel}</p>
                            <p className="agent-runtime-meta">
                                {runtimeContextTags.length > 0 && (
                                    <span>
                                        {runtimeContextTags.map(formatRuntimeTag).join(' · ')}
                                    </span>
                                )}
                                {runtimeSignals.length > 0 && (
                                    <span>
                                        {runtimeSignals.map(formatRuntimeSignal).join(' · ')}
                                    </span>
                                )}
                                {activeRuntimeTask && (
                                    <span>{activeRuntimeTask.title}</span>
                                )}
                            </p>
                        </div>
                    </div>
                    {(runtimeState?.pendingActionCount || pendingRuntimeActions.length) > 0 && (
                        <span className="runtime-count-pill">
                            {t('agent.runtime.pendingCount', '{{count}} 个待确认', {
                                count: runtimeState?.pendingActionCount || pendingRuntimeActions.length,
                            })}
                        </span>
                    )}
                </section>
            )}

            {(runtimeEvents.length > 0 || memoryHighlights.length > 0) && (
                <div className="agent-runtime-feed">
                    {runtimeEvents.slice(0, 2).map((event) => (
                        <article key={event.id} className={`agent-runtime-event severity-${event.severity}`}>
                            <div>
                                <strong>{event.title}</strong>
                                {event.body && <p>{event.body}</p>}
                            </div>
                            <button type="button" onClick={() => void acknowledgeEvent(event.id)}>
                                {t('agent.runtime.ack', '知道了')}
                            </button>
                        </article>
                    ))}
                    {runtimeEvents.length === 0 && memoryHighlights.length > 0 && (
                        <article className="agent-runtime-event severity-info">
                            <div>
                                <strong>{t('agent.runtime.memoryReady', '长期记忆已就绪')}</strong>
                                <p>{memoryHighlights.slice(0, 2).map((item) => item.content).join(' · ')}</p>
                            </div>
                        </article>
                    )}
                </div>
            )}

            {/* 聊天区域 */}
            <div
                ref={chatAreaRef}
                className="chat-area"
                onScroll={handleChatScroll}
            >
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

                        {renderPresetSection(presetQuestions, false)}
                    </div>
                ) : (
                    <div className="chat-messages">
                        {isLoadingConversation && (
                            <div className="chat-loading-overlay">{t('agent.history.loadingConversation', '正在加载对话...')}</div>
                        )}
                        {compactPresetQuestions.length > 0 && (
                            <div className="chat-inline-presets">
                                {renderPresetSection(compactPresetQuestions, true)}
                            </div>
                        )}
                        {messages.map((msg, index) => {
                            const isLatestMessage = !isTyping && index === messages.length - 1;

                            return (
                                <div
                                    key={msg.id}
                                    ref={isLatestMessage ? latestContentRef : undefined}
                                    className={`chat-bubble ${msg.role}${msg.isError ? ' error' : ''}`}
                                >
                                    {msg.role === 'assistant' && (
                                        <span className="bubble-avatar">
                                            <IconSparkle size={16} color="white" />
                                        </span>
                                    )}
                                    <div className="bubble-content">
                                        {msg.role === 'assistant' ? (
                                            renderAssistantMessageContent(msg.content)
                                        ) : (
                                            <p className="plain-message">{msg.content}</p>
                                        )}
                                        {msg.role === 'assistant' && (msg.reasoningSummary || (msg.contextUsed?.length || 0) > 0) && (
                                            <div className="bubble-runtime-meta">
                                                {msg.reasoningSummary && <span>{msg.reasoningSummary}</span>}
                                                {(msg.contextUsed?.length || 0) > 0 && (
                                                    <span>{msg.contextUsed?.slice(0, 3).map(formatRuntimeTag).join(' · ')}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {isTyping && (
                            <div ref={latestContentRef} className="thinking-card" aria-live="polite">
                                <div className="thinking-card-header">
                                    <span className="bubble-avatar thinking-avatar">
                                        <IconSparkle size={16} color="white" />
                                    </span>
                                    <div className="thinking-card-copy">
                                        <p className="thinking-card-title">{t('agent.thinking.title', 'Agent 正在思考')}</p>
                                        <p className="thinking-card-subtitle">
                                            {t('agent.thinking.subtitle', '已收到你的问题，正在持续处理')}
                                        </p>
                                    </div>
                                </div>
                                <div className="thinking-word-row">
                                    <span className="thinking-word-current">{currentThinkingWord}...</span>
                                    <div className="thinking-dots" aria-hidden="true">
                                        <span className="dot" /><span className="dot" /><span className="dot" />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {showJumpToLatest && (
                <button
                    type="button"
                    className="jump-to-latest-btn"
                    onClick={handleJumpToLatest}
                    style={{ bottom: `${inputAreaHeight + 16}px` }}
                    title={t('agent.thinking.anchorHint', '已定位到最新回复')}
                >
                    {t('agent.thinking.latest', '回到最新')}
                </button>
            )}

            {/* 输入区域 */}
            <div ref={chatInputAreaRef} className="chat-input-area">
                <div className="chat-input-wrapper">
                    <textarea
                        ref={chatInputRef}
                        className="chat-input"
                        rows={1}
                        placeholder={isVoiceTranscribing
                            ? t('agent.voice.transcribing', '正在转写语音...')
                            : t('agent.inputPlaceholder', '请输入您的问题')
                        }
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isTyping}
                    />
                    <div className="chat-input-toolbar">
                        <p className="chat-input-helper">{composerHelperText}</p>
                        <div className="chat-input-actions">
                            <button
                                type="button"
                                className={`chat-voice-btn ${isVoiceRecording ? 'recording' : ''} ${isVoiceTranscribing ? 'transcribing' : ''}`}
                                onClick={() => void toggleVoiceInput()}
                                disabled={!isVoiceRecorderAvailable || isTyping || isVoiceTranscribing}
                                title={!isVoiceRecorderAvailable
                                    ? t('agent.voice.unavailable', '当前设备不支持语音输入')
                                    : isVoiceRecording
                                        ? t('agent.voice.stop', '点击结束录音')
                                        : t('agent.voice.start', '点击开始语音输入')
                                }
                                aria-label={t('agent.voice.inputLabel', '语音输入')}
                            >
                                <IconMic size={18} color="currentColor" />
                                {isVoiceRecording && <span className="chat-voice-pulse" />}
                            </button>
                            <button
                                type="button"
                                className="chat-send-btn"
                                onClick={handleSend}
                                disabled={!inputText.trim() || isTyping}
                            >
                                <IconSend size={18} color="white" />
                            </button>
                        </div>
                    </div>
                </div>
                {(isVoiceRecording || isVoiceTranscribing || voiceError || voiceRecorderError) && (
                    <p className={`chat-input-status ${voiceError || voiceRecorderError ? 'error' : ''}`}>
                        {voiceError
                            || voiceRecorderError
                            || (isVoiceTranscribing
                                ? t('agent.voice.transcribing', '正在转写语音...')
                                : isVoiceRecording
                                    ? t('agent.voice.recording', '正在录音，点击麦克风结束')
                                    : ''
                            )}
                    </p>
                )}
                <p className="chat-disclaimer">
                    {t('agent.disclaimer', 'AI 建议仅供参考，具体用药请遵医嘱')}
                </p>
            </div>
        </div>
    );
}
