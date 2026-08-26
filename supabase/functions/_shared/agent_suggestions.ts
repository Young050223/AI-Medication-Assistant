import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
    getAgentRolloutStage,
    isAgentSuggestionsEnabled,
} from './feature_rollout.ts';

export const suggestionCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt, x-trace-id',
};

export type SupportedLanguage = 'zh-CN' | 'zh-TW' | 'en';

export interface SuggestionRequest {
    forceRefresh?: boolean;
    userJwt?: string;
    language?: SupportedLanguage;
}

export interface SuggestionResponse {
    success: boolean;
    questions: string[];
    contextTags: string[];
    triggerSignals: string[];
    generatedAt: string;
    expiresAt: string;
    fromCache: boolean;
    traceId: string;
    error?: string;
}

type TriggerSignalKey =
    | 'new_medication'
    | 'prescription_change'
    | 'next_dose'
    | 'conversation_theme'
    | 'conversation_follow_up';

interface TriggerSignal {
    key: TriggerSignalKey;
    detail: string;
}

interface HealthProfileRow {
    birth_date: string | null;
    gender: string | null;
    medical_history: string | null;
    allergies: string | null;
}

interface MedicationScheduleRow {
    medication_name: string;
    medication_dosage: string | null;
    frequency: string | null;
    status: string | null;
    start_date: string;
    end_date: string | null;
    source_record_id: string | null;
    reminders: unknown;
    updated_at: string;
}

interface PrescriptionItemRow {
    medication_name: string | null;
    created_at: string;
}

interface ConversationRow {
    id: string;
    summary?: string | null;
    updated_at: string;
}

interface ConversationMessageRow {
    role: string | null;
    content: string | null;
    created_at: string;
}

interface SuggestionContext {
    healthSummary: string;
    activeMedicationSummary: string;
    conversationSummary: string;
    conversationDetailSummary: string;
    followUpTopic: string;
    nextDoseSummary: string;
    medicationNames: string[];
    contextTags: string[];
    triggerSignals: TriggerSignal[];
}

interface PersistedSuggestionRow {
    suggested_questions: unknown;
    context_tags: unknown;
    trigger_signals: unknown;
    generated_at: string;
    expires_at: string;
    version?: number | null;
}

interface LegacySuggestionRow {
    suggestions: unknown;
    context_tags: unknown;
    generated_at: string;
    expires_at: string;
}

const CACHE_TTL_HOURS = 6;
const QUESTION_MIN = 3;
const QUESTION_MAX = 4;
const SUGGESTION_TABLE = 'agent_suggested_questions';
const LEGACY_TABLE = 'agent_question_suggestions';
const SUGGESTION_CACHE_VERSION = 2;

function jsonHeaders(traceId: string): Record<string, string> {
    return {
        ...suggestionCorsHeaders,
        'Content-Type': 'application/json',
        'x-trace-id': traceId,
    };
}

function createTraceId(req: Request): string {
    const header = req.headers.get('x-trace-id') || req.headers.get('X-Trace-Id');
    const normalized = header?.trim();
    if (normalized) return normalized.slice(0, 128);
    return crypto.randomUUID();
}

function logTrace(service: string, event: string, traceId: string, meta?: Record<string, unknown>) {
    console.log(JSON.stringify({
        service,
        event,
        trace_id: traceId,
        ...meta,
    }));
}

function normalizeLanguage(language: unknown): SupportedLanguage {
    if (language === 'zh-TW' || language === 'en') return language;
    return 'zh-CN';
}

function normalizeToken(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const value = raw.trim();
    if (!value) return null;
    const matched = value.match(/^Bearer\s+(.+)$/i);
    const token = matched ? matched[1] : value;
    return token.trim() || null;
}

function getBearerToken(req: Request): string | null {
    const userJwtHeader = normalizeToken(req.headers.get('x-user-jwt') || req.headers.get('X-User-Jwt'));
    if (userJwtHeader) return userJwtHeader;

    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader) return null;
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return normalizeToken(token);
}

function getSupabaseClient() {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return null;
    return createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

async function getAuthenticatedUserId(
    supabase: ReturnType<typeof getSupabaseClient>,
    token: string | null
): Promise<string | null> {
    if (!supabase || !token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
}

function clipText(text: string | null | undefined, max: number): string {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function uniqueNonEmpty(values: string[]): string[] {
    const set = new Set<string>();
    values.forEach((item) => {
        const v = item.trim();
        if (!v) return;
        if (!set.has(v)) set.add(v);
    });
    return Array.from(set);
}

function dateKeyOffset(baseDate: Date, days: number): string {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

function parseDateKey(dateText: string | null | undefined): string | null {
    if (!dateText) return null;
    const normalized = dateText.includes('T') ? dateText.split('T')[0] : dateText;
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function getReminderTimes(reminders: unknown): string[] {
    if (!Array.isArray(reminders)) return [];
    return reminders
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const row = item as { time?: unknown };
            return typeof row.time === 'string' && row.time.length >= 4 ? row.time.slice(0, 5) : null;
        })
        .filter((item): item is string => !!item);
}

function buildDateFromTime(day: Date, hhmm: string): Date | null {
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    const candidate = new Date(day);
    candidate.setHours(h, m, 0, 0);
    return candidate;
}

function resolveNextDose(schedules: MedicationScheduleRow[], todayKey: string): { medicationName: string; time: string } | null {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().split('T')[0];

    let selected: { medicationName: string; time: string; timestamp: number } | null = null;

    schedules.forEach((item) => {
        const start = parseDateKey(item.start_date) || todayKey;
        const end = parseDateKey(item.end_date) || tomorrowKey;
        if (end < todayKey || start > tomorrowKey) return;
        if (!(item.status === 'active' || item.status === null)) return;

        const reminderTimes = getReminderTimes(item.reminders).slice(0, 8);
        reminderTimes.forEach((time) => {
            const todayCandidate = buildDateFromTime(now, time);
            const tomorrowCandidate = buildDateFromTime(tomorrow, time);
            const candidates = [todayCandidate, tomorrowCandidate].filter((row): row is Date => !!row);

            candidates.forEach((candidate) => {
                if (candidate.getTime() < now.getTime()) return;
                if (!selected || candidate.getTime() < selected.timestamp) {
                    selected = {
                        medicationName: item.medication_name,
                        time,
                        timestamp: candidate.getTime(),
                    };
                }
            });
        });
    });

    if (!selected) return null;
    return {
        medicationName: selected.medicationName,
        time: selected.time,
    };
}

function parseQuestionArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return uniqueNonEmpty(
        value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length >= 4)
    );
}

function sanitizeQuestions(items: string[], language: SupportedLanguage): string[] {
    const punctuation = language === 'en' ? '?' : '？';
    const trimmed = uniqueNonEmpty(items.map((row) => clipText(row, 100))).filter((row) => row.length >= 4);
    return trimmed.map((row) => {
        if (/[？?]$/.test(row)) return row;
        return `${row}${punctuation}`;
    });
}

type SuggestionAspect = 'medical' | 'usage' | 'unknown';

function classifyQuestionAspect(question: string): SuggestionAspect {
    const content = question.toLowerCase();
    const medicalKeywords = [
        '相互作用', '禁忌', '副作用', '不良反应', '警示', '说明书', '药理', '药效', '风险',
        'interaction', 'interact', 'contraindication', 'warning', 'side effect', 'adverse', 'leaflet',
    ];
    const usageKeywords = [
        '服药', '用药计划', '计划', '提醒', '按时', '漏服', '补服', '下一次', '今天', '执行', '打卡',
        'schedule', 'dose', 'take', 'adherence', 'reminder', 'missed', 'next dose',
    ];

    if (medicalKeywords.some((kw) => content.includes(kw))) return 'medical';
    if (usageKeywords.some((kw) => content.includes(kw))) return 'usage';
    return 'unknown';
}

function buildAspectFallback(language: SupportedLanguage, aspect: Exclude<SuggestionAspect, 'unknown'>): string {
    if (aspect === 'medical') {
        if (language === 'en') return 'Which interaction and contraindication risks should I prioritize today?';
        if (language === 'zh-TW') return '我今天最需要優先關注哪些藥物交互作用與禁忌風險？';
        return '我今天最需要优先关注哪些药物相互作用与禁忌风险？';
    }

    if (language === 'en') return 'What are my top two medication-plan actions for today?';
    if (language === 'zh-TW') return '依照我目前的用藥計畫，今天最優先要執行哪兩件事？';
    return '按照我当前的用药计划，今天最优先要执行哪两件事？';
}

function ensureQuestionRange(primary: string[], fallback: string[], language: SupportedLanguage): string[] {
    const merged = uniqueNonEmpty([...primary, ...fallback]);
    const globalFallback = buildGlobalFallbackQuestions(language);
    const selected: string[] = [];
    const selectedSet = new Set<string>();

    const pushQuestion = (question: string) => {
        if (!question || selectedSet.has(question)) return;
        selected.push(question);
        selectedSet.add(question);
    };

    const firstMedical = merged.find((item) => classifyQuestionAspect(item) === 'medical');
    const firstUsage = merged.find((item) => classifyQuestionAspect(item) === 'usage');
    if (firstMedical) pushQuestion(firstMedical);
    if (firstUsage) pushQuestion(firstUsage);

    merged.forEach((item) => {
        if (selected.length >= QUESTION_MAX) return;
        pushQuestion(item);
    });

    if (!selected.some((item) => classifyQuestionAspect(item) === 'medical')) {
        pushQuestion(sanitizeQuestions([buildAspectFallback(language, 'medical')], language)[0] || '');
    }
    if (!selected.some((item) => classifyQuestionAspect(item) === 'usage')) {
        pushQuestion(sanitizeQuestions([buildAspectFallback(language, 'usage')], language)[0] || '');
    }

    globalFallback.forEach((item) => {
        if (selected.length >= QUESTION_MAX) return;
        pushQuestion(item);
    });

    const normalized = sanitizeQuestions(selected, language);
    if (normalized.length >= QUESTION_MIN) return normalized.slice(0, QUESTION_MAX);
    return normalized.concat(globalFallback).slice(0, QUESTION_MIN);
}

function isMissingColumnError(error: { message?: string } | null | undefined, column: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('column') && message.includes(column.toLowerCase()) && message.includes('does not exist');
}

function isMissingRelationError(error: { message?: string } | null | undefined, relation: string): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('relation') && message.includes(relation.toLowerCase()) && message.includes('does not exist');
}

function buildFallbackQuestions(context: SuggestionContext, language: SupportedLanguage): string[] {
    const medA = context.medicationNames[0] || (language === 'en' ? 'my medication' : '当前用药');
    const medB = context.medicationNames[1] || medA;
    const hasSignal = (key: TriggerSignalKey) => context.triggerSignals.some((item) => item.key === key);
    const getSignalDetail = (key: TriggerSignalKey): string =>
        context.triggerSignals.find((item) => item.key === key)?.detail || '';
    const nextDose = context.nextDoseSummary || (language === 'en' ? 'my next dose' : '下一次服药');
    const theme = context.conversationSummary || (language === 'en' ? 'my recent concerns' : '最近咨询主题');
    const followUpTopic = getSignalDetail('conversation_follow_up') || context.followUpTopic || theme;

    if (language === 'en') {
        const questions: string[] = [];
        if (hasSignal('new_medication')) questions.push(`What should I monitor in the first week after starting ${medA}?`);
        if (hasSignal('prescription_change')) questions.push('My prescription changed recently, what transition checklist should I follow?');
        if (hasSignal('next_dose')) questions.push(`Before ${nextDose}, what should I prepare or avoid?`);
        if (hasSignal('conversation_theme')) questions.push(`From my recent topic "${theme}", what should I prioritize today?`);
        if (hasSignal('conversation_follow_up')) questions.push(`Regarding "${followUpTopic}", has this issue been resolved, or should we continue troubleshooting?`);
        questions.push(`Can ${medA} and ${medB} interact in ways I should actively monitor?`);
        questions.push('Based on my current schedule, what are today’s top two execution priorities?');
        questions.push('What exact points should I discuss with my doctor at the next follow-up?');
        return sanitizeQuestions(questions, language);
    }

    if (language === 'zh-TW') {
        const questions: string[] = [];
        if (hasSignal('new_medication')) questions.push(`我剛新增 ${medA}，第一週應該重點觀察哪些反應`);
        if (hasSignal('prescription_change')) questions.push('我的處方最近有變動，現在應該怎麼銜接新方案');
        if (hasSignal('next_dose')) questions.push(`在 ${nextDose} 這次服藥前後，我要特別注意什麼`);
        if (hasSignal('conversation_theme')) questions.push(`延續我最近的主題「${theme}」，今天最該先做哪一步`);
        if (hasSignal('conversation_follow_up')) questions.push(`延續你之前問過的「${followUpTopic}」，目前是否已解決，還需要我繼續追蹤嗎`);
        questions.push(`${medA} 和 ${medB} 是否有需要主動監測的交互作用風險`);
        questions.push('依照我目前的用藥計畫，今天最優先的兩個執行動作是什麼');
        questions.push('下次回診時，我應該優先和醫師確認哪三件事');
        return sanitizeQuestions(questions, language);
    }

    const questions: string[] = [];
    if (hasSignal('new_medication')) questions.push(`我刚新增 ${medA}，第一周该重点观察什么`);
    if (hasSignal('prescription_change')) questions.push('我的处方最近有变化，应该如何平稳过渡到新方案');
    if (hasSignal('next_dose')) questions.push(`在 ${nextDose} 这次服药前后，我要特别注意哪些事项`);
    if (hasSignal('conversation_theme')) questions.push(`延续我最近的主题“${theme}”，今天最该优先处理什么`);
    if (hasSignal('conversation_follow_up')) questions.push(`延续你之前问过的“${followUpTopic}”，目前是否已解决，还需要我继续跟进吗`);
    questions.push(`${medA} 和 ${medB} 之间有哪些需要主动监测的相互作用风险`);
    questions.push('按照我当前的用药计划，今天最优先的两个执行动作是什么');
    questions.push('下次复诊时，我应该优先和医生确认哪三件事');
    return sanitizeQuestions(questions, language);
}

function buildGlobalFallbackQuestions(language: SupportedLanguage): string[] {
    if (language === 'en') {
        return sanitizeQuestions([
            'What should I prioritize before my next dose today',
            'How can I reduce missed doses this week',
            'Which side effects should prompt me to contact my doctor now',
            'What should I discuss at my next follow-up visit',
        ], language);
    }

    if (language === 'zh-TW') {
        return sanitizeQuestions([
            '我今天下一次服藥前最該先做什麼',
            '這週要怎麼降低漏服風險',
            '哪些副作用出現時需要盡快聯絡醫師',
            '下次回診我應該優先確認哪些重點',
        ], language);
    }

    return sanitizeQuestions([
        '我今天下一次服药前最该先做什么',
        '这周要怎么降低漏服风险',
        '哪些副作用出现时需要尽快联系医生',
        '下次复诊我应该优先确认哪些重点',
    ], language);
}

function buildGenerationPrompt(context: SuggestionContext, language: SupportedLanguage): string {
    const langRule: Record<SupportedLanguage, string> = {
        'zh-CN': '请使用简体中文。',
        'zh-TW': '請使用繁體中文。',
        'en': 'Please use English.',
    };
    const triggerText = context.triggerSignals.map((item) => `${item.key}: ${item.detail}`).join(' | ') || 'none';

    return `你是医疗用药助手的“问题建议生成器”。请基于用户上下文，生成 3 到 4 条可点击问题。

硬性约束：
1) 问题必须是用户口吻疑问句，禁止陈述句。
2) 只输出 JSON：{"questions":["..."]}，不要输出其它文本。
3) 每条问题必须具体、可执行，避免泛泛建议。
4) 问题必须同时覆盖两类：药物医学类 + 用户服用执行类（至少各1条）。
5) 问题优先覆盖触发信号：new_medication / prescription_change / next_dose / conversation_theme / conversation_follow_up。
6) 严禁重复，禁止编造上下文不存在的事实。
7) 只有“活跃用药”中明确出现的药物，才允许在问题中被点名并视作当前用药。
8) 历史会话里提到、但未加入当前计划的药物，以及已结束/暂停/取消的药物，禁止在问题里点名，最多只能转写成泛化的“最近话题/待跟进问题”。
9) ${langRule[language]}

上下文：
- 触发信号: ${triggerText}
- 健康档案: ${context.healthSummary || '无'}
- 活跃用药: ${context.activeMedicationSummary || '无'}
- 下一次服药: ${context.nextDoseSummary || '无'}
- 历史会话主题: ${context.conversationSummary || '无'}
- 历史对话详情: ${context.conversationDetailSummary || '无'}
- 待跟进问题: ${context.followUpTopic || '无'}`;
}

async function generateWithOpenAI(params: {
    apiKey: string;
    language: SupportedLanguage;
    context: SuggestionContext;
}): Promise<string[]> {
    const { apiKey, language, context } = params;
    const model = Deno.env.get('OPENAI_CHAT_MODEL') || 'gpt-4o-mini';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: 'Generate personalized medication question suggestions in strict JSON format.' },
                { role: 'user', content: buildGenerationPrompt(context, language) },
            ],
            temperature: 0.35,
            max_tokens: 320,
            response_format: { type: 'json_object' },
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`openai status=${response.status} err=${errText.slice(0, 300)}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('openai empty content');

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        throw new Error('openai invalid json');
    }

    const row = parsed as Record<string, unknown>;
    return sanitizeQuestions(parseQuestionArray(row.questions), language);
}

async function loadSuggestionContext(
    supabase: ReturnType<typeof getSupabaseClient>,
    userId: string
): Promise<SuggestionContext> {
    const today = new Date().toISOString().split('T')[0];
    const recentAddedSince = dateKeyOffset(new Date(`${today}T00:00:00Z`), -14);
    const recentPrescriptionSince = dateKeyOffset(new Date(`${today}T00:00:00Z`), -21);
    const contextTags = new Set<string>();
    const triggerSignals: TriggerSignal[] = [];

    const [healthRes, scheduleRes, prescriptionRes] = await Promise.all([
        supabase
            .from('health_profiles')
            .select('birth_date, gender, medical_history, allergies')
            .eq('user_id', userId)
            .maybeSingle(),
        supabase
            .from('medication_schedules')
            .select('medication_name, medication_dosage, frequency, status, start_date, end_date, source_record_id, reminders, updated_at')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(80),
        supabase
            .from('prescription_items')
            .select('medication_name, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(80),
    ]);

    const healthRow = healthRes.data as HealthProfileRow | null;
    const healthSummary = [
        healthRow?.gender ? `性别:${healthRow.gender}` : '',
        healthRow?.birth_date ? `出生:${healthRow.birth_date}` : '',
        healthRow?.medical_history ? `病史:${clipText(healthRow.medical_history, 140)}` : '',
        healthRow?.allergies ? `过敏:${clipText(healthRow.allergies, 140)}` : '',
    ].filter(Boolean).join(' | ');
    if (healthSummary) contextTags.add('health_profile');

    const scheduleRows = (scheduleRes.data || []) as MedicationScheduleRow[];
    const activeSchedules = scheduleRows.filter((item) =>
        (item.status === 'active' || item.status === null)
        && (parseDateKey(item.start_date) || today) <= today
        && (!item.end_date || item.end_date >= today)
    );
    const activeMedicationSummary = activeSchedules
        .slice(0, 8)
        .map((item, index) =>
            `${index + 1}. ${item.medication_name}${item.medication_dosage ? `(${item.medication_dosage})` : ''}${item.frequency ? ` ${item.frequency}` : ''}`
        )
        .join('\n');
    if (activeMedicationSummary) contextTags.add('medication_schedule');

    const medicationNames = uniqueNonEmpty(
        activeSchedules.map((item) => item.medication_name || '')
    );

    const newMedicationNames = uniqueNonEmpty(
        activeSchedules
            .filter((item) => (parseDateKey(item.start_date) || '0000-00-00') >= recentAddedSince)
            .map((item) => item.medication_name || '')
    );
    if (newMedicationNames.length > 0) {
        triggerSignals.push({
            key: 'new_medication',
            detail: newMedicationNames.slice(0, 3).join(', '),
        });
    }

    const prescriptionRows = (prescriptionRes.data || []) as PrescriptionItemRow[];
    const prescriptionNames = uniqueNonEmpty(prescriptionRows.map((item) => item.medication_name || ''));
    if (prescriptionNames.length > 0) {
        contextTags.add('doctor_prescription');
    }
    const hasRecentPrescriptionChange =
        prescriptionRows.some((item) => (parseDateKey(item.created_at) || '0000-00-00') >= recentPrescriptionSince)
        || scheduleRows.some((item) =>
            !!item.source_record_id
            && (parseDateKey(item.updated_at) || '0000-00-00') >= recentPrescriptionSince
        );
    if (hasRecentPrescriptionChange) {
        triggerSignals.push({
            key: 'prescription_change',
            detail: prescriptionNames.slice(0, 3).join(', ') || '近期处方更新',
        });
    }

    const nextDose = resolveNextDose(scheduleRows, today);
    const nextDoseSummary = nextDose ? `${nextDose.medicationName} ${nextDose.time}` : '';
    if (nextDoseSummary) {
        triggerSignals.push({
            key: 'next_dose',
            detail: nextDoseSummary,
        });
    }

    const conversationLimit = 6;
    let conversationRows: ConversationRow[] = [];
    const conversationQuery = await supabase
        .from('chat_conversations')
        .select('id, summary, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(conversationLimit);

    if (conversationQuery.error && isMissingColumnError(conversationQuery.error, 'summary')) {
        const fallbackQuery = await supabase
            .from('chat_conversations')
            .select('id, updated_at')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(conversationLimit);
        conversationRows = ((fallbackQuery.data || []) as Array<{ id: string; updated_at: string }>)
            .map((item) => ({ id: item.id, updated_at: item.updated_at }));
    } else {
        conversationRows = (conversationQuery.data || []) as ConversationRow[];
    }

    const conversationIds = conversationRows.map((row) => row.id).filter(Boolean);
    let conversationMessages: ConversationMessageRow[] = [];
    if (conversationIds.length > 0) {
        const messageQuery = await supabase
            .from('chat_messages')
            .select('role, content, created_at')
            .in('conversation_id', conversationIds)
            .order('created_at', { ascending: false })
            .limit(16);

        if (messageQuery.error) {
            console.warn('[agent-suggestions] load recent messages failed:', messageQuery.error.message);
        } else {
            conversationMessages = (messageQuery.data || []) as ConversationMessageRow[];
        }
    }

    const hasRecentConversation = conversationRows.length > 0 || conversationMessages.length > 0;
    const summaryText = conversationRows
        .map((row) => clipText(row.summary || '', 120))
        .filter(Boolean)
        .slice(0, 3)
        .join(' / ');
    const messageDigest = conversationMessages
        .slice(0, 8)
        .reverse()
        .map((row) => {
            const role = row.role === 'assistant' ? '助手' : '用户';
            return `${role}:${clipText(row.content || '', 90)}`;
        })
        .join(' | ');
    const latestUserMessage = conversationMessages
        .find((row) => row.role === 'user' && String(row.content || '').trim());
    const conversationSummary = summaryText
        || (hasRecentConversation ? '最近有过与用药相关的待跟进对话' : '');
    const conversationDetailSummary = messageDigest
        || (hasRecentConversation ? '存在最近对话记录，但其中提到的药物不应自动视为当前用药' : '');
    const followUpTopic = latestUserMessage ? clipText(latestUserMessage.content || '', 80) : '';

    if (conversationSummary) {
        contextTags.add('chat_history');
        triggerSignals.push({
            key: 'conversation_theme',
            detail: 'recent_medication_follow_up',
        });
    }
    if (conversationDetailSummary) {
        contextTags.add('chat_history_detail');
    }

    return {
        healthSummary,
        activeMedicationSummary,
        conversationSummary,
        conversationDetailSummary,
        followUpTopic,
        nextDoseSummary,
        medicationNames,
        contextTags: Array.from(contextTags),
        triggerSignals,
    };
}

async function hasSuggestionContextChanged(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    generatedAt: string;
    nowIso: string;
}): Promise<boolean> {
    const { supabase, userId, generatedAt, nowIso } = params;
    if (parseDateKey(generatedAt) !== parseDateKey(nowIso)) {
        return true;
    }

    const checks = await Promise.all([
        supabase
            .from('medication_schedules')
            .select('updated_at')
            .eq('user_id', userId)
            .gt('updated_at', generatedAt)
            .limit(1),
        supabase
            .from('prescription_items')
            .select('created_at')
            .eq('user_id', userId)
            .gt('created_at', generatedAt)
            .limit(1),
        supabase
            .from('chat_conversations')
            .select('updated_at')
            .eq('user_id', userId)
            .gt('updated_at', generatedAt)
            .limit(1),
    ]);

    return checks.some((result) => Array.isArray(result.data) && result.data.length > 0);
}

async function readCachedSuggestions(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    nowIso: string;
}): Promise<{
    questions: string[];
    contextTags: string[];
    triggerSignals: string[];
    generatedAt: string;
    expiresAt: string;
} | null> {
    const { supabase, userId, nowIso } = params;
    const { data, error } = await supabase
        .from(SUGGESTION_TABLE)
        .select('suggested_questions, context_tags, trigger_signals, generated_at, expires_at, version')
        .eq('user_id', userId)
        .gt('expires_at', nowIso)
        .maybeSingle();

    if (error) {
        if (!isMissingRelationError(error, SUGGESTION_TABLE)) {
            console.warn('[agent-suggestions] read cache error:', error.message);
        }
    } else if (data) {
        const row = data as PersistedSuggestionRow;
        if (row.version !== SUGGESTION_CACHE_VERSION) {
            return null;
        }
        const isStale = await hasSuggestionContextChanged({
            supabase,
            userId,
            generatedAt: row.generated_at,
            nowIso,
        });
        if (isStale) {
            return null;
        }
        const questions = sanitizeQuestions(parseQuestionArray(row.suggested_questions), 'zh-CN');
        if (questions.length >= QUESTION_MIN) {
            return {
                questions: questions.slice(0, QUESTION_MAX),
                contextTags: Array.isArray(row.context_tags) ? row.context_tags.map((item) => String(item)) : [],
                triggerSignals: Array.isArray(row.trigger_signals) ? row.trigger_signals.map((item) => String(item)) : [],
                generatedAt: row.generated_at,
                expiresAt: row.expires_at,
            };
        }
    }

    const legacy = await supabase
        .from(LEGACY_TABLE)
        .select('suggestions, context_tags, generated_at, expires_at')
        .eq('user_id', userId)
        .gt('expires_at', nowIso)
        .maybeSingle();

    if (legacy.error) {
        if (!isMissingRelationError(legacy.error, LEGACY_TABLE)) {
            console.warn('[agent-suggestions] read legacy cache error:', legacy.error.message);
        }
        return null;
    }

    if (!legacy.data) return null;
    const row = legacy.data as LegacySuggestionRow;
    if (parseDateKey(row.generated_at) !== parseDateKey(nowIso)) return null;
    const questions = sanitizeQuestions(parseQuestionArray(row.suggestions), 'zh-CN');
    if (questions.length < QUESTION_MIN) return null;

    return {
        questions: questions.slice(0, QUESTION_MAX),
        contextTags: Array.isArray(row.context_tags) ? row.context_tags.map((item) => String(item)) : [],
        triggerSignals: [],
        generatedAt: row.generated_at,
        expiresAt: row.expires_at,
    };
}

async function saveSuggestions(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    questions: string[];
    contextTags: string[];
    triggerSignals: string[];
    generatedAt: string;
    expiresAt: string;
}): Promise<void> {
    const { supabase, userId, questions, contextTags, triggerSignals, generatedAt, expiresAt } = params;
    const { error } = await supabase
        .from(SUGGESTION_TABLE)
        .upsert({
            user_id: userId,
            suggested_questions: questions,
            context_tags: contextTags,
            trigger_signals: triggerSignals,
            generated_at: generatedAt,
            expires_at: expiresAt,
            version: SUGGESTION_CACHE_VERSION,
        }, {
            onConflict: 'user_id',
        });

    if (!error) return;
    if (!isMissingRelationError(error, SUGGESTION_TABLE)) {
        console.warn('[agent-suggestions] save cache error:', error.message);
        return;
    }

    const { error: legacyError } = await supabase
        .from(LEGACY_TABLE)
        .upsert({
            user_id: userId,
            suggestions: questions,
            context_tags: contextTags,
            generated_at: generatedAt,
            expires_at: expiresAt,
        }, {
            onConflict: 'user_id',
        });

    if (legacyError) {
        console.warn('[agent-suggestions] save legacy cache error:', legacyError.message);
    }
}

async function generateSuggestions(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    forceRefresh: boolean;
    language: SupportedLanguage;
}): Promise<Omit<SuggestionResponse, 'traceId' | 'success'>> {
    const { supabase, userId, forceRefresh, language } = params;
    const nowIso = new Date().toISOString();

    if (!forceRefresh) {
        const cached = await readCachedSuggestions({
            supabase,
            userId,
            nowIso,
        });
        if (cached) {
            return {
                questions: cached.questions,
                contextTags: cached.contextTags,
                triggerSignals: cached.triggerSignals,
                generatedAt: cached.generatedAt,
                expiresAt: cached.expiresAt,
                fromCache: true,
            };
        }
    }

    const context = await loadSuggestionContext(supabase, userId);
    const fallback = buildFallbackQuestions(context, language);
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    let modelQuestions: string[] = [];

    if (openaiKey) {
        try {
            modelQuestions = await generateWithOpenAI({
                apiKey: openaiKey,
                language,
                context,
            });
        } catch (error) {
            console.warn('[agent-suggestions] generate with model failed:', error);
        }
    }

    const questions = ensureQuestionRange(
        sanitizeQuestions(modelQuestions, language),
        sanitizeQuestions(fallback, language),
        language
    ).slice(0, QUESTION_MAX);

    const generatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    await saveSuggestions({
        supabase,
        userId,
        questions,
        contextTags: context.contextTags,
        triggerSignals: context.triggerSignals.map((item) => item.key),
        generatedAt,
        expiresAt,
    });

    return {
        questions,
        contextTags: context.contextTags,
        triggerSignals: context.triggerSignals.map((item) => item.key),
        generatedAt,
        expiresAt,
        fromCache: false,
    };
}

async function recordSuggestionRuntimeState(params: {
    supabase: ReturnType<typeof getSupabaseClient>;
    userId: string;
    serviceName: string;
    contextTags: string[];
    triggerSignals: string[];
    fromCache: boolean;
}): Promise<void> {
    const { supabase, userId, serviceName, contextTags, triggerSignals, fromCache } = params;
    if (!supabase) return;

    const now = new Date().toISOString();
    const taskTitle = fromCache ? '读取 Agent 预热缓存' : '生成 Agent 预热建议';
    const taskSummary = fromCache
        ? '已复用最近一次上下文预读取结果。'
        : '已基于用户历史、当前用药和触发信号生成前端可展示建议。';

    const taskInsert = await supabase
        .from('agent_background_tasks')
        .insert({
            user_id: userId,
            task_type: 'suggestion_refresh',
            task_status: 'succeeded',
            priority: 'normal',
            title: taskTitle,
            summary: taskSummary,
            input: { serviceName, force: !fromCache },
            output: { contextTags, triggerSignals, fromCache },
            scheduled_at: now,
            started_at: now,
            completed_at: now,
        });

    if (taskInsert.error && !isMissingRelationError(taskInsert.error, 'agent_background_tasks')) {
        console.warn('[agent-suggestions] record task failed:', taskInsert.error.message);
    }

    const stateUpsert = await supabase
        .from('agent_runtime_states')
        .upsert({
            user_id: userId,
            lifecycle_status: 'ready',
            last_context_summary: contextTags.length > 0
                ? `已预读取 ${contextTags.length} 类上下文`
                : '已完成 Agent 预热',
            last_context_tags: contextTags,
            last_trigger_signals: triggerSignals,
            last_bootstrapped_at: now,
            background_status: {
                latestTask: 'suggestion_refresh',
                fromCache,
                serviceName,
            },
            last_error: null,
        }, { onConflict: 'user_id' });

    if (stateUpsert.error && !isMissingRelationError(stateUpsert.error, 'agent_runtime_states')) {
        console.warn('[agent-suggestions] record runtime state failed:', stateUpsert.error.message);
    }
}

export async function handleSuggestionRequest(req: Request, options: {
    serviceName: 'agent-bootstrap' | 'generate-agent-suggestions' | 'agent-presets';
    forceRefreshDefault?: boolean;
}): Promise<Response> {
    const traceId = createTraceId(req);
    const serviceName = options.serviceName;
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: jsonHeaders(traceId) });
    }

    if (req.method !== 'POST') {
        return new Response(
            JSON.stringify({
                success: false,
                questions: [],
                contextTags: [],
                triggerSignals: [],
                generatedAt: new Date().toISOString(),
                expiresAt: new Date().toISOString(),
                fromCache: false,
                traceId,
                error: 'Method not allowed',
            } as SuggestionResponse),
            { status: 405, headers: jsonHeaders(traceId) }
        );
    }

    try {
        const supabase = getSupabaseClient();
        if (!supabase) {
            return new Response(
                JSON.stringify({
                    success: false,
                    questions: [],
                    contextTags: [],
                    triggerSignals: [],
                    generatedAt: new Date().toISOString(),
                    expiresAt: new Date().toISOString(),
                    fromCache: false,
                    traceId,
                    error: '服务配置错误',
                } as SuggestionResponse),
                { status: 500, headers: jsonHeaders(traceId) }
            );
        }

        const body = (await req.json()) as SuggestionRequest;
        const forceRefresh = body.forceRefresh ?? options.forceRefreshDefault ?? false;
        const language = normalizeLanguage(body.language);
        const rolloutStage = getAgentRolloutStage();
        const suggestionsEnabled = isAgentSuggestionsEnabled();
        const authToken = normalizeToken(body.userJwt) || getBearerToken(req);
        const userId = await getAuthenticatedUserId(supabase, authToken);
        if (!userId) {
            return new Response(
                JSON.stringify({
                    success: false,
                    questions: [],
                    contextTags: [],
                    triggerSignals: [],
                    generatedAt: new Date().toISOString(),
                    expiresAt: new Date().toISOString(),
                    fromCache: false,
                    traceId,
                    error: '未授权访问',
                } as SuggestionResponse),
                { status: 401, headers: jsonHeaders(traceId) }
            );
        }

        if (!suggestionsEnabled) {
            const now = new Date().toISOString();
            const response: SuggestionResponse = {
                success: true,
                questions: buildGlobalFallbackQuestions(language),
                contextTags: [],
                triggerSignals: [],
                generatedAt: now,
                expiresAt: now,
                fromCache: false,
                traceId,
            };
            logTrace(serviceName, 'suggestions.disabled_fallback', traceId, {
                user_id: userId,
                rollout_stage: rolloutStage,
            });
            return new Response(
                JSON.stringify(response),
                { status: 200, headers: jsonHeaders(traceId) }
            );
        }

        const result = await generateSuggestions({
            supabase,
            userId,
            forceRefresh,
            language,
        });

        await recordSuggestionRuntimeState({
            supabase,
            userId,
            serviceName,
            contextTags: result.contextTags,
            triggerSignals: result.triggerSignals,
            fromCache: result.fromCache,
        });

        logTrace(serviceName, 'suggestions.generated', traceId, {
            user_id: userId,
            force_refresh: forceRefresh,
            from_cache: result.fromCache,
            rollout_stage: rolloutStage,
            question_count: result.questions.length,
            context_tags: result.contextTags,
            trigger_signals: result.triggerSignals,
        });

        const response: SuggestionResponse = {
            success: true,
            questions: result.questions,
            contextTags: result.contextTags,
            triggerSignals: result.triggerSignals,
            generatedAt: result.generatedAt,
            expiresAt: result.expiresAt,
            fromCache: result.fromCache,
            traceId,
        };

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: jsonHeaders(traceId) }
        );
    } catch (error) {
        console.error(`[${serviceName}] error:`, error);
        return new Response(
            JSON.stringify({
                success: false,
                questions: [],
                contextTags: [],
                triggerSignals: [],
                generatedAt: new Date().toISOString(),
                expiresAt: new Date().toISOString(),
                fromCache: false,
                traceId,
                error: error instanceof Error ? error.message : '生成推荐问题失败',
            } as SuggestionResponse),
            { status: 500, headers: jsonHeaders(traceId) }
        );
    }
}
