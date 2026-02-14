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
import { IconSparkle, IconChat, IconNew, IconSend } from '../components/Icons';
import './AgentChatPage.css';

interface AgentChatPageProps {
    onNavigateToUpload?: () => void;
}

export default function AgentChatPage(_props: AgentChatPageProps) {
    const { t } = useTranslation();
    const { schedules } = useMedicationSchedule();
    const {
        messages,
        isTyping,
        sendMessage,
        sendPreset,
        newConversation,
    } = useAgentChat();

    const [inputText, setInputText] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);

    const presetQuestions = schedules.length > 0
        ? [
            t('agent.preset.interaction', `${schedules[0]?.medicationName || '药物'}有什么禁忌吗？`),
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

    return (
        <div className="agent-page">
            {/* 用药冲突 Banner */}
            <div className={`conflict-banner conflict-${conflictStatus}`}>
                <span className="conflict-light" />
                <span className="conflict-text">
                    {conflictStatus === 'green' && t('agent.noConflict', '用药安全，暂无冲突')}
                    {conflictStatus === 'yellow' && t('agent.possibleConflict', '可能存在用药相互作用，建议咨询医生')}
                    {conflictStatus === 'red' && t('agent.conflict', '检测到用药冲突！请立即咨询医生')}
                </span>
                {messages.length > 0 && (
                    <button className="new-chat-btn" onClick={newConversation} title="新对话">
                        <IconNew size={16} />
                    </button>
                )}
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
                        placeholder={t('agent.inputPlaceholder', '输入您的问题...')}
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
