/**
 * @file dailymed.ts
 * @description DailyMed API共享模块 - 药物说明书查询
 * @location Supabase Edge Function (_shared)
 * @created 2026-02-03
 */

const DAILYMED_BASE_URL = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';

export interface LabelSection {
    id: string;
    name: string;
    title: string;
    text: string;
}

export interface DrugLabel {
    setId: string;
    title: string;
    effectiveTime: string;
    sections: LabelSection[];
}

export interface DailyMedResult {
    success: boolean;
    label?: DrugLabel;
    keySections?: {
        indications?: LabelSection;
        dosage?: LabelSection;
        contraindications?: LabelSection;
        warnings?: LabelSection;
        adverseReactions?: LabelSection;
        drugInteractions?: LabelSection;
    };
    source: string;
    error?: string;
}

/**
 * 通过RxCUI搜索药物说明书
 */
export async function searchByRxcui(rxcui: string): Promise<Array<{ setid: string; title: string; published_date: string }>> {
    const url = `${DAILYMED_BASE_URL}/spls.json?rxcui=${rxcui}`;
    console.log('[DailyMed] 通过RxCUI搜索:', url);

    const startTime = Date.now();
    const response = await fetch(url);
    const elapsed = Date.now() - startTime;

    console.log(`[DailyMed] 搜索响应: status=${response.status}, time=${elapsed}ms`);

    if (!response.ok) {
        console.error('[DailyMed] API错误:', response.status);
        throw new Error(`DailyMed API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[DailyMed] 找到 ${data.data?.length || 0} 个SPL记录`);
    return data.data || [];
}

/**
 * 通过药物名称搜索
 */
export async function searchByDrugName(drugName: string): Promise<Array<{ setid: string; title: string; published_date: string }>> {
    const url = `${DAILYMED_BASE_URL}/spls.json?drug_name=${encodeURIComponent(drugName)}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`DailyMed API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data || [];
}

/**
 * 获取特定部分内容
 * LOINC codes:
 * - 34067-9: 适应症
 * - 34068-7: 用法用量
 * - 34070-3: 禁忌症
 * - 34071-1: 警告
 * - 34084-4: 不良反应
 * - 34073-7: 药物相互作用
 */
export async function getSectionByLoincCode(setId: string, loincCode: string): Promise<LabelSection | null> {
    try {
        const url = `${DAILYMED_BASE_URL}/spls/${setId}/sections/${loincCode}.json`;

        const response = await fetch(url);
        if (!response.ok) return null;

        const data = await response.json();
        const sectionData = data.data;

        if (!sectionData) return null;

        return {
            id: loincCode,
            name: sectionData.section_name || '',
            title: sectionData.title || sectionData.section_name || '',
            text: sectionData.text || '',
        };
    } catch {
        return null;
    }
}

/**
 * 获取药物的关键信息部分
 */
export async function getKeyLabelSections(setId: string): Promise<DailyMedResult['keySections']> {
    console.log(`[DailyMed] 获取关键部分, setId=${setId}`);

    const loincCodes = {
        indications: '34067-9',
        dosage: '34068-7',
        contraindications: '34070-3',
        warnings: '34071-1',
        adverseReactions: '34084-4',
        drugInteractions: '34073-7',
    };

    const results: DailyMedResult['keySections'] = {};

    await Promise.all(
        Object.entries(loincCodes).map(async ([key, code]) => {
            const section = await getSectionByLoincCode(setId, code);
            if (section) {
                results[key as keyof typeof results] = section;
                console.log(`[DailyMed] ✅ 获取到 ${key} 部分 (长度: ${section.text.length})`);
            } else {
                console.log(`[DailyMed] ❌ 未找到 ${key} 部分`);
            }
        })
    );

    return results;
}

/**
 * 综合查询药物标签 (主入口)
 */
export async function getDrugLabel(drugIdentifier: string, useRxcui: boolean = true): Promise<DailyMedResult> {
    try {
        // 1. 搜索SPL
        const spls = useRxcui
            ? await searchByRxcui(drugIdentifier)
            : await searchByDrugName(drugIdentifier);

        if (spls.length === 0) {
            return {
                success: false,
                source: 'DailyMed (NIH)',
                error: `未找到"${drugIdentifier}"的药物说明书`,
            };
        }

        // 2. 选择最新的SPL
        const latestSPL = spls.sort((a, b) =>
            new Date(b.published_date).getTime() - new Date(a.published_date).getTime()
        )[0];

        // 3. 获取关键部分
        const keySections = await getKeyLabelSections(latestSPL.setid);

        return {
            success: true,
            label: {
                setId: latestSPL.setid,
                title: latestSPL.title || '',
                effectiveTime: latestSPL.published_date || '',
                sections: Object.values(keySections || {}).filter(Boolean) as LabelSection[],
            },
            keySections,
            source: 'DailyMed (NIH)',
        };
    } catch (error) {
        return {
            success: false,
            source: 'DailyMed (NIH)',
            error: error instanceof Error ? error.message : '获取药物说明书失败',
        };
    }
}
