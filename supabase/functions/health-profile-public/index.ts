/**
 * @file health-profile-public/index.ts
 * @description 对外非敏感健康档案投影接口，默认关闭
 * @endpoint POST /functions/v1/health-profile-public
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt',
};

function isFeatureEnabled(envKey: string, defaultValue = false): boolean {
    const raw = Deno.env.get(envKey);
    if (!raw) return defaultValue;
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getSupabaseClient() {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return null;
    return createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

function normalizeToken(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const value = raw.trim();
    if (!value) return null;
    const matched = value.match(/^Bearer\s+(.+)$/i);
    return (matched ? matched[1] : value).trim() || null;
}

function getBearerToken(req: Request): string | null {
    return normalizeToken(req.headers.get('x-user-jwt') || req.headers.get('authorization'));
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

serve(async (req) => {
    const respond = (status: number, payload: Record<string, unknown>) => new Response(
        JSON.stringify(payload),
        {
            status,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
            },
        }
    );

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (!isFeatureEnabled('FEATURE_HEALTH_PROFILE_PUBLIC_ENABLED', false)) {
        return respond(503, {
            success: false,
            error: '非敏感健康档案对外接口尚未开启',
        });
    }

    if (req.method !== 'POST') {
        return respond(405, { success: false, error: 'Method not allowed' });
    }

    try {
        const supabase = getSupabaseClient();
        if (!supabase) {
            return respond(500, { success: false, error: '服务配置错误' });
        }

        const userId = await getAuthenticatedUserId(supabase, getBearerToken(req));
        if (!userId) {
            return respond(401, { success: false, error: '未授权访问' });
        }

        const { data: profile } = await supabase
            .from('health_profiles')
            .select('birth_date, gender, medical_history, allergies')
            .eq('user_id', userId)
            .maybeSingle();

        const { data: schedules } = await supabase
            .from('medication_schedules')
            .select('medication_name, status')
            .eq('user_id', userId)
            .eq('status', 'active')
            .limit(20);

        const { data: feedback } = await supabase
            .from('medication_feedback')
            .select('medication_name, mood, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);

        const { data: adherence } = await supabase
            .from('medication_logs')
            .select('status, scheduled_date')
            .eq('user_id', userId)
            .gte('scheduled_date', new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10))
            .limit(200);

        const now = new Date();
        const birthYear = profile?.birth_date ? new Date(profile.birth_date).getFullYear() : null;
        const age = birthYear ? now.getFullYear() - birthYear : null;
        const ageRange = age === null
            ? null
            : age < 18
                ? '0-17'
                : age < 30
                    ? '18-29'
                    : age < 45
                        ? '30-44'
                        : age < 60
                            ? '45-59'
                            : '60+';

        const totalLogs = Array.isArray(adherence) ? adherence.length : 0;
        const completedLogs = Array.isArray(adherence)
            ? adherence.filter((item) => item.status === 'taken' || item.status === 'late').length
            : 0;

        return respond(200, {
            success: true,
            projection: {
                ageRange,
                gender: profile?.gender || null,
                currentMedicationSummary: Array.isArray(schedules)
                    ? schedules.map((item) => item.medication_name).filter(Boolean)
                    : [],
                adherenceSummary: totalLogs > 0
                    ? {
                        totalLogs,
                        completedLogs,
                        complianceRate: Number(((completedLogs / totalLogs) * 100).toFixed(2)),
                    }
                    : null,
                allergyTags: String(profile?.allergies || '')
                    .split(/[,，、\n]/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                riskTags: String(profile?.medical_history || '')
                    .split(/[,，、\n]/)
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .slice(0, 10),
                recentFeedbackSummary: Array.isArray(feedback)
                    ? feedback.map((item) => ({
                        medicationName: item.medication_name,
                        mood: item.mood,
                        createdAt: item.created_at,
                    }))
                    : [],
            },
        });
    } catch (error) {
        return respond(500, {
            success: false,
            error: error instanceof Error ? error.message : '读取投影档案失败',
        });
    }
});
