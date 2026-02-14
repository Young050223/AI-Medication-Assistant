/**
 * @file AgentAnalysisPage.tsx
 * @description AI Agent药物分析页面 (老年友好UI)
 * @author AI用药助手开发团队
 * @created 2026-02-03
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentAnalysis } from '../hooks/agent/useAgentAnalysis';
import { IconBack, IconWarning, IconPill, IconClipboard, IconFood, IconGuide, IconStethoscope } from '../components/Icons';
import './AgentAnalysisPage.css';

interface AgentAnalysisPageProps {
    onBack: () => void;
}

const AgentAnalysisPage: React.FC<AgentAnalysisPageProps> = ({ onBack }) => {
    const { t, i18n } = useTranslation();

    const {
        isAnalyzing,
        progress,
        result,
        riskAlerts,
        error,
        analyzedrugInfo,
        clearResult,
    } = useAgentAnalysis();

    const [drugName, setDrugName] = useState('');

    /**
     * 处理分析提交
     */
    const handleAnalyze = useCallback(async () => {
        if (!drugName.trim()) return;

        const language = i18n.language as 'zh-CN' | 'zh-TW' | 'en';
        await analyzedrugInfo(drugName.trim(), language);
    }, [drugName, i18n.language, analyzedrugInfo]);

    /**
     * 处理输入回车
     */
    const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !isAnalyzing) {
            handleAnalyze();
        }
    }, [handleAnalyze, isAnalyzing]);

    /**
     * 重新分析
     */
    const handleReset = useCallback(() => {
        setDrugName('');
        clearResult();
    }, [clearResult]);

    return (
        <div className="agent-analysis-page">
            {/* 顶部导航 */}
            <header className="agent-header">
                <button className="back-button" onClick={onBack}>
                    <IconBack size={16} /> {t('common.back', '返回')}
                </button>
                <h1 className="page-title">{t('agent.title', '药物分析')}</h1>
            </header>

            {/* 搜索区域 */}
            <section className="search-section">
                <div className="search-container">
                    <input
                        type="text"
                        className="drug-input"
                        placeholder={t('agent.inputPlaceholder', '请输入药物名称...')}
                        value={drugName}
                        onChange={(e) => setDrugName(e.target.value)}
                        onKeyPress={handleKeyPress}
                        disabled={isAnalyzing}
                    />
                    <button
                        className="analyze-button"
                        onClick={handleAnalyze}
                        disabled={isAnalyzing || !drugName.trim()}
                    >
                        {isAnalyzing ? t('agent.analyzing', '分析中...') : t('agent.analyze', '分析')}
                    </button>
                </div>

                {/* 进度指示 */}
                {isAnalyzing && (
                    <div className="progress-section">
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{ width: `${progress.percentage}%` }}
                            />
                        </div>
                        <p className="progress-message">{progress.message}</p>
                    </div>
                )}
            </section>

            {/* 错误提示 */}
            {error && (
                <section className="error-section">
                    <div className="error-card">
                        <span className="error-icon"><IconWarning size={20} /></span>
                        <p className="error-message">{error}</p>
                        <button className="retry-button" onClick={handleReset}>
                            {t('agent.retry', '重试')}
                        </button>
                    </div>
                </section>
            )}

            {/* 分析结果 */}
            {result && (
                <section className="result-section">
                    {/* 药物基本信息 */}
                    <div className="result-card drug-info-card">
                        <h2 className="card-title"><IconPill size={20} /> {result.drugName}</h2>
                        {result.normalizedName && result.normalizedName !== result.drugName && (
                            <p className="normalized-name">
                                {t('agent.standardName', '标准名')}: {result.normalizedName}
                            </p>
                        )}
                    </div>

                    {/* 风险警报 */}
                    {riskAlerts.length > 0 && (
                        <div className="result-card alerts-card">
                            <h3 className="card-subtitle"><IconWarning size={16} /> {t('agent.riskAlerts', '风险提示')}</h3>
                            <div className="alerts-list">
                                {riskAlerts.map((alert, index) => (
                                    <div
                                        key={index}
                                        className={`alert-item severity-${alert.severity}`}
                                    >
                                        <span className="alert-title">{alert.title}</span>
                                        <p className="alert-message">{alert.message}</p>
                                        <span className="alert-source">{t('agent.source', '来源')}: {alert.source}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* AI总结 */}
                    {result.aiSummary && (
                        <div className="result-card summary-card">
                            <h3 className="card-subtitle"><IconClipboard size={16} /> {t('agent.summary', '分析总结')}</h3>

                            {/* 概述 */}
                            <div className="summary-section">
                                <p className="overview">{result.aiSummary.overview}</p>
                            </div>

                            {/* 关键要点 */}
                            {result.aiSummary.keyPoints.length > 0 && (
                                <div className="summary-section">
                                    <h4>{t('agent.keyPoints', '关键要点')}</h4>
                                    <ul className="key-points-list">
                                        {result.aiSummary.keyPoints.map((point, index) => (
                                            <li key={index}>{point}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* 注意事项 */}
                            {result.aiSummary.warnings.length > 0 && (
                                <div className="summary-section warnings-section">
                                    <h4><IconWarning size={14} /> {t('agent.warnings', '注意事项')}</h4>
                                    <ul className="warnings-list">
                                        {result.aiSummary.warnings.map((warning, index) => (
                                            <li key={index}>{warning}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* 常见副作用 */}
                            {result.aiSummary.commonSideEffects.length > 0 && (
                                <div className="summary-section">
                                    <h4>{t('agent.sideEffects', '常见副作用')}</h4>
                                    <div className="tags-container">
                                        {result.aiSummary.commonSideEffects.map((effect, index) => (
                                            <span key={index} className="tag side-effect-tag">{effect}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 食物禁忌 */}
                            {result.aiSummary.foodInteractions.length > 0 && (
                                <div className="summary-section">
                                    <h4><IconFood size={14} /> {t('agent.foodInteractions', '食物/饮品禁忌')}</h4>
                                    <div className="tags-container">
                                        {result.aiSummary.foodInteractions.map((item, index) => (
                                            <span key={index} className="tag food-tag">{item}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 不良反应统计 */}
                    {result.adverseEvents && (
                        <div className="result-card adverse-card">
                            <h3 className="card-subtitle"><IconStethoscope size={16} /> {t('agent.adverseStats', '不良反应统计')}</h3>

                            <div className="stats-grid">
                                <div className="stat-item">
                                    <span className="stat-value">{result.adverseEvents.totalReports.toLocaleString()}</span>
                                    <span className="stat-label">{t('agent.totalReports', '总报告数')}</span>
                                </div>
                                <div className="stat-item">
                                    <span className="stat-value">{result.adverseEvents.seriousRate}%</span>
                                    <span className="stat-label">{t('agent.seriousRate', '严重事件比例')}</span>
                                </div>
                            </div>

                            {result.adverseEvents.topReactions.length > 0 && (
                                <div className="reactions-section">
                                    <h4>{t('agent.topReactions', '常见反应')} TOP 10</h4>
                                    <div className="reactions-list">
                                        {result.adverseEvents.topReactions.slice(0, 10).map((reaction, index) => (
                                            <div key={index} className="reaction-item">
                                                <span className="reaction-rank">{index + 1}</span>
                                                <span className="reaction-term">{reaction.term}</span>
                                                <div className="reaction-bar-container">
                                                    <div
                                                        className="reaction-bar"
                                                        style={{ width: `${reaction.percentage}%` }}
                                                    />
                                                </div>
                                                <span className="reaction-count">{reaction.count.toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 数据来源标注 */}
                            <div className="data-source">
                                <span>{t('agent.dataSource', '数据来源')}: {result.adverseEvents.source}</span>
                                <span>{t('agent.dataRange', '数据范围')}: {result.adverseEvents.dataRange}</span>
                                <span>{t('agent.lastUpdated', '更新时间')}: {result.adverseEvents.lastUpdated}</span>
                            </div>
                        </div>
                    )}

                    {/* 来源列表 */}
                    {result.sources.length > 0 && (
                        <div className="result-card sources-card">
                            <h3 className="card-subtitle"><IconGuide size={16} /> {t('agent.sources', '信息来源')}</h3>
                            <ul className="sources-list">
                                {result.sources.map((source, index) => (
                                    <li key={index}>{source}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* 强制免责声明 */}
                    <div className="result-card disclaimer-card">
                        <h3 className="disclaimer-title">{result.disclaimer.title}</h3>
                        <ul className="disclaimer-content">
                            {result.disclaimer.content.map((item, index) => (
                                <li key={index}>{item}</li>
                            ))}
                        </ul>
                    </div>

                    {/* 重新分析按钮 */}
                    <button className="new-analysis-button" onClick={handleReset}>
                        {t('agent.newAnalysis', '分析其他药物')}
                    </button>
                </section>
            )}

            {/* 空状态 */}
            {!isAnalyzing && !result && !error && (
                <section className="empty-section">
                    <div className="empty-content">
                        <span className="empty-icon"><IconStethoscope size={40} /></span>
                        <p className="empty-text">{t('agent.emptyHint', '输入药物名称开始分析')}</p>
                        <p className="empty-subtext">{t('agent.emptySubHint', '支持中英文药物名称')}</p>
                    </div>
                </section>
            )}
        </div>
    );
};

export default AgentAnalysisPage;
