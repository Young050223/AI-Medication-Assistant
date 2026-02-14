/**
 * @file openai.ts
 * @description OpenAI API共享模块 - 文本总结和向量生成
 * @location Supabase Edge Function (_shared)
 * @created 2026-02-03
 * 
 * 核心原则: "只总结来源内容，不新增事实"
 */

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// =============================================
// 免责声明 (多语言)
// =============================================

export const DISCLAIMER = {
    'zh-CN': {
        title: '⚠️ 重要声明',
        content: [
            '本信息仅供参考，不构成医疗诊断或治疗建议。',
            '如有任何身体不适，请立即停药并咨询医生。',
            '请遵医嘱用药，不要自行调整剂量或停药。',
        ],
    },
    'zh-TW': {
        title: '⚠️ 重要聲明',
        content: [
            '本資訊僅供參考，不構成醫療診斷或治療建議。',
            '如有任何身體不適，請立即停藥並諮詢醫生。',
            '請遵醫囑用藥，不要自行調整劑量或停藥。',
        ],
    },
    'en': {
        title: '⚠️ Important Disclaimer',
        content: [
            'This information is for reference only and does not constitute medical advice.',
            'If you experience any discomfort, stop taking the medication and consult a doctor.',
            'Follow your doctor\'s instructions. Do not adjust dosage on your own.',
        ],
    },
};

// =============================================
// 类型定义
// =============================================

export interface DrugSummaryInput {
    drugName: string;
    normalizedName?: string;
    labelSections?: {
        indications?: string;
        dosage?: string;
        contraindications?: string;
        warnings?: string;
        adverseReactions?: string;
        drugInteractions?: string;
    };
    adverseStats?: {
        totalReports: number;
        seriousRate: number;
        topReactions: Array<{ term: string; count: number }>;
    };
    language?: 'zh-CN' | 'zh-TW' | 'en';
}

export interface DrugSummaryOutput {
    overview: string;
    keyPoints: string[];
    warnings: string[];
    commonSideEffects: string[];
    foodInteractions: string[];
    disclaimer: typeof DISCLAIMER['zh-CN'];
    sources: string[];
}

// =============================================
// 向量生成
// =============================================

/**
 * 生成文本向量
 * @param text 输入文本
 * @param apiKey OpenAI API Key
 * @returns 1536维向量
 */
export async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
    console.log(`[OpenAI] 生成Embedding, 输入长度=${text.length}`);
    const startTime = Date.now();

    const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: text,
            encoding_format: 'float',
        }),
    });

    const elapsed = Date.now() - startTime;
    console.log(`[OpenAI] Embedding响应: status=${response.status}, time=${elapsed}ms`);

    if (!response.ok) {
        const error = await response.text();
        console.error('[OpenAI] Embedding API错误:', error);
        throw new Error(`OpenAI Embedding API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log(`[OpenAI] Embedding维度: ${data.data[0].embedding.length}`);
    return data.data[0].embedding;
}

// =============================================
// 药物信息总结
// =============================================

/**
 * 构建系统提示词
 * 核心: 只总结来源内容，不新增事实
 */
function buildSystemPrompt(language: string): string {
    const langInstructions: Record<string, string> = {
        'zh-CN': '请用简体中文回复。',
        'zh-TW': '請用繁體中文回覆。',
        'en': 'Please respond in English.',
    };

    return `你是一个药物信息总结助手。你的任务是总结已提供的药物信息。

## 核心原则
1. **只总结已提供的来源内容，绝不新增任何医学事实或建议**
2. **不做任何诊断或治疗建议**
3. **如果来源信息不足，明确说明"来源信息中未提及"**
4. **所有输出必须标注信息来源**

## 输出要求
${langInstructions[language] || langInstructions['zh-CN']}

请以JSON格式输出，包含以下字段：
- overview: 药物简要概述（1-2句）
- keyPoints: 关键要点数组（3-5个要点）
- warnings: 警告事项数组（来自来源）
- commonSideEffects: 常见副作用数组（来自来源统计）
- foodInteractions: 食物/饮品禁忌数组（如来源未提及则为空数组）

严格基于提供的来源信息回答，不要添加任何来源中没有的信息。`;
}

/**
 * 构建用户提示词
 */
function buildUserPrompt(input: DrugSummaryInput): string {
    let prompt = `## 药物名称\n${input.drugName}`;

    if (input.normalizedName && input.normalizedName !== input.drugName) {
        prompt += ` (标准名: ${input.normalizedName})`;
    }

    prompt += '\n\n## 来源信息\n';

    if (input.labelSections) {
        prompt += '\n### 来源1: DailyMed药物说明书\n';

        if (input.labelSections.indications) {
            prompt += `\n**适应症:**\n${input.labelSections.indications.slice(0, 1000)}\n`;
        }
        if (input.labelSections.warnings) {
            prompt += `\n**警告:**\n${input.labelSections.warnings.slice(0, 1000)}\n`;
        }
        if (input.labelSections.contraindications) {
            prompt += `\n**禁忌症:**\n${input.labelSections.contraindications.slice(0, 1000)}\n`;
        }
        if (input.labelSections.adverseReactions) {
            prompt += `\n**不良反应:**\n${input.labelSections.adverseReactions.slice(0, 1000)}\n`;
        }
        if (input.labelSections.drugInteractions) {
            prompt += `\n**药物相互作用:**\n${input.labelSections.drugInteractions.slice(0, 1000)}\n`;
        }
    }

    if (input.adverseStats) {
        prompt += '\n### 来源2: OpenFDA不良事件统计\n';
        prompt += `- 总报告数: ${input.adverseStats.totalReports}\n`;
        prompt += `- 严重事件比例: ${input.adverseStats.seriousRate}%\n`;

        if (input.adverseStats.topReactions.length > 0) {
            prompt += '- 最常报告的反应:\n';
            input.adverseStats.topReactions.slice(0, 10).forEach((r, i) => {
                prompt += `  ${i + 1}. ${r.term} (${r.count}例)\n`;
            });
        }
    }

    prompt += '\n请基于以上来源信息进行总结，不要添加任何来源中没有的信息。';

    return prompt;
}

/**
 * 生成药物信息总结 (主入口)
 */
export async function summarizeDrugInfo(
    input: DrugSummaryInput,
    apiKey: string
): Promise<DrugSummaryOutput> {
    const language = input.language || 'zh-CN';

    console.log(`[OpenAI] 生成药物总结, drug=${input.drugName}, lang=${language}`);
    console.log(`[OpenAI] 有说明书数据: ${!!input.labelSections}, 有统计数据: ${!!input.adverseStats}`);

    const startTime = Date.now();
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-5.2',
            messages: [
                { role: 'system', content: buildSystemPrompt(language) },
                { role: 'user', content: buildUserPrompt(input) },
            ],
            temperature: 0.3, // 低温度，减少创造性
            max_tokens: 1000,
            response_format: { type: 'json_object' },
        }),
    });

    const elapsed = Date.now() - startTime;
    console.log(`[OpenAI] Chat响应: status=${response.status}, time=${elapsed}ms`);

    if (!response.ok) {
        const error = await response.text();
        console.error('[OpenAI] Chat API错误:', error);
        throw new Error(`OpenAI Chat API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
        throw new Error('OpenAI返回空内容');
    }

    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch {
        throw new Error('OpenAI返回格式错误');
    }

    // 构建来源列表
    const sources: string[] = [];
    if (input.labelSections) {
        sources.push('DailyMed药物说明书 (NIH)');
    }
    if (input.adverseStats) {
        sources.push('OpenFDA FAERS不良事件数据库');
    }

    return {
        overview: parsed.overview || '',
        keyPoints: parsed.keyPoints || [],
        warnings: parsed.warnings || [],
        commonSideEffects: parsed.commonSideEffects || [],
        foodInteractions: parsed.foodInteractions || [],
        disclaimer: DISCLAIMER[language] || DISCLAIMER['zh-CN'],
        sources,
    };
}
