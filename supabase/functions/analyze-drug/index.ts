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
import { normalizeDrugName, findDrugByName, type RxNormConcept } from '../_shared/rxnorm.ts';
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
    userId?: string; // 可选：用于将请求/日志写入 Supabase
    source?: 'text' | 'ocr' | 'manual';
}

type WorkflowStatus = 'start' | 'success' | 'error' | 'skip' | 'info';

interface WorkflowLog {
    step: string;
    status: WorkflowStatus;
    message: string;
    timestamp: string;
    meta?: Record<string, unknown>;
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
    workflowLogs?: WorkflowLog[];
    workflowOverview?: WorkflowOverviewItem[];
    error?: string;
}

interface TranslationAlignmentResult {
    translatedName: string;
    alignedName?: string;
    alignedRxcui?: string;
    rxnormCandidates: RxNormConcept[];
}

interface WorkflowOverviewItem {
    step: string;
    status: WorkflowStatus;
    detail: string;
    meta?: Record<string, unknown>;
}

/**
 * 将请求与工作流日志写入 Supabase
 */
async function persistRequestAndLogs(options: {
    userId?: string;
    source?: 'text' | 'ocr' | 'manual';
    inputText: string;
    normalizedName?: string;
    rxcui?: string;
    success: boolean;
    error?: string;
    workflowLogs: WorkflowLog[];
}) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        addWorkflowLog(options.workflowLogs, 'step6.persist', 'skip', '未配置 SUPABASE_SERVICE_ROLE_KEY，跳过落库');
        return;
    }

    if (!options.userId) {
        addWorkflowLog(options.workflowLogs, 'step6.persist', 'skip', '未提供 userId，跳过落库');
        return;
    }

    // 插入 analyze_requests
    const { data: requestRow, error: reqError } = await supabase
        .from('analyze_requests')
        .insert({
            user_id: options.userId,
            source: options.source || 'text',
            input_text: options.inputText,
            normalized_name: options.normalizedName,
            rxcui: options.rxcui,
            status: options.success ? 'success' : 'failed',
            error: options.error || null,
            analyzed_at: new Date().toISOString(),
        })
        .select('id')
        .single();

    if (reqError || !requestRow?.id) {
        addWorkflowLog(options.workflowLogs, 'step6.persist', 'error', '写入 analyze_requests 失败', {
            message: reqError?.message,
        });
        return;
    }

    // 批量写入工作流日志
    const logsPayload = options.workflowLogs.map((log) => ({
        request_id: requestRow.id,
        step: log.step,
        status: log.status,
        message: log.message,
        meta: log.meta || null,
    }));

    const { error: logError } = await supabase.from('analyze_workflow_logs').insert(logsPayload);

    if (logError) {
        addWorkflowLog(options.workflowLogs, 'step6.persist', 'error', '写入 analyze_workflow_logs 失败', {
            message: logError.message,
        });
        return;
    }

    addWorkflowLog(options.workflowLogs, 'step6.persist', 'success', '日志已落库', {
        requestId: requestRow.id,
        logCount: logsPayload.length,
    });
}

/**
 * 添加工作流日志并输出到控制台
 */
function addWorkflowLog(
    logs: WorkflowLog[],
    step: string,
    status: WorkflowStatus,
    message: string,
    meta?: Record<string, unknown>
) {
    const entry: WorkflowLog = {
        step,
        status,
        message,
        timestamp: new Date().toISOString(),
        ...(meta ? { meta } : {}),
    };

    logs.push(entry);

    const metaText = meta ? ` | meta=${JSON.stringify(meta)}` : '';
    console.log(`[${step}] ${status.toUpperCase()} - ${message}${metaText}`);
}

/**
 * 添加概览表项
 */
function addOverviewItem(
    items: WorkflowOverviewItem[],
    step: string,
    status: WorkflowStatus,
    detail: string,
    meta?: Record<string, unknown>
) {
    items.push({
        step,
        status,
        detail,
        ...(meta ? { meta } : {}),
    });
}

/**
 * 获取 Supabase 客户端（服务角色）
 */
function getSupabaseClient() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
        return null;
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

/**
 * 使用 OpenAI 翻译中文药名，并结合 RxNorm 候选对齐
 */
async function translateAndAlignDrugName(
    originalName: string,
    openaiKey: string,
    logs: WorkflowLog[]
): Promise<TranslationAlignmentResult> {
    addWorkflowLog(logs, 'step0.translate', 'start', `检测到中文药名: "${originalName}"`);

    const translateStart = Date.now();
    const translateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You map Chinese drug names to RxNorm-compatible English generic names (INN) and dosage forms.

Output strictly in JSON: {"candidates": [string, ...]}

Rules:
- Provide 1-3 candidate names (most likely first), RxNorm-friendly spelling.
- Include dosage form if input implies it (乳膏=cream, 片=tablet, 胶囊=capsule, 喷雾=spray).
- Prefer generic/INN naming; avoid prostaglandins unless clearly indicated.
- Common pitfalls: "地奈德" => "desonide" (topical steroid), NOT dinoprostone.`,
                },
                { role: 'user', content: originalName },
            ],
            max_tokens: 120,
            temperature: 0,
            response_format: { type: 'json_object' },
        }),
    });
    const translateElapsed = Date.now() - translateStart;

    if (!translateResponse.ok) {
        const errorText = await translateResponse.text();
        addWorkflowLog(logs, 'step0.translate', 'error', 'OpenAI 翻译接口调用失败', {
            status: translateResponse.status,
            error: errorText.substring(0, 200),
            durationMs: translateElapsed,
        });
        throw new Error('无法完成中文药名翻译');
    }

    const translateData = await translateResponse.json();
    let candidates: string[] = [];

    try {
        const parsed = JSON.parse(translateData.choices?.[0]?.message?.content || '{}');
        candidates = Array.isArray(parsed.candidates)
            ? parsed.candidates.filter((c: unknown) => typeof c === 'string' && c.trim().length > 0).map((c: string) => c.trim())
            : [];
    } catch {
        // ignore parse error; handled below
    }

    if (candidates.length === 0) {
        addWorkflowLog(logs, 'step0.translate', 'error', 'OpenAI 翻译返回空结果');
        throw new Error(`无法翻译中文药名"${originalName}"，请尝试输入英文药名或检查拼写。`);
    }

    const primaryCandidate = candidates[0];
    addWorkflowLog(logs, 'step0.translate', 'success', `OpenAI 翻译候选: ${candidates.join(' | ')}`, {
        model: 'gpt-4o-mini',
        promptTokens: translateData.usage?.prompt_tokens,
        completionTokens: translateData.usage?.completion_tokens,
        durationMs: translateElapsed,
    });

    // 组合 RxNorm 候选（对每个翻译名进行搜索去重）
    const aggregated: Map<string, RxNormConcept> = new Map();

    for (const candidateName of candidates) {
        try {
            const rxCands = await findDrugByName(candidateName);
            rxCands.forEach(c => {
                if (!aggregated.has(c.rxcui)) {
                    aggregated.set(c.rxcui, c);
                }
            });
            addWorkflowLog(logs, 'step0.align', 'info', `RxNorm 候选 (${candidateName}): ${rxCands.length} 个`, {
                preview: rxCands.slice(0, 3).map(c => ({ name: c.name, rxcui: c.rxcui, tty: c.tty, score: c.score })),
            });
        } catch (error) {
            addWorkflowLog(logs, 'step0.align', 'error', `获取 RxNorm 候选失败 (${candidateName})`, {
                message: error instanceof Error ? error.message : 'unknown error',
            });
        }
    }

    const rxnormCandidates = Array.from(aggregated.values());

    if (rxnormCandidates.length === 0) {
        addWorkflowLog(logs, 'step0.align', 'skip', '未找到任何 RxNorm 候选，使用首个翻译继续');
        return { translatedName: primaryCandidate, rxnormCandidates };
    }

    // OpenAI 选择最佳候选
    const alignStart = Date.now();
    const alignmentResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `Select the best RxNorm candidate for the given Chinese drug name.
Reply JSON only: {"rxnormName": string|null, "rxcui": string|null}
Rules:
- Choose only from provided candidates.
- Prefer ingredients (TTY=IN) or clinical drugs (TTY=SCD/SBD); avoid unrelated prostaglandins.
- Respect topical dosage forms when present (cream/ointment/lotion).`,
                },
                {
                    role: 'user',
                    content:
                        `Original Chinese name: ${originalName}\n` +
                        `Translation candidates: ${candidates.join(', ')}\n` +
                        `RxNorm candidates:\n` +
                        rxnormCandidates
                            .slice(0, 12)
                            .map(c => `- ${c.name} (tty=${c.tty}, rxcui=${c.rxcui}${c.score ? `, score=${c.score}` : ''})`)
                            .join('\n'),
                },
            ],
            temperature: 0,
            max_tokens: 120,
            response_format: { type: 'json_object' },
        }),
    });
    const alignElapsed = Date.now() - alignStart;

    if (!alignmentResponse.ok) {
        const errorText = await alignmentResponse.text();
        addWorkflowLog(logs, 'step0.align', 'error', 'OpenAI 对齐失败，使用首个候选继续', {
            status: alignmentResponse.status,
            error: errorText.substring(0, 200),
            durationMs: alignElapsed,
        });
        const fallback = rxnormCandidates[0];
        return { translatedName: primaryCandidate, alignedName: fallback.name, alignedRxcui: fallback.rxcui, rxnormCandidates };
    }

    const alignmentData = await alignmentResponse.json();
    let alignedName: string | undefined;
    let alignedRxcui: string | undefined;

    try {
        const parsed = JSON.parse(alignmentData.choices?.[0]?.message?.content || '{}');
        alignedName = parsed.rxnormName || undefined;
        alignedRxcui = parsed.rxcui || undefined;
    } catch {
        const fallback = rxnormCandidates[0];
        addWorkflowLog(logs, 'step0.align', 'error', 'OpenAI 对齐结果解析失败，使用首个候选继续');
        return { translatedName: primaryCandidate, alignedName: fallback.name, alignedRxcui: fallback.rxcui, rxnormCandidates };
    }

    if (alignedName) {
        addWorkflowLog(logs, 'step0.align', 'success', `RxNorm 对齐结果: "${alignedName}"`, {
            rxcui: alignedRxcui,
            durationMs: alignElapsed,
        });
        return {
            translatedName: primaryCandidate,
            alignedName,
            alignedRxcui,
            rxnormCandidates,
        };
    }

    addWorkflowLog(logs, 'step0.align', 'skip', 'OpenAI 未选择候选，使用首个翻译继续');
    return { translatedName: primaryCandidate, rxnormCandidates };
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const workflowLogs: WorkflowLog[] = [];
    const workflowOverview: WorkflowOverviewItem[] = [];

    try {
        // 验证请求方法
        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ success: false, error: 'Method not allowed', workflowLogs, workflowOverview }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 解析请求
        const body: AnalyzeRequest = await req.json();
        const { drugName, language = 'zh-CN' } = body;

        if (!drugName || typeof drugName !== 'string') {
            return new Response(
                JSON.stringify({ success: false, error: '请提供药物名称', workflowLogs, workflowOverview }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 获取环境变量
        const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
        const OPENFDA_API_KEY = Deno.env.get('OPENFDA_API_KEY');

        if (!OPENAI_API_KEY) {
            return new Response(
                JSON.stringify({ success: false, error: '服务配置错误: 缺少API密钥', workflowLogs, workflowOverview }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 来源列表
        const sources: string[] = [];

        // 检测是否为中文药名 (含中文字符)
        const isChinese = /[\u4e00-\u9fa5]/.test(drugName);
        let englishDrugName = drugName;
        let alignmentRxcui: string | undefined;

        // ========================================
        // Step 0: 中文药名翻译 (使用 OpenAI) - 强制执行
        // ========================================
        if (isChinese) {
            try {
                const translationResult = await translateAndAlignDrugName(drugName, OPENAI_API_KEY, workflowLogs);
                englishDrugName = translationResult.alignedName || translationResult.translatedName;
                alignmentRxcui = translationResult.alignedRxcui;
                addOverviewItem(workflowOverview, '翻译/对齐 (OpenAI×2)', 'success', `译名: ${englishDrugName}`, {
                    alignedRxcui: alignmentRxcui || 'N/A',
                });
            } catch (error) {
                addWorkflowLog(
                    workflowLogs,
                    'step0.translate',
                    'error',
                    error instanceof Error ? error.message : '翻译失败'
                );

                return new Response(
                    JSON.stringify({
                        success: false,
                        error: error instanceof Error ? error.message : '无法完成中文药名翻译',
                        workflowLogs,
                        workflowOverview,
                    }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
        } else {
            addWorkflowLog(workflowLogs, 'step0.translate', 'skip', `输入非中文，使用原文: "${drugName}"`);
            addOverviewItem(workflowOverview, '翻译/对齐 (OpenAI×2)', 'skip', '输入非中文，跳过翻译');
        }
        // ========================================
        // Step 1: RxNorm 药物名称标准化 (模糊搜索)
        // ========================================
        addWorkflowLog(workflowLogs, 'step1.rxnorm', 'start', `标准化药名: "${englishDrugName}"`);

        const normResult = await normalizeDrugName(englishDrugName);

        let rxcui: string | undefined;
        let normalizedName: string | undefined;

        if (normResult.success && normResult.rxcui) {
            rxcui = normResult.rxcui;
            normalizedName = normResult.normalizedName;
            sources.push('RxNorm (NIH)');
            addWorkflowLog(workflowLogs, 'step1.rxnorm', 'success', 'RxNorm 标准化成功', {
                rxcui,
                normalizedName,
                alternatives: normResult.alternatives?.slice(0, 3).map(a => ({ name: a.name, tty: a.tty })),
            });
            addOverviewItem(workflowOverview, 'RxNorm', 'success', normalizedName || '已匹配', { rxcui });
        } else {
            addWorkflowLog(workflowLogs, 'step1.rxnorm', 'error', `标准化失败: ${normResult.error || '无匹配结果'}`, { alignmentRxcui });

            // 如果翻译阶段已有对齐的RxCUI，作为后备
            if (alignmentRxcui) {
                rxcui = alignmentRxcui;
                normalizedName = englishDrugName;
                addWorkflowLog(workflowLogs, 'step1.rxnorm', 'info', '使用翻译阶段返回的 RxCUI 作为后备', {
                    rxcui,
                    normalizedName,
                });
                sources.push('RxNorm (NIH)');
                addOverviewItem(workflowOverview, 'RxNorm', 'info', normalizedName || '使用翻译对齐', { rxcui });
            } else {
                addOverviewItem(workflowOverview, 'RxNorm', 'error', normResult.error || '无匹配结果');
            }
        }

        // ========================================
        // Step 2: DailyMed 药物说明书提取
        // ========================================
        addWorkflowLog(workflowLogs, 'step2.dailymed', 'start', `查询方式: ${rxcui ? `RxCUI ${rxcui}` : `药名 ${englishDrugName}`}`);

        const labelSections: Record<string, string> = {};
        let labelSummary: AnalyzeResponse['data'] extends { labelSummary?: infer T } ? T : never = undefined;

        const labelResult = rxcui
            ? await getDrugLabel(rxcui, true)
            : await getDrugLabel(englishDrugName, false);

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
            addWorkflowLog(workflowLogs, 'step2.dailymed', 'success', `说明书提取成功 (${sectionCount} 个章节)`, {
                sections: Object.keys(labelSections),
            });
            addOverviewItem(workflowOverview, 'DailyMed', 'success', `章节: ${sectionCount}`, {
                sections: Object.keys(labelSections),
            });
        } else {
            addWorkflowLog(workflowLogs, 'step2.dailymed', 'error', `未找到说明书: ${labelResult.error || '无匹配结果'}`);
            addOverviewItem(workflowOverview, 'DailyMed', 'error', labelResult.error || '未找到说明书');
        }

        // ========================================
        // Step 3: OpenFDA 不良反应统计
        // ========================================
        const searchName = normalizedName || englishDrugName;
        addWorkflowLog(workflowLogs, 'step3.openfda', 'start', `查询药名: "${searchName}"`);

        const fdaResult = await getAdverseEvents(searchName, OPENFDA_API_KEY);

        let adverseEvents: AnalyzeResponse['data'] extends { adverseEvents?: infer T } ? T : never = undefined;

        if (fdaResult.success && fdaResult.adverseEvents) {
            sources.push('OpenFDA FAERS不良事件数据库');
            adverseEvents = fdaResult.adverseEvents;
            addWorkflowLog(workflowLogs, 'step3.openfda', 'success', '不良反应数据获取成功', {
                totalReports: adverseEvents.totalReports,
                seriousRate: adverseEvents.seriousRate,
                topReactions: adverseEvents.topReactions?.slice(0, 3).map(r => r.term),
            });
            addOverviewItem(workflowOverview, 'OpenFDA', 'success', `报告: ${adverseEvents.totalReports}`, {
                seriousRate: adverseEvents.seriousRate,
            });
        } else {
            addWorkflowLog(workflowLogs, 'step3.openfda', 'error', `未找到不良反应数据: ${fdaResult.error || '无匹配结果'}`);
            addOverviewItem(workflowOverview, 'OpenFDA', 'error', fdaResult.error || '无匹配结果');
        }

        // ========================================
        // Step 4: OpenAI 智能总结
        // ========================================
        addWorkflowLog(workflowLogs, 'step4.summary', 'start', '准备调用 OpenAI 生成总结');

        let aiSummary: AnalyzeResponse['data'] extends { aiSummary?: infer T } ? T : never = undefined;

        // 只有在有来源数据时才生成总结
        const hasLabelData = Object.keys(labelSections).length > 0;
        const hasAdverseData = !!adverseEvents;

        if (hasLabelData || hasAdverseData) {
            addWorkflowLog(
                workflowLogs,
                'step4.summary',
                'info',
                `数据来源: ${[hasLabelData ? 'DailyMed' : '', hasAdverseData ? 'OpenFDA' : ''].filter(Boolean).join(' + ')}`
            );

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
                addWorkflowLog(workflowLogs, 'step4.summary', 'success', `AI 总结生成成功 (${summaryElapsed}ms)`, {
                    overviewPreview: aiSummary.overview?.substring(0, 80),
                });
                addOverviewItem(workflowOverview, 'OpenAI 总结', 'success', '已生成', {
                    durationMs: summaryElapsed,
                });
            } catch (error) {
                addWorkflowLog(workflowLogs, 'step4.summary', 'error', 'AI 总结失败', {
                    message: error instanceof Error ? error.message : '未知错误',
                });
                addOverviewItem(workflowOverview, 'OpenAI 总结', 'error', error instanceof Error ? error.message : '未知错误');
                // 继续执行，只是没有AI总结
            }
        } else {
            addWorkflowLog(workflowLogs, 'step4.summary', 'skip', '无可用来源，跳过AI总结');
            addOverviewItem(workflowOverview, 'OpenAI 总结', 'skip', '无数据来源跳过');
        }

        // 数据持久化（当前未开启）
        addWorkflowLog(workflowLogs, 'step5.storage', 'info', '准备写入 Supabase（如配置）');
        addOverviewItem(workflowOverview, 'Supabase 存储', 'info', '如配置 service_role + userId 则入库');

        // 持久化到 Supabase（需要 service role key & userId）
        await persistRequestAndLogs({
            userId: body.userId,
            source: body.source || (isChinese ? 'text' : 'text'),
            inputText: drugName,
            normalizedName: normalizedName || englishDrugName,
            rxcui,
            success: response.success,
            error: response.success ? undefined : response.error,
            workflowLogs,
        });

        // 最终工作流总结
        addWorkflowLog(workflowLogs, 'summary', 'info', '工作流完成', {
            input: drugName,
            translated: englishDrugName,
            normalizedName: normalizedName || 'N/A',
            rxcui: rxcui || 'N/A',
            sources,
        });

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
            workflowLogs,
            workflowOverview,
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
                error: error instanceof Error ? error.message : '分析失败，请稍后重试',
                workflowLogs,
                workflowOverview,
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
