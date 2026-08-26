export type AgentStyle = 'friendly' | 'efficient';

export const DEFAULT_AGENT_STYLE: AgentStyle = 'efficient';

export function isAgentStyle(value: unknown): value is AgentStyle {
    return value === 'friendly' || value === 'efficient';
}

export function normalizeAgentStyle(value: unknown): AgentStyle {
    return isAgentStyle(value) ? value : DEFAULT_AGENT_STYLE;
}

export function buildAgentStylePrompt(params: {
    agentStyle: AgentStyle;
    language: string;
    forcePlanEvidence?: boolean;
}): string {
    const { agentStyle, language, forcePlanEvidence = false } = params;
    const langMap: Record<string, string> = {
        'zh-CN': '请用简体中文回复。',
        'zh-TW': '請用繁體中文回覆。',
        'en': 'Please respond in English.',
    };

    const sharedRules = [
        '所有医疗安全规则始终高于风格规则。',
        '绝不输出纯文本的“依据:”或“引用:”段落；来源展示由结构化字段完成。',
        '如果涉及停药、换药、加药，必须提醒用户最终由医生确认。',
        '不要使用空泛鼓励、套话或模板化寒暄。',
        '使用有限 Markdown 排版：用 ##/### 分章节，用 **加粗** 突出结论、风险和动作，需要列举时使用 - 列表。',
        '短回复可以只用短段落；避免代码块、复杂表格和过度装饰，不要为了排版改变事实或新增内容。',
    ];

    const styleSpecificRules: Record<AgentStyle, string[]> = {
        // 对齐“温柔详细关怀”风格。
        friendly: [
            '语气温柔、关怀、耐心，但不要夸张安抚。',
            '可以先用一句短句接住用户情绪，再进入建议。',
            '解释时适度补充原因、观察点和下一步，让用户理解为什么这样建议。',
            '在确实能提高帮助质量时，只补一个聚焦追问，不要连续追问。',
            '允许比务实风格更详细，但仍要控制层次清楚、避免冗长。',
        ],
        // 对齐“专业简单直观”风格。
        efficient: [
            '语气专业、简单、直观。',
            '先给结论或行动建议，再补最必要的原因。',
            '尽量用短句，不写多余铺垫，不重复同一个意思。',
            '优先保留用户能立即判断或执行的信息。',
            '只有在安全判断必须时才追问。',
            '需要分点时使用短列表，但每条都要有明确动作或判断价值。',
        ],
    };

    const planRule = forcePlanEvidence
        ? '当前问题属于用药计划相关，回答时要自然融合最新计划、过往记录和反馈，不要机械拼接附录。'
        : '';

    return `你正在使用当前用户选择的答复风格：${agentStyle === 'friendly' ? '温柔详细关怀' : '专业简单直观'}。

## 风格规则
${[...sharedRules, ...styleSpecificRules[agentStyle], planRule].filter(Boolean).map((item) => `- ${item}`).join('\n')}

${langMap[language] || langMap['zh-CN']}`;
}
