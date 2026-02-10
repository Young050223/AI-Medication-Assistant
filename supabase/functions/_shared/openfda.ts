/**
 * @file openfda.ts
 * @description OpenFDA API共享模块 - 不良反应统计
 * @location Supabase Edge Function (_shared)
 * @created 2026-02-03
 */

const OPENFDA_BASE_URL = 'https://api.fda.gov/drug';

export interface ReactionStat {
    term: string;
    count: number;
    percentage: number;
}

export interface AdverseEventStats {
    totalReports: number;
    seriousCount: number;
    seriousRate: number;
    deathCount: number;
    hospitalizationCount: number;
    topReactions: ReactionStat[];
    source: string;
    dataRange: string;
    lastUpdated: string;
}

export interface OpenFDAResult {
    success: boolean;
    adverseEvents?: AdverseEventStats;
    error?: string;
}

/**
 * 构建URL (支持API Key)
 */
function buildUrl(endpoint: string, params: Record<string, string>, apiKey?: string): string {
    const url = new URL(`${OPENFDA_BASE_URL}/${endpoint}`);

    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
    });

    if (apiKey) {
        url.searchParams.append('api_key', apiKey);
    }

    return url.toString();
}

/**
 * 安全获取统计数量
 */
async function getEventCount(searchQuery: string, apiKey?: string): Promise<number> {
    try {
        const url = buildUrl('event.json', { search: searchQuery, limit: '1' }, apiKey);
        const response = await fetch(url);

        if (!response.ok) return 0;

        const data = await response.json();
        return data.meta?.results?.total || 0;
    } catch {
        return 0;
    }
}

/**
 * 获取药物不良反应统计 (主入口)
 */
export async function getAdverseEvents(drugName: string, apiKey?: string): Promise<OpenFDAResult> {
    console.log(`[OpenFDA] 查询不良反应: drug="${drugName}", hasApiKey=${!!apiKey}`);

    try {
        const searchQuery = `patient.drug.medicinalproduct:"${drugName}"`;
        const startTime = Date.now();

        // 并行获取各类统计
        const [totalReports, seriousCount, deathCount, hospitalizationCount] = await Promise.all([
            getEventCount(searchQuery, apiKey),
            getEventCount(`${searchQuery}+AND+serious:1`, apiKey),
            getEventCount(`${searchQuery}+AND+seriousnessdeath:1`, apiKey),
            getEventCount(`${searchQuery}+AND+seriousnesshospitalization:1`, apiKey),
        ]);

        const elapsed = Date.now() - startTime;
        console.log(`[OpenFDA] 统计查询完成: total=${totalReports}, serious=${seriousCount}, time=${elapsed}ms`);

        // 获取top反应统计
        const reactionsUrl = buildUrl('event.json', {
            search: searchQuery,
            count: 'patient.reaction.reactionmeddrapt.exact',
            limit: '15',
        }, apiKey);

        const topReactions: ReactionStat[] = [];

        try {
            const reactionsResponse = await fetch(reactionsUrl);
            if (reactionsResponse.ok) {
                const reactionsData = await reactionsResponse.json();
                const results = reactionsData.results || [];
                console.log(`[OpenFDA] 获取到 ${results.length} 个反应统计`);

                const maxCount = results[0]?.count || 1;

                for (const item of results) {
                    topReactions.push({
                        term: item.term,
                        count: item.count,
                        percentage: Math.round((item.count / maxCount) * 100),
                    });
                }
            }
        } catch (e) {
            console.warn('[OpenFDA] 获取反应统计失败:', e);
            // 忽略反应统计错误
        }

        const seriousRate = totalReports > 0
            ? Math.round((seriousCount / totalReports) * 100 * 10) / 10
            : 0;

        return {
            success: true,
            adverseEvents: {
                totalReports,
                seriousCount,
                seriousRate,
                deathCount,
                hospitalizationCount,
                topReactions,
                source: 'OpenFDA FAERS',
                dataRange: '2004-present',
                lastUpdated: new Date().toISOString().split('T')[0],
            },
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : '获取不良反应数据失败',
        };
    }
}

/**
 * 获取药物标签中的警告和相互作用
 */
export async function getDrugWarningsFromLabel(drugName: string, apiKey?: string): Promise<{
    warnings?: string;
    drugInteractions?: string;
    contraindications?: string;
}> {
    try {
        const url = buildUrl('label.json', {
            search: `openfda.brand_name:"${drugName}"+OR+openfda.generic_name:"${drugName}"`,
            limit: '1',
        }, apiKey);

        const response = await fetch(url);
        if (!response.ok) return {};

        const data = await response.json();
        const results = data.results || [];

        if (results.length === 0) return {};

        const label = results[0];

        const formatField = (field: string | string[] | undefined): string | undefined => {
            if (!field) return undefined;
            if (Array.isArray(field)) return field.join('\n').slice(0, 2000); // 限制长度
            return field.slice(0, 2000);
        };

        return {
            warnings: formatField(label.warnings) || formatField(label.warnings_and_cautions),
            drugInteractions: formatField(label.drug_interactions),
            contraindications: formatField(label.contraindications),
        };
    } catch {
        return {};
    }
}
