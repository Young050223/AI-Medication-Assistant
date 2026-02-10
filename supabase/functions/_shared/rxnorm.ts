/**
 * @file rxnorm.ts
 * @description RxNorm API共享模块 - 药物名称标准化
 * @location Supabase Edge Function (_shared)
 * @created 2026-02-03
 */

const RXNORM_BASE_URL = 'https://rxnav.nlm.nih.gov/REST';

export interface RxNormConcept {
    rxcui: string;
    name: string;
    tty: string;
    synonym?: string;
    score?: number;
}

export interface NormalizationResult {
    success: boolean;
    rxcui?: string;
    normalizedName?: string;
    alternatives?: RxNormConcept[];
    error?: string;
}

/**
 * 通过药物名称查找RxCUI (近似匹配)
 */
export async function findDrugByName(drugName: string): Promise<RxNormConcept[]> {
    const url = `${RXNORM_BASE_URL}/approximateTerm.json?term=${encodeURIComponent(drugName)}&maxEntries=10`;
    console.log('[RxNorm] 模糊搜索 URL:', url);

    const startTime = Date.now();
    const response = await fetch(url);
    const elapsed = Date.now() - startTime;

    console.log(`[RxNorm] 模糊搜索响应: status=${response.status}, time=${elapsed}ms`);

    if (!response.ok) {
        console.error('[RxNorm] API错误:', response.status);
        throw new Error(`RxNorm API error: ${response.status}`);
    }

    const data = await response.json();
    const candidates = data.approximateGroup?.candidate || [];
    console.log(`[RxNorm] 找到 ${candidates.length} 个候选结果`);

    return candidates
        .filter((c: { rxcui?: string; name?: string }) => c.rxcui && c.name)
        .map((c: { rxcui: string; name: string; tty?: string; synonym?: string; score?: number }) => ({
            rxcui: c.rxcui,
            name: c.name,
            tty: c.tty || 'UNKNOWN',
            synonym: c.synonym,
            score: typeof c.score === 'number' ? c.score : undefined,
        }));
}

/**
 * 精确匹配查找RxCUI
 */
export async function findRxcuiByExactName(drugName: string): Promise<string | null> {
    const url = `${RXNORM_BASE_URL}/rxcui.json?name=${encodeURIComponent(drugName)}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const rxcuis = data.idGroup?.rxnormId;

    return rxcuis && rxcuis.length > 0 ? rxcuis[0] : null;
}

/**
 * 获取药物属性
 */
export async function getDrugProperties(rxcui: string): Promise<{ name: string } | null> {
    const url = `${RXNORM_BASE_URL}/rxcui/${rxcui}/properties.json`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    return data.properties ? { name: data.properties.name } : null;
}

/**
 * 标准化药物名称 (主入口)
 */
export async function normalizeDrugName(drugName: string): Promise<NormalizationResult> {
    try {
        // 1. 尝试精确匹配
        const exactRxcui = await findRxcuiByExactName(drugName);

        if (exactRxcui) {
            const props = await getDrugProperties(exactRxcui);
            console.log(`[RxNorm] 精确匹配成功: rxcui=${exactRxcui}, name=${props?.name}`);
            return {
                success: true,
                rxcui: exactRxcui,
                normalizedName: props?.name || drugName,
            };
        }

        // 2. 模糊匹配
        const concepts = await findDrugByName(drugName);

        if (concepts.length === 0) {
            return {
                success: false,
                error: `未找到与"${drugName}"匹配的药物`,
            };
        }

        // 优先选择 IN (成分) 或 SCD (语义临床药物)
        const preferredTypes = ['IN', 'SCD', 'SBD', 'SCDC', 'SBDC'];
        const sorted = [...concepts].sort((a, b) => {
            const ai = preferredTypes.indexOf(a.tty);
            const bi = preferredTypes.indexOf(b.tty);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });

        return {
            success: true,
            rxcui: sorted[0].rxcui,
            normalizedName: sorted[0].name,
            alternatives: sorted.slice(1, 5),
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : '药物名称标准化失败',
        };
    }
}
