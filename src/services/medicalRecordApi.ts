import { supabase } from './supabase';
import type { ExtractedMedication } from '../types/MedicalRecord.types';

export interface SaveMedicalRecordPayload {
    imageUri?: string | null;
    rawText?: string | null;
    medications: ExtractedMedication[];
    ocrStatus?: string;
    ocrProvider?: string | null;
}

export interface SaveMedicalRecordResult {
    success: boolean;
    recordId?: string;
    itemCount?: number;
    error?: string;
}

export interface GenerateSchedulesResult {
    success: boolean;
    createdCount?: number;
    error?: string;
}

export interface SavedPrescriptionSummary {
    recordId: string;
    recognizedAt: string;
    ocrStatus: string;
    itemCount: number;
    medicationNames: string[];
}

export interface SavedPrescriptionSummaryResult {
    success: boolean;
    records: SavedPrescriptionSummary[];
    error?: string;
}

const DEFAULT_REMINDER_BY_COUNT: Record<number, string[]> = {
    1: ['08:00'],
    2: ['08:00', '20:00'],
    3: ['08:00', '14:00', '20:00'],
    4: ['08:00', '12:00', '16:00', '20:00'],
};

function normalizeFrequency(raw?: string): string {
    const value = (raw || '').trim();
    if (!value) return 'onceDaily';
    const lower = value.toLowerCase();

    if (lower.includes('每日4') || lower.includes('4次') || lower.includes('four')) return 'fourTimesDaily';
    if (lower.includes('每日3') || lower.includes('3次') || lower.includes('three')) return 'thriceDaily';
    if (lower.includes('每日2') || lower.includes('2次') || lower.includes('twice')) return 'twiceDaily';
    if (lower.includes('需要') || lower.includes('按需') || lower.includes('as needed') || lower.includes('prn')) return 'asNeeded';
    return 'onceDaily';
}

function remindersFromFrequency(
    frequency: string,
    scheduleId: string,
    dosage?: string
): Array<{ id: string; time: string; dosage: string }> {
    const count = frequency === 'fourTimesDaily'
        ? 4
        : frequency === 'thriceDaily'
            ? 3
            : frequency === 'twiceDaily'
                ? 2
                : 1;

    const times = DEFAULT_REMINDER_BY_COUNT[count] || DEFAULT_REMINDER_BY_COUNT[1];
    const safeDosage = (dosage || '').trim();

    return times.map((time, index) => ({
        id: `${scheduleId}-template-${time}-${index}`,
        time,
        dosage: safeDosage,
    }));
}

function parseDurationDays(duration?: string): number | null {
    if (!duration) return null;
    const matched = duration.match(/(\d+)/);
    if (!matched) return null;
    const parsed = Number(matched[1]);
    if (Number.isNaN(parsed) || parsed <= 0) return null;
    return parsed;
}

function addDays(baseDate: string, days: number): string {
    const d = new Date(`${baseDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

async function getAuthedUserId(): Promise<string | null> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user.id;
}

export async function saveMedicalRecordWithItems(
    payload: SaveMedicalRecordPayload
): Promise<SaveMedicalRecordResult> {
    try {
        const userId = await getAuthedUserId();
        if (!userId) {
            return { success: false, error: '未登录，无法保存病历' };
        }

        const validItems = (payload.medications || [])
            .map((item) => ({
                ...item,
                name: (item.name || '').trim(),
            }))
            .filter((item) => item.name.length > 0);

        if (validItems.length === 0) {
            return { success: false, error: '没有可保存的处方药物' };
        }

        const recognizedAt = new Date().toISOString();
        const { data: record, error: recordError } = await supabase
            .from('medical_records')
            .insert({
                user_id: userId,
                image_uri: payload.imageUri || null,
                raw_text: payload.rawText || null,
                ocr_status: payload.ocrStatus || 'manual_confirmed',
                ocr_provider: payload.ocrProvider || null,
                source: 'upload',
                recognized_at: recognizedAt,
            })
            .select('id')
            .single();

        if (recordError || !record?.id) {
            return {
                success: false,
                error: recordError?.message || '保存病历失败',
            };
        }

        const itemPayload = validItems.map((item) => ({
            user_id: userId,
            record_id: record.id,
            medication_name: item.name,
            dosage: item.dosage || null,
            frequency: item.frequency || null,
            duration: item.duration || null,
            instructions: item.instructions || null,
            confidence: item.confidence || 0,
            parsed_payload: item,
        }));

        const { error: itemsError } = await supabase
            .from('prescription_items')
            .insert(itemPayload);

        if (itemsError) {
            return {
                success: false,
                error: itemsError.message,
            };
        }

        return {
            success: true,
            recordId: record.id,
            itemCount: itemPayload.length,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : '保存病历失败',
        };
    }
}

export async function generateSchedulesFromPrescriptionItems(params: {
    recordId: string;
    medications: ExtractedMedication[];
    startDate?: string;
}): Promise<GenerateSchedulesResult> {
    try {
        const userId = await getAuthedUserId();
        if (!userId) {
            return { success: false, error: '未登录，无法生成计划' };
        }

        const validItems = (params.medications || [])
            .map((item) => ({
                ...item,
                name: (item.name || '').trim(),
            }))
            .filter((item) => item.name.length > 0);

        if (validItems.length === 0) {
            return { success: false, error: '没有可生成计划的药物' };
        }

        const startDate = params.startDate || new Date().toISOString().slice(0, 10);

        // 同一 record 重复触发时保持幂等
        const { error: deleteError } = await supabase
            .from('medication_schedules')
            .delete()
            .eq('user_id', userId)
            .eq('source_record_id', params.recordId);
        if (deleteError) {
            return { success: false, error: deleteError.message };
        }

        const schedulePayload = validItems.map((item) => {
            const scheduleId = crypto.randomUUID();
            const frequency = normalizeFrequency(item.frequency);
            const durationDays = parseDurationDays(item.duration);

            return {
                id: scheduleId,
                user_id: userId,
                medication_name: item.name,
                medication_dosage: item.dosage || null,
                instructions: item.instructions || null,
                frequency,
                reminders: remindersFromFrequency(frequency, scheduleId, item.dosage),
                status: 'active',
                start_date: startDate,
                end_date: durationDays ? addDays(startDate, Math.max(durationDays - 1, 0)) : null,
                source_record_id: params.recordId,
            };
        });

        const { error: insertError } = await supabase
            .from('medication_schedules')
            .insert(schedulePayload);

        if (insertError) {
            return { success: false, error: insertError.message };
        }

        return {
            success: true,
            createdCount: schedulePayload.length,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : '生成用药计划失败',
        };
    }
}

export async function fetchSavedPrescriptionSummaries(limit: number = 6): Promise<SavedPrescriptionSummaryResult> {
    try {
        const userId = await getAuthedUserId();
        if (!userId) {
            return { success: false, records: [], error: '未登录，无法读取病历' };
        }

        const { data: records, error: recordsError } = await supabase
            .from('medical_records')
            .select('id, recognized_at, created_at, ocr_status')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (recordsError) {
            return { success: false, records: [], error: recordsError.message };
        }

        const safeRecords = Array.isArray(records) ? records : [];
        if (safeRecords.length === 0) {
            return { success: true, records: [] };
        }

        const recordIds = safeRecords.map((record) => record.id);
        const { data: items, error: itemsError } = await supabase
            .from('prescription_items')
            .select('record_id, medication_name')
            .eq('user_id', userId)
            .in('record_id', recordIds)
            .order('created_at', { ascending: true });

        if (itemsError) {
            return { success: false, records: [], error: itemsError.message };
        }

        const itemMap = new Map<string, string[]>();
        (items || []).forEach((item) => {
            const list = itemMap.get(item.record_id) || [];
            if (item.medication_name) list.push(item.medication_name);
            itemMap.set(item.record_id, list);
        });

        const summaries: SavedPrescriptionSummary[] = safeRecords.map((record) => {
            const names = Array.from(new Set(itemMap.get(record.id) || [])).filter(Boolean);
            return {
                recordId: record.id,
                recognizedAt: record.recognized_at || record.created_at || new Date().toISOString(),
                ocrStatus: record.ocr_status || 'manual_confirmed',
                itemCount: names.length,
                medicationNames: names.slice(0, 6),
            };
        });

        return { success: true, records: summaries };
    } catch (error) {
        return {
            success: false,
            records: [],
            error: error instanceof Error ? error.message : '读取病历失败',
        };
    }
}
