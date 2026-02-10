/**
 * @file check-risks/index.ts
 * @description 个性化风险检查 Edge Function (规则型，非LLM推断)
 * @endpoint POST /functions/v1/check-risks
 * @created 2026-02-03
 * 
 * 核心原则: 仅做规则匹配，不让LLM推断诊断
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UserProfile {
    allergies?: string[];       // 用户过敏史
    conditions?: string[];      // 用户疾病史
    currentMedications?: string[]; // 当前用药
}

interface DrugInfo {
    name: string;
    ingredients?: string[];
    contraindications?: string[];
    interactions?: string[];
    warnings?: string[];
}

interface RiskAlert {
    type: 'ALLERGY_WARNING' | 'CONTRAINDICATION' | 'DRUG_INTERACTION' | 'GENERAL_WARNING';
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    message: string;
    source: string;
}

interface CheckRisksRequest {
    userProfile: UserProfile;
    drugInfo: DrugInfo;
    language?: 'zh-CN' | 'zh-TW' | 'en';
}

interface CheckRisksResponse {
    success: boolean;
    alerts: RiskAlert[];
    checkedAt: string;
}

// 多语言消息模板
const MESSAGES = {
    'zh-CN': {
        allergyTitle: '⚠️ 过敏风险',
        allergyMessage: (allergy: string) => `该药物可能含有您已记录的过敏成分: ${allergy}`,
        contraTitle: '🚫 禁忌提示',
        contraMessage: (condition: string) => `药物说明书显示该药禁用于: ${condition}`,
        interactionTitle: '⚡ 药物相互作用',
        interactionMessage: (drug: string) => `该药物可能与您正在使用的 ${drug} 存在相互作用`,
        warningTitle: '⚠️ 注意事项',
        userProfileSource: '用户健康档案',
        labelSource: '药物说明书',
    },
    'zh-TW': {
        allergyTitle: '⚠️ 過敏風險',
        allergyMessage: (allergy: string) => `該藥物可能含有您已記錄的過敏成分: ${allergy}`,
        contraTitle: '🚫 禁忌提示',
        contraMessage: (condition: string) => `藥物說明書顯示該藥禁用於: ${condition}`,
        interactionTitle: '⚡ 藥物相互作用',
        interactionMessage: (drug: string) => `該藥物可能與您正在使用的 ${drug} 存在相互作用`,
        warningTitle: '⚠️ 注意事項',
        userProfileSource: '用戶健康檔案',
        labelSource: '藥物說明書',
    },
    'en': {
        allergyTitle: '⚠️ Allergy Risk',
        allergyMessage: (allergy: string) => `This medication may contain an allergen you\'ve recorded: ${allergy}`,
        contraTitle: '🚫 Contraindication',
        contraMessage: (condition: string) => `The drug label indicates this medication is contraindicated for: ${condition}`,
        interactionTitle: '⚡ Drug Interaction',
        interactionMessage: (drug: string) => `This medication may interact with ${drug} that you\'re currently taking`,
        warningTitle: '⚠️ Warning',
        userProfileSource: 'User Health Profile',
        labelSource: 'Drug Label',
    },
};

/**
 * 规则型风险检查 (不使用LLM)
 */
function checkRisks(
    userProfile: UserProfile,
    drugInfo: DrugInfo,
    lang: 'zh-CN' | 'zh-TW' | 'en'
): RiskAlert[] {
    const alerts: RiskAlert[] = [];
    const msg = MESSAGES[lang] || MESSAGES['zh-CN'];

    // 规则1: 过敏成分检查
    if (userProfile.allergies && drugInfo.ingredients) {
        for (const allergy of userProfile.allergies) {
            const allergyLower = allergy.toLowerCase();

            for (const ingredient of drugInfo.ingredients) {
                if (ingredient.toLowerCase().includes(allergyLower) ||
                    allergyLower.includes(ingredient.toLowerCase())) {
                    alerts.push({
                        type: 'ALLERGY_WARNING',
                        severity: 'critical',
                        title: msg.allergyTitle,
                        message: msg.allergyMessage(allergy),
                        source: `${msg.userProfileSource} + ${msg.labelSource}`,
                    });
                    break; // 每个过敏原只报告一次
                }
            }
        }
    }

    // 规则2: 禁忌症检查
    if (userProfile.conditions && drugInfo.contraindications) {
        for (const condition of userProfile.conditions) {
            const conditionLower = condition.toLowerCase();

            for (const contra of drugInfo.contraindications) {
                if (contra.toLowerCase().includes(conditionLower) ||
                    conditionLower.includes(contra.toLowerCase())) {
                    alerts.push({
                        type: 'CONTRAINDICATION',
                        severity: 'high',
                        title: msg.contraTitle,
                        message: msg.contraMessage(condition),
                        source: msg.labelSource,
                    });
                    break;
                }
            }
        }
    }

    // 规则3: 药物相互作用检查
    if (userProfile.currentMedications && drugInfo.interactions) {
        for (const medication of userProfile.currentMedications) {
            const medLower = medication.toLowerCase();

            for (const interaction of drugInfo.interactions) {
                if (interaction.toLowerCase().includes(medLower) ||
                    medLower.includes(interaction.toLowerCase())) {
                    alerts.push({
                        type: 'DRUG_INTERACTION',
                        severity: 'high',
                        title: msg.interactionTitle,
                        message: msg.interactionMessage(medication),
                        source: msg.labelSource,
                    });
                    break;
                }
            }
        }
    }

    // 规则4: 通用警告 (如果有的话直接传递)
    if (drugInfo.warnings) {
        for (const warning of drugInfo.warnings.slice(0, 3)) { // 最多3条
            alerts.push({
                type: 'GENERAL_WARNING',
                severity: 'medium',
                title: msg.warningTitle,
                message: warning.slice(0, 200), // 限制长度
                source: msg.labelSource,
            });
        }
    }

    return alerts;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ success: false, error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const body: CheckRisksRequest = await req.json();
        const { userProfile, drugInfo, language = 'zh-CN' } = body;

        if (!userProfile || !drugInfo) {
            return new Response(
                JSON.stringify({ success: false, error: '请提供用户信息和药物信息' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 执行规则检查
        const alerts = checkRisks(userProfile, drugInfo, language);

        // 按严重程度排序
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        const response: CheckRisksResponse = {
            success: true,
            alerts,
            checkedAt: new Date().toISOString(),
        };

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('[check-risks] Error:', error);

        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '风险检查失败'
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
