/**
 * @file analyze-drug/index.ts
 * @description 药物分析 Edge Function
 * @endpoint POST /functions/v1/analyze-drug
 * @created 2026-02-03
 * 
 * 功能: 药物名称标准化 → 说明书查询 → 不良反应统计 → AI总结
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeDrugName } from '../_shared/rxnorm.ts';
import { getDrugLabel } from '../_shared/dailymed.ts';
import { getAdverseEvents } from '../_shared/openfda.ts';
import { summarizeDrugInfo, DISCLAIMER } from '../_shared/openai.ts';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalyzeRequest {
    drugName: string;
    language?: 'zh-CN' | 'zh-TW' | 'en';
    includeEmbedding?: boolean;
}

interface AnalyzeResponse {
    success: boolean;
    data?: {
        drugName: string;
        normalizedName?: string;
        rxcui?: string;
        adverseEvents?: {
            totalReports: number;
            seriousRate: number;
            topReactions: Array<{ term: string; count: number; percentage: number }>;
            source: string;
            dataRange: string;
            lastUpdated: string;
        };
        labelSummary?: {
            indications?: string;
            warnings?: string;
            contraindications?: string;
        };
        aiSummary?: {
            overview: string;
            keyPoints: string[];
            warnings: string[];
            commonSideEffects: string[];
            foodInteractions: string[];
        };
        disclaimer: typeof DISCLAIMER['zh-CN'];
        sources: string[];
        analyzedAt: string;
    };
    error?: string;
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // 验证请求方法
        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ success: false, error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 解析请求
        const body: AnalyzeRequest = await req.json();
        const { drugName, language = 'zh-CN' } = body;

        if (!drugName || typeof drugName !== 'string') {
            return new Response(
                JSON.stringify({ success: false, error: '请提供药物名称' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 获取环境变量
        const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
        const OPENFDA_API_KEY = Deno.env.get('OPENFDA_API_KEY');

        if (!OPENAI_API_KEY) {
            return new Response(
                JSON.stringify({ success: false, error: '服务配置错误: 缺少API密钥' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 来源列表
        const sources: string[] = [];

        // 检测是否为中文药名 (含中文字符)
        const isChinese = /[\u4e00-\u9fa5]/.test(drugName);
        let englishDrugName = drugName;

        // ========================================
        // Step 0: 中文药名翻译 (使用 OpenAI) - 强制执行
        // ========================================
        if (isChinese) {
            console.log('┌──────────────────────────────────────────────────────────');
            console.log('│ [Step 0] 🌐 中文药名翻译 (强制)');
            console.log('├──────────────────────────────────────────────────────────');
            console.log(`│ 原始输入: "${drugName}"`);
            console.log(`│ OpenAI API Key: sk-...${OPENAI_API_KEY?.slice(-8) || 'NOT_SET'}`);
            console.log('│ Model: gpt-4o-mini');
            console.log('│ ⏳ 正在调用 OpenAI 翻译...');

            const translateStart = Date.now();
            let translationSuccess = false;

            try {
                const translateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [
                            {
                                role: 'system',
                                content: `You are a pharmaceutical translator specializing in Chinese to English drug name translation.

IMPORTANT RULES:
1. Translate the Chinese drug name to its English generic name (INN - International Nonproprietary Name)
2. Only respond with the English drug name, nothing else
3. If the input includes dosage form (like 乳膏=cream, 片=tablet), include it
4. Be precise - 地奈德 is "desonide" NOT "dinoprostone"

Examples:
- 布洛芬 → ibuprofen
- 阿司匹林 → aspirin  
- 对乙酰氨基酚 → acetaminophen
- 地奈德乳膏 → desonide cream
- 氢化可的松 → hydrocortisone
- 阿莫西林 → amoxicillin`
                            },
                            {
                                role: 'user',
                                content: drugName
                            }
                        ],
                        max_tokens: 50,
                        temperature: 0,
                    }),
                });

                const translateElapsed = Date.now() - translateStart;
                console.log(`│ 📡 响应状态: ${translateResponse.status} (${translateElapsed}ms)`);

                if (translateResponse.ok) {
                    const translateData = await translateResponse.json();
                    const translatedName = translateData.choices?.[0]?.message?.content?.trim();

                    if (translatedName && translatedName.length > 0) {
                        englishDrugName = translatedName;
                        translationSuccess = true;
                        console.log(`│ ✅ 翻译成功: "${drugName}" → "${englishDrugName}"`);
                        console.log(`│ Tokens: prompt=${translateData.usage?.prompt_tokens}, completion=${translateData.usage?.completion_tokens}`);
                    } else {
                        console.log(`│ ❌ 翻译返回空值`);
                    }
                } else {
                    const errorText = await translateResponse.text();
                    console.log(`│ ❌ OpenAI API错误: ${errorText.substring(0, 200)}`);
                }
            } catch (e) {
                console.log(`│ ❌ 翻译异常: ${e}`);
            }
            console.log('└──────────────────────────────────────────────────────────');

            // 🚨 关键安全检查: 翻译失败时必须返回错误
            if (!translationSuccess) {
                console.log('🚨 翻译失败，拒绝继续执行以防止错误匹配');
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: `无法翻译中文药名"${drugName}"，请尝试输入英文药名或检查拼写。`
                    }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
        } else {
            console.log(`[Step 0] 跳过翻译 (非中文输入): "${drugName}"`);
        }
        // ========================================
        // Step 1: RxNorm 药物名称标准化 (模糊搜索)
        // ========================================
        console.log('┌──────────────────────────────────────────────────────────');
        console.log('│ [Step 1] 💊 RxNorm 药物名称标准化');
        console.log('├──────────────────────────────────────────────────────────');
        console.log(`│ 输入药名: "${englishDrugName}"`);
        console.log('│ 搜索方式: approximateTerm (模糊匹配)');
        console.log('│ ⏳ 正在查询 RxNorm API...');

        const normResult = await normalizeDrugName(englishDrugName);

        let rxcui: string | undefined;
        let normalizedName: string | undefined;

        if (normResult.success && normResult.rxcui) {
            rxcui = normResult.rxcui;
            normalizedName = normResult.normalizedName;
            sources.push('RxNorm (NIH)');
            console.log(`│ ✅ 标准化成功!`);
            console.log(`│   RxCUI: ${rxcui}`);
            console.log(`│   标准名称: ${normalizedName}`);
            if (normResult.alternatives && normResult.alternatives.length > 0) {
                console.log(`│   备选: ${normResult.alternatives.map(a => a.name).slice(0, 3).join(', ')}`);
            }
        } else {
            console.log(`│ ❌ 标准化失败: ${normResult.error}`);
        }
        console.log('└──────────────────────────────────────────────────────────');

        // ========================================
        // Step 2: DailyMed 药物说明书提取
        // ========================================
        console.log('┌──────────────────────────────────────────────────────────');
        console.log('│ [Step 2] 📋 DailyMed 药物说明书');
        console.log('├──────────────────────────────────────────────────────────');
        console.log(`│ 查询方式: ${rxcui ? `RxCUI (${rxcui})` : `药名 (${drugName})`}`);
        console.log('│ ⏳ 正在提取说明书...');

        let labelSections: Record<string, string> = {};
        let labelSummary: AnalyzeResponse['data'] extends { labelSummary?: infer T } ? T : never = undefined;

        const labelResult = rxcui
            ? await getDrugLabel(rxcui, true)
            : await getDrugLabel(drugName, false);

        if (labelResult.success && labelResult.keySections) {
            sources.push('DailyMed药物说明书 (NIH)');

            // 提取文本内容
            if (labelResult.keySections.indications) {
                labelSections.indications = labelResult.keySections.indications.text;
            }
            if (labelResult.keySections.dosage) {
                labelSections.dosage = labelResult.keySections.dosage.text;
            }
            if (labelResult.keySections.contraindications) {
                labelSections.contraindications = labelResult.keySections.contraindications.text;
            }
            if (labelResult.keySections.warnings) {
                labelSections.warnings = labelResult.keySections.warnings.text;
            }
            if (labelResult.keySections.adverseReactions) {
                labelSections.adverseReactions = labelResult.keySections.adverseReactions.text;
            }
            if (labelResult.keySections.drugInteractions) {
                labelSections.drugInteractions = labelResult.keySections.drugInteractions.text;
            }

            labelSummary = {
                indications: labelSections.indications?.slice(0, 500),
                warnings: labelSections.warnings?.slice(0, 500),
                contraindications: labelSections.contraindications?.slice(0, 500),
            };

            const sectionCount = Object.keys(labelSections).length;
            console.log(`│ ✅ 说明书提取成功!`);
            console.log(`│   获取章节: ${sectionCount} 个 (${Object.keys(labelSections).join(', ')})`);
        } else {
            console.log(`│ ⚠️ 未找到说明书: ${labelResult.error || '无匹配结果'}`);
        }
        console.log('└──────────────────────────────────────────────────────────');

        // ========================================
        // Step 3: OpenFDA 不良反应统计
        // ========================================
        console.log('┌──────────────────────────────────────────────────────────');
        console.log('│ [Step 3] ⚠️ OpenFDA 不良反应统计');
        console.log('├──────────────────────────────────────────────────────────');
        const searchName = normalizedName || englishDrugName;
        console.log(`│ 查询药名: "${searchName}"`);
        console.log('│ ⏳ 正在查询FAERS数据库...');

        const fdaResult = await getAdverseEvents(searchName, OPENFDA_API_KEY);

        let adverseEvents: AnalyzeResponse['data'] extends { adverseEvents?: infer T } ? T : never = undefined;

        if (fdaResult.success && fdaResult.adverseEvents) {
            sources.push('OpenFDA FAERS不良事件数据库');
            adverseEvents = fdaResult.adverseEvents;
            console.log(`│ ✅ 不良反应数据获取成功!`);
            console.log(`│   总报告数: ${adverseEvents.totalReports}`);
            console.log(`│   严重事件率: ${(adverseEvents.seriousRate * 100).toFixed(1)}%`);
            console.log(`│   Top反应: ${adverseEvents.topReactions?.slice(0, 3).map(r => r.term).join(', ')}`);
        } else {
            console.log(`│ ⚠️ 未找到不良反应数据: ${fdaResult.error || '无匹配结果'}`);
        }
        console.log('└──────────────────────────────────────────────────────────');

        // ========================================
        // Step 4: OpenAI 智能总结
        // ========================================
        console.log('┌──────────────────────────────────────────────────────────');
        console.log('│ [Step 4] 🤖 OpenAI 智能总结');
        console.log('├──────────────────────────────────────────────────────────');
        console.log(`│ OpenAI API Key: sk-...${OPENAI_API_KEY?.slice(-8) || 'NOT_SET'}`);

        let aiSummary: AnalyzeResponse['data'] extends { aiSummary?: infer T } ? T : never = undefined;

        // 只有在有来源数据时才生成总结
        const hasLabelData = Object.keys(labelSections).length > 0;
        const hasAdverseData = !!adverseEvents;

        if (hasLabelData || hasAdverseData) {
            console.log(`│ 数据来源: ${[hasLabelData ? 'DailyMed' : '', hasAdverseData ? 'OpenFDA' : ''].filter(Boolean).join(' + ')}`);
            console.log('│ ⏳ 正在生成AI总结...');

            const summaryStart = Date.now();
            try {
                const summaryResult = await summarizeDrugInfo({
                    drugName,
                    normalizedName,
                    labelSections: hasLabelData ? labelSections : undefined,
                    adverseStats: adverseEvents ? {
                        totalReports: adverseEvents.totalReports,
                        seriousRate: adverseEvents.seriousRate,
                        topReactions: adverseEvents.topReactions,
                    } : undefined,
                    language,
                }, OPENAI_API_KEY);

                aiSummary = {
                    overview: summaryResult.overview,
                    keyPoints: summaryResult.keyPoints,
                    warnings: summaryResult.warnings,
                    commonSideEffects: summaryResult.commonSideEffects,
                    foodInteractions: summaryResult.foodInteractions,
                };

                const summaryElapsed = Date.now() - summaryStart;
                console.log(`│ ✅ AI总结生成成功! (${summaryElapsed}ms)`);
                console.log(`│   概述: ${aiSummary.overview?.substring(0, 50)}...`);
            } catch (error) {
                console.log(`│ ❌ AI总结失败: ${error}`);
                // 继续执行，只是没有AI总结
            }
        } else {
            console.log('│ ⚠️ 跳过AI总结 (无数据来源)');
        }
        console.log('└──────────────────────────────────────────────────────────');

        // 最终工作流总结
        console.log('╔══════════════════════════════════════════════════════════');
        console.log('║ 📊 工作流执行总结');
        console.log('╠══════════════════════════════════════════════════════════');
        console.log(`║ 原始输入: "${drugName}"`);
        console.log(`║ 翻译结果: "${englishDrugName}"`);
        console.log(`║ 标准名称: "${normalizedName || 'N/A'}" (RxCUI: ${rxcui || 'N/A'})`);
        console.log(`║ 数据来源: ${sources.join(' → ')}`);
        console.log('╚══════════════════════════════════════════════════════════');

        // 构建响应
        const response: AnalyzeResponse = {
            success: true,
            data: {
                drugName,
                normalizedName,
                rxcui,
                adverseEvents,
                labelSummary,
                aiSummary,
                disclaimer: DISCLAIMER[language] || DISCLAIMER['zh-CN'],
                sources,
                analyzedAt: new Date().toISOString(),
            },
        };

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('[analyze-drug] Error:', error);

        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '分析失败，请稍后重试'
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
