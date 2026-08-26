/**
 * @file useMedicationSchedule.ts
 * @description 服药计划管理 Hook
 * @author AI用药助手开发团队
 * @created 2026-02-03
 * @updated 2026-03-05 — 引入按日期的服药记录，修复 taken 状态泄漏到所有日期的 bug
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../user/useAuth';
import { formatLocalDateKey, normalizeDateKey } from '../../utils/dateKey';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { vectorizeDocument } from '../../services/agentApi';

// ===================== 类型定义 =====================

export interface MedicationReminder {
    id: string;
    time: string;
    dosage: string;
    /** @deprecated — kept for migration compat; actual taken state is in takenRecords */
    taken: boolean;
    takenAt?: string;
    missed?: boolean;
}

export interface MedicationSchedule {
    id: string;
    medicationName: string;
    medicationDosage: string;
    frequency: string;
    instructions?: string;
    sourceRecordId?: string;
    allowWindowMinutes?: number;
    /** 按日期的覆盖配置（仅当天生效） */
    dateOverrides?: Record<string, ScheduleOverride>;
    startDate: string;
    endDate?: string;
    reminders: MedicationReminder[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    /** Configurable time window in minutes (±) for confirm button. Default 20. */
    graceMinutes?: number;
}

export interface ScheduleOverride {
    /** When true, this schedule is hidden on the specific date. */
    isDeleted?: boolean;
    medicationName?: string;
    medicationDosage?: string;
    frequency?: string;
    instructions?: string;
    reminderTimes?: string[];
    reminders?: Array<{
        id: string;
        time: string;
        dosage: string;
    }>;
    allowWindowMinutes?: number;
}

/** Per-date, per-reminder taken record */
export interface TakenRecord {
    taken: boolean;
    takenAt?: string;
    missed?: boolean;
}

/** Map: date string (YYYY-MM-DD) → { reminderId → TakenRecord } */
export type TakenRecords = Record<string, Record<string, TakenRecord>>;

export interface UseMedicationScheduleReturn {
    schedules: MedicationSchedule[];
    takenRecords: TakenRecords;
    anchorDate: string | null;
    syncState: 'cloud' | 'local' | 'mixed' | 'migrating';
    lastSyncedAt: string | null;
    isLoading: boolean;
    isSaving: boolean;
    error: string | null;
    loadSchedules: () => Promise<void>;
    addSchedule: (schedule: Omit<MedicationSchedule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    createSchedule: (schedule: Omit<MedicationSchedule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateSchedule: (id: string, updates: Partial<MedicationSchedule>) => Promise<void>;
    deleteSchedule: (id: string) => Promise<void>;
    markAsTaken: (scheduleId: string, reminderId: string, date?: string) => Promise<void>;
    markAsMissed: (scheduleId: string, reminderId: string, date?: string) => Promise<void>;
    isReminderTaken: (reminderId: string, date?: string) => boolean;
    setDateOverride: (scheduleId: string, date: string, override: ScheduleOverride) => Promise<void>;
    getSchedulesForDate: (date: string) => MedicationSchedule[];
    getTodaySchedules: () => MedicationSchedule[];
    setAnchorDate: (date: string) => Promise<void>;
}

// ===================== Constants =====================

const STORAGE_KEY_PREFIX = 'medication_schedules';
const TAKEN_KEY_PREFIX = 'medication_taken';
const ANCHOR_KEY_PREFIX = 'medication_anchor_date';
const CLOUD_MIGRATION_MARKER_PREFIX = 'medication_cloud_migrated';
const CLOUD_LOG_LOOKBACK_DAYS = 120;
export const MEDICATION_SCHEDULES_INVALIDATED_EVENT = 'medication-schedules:invalidate';
const SCHEDULE_SELECT_COLUMNS = 'id, user_id, medication_name, medication_dosage, instructions, frequency, reminders, status, start_date, end_date, source_record_id, allow_window_minutes, date_overrides, created_at, updated_at';
const FREQUENCY_KEYS = ['onceDaily', 'twiceDaily', 'thriceDaily', 'fourTimesDaily', 'asNeeded'] as const;
const FREQUENCY_TEXT_TO_KEY: Record<string, string> = {
    '每日1次': 'onceDaily',
    '每日2次': 'twiceDaily',
    '每日3次': 'thriceDaily',
    '每日4次': 'fourTimesDaily',
    '需要时': 'asNeeded',
    '需要時': 'asNeeded',
    'Once daily': 'onceDaily',
    'Twice daily': 'twiceDaily',
    '3 times daily': 'thriceDaily',
    '4 times daily': 'fourTimesDaily',
    'As needed': 'asNeeded',
};

const normalizeFrequency = (value: string): string => {
    if (FREQUENCY_KEYS.includes(value as typeof FREQUENCY_KEYS[number])) {
        return value;
    }
    return FREQUENCY_TEXT_TO_KEY[value] || value;
};

function todayKey(): string {
    return formatLocalDateKey(new Date());
}

const buildReminderIdForDate = (scheduleId: string, date: string, time: string, index: number): string =>
    `${scheduleId}-${date}-${time}-${index}`;

const parseReminderTimeToMinutes = (time: string): number | null => {
    const parts = time.split(':').map(Number);
    if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
        return null;
    }
    return parts[0] * 60 + parts[1];
};

const getMinimumDoseIntervalMinutes = (schedule: MedicationSchedule): number => {
    const times = schedule.reminders
        .map(reminder => parseReminderTimeToMinutes(reminder.time))
        .filter((minutes): minutes is number => minutes !== null)
        .sort((a, b) => a - b);

    if (times.length <= 1) {
        return 24 * 60;
    }

    const gaps = times.map((current, index) => {
        const next = times[(index + 1) % times.length];
        if (index === times.length - 1) {
            return (24 * 60 - current) + next;
        }
        return next - current;
    }).filter(gap => gap > 0);

    if (gaps.length === 0) {
        return 24 * 60;
    }

    return Math.min(...gaps);
};

const getLatestTakenTimestamp = (records: TakenRecords, reminderId: string): number | null => {
    let latest: number | null = null;
    Object.values(records).forEach(dateRecords => {
        const record = dateRecords[reminderId];
        if (!record?.taken || !record.takenAt) return;
        const ts = new Date(record.takenAt).getTime();
        if (Number.isNaN(ts)) return;
        if (latest === null || ts > latest) {
            latest = ts;
        }
    });
    return latest;
};

const deriveAnchorDate = (items: MedicationSchedule[]): string | null => {
    const candidateDates = items
        .map(schedule => normalizeDateKey(schedule.startDate))
        .filter((date): date is string => date !== null);

    if (candidateDates.length === 0) {
        return null;
    }

    return candidateDates.sort()[0];
};

type MedicationScheduleRow = {
    id: string;
    user_id: string;
    medication_name: string;
    medication_dosage: string | null;
    instructions: string | null;
    frequency: string | null;
    reminders: unknown;
    status: string | null;
    start_date: string;
    end_date: string | null;
    source_record_id: string | null;
    allow_window_minutes?: number | null;
    date_overrides?: Record<string, ScheduleOverride> | null;
    effective_status?: string | null;
    is_current?: boolean | null;
    created_at: string;
    updated_at: string;
};

type MedicationLogRow = {
    schedule_id: string | null;
    reminder_id?: string | null;
    scheduled_date: string;
    status: string;
    taken_at: string | null;
};

const toReminderArray = (
    raw: unknown,
    fallbackDosage: string,
    scheduleId: string
): MedicationReminder[] => {
    if (!Array.isArray(raw)) return [];

    return raw
        .filter((item): item is { id?: string; time?: string; dosage?: string } =>
            !!item && typeof item === 'object'
        )
        .map((item, index) => {
            const time = typeof item.time === 'string' ? item.time : '';
            return {
                id: typeof item.id === 'string' && item.id.length > 0
                    ? item.id
                    : `${scheduleId}-template-${time || '00:00'}-${index}`,
                time: time || '00:00',
                dosage: typeof item.dosage === 'string' && item.dosage.length > 0
                    ? item.dosage
                    : fallbackDosage,
                taken: false,
                missed: false,
            };
        })
        .sort((a, b) => a.time.localeCompare(b.time));
};

const mapRowToSchedule = (row: MedicationScheduleRow): MedicationSchedule => {
    const fallbackDosage = row.medication_dosage || '';
    const reminders = toReminderArray(row.reminders, fallbackDosage, row.id);
    const currentDateKey = todayKey();
    const normalizedStartDate = normalizeDateKey(row.start_date) || row.start_date;
    const normalizedEndDate = row.end_date
        ? (normalizeDateKey(row.end_date) || row.end_date)
        : null;
    const effectiveIsCurrent = typeof row.is_current === 'boolean'
        ? row.is_current
        : ((row.status === 'active' || row.status === null)
            && normalizedStartDate <= currentDateKey
            && (!normalizedEndDate || normalizedEndDate >= currentDateKey));

    return {
        id: row.id,
        medicationName: row.medication_name,
        medicationDosage: fallbackDosage,
        frequency: normalizeFrequency(row.frequency || 'onceDaily'),
        instructions: row.instructions || '',
        sourceRecordId: row.source_record_id || undefined,
        reminders,
        isActive: effectiveIsCurrent,
        startDate: row.start_date,
        endDate: row.end_date || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        allowWindowMinutes: row.allow_window_minutes ?? undefined,
        graceMinutes: row.allow_window_minutes ?? undefined,
        dateOverrides: row.date_overrides || {},
    };
};

const mapScheduleFields = (schedule: MedicationSchedule) => ({
    medication_name: schedule.medicationName,
    medication_dosage: schedule.medicationDosage || null,
    instructions: schedule.instructions || null,
    frequency: normalizeFrequency(schedule.frequency),
    reminders: schedule.reminders.map((reminder) => ({
        id: reminder.id,
        time: reminder.time,
        dosage: reminder.dosage,
    })),
    status: schedule.isActive ? 'active' : 'paused',
    start_date: normalizeDateKey(schedule.startDate) || todayKey(),
    end_date: schedule.endDate ? (normalizeDateKey(schedule.endDate) || schedule.endDate) : null,
    source_record_id: schedule.sourceRecordId || null,
    allow_window_minutes: schedule.allowWindowMinutes ?? schedule.graceMinutes ?? null,
    date_overrides: schedule.dateOverrides || {},
});

const mapScheduleToDbInsertPayload = (schedule: MedicationSchedule, userId: string) => ({
    id: schedule.id,
    user_id: userId,
    ...mapScheduleFields(schedule),
});

const mapScheduleToDbUpdatePayload = (schedule: MedicationSchedule) => ({
    ...mapScheduleFields(schedule),
});

const buildScheduleRagContent = (schedule: MedicationSchedule): string => {
    const reminderTimes = schedule.reminders
        .map((item) => item.time)
        .filter(Boolean)
        .join(', ');

    return [
        `药物: ${schedule.medicationName}`,
        schedule.medicationDosage ? `剂量: ${schedule.medicationDosage}` : '',
        schedule.frequency ? `频率: ${schedule.frequency}` : '',
        schedule.instructions ? `说明: ${schedule.instructions}` : '',
        `开始日期: ${schedule.startDate}`,
        schedule.endDate ? `结束日期: ${schedule.endDate}` : '结束日期: 未设置',
        reminderTimes ? `提醒时间: ${reminderTimes}` : '',
        schedule.allowWindowMinutes || schedule.graceMinutes
            ? `确认窗口(分钟): ${schedule.allowWindowMinutes ?? schedule.graceMinutes}`
            : '',
    ].filter(Boolean).join('\n');
};

const buildTakenRecordsFromLogs = (logs: MedicationLogRow[]): TakenRecords => {
    const records: TakenRecords = {};

    logs.forEach((log) => {
        if (!log.reminder_id || !log.scheduled_date) return;
        const dateKey = normalizeDateKey(log.scheduled_date) || log.scheduled_date;
        if (!records[dateKey]) records[dateKey] = {};

        records[dateKey][log.reminder_id] = {
            taken: log.status === 'taken' || log.status === 'late' || !!log.taken_at,
            takenAt: log.taken_at || undefined,
            missed: log.status === 'skipped',
        };
    });

    return records;
};

const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
    if (chunkSize <= 0) return [items];
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
};

const normalizeReminderForMigration = (
    value: unknown,
    scheduleId: string,
    fallbackDosage: string,
    index: number
): MedicationReminder | null => {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const time = typeof record.time === 'string' && record.time.length > 0
        ? record.time
        : '00:00';
    const dosage = typeof record.dosage === 'string' && record.dosage.length > 0
        ? record.dosage
        : fallbackDosage;
    const id = typeof record.id === 'string' && record.id.length > 0
        ? record.id
        : `${scheduleId}-template-${time}-${index}`;
    return {
        id,
        time,
        dosage,
        taken: false,
        missed: false,
    };
};

const normalizeLocalScheduleForMigration = (value: unknown): MedicationSchedule | null => {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;

    const id = typeof row.id === 'string' && row.id.length > 0 ? row.id : crypto.randomUUID();
    const medicationName = typeof row.medicationName === 'string' ? row.medicationName.trim() : '';
    if (!medicationName) return null;

    const medicationDosage = typeof row.medicationDosage === 'string' ? row.medicationDosage : '';
    const rawReminders = Array.isArray(row.reminders) ? row.reminders : [];
    const reminders = rawReminders
        .map((reminder, index) => normalizeReminderForMigration(reminder, id, medicationDosage, index))
        .filter((reminder): reminder is MedicationReminder => !!reminder);

    return {
        id,
        medicationName,
        medicationDosage,
        frequency: normalizeFrequency(typeof row.frequency === 'string' ? row.frequency : 'onceDaily'),
        instructions: typeof row.instructions === 'string' ? row.instructions : '',
        sourceRecordId: typeof row.sourceRecordId === 'string'
            ? row.sourceRecordId
            : (typeof row.source_record_id === 'string' ? row.source_record_id : undefined),
        allowWindowMinutes: typeof row.allowWindowMinutes === 'number' ? row.allowWindowMinutes : undefined,
        dateOverrides: (row.dateOverrides && typeof row.dateOverrides === 'object')
            ? row.dateOverrides as Record<string, ScheduleOverride>
            : {},
        startDate: normalizeDateKey(typeof row.startDate === 'string' ? row.startDate : '') || todayKey(),
        endDate: normalizeDateKey(typeof row.endDate === 'string' ? row.endDate : '') || undefined,
        reminders,
        isActive: row.isActive !== false,
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
        graceMinutes: typeof row.graceMinutes === 'number' ? row.graceMinutes : undefined,
    };
};

// ===================== Hook =====================

/**
 * 服药计划管理 Hook
 * 数据按用户 ID 隔离存储
 * taken 状态按日期隔离，存储在 medication_taken_<userId> 中
 */
export function useMedicationSchedule(): UseMedicationScheduleReturn {
    const { user } = useAuth();
    const userId = user?.id;
    const cloudEnabled = useMemo(() => Boolean(userId) && isSupabaseConfigured(), [userId]);
    const storageKey = useMemo(
        () => userId ? `${STORAGE_KEY_PREFIX}_${userId}` : null,
        [userId]
    );
    const takenKey = useMemo(
        () => userId ? `${TAKEN_KEY_PREFIX}_${userId}` : null,
        [userId]
    );
    const anchorKey = useMemo(
        () => userId ? `${ANCHOR_KEY_PREFIX}_${userId}` : null,
        [userId]
    );
    const cloudMigrationMarkerKey = useMemo(
        () => userId ? `${CLOUD_MIGRATION_MARKER_PREFIX}_${userId}` : null,
        [userId]
    );

    const [schedules, setSchedules] = useState<MedicationSchedule[]>([]);
    const [takenRecords, setTakenRecords] = useState<TakenRecords>({});
    const [anchorDate, setAnchorDateState] = useState<string | null>(null);
    const [syncState, setSyncState] = useState<'cloud' | 'local' | 'mixed' | 'migrating'>('local');
    const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const saveAnchorDate = useCallback((date: string | null) => {
        if (!anchorKey) return;
        if (!date) {
            localStorage.removeItem(anchorKey);
            setAnchorDateState(null);
            return;
        }
        localStorage.setItem(anchorKey, date);
        setAnchorDateState(date);
    }, [anchorKey]);

    const setAnchorDate = useCallback(async (date: string) => {
        const normalized = normalizeDateKey(date);
        if (!normalized) return;
        saveAnchorDate(normalized);
    }, [saveAnchorDate]);

    const getReminderRecord = useCallback((reminderId: string, date: string): TakenRecord | undefined => {
        return takenRecords[date]?.[reminderId];
    }, [takenRecords]);

    const buildScheduleForDate = useCallback((schedule: MedicationSchedule, date: string): MedicationSchedule => {
        const override = schedule.dateOverrides?.[date];
        console.log('[buildScheduleForDate] date=', date, 'hasOverride=', !!override, 'overrideKeys=', override ? Object.keys(override) : 'none', 'scheduleName=', schedule.medicationName, 'overrideName=', override?.medicationName);
        const overrideReminders = override?.reminders;
        const reminderTimes = overrideReminders
            ? overrideReminders.map(reminder => reminder.time)
            : (override?.reminderTimes ?? schedule.reminders.map(r => r.time));
        const allowWindowMinutes = override?.allowWindowMinutes ?? schedule.allowWindowMinutes ?? schedule.graceMinutes ?? 0;

        const reminders = reminderTimes.map((time, index) => {
            const baseReminder = schedule.reminders[index];
            const overrideReminder = overrideReminders?.[index];
            const reminderId = overrideReminder?.id
                || (override
                    ? buildReminderIdForDate(schedule.id, date, time, index)
                    : (baseReminder?.id || buildReminderIdForDate(schedule.id, date, time, index)));
            const record = getReminderRecord(reminderId, date);
            return {
                id: reminderId,
                time,
                dosage: overrideReminder?.dosage ?? override?.medicationDosage ?? baseReminder?.dosage ?? schedule.medicationDosage,
                taken: !!record?.taken,
                missed: !!record?.missed,
                takenAt: record?.takenAt,
            };
        });

        return {
            ...schedule,
            medicationName: override?.medicationName ?? schedule.medicationName,
            medicationDosage: override?.medicationDosage ?? schedule.medicationDosage,
            frequency: override?.frequency ? normalizeFrequency(override.frequency) : schedule.frequency,
            instructions: override?.instructions ?? schedule.instructions,
            reminders,
            allowWindowMinutes,
        };
    }, [getReminderRecord]);

    const migrateLocalDataToCloudIfNeeded = useCallback(async (): Promise<void> => {
        if (!cloudEnabled || !userId || !storageKey || !takenKey || !cloudMigrationMarkerKey) return;
        if (localStorage.getItem(cloudMigrationMarkerKey) === 'done') return;

        const localScheduleRaw = localStorage.getItem(storageKey);
        const localTakenRaw = localStorage.getItem(takenKey);
        if (!localScheduleRaw && !localTakenRaw) {
            localStorage.setItem(cloudMigrationMarkerKey, 'done');
            return;
        }

        let localSchedules: MedicationSchedule[] = [];
        let localTakenRecords: TakenRecords = {};

        try {
            const parsed = localScheduleRaw ? JSON.parse(localScheduleRaw) : [];
            localSchedules = Array.isArray(parsed)
                ? parsed
                    .map((item) => normalizeLocalScheduleForMigration(item))
                    .filter((item): item is MedicationSchedule => !!item)
                : [];
        } catch (parseError) {
            console.warn('[useMedicationSchedule] local schedule parse failed in migration:', parseError);
        }

        try {
            const parsedTaken = localTakenRaw ? JSON.parse(localTakenRaw) : {};
            localTakenRecords = parsedTaken && typeof parsedTaken === 'object' ? parsedTaken as TakenRecords : {};
        } catch (parseError) {
            console.warn('[useMedicationSchedule] local taken parse failed in migration:', parseError);
        }

        if (localSchedules.length === 0 && Object.keys(localTakenRecords).length === 0) {
            localStorage.setItem(cloudMigrationMarkerKey, 'done');
            return;
        }

        if (localSchedules.length > 0) {
            const schedulePayload = localSchedules.map((schedule) => mapScheduleToDbInsertPayload(schedule, userId));
            const { error: scheduleUpsertError } = await supabase
                .from('medication_schedules')
                .upsert(schedulePayload, { onConflict: 'id' });

            if (scheduleUpsertError) {
                throw new Error(`migrate medication_schedules failed: ${scheduleUpsertError.message}`);
            }
        }

        const reminderLookup = new Map<string, {
            scheduleId: string;
            medicationName: string;
            dosage: string;
            time: string;
        }>();
        localSchedules.forEach((schedule) => {
            schedule.reminders.forEach((reminder) => {
                reminderLookup.set(reminder.id, {
                    scheduleId: schedule.id,
                    medicationName: schedule.medicationName,
                    dosage: reminder.dosage || schedule.medicationDosage || '',
                    time: reminder.time || '00:00',
                });
            });
        });

        const logPayload: Array<{
            user_id: string;
            schedule_id: string;
            reminder_id: string;
            medication_name: string;
            dosage: string | null;
            scheduled_time: string;
            scheduled_date: string;
            taken_at: string | null;
            status: 'taken' | 'skipped';
            confirmed_by: 'manual';
        }> = [];

        Object.entries(localTakenRecords).forEach(([dateKey, reminders]) => {
            const normalizedDate = normalizeDateKey(dateKey) || dateKey;
            if (!reminders || typeof reminders !== 'object') return;

            Object.entries(reminders).forEach(([reminderId, record]) => {
                if (!record || typeof record !== 'object') return;
                const taken = !!record.taken;
                const missed = !!record.missed;
                if (!taken && !missed) return;

                const lookup = reminderLookup.get(reminderId);
                if (!lookup) return;

                const normalizedTime = lookup.time && lookup.time.length === 5
                    ? `${lookup.time}:00`
                    : (lookup.time || '00:00:00');

                logPayload.push({
                    user_id: userId,
                    schedule_id: lookup.scheduleId,
                    reminder_id: reminderId,
                    medication_name: lookup.medicationName,
                    dosage: lookup.dosage || null,
                    scheduled_time: normalizedTime,
                    scheduled_date: normalizedDate,
                    taken_at: taken ? (record.takenAt || new Date(`${normalizedDate}T00:00:00.000Z`).toISOString()) : null,
                    status: taken ? 'taken' : 'skipped',
                    confirmed_by: 'manual',
                });
            });
        });

        if (logPayload.length > 0) {
            const chunks = chunkArray(logPayload, 300);
            for (const chunk of chunks) {
                const { error: logUpsertError } = await supabase
                    .from('medication_logs')
                    .upsert(chunk, {
                        onConflict: 'user_id,schedule_id,scheduled_date,reminder_id',
                    });
                if (logUpsertError) {
                    throw new Error(`migrate medication_logs failed: ${logUpsertError.message}`);
                }
            }
        }

        localStorage.setItem(cloudMigrationMarkerKey, 'done');
        console.log('[useMedicationSchedule] local data migrated to cloud');
    }, [cloudEnabled, userId, storageKey, takenKey, cloudMigrationMarkerKey]);

    // ---- Load ----

    const loadSchedules = useCallback(async () => {
        if (!storageKey || !takenKey || !anchorKey) {
            setSchedules([]);
            setTakenRecords({});
            setAnchorDateState(null);
            setSyncState('local');
            setLastSyncedAt(null);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            if (cloudEnabled && userId) {
                try {
                    setSyncState('migrating');
                    await migrateLocalDataToCloudIfNeeded();
                } catch (migrationError) {
                    console.warn('[useMedicationSchedule] local->cloud migration failed, continue with normal load:', migrationError);
                    setError('本地数据迁移到云端失败，已继续加载现有数据');
                    setSyncState('mixed');
                }

                const { data: projectedRows, error: projectionError } = await supabase
                    .rpc('get_medication_schedule_projection', {
                        target_user_id: userId,
                        as_of_date: todayKey(),
                    });

                const { data: cloudRows, error: cloudError } = projectionError
                    ? await supabase
                        .from('medication_schedules')
                        .select(SCHEDULE_SELECT_COLUMNS)
                        .eq('user_id', userId)
                        .order('updated_at', { ascending: false })
                    : { data: projectedRows, error: null };

                if (!cloudError && Array.isArray(cloudRows)) {
                    const mapped = cloudRows.map((row) => mapRowToSchedule(row as MedicationScheduleRow));
                    setSchedules(mapped);
                    localStorage.setItem(storageKey, JSON.stringify(mapped));

                    const sinceDate = new Date();
                    sinceDate.setDate(sinceDate.getDate() - CLOUD_LOG_LOOKBACK_DAYS);
                    const sinceDateKey = formatLocalDateKey(sinceDate);

                    const { data: cloudLogs, error: logError } = await supabase
                        .from('medication_logs')
                        .select('schedule_id, reminder_id, scheduled_date, status, taken_at')
                        .eq('user_id', userId)
                        .gte('scheduled_date', sinceDateKey)
                        .in('status', ['taken', 'late', 'skipped'])
                        .order('scheduled_date', { ascending: false })
                        .limit(5000);

                    if (logError) {
                        console.warn('[useMedicationSchedule] cloud logs load failed:', logError.message);
                    }

                    const cloudTaken = buildTakenRecordsFromLogs((cloudLogs || []) as MedicationLogRow[]);
                    setTakenRecords(cloudTaken);
                    localStorage.setItem(takenKey, JSON.stringify(cloudTaken));
                    setSyncState('cloud');
                    setLastSyncedAt(new Date().toISOString());

                    const storedAnchor = normalizeDateKey(localStorage.getItem(anchorKey));
                    const derivedAnchor = deriveAnchorDate(mapped) || todayKey();
                    saveAnchorDate(storedAnchor || derivedAnchor);
                    return;
                }

                if (cloudError) {
                    console.warn('[useMedicationSchedule] cloud schedules load failed, fallback local:', cloudError.message);
                    setSyncState('mixed');
                }
            }

            const stored = localStorage.getItem(storageKey);
            if (!stored) {
                setSchedules([]);
                const storedTaken = localStorage.getItem(takenKey);
                setTakenRecords(storedTaken ? JSON.parse(storedTaken) : {});
                const storedAnchor = normalizeDateKey(localStorage.getItem(anchorKey));
                saveAnchorDate(storedAnchor || todayKey());
                if (!cloudEnabled) {
                    setSyncState('local');
                    setLastSyncedAt(null);
                }
                return;
            }

            const parsed = JSON.parse(stored);
            const migrated = Array.isArray(parsed)
                ? parsed.map((schedule: MedicationSchedule) => ({
                    ...schedule,
                    frequency: normalizeFrequency(schedule.frequency),
                }))
                : [];
            setSchedules(migrated);

            const storedTaken = localStorage.getItem(takenKey);
            const taken: TakenRecords = storedTaken ? JSON.parse(storedTaken) : {};
            let migrationNeeded = false;

            for (const schedule of migrated) {
                for (const reminder of schedule.reminders) {
                    if (!reminder.taken) continue;

                    const takenDate = reminder.takenAt
                        ? (normalizeDateKey(reminder.takenAt) || todayKey())
                        : todayKey();
                    if (!taken[takenDate]) taken[takenDate] = {};
                    if (!taken[takenDate][reminder.id]) {
                        taken[takenDate][reminder.id] = {
                            taken: true,
                            takenAt: reminder.takenAt || new Date().toISOString(),
                        };
                        migrationNeeded = true;
                    }
                    reminder.taken = false;
                    reminder.takenAt = undefined;
                }
            }

            if (migrationNeeded) {
                localStorage.setItem(storageKey, JSON.stringify(migrated));
                localStorage.setItem(takenKey, JSON.stringify(taken));
            }

            setTakenRecords(taken);
            const storedAnchor = normalizeDateKey(localStorage.getItem(anchorKey));
            const derivedAnchor = deriveAnchorDate(migrated) || todayKey();
            saveAnchorDate(storedAnchor || derivedAnchor);
            if (!cloudEnabled) {
                setSyncState('local');
                setLastSyncedAt(null);
            }
        } catch (err) {
            console.error('[useMedicationSchedule] Load error:', err);
            setError('加载服药计划失败');
            if (cloudEnabled) {
                setSyncState('mixed');
            }
        } finally {
            setIsLoading(false);
        }
    }, [storageKey, takenKey, anchorKey, saveAnchorDate, cloudEnabled, userId, migrateLocalDataToCloudIfNeeded]);

    // ---- Save helpers ----

    const saveSchedules = useCallback((newSchedules: MedicationSchedule[]) => {
        if (!storageKey) return;
        localStorage.setItem(storageKey, JSON.stringify(newSchedules));
        setSchedules(newSchedules);
    }, [storageKey]);

    const saveTakenRecords = useCallback((newRecords: TakenRecords) => {
        if (!takenKey) return;
        localStorage.setItem(takenKey, JSON.stringify(newRecords));
        setTakenRecords(newRecords);
    }, [takenKey]);

    const vectorizeSchedule = useCallback((schedule: MedicationSchedule) => {
        if (!cloudEnabled || !userId) return;
        const content = buildScheduleRagContent(schedule);
        if (!content.trim()) return;

        void vectorizeDocument({
            userId,
            sourceType: 'medication_schedule',
            sourceId: schedule.id,
            content,
            metadata: {
                medication_name: schedule.medicationName,
                frequency: schedule.frequency,
                start_date: schedule.startDate,
                end_date: schedule.endDate || null,
                is_active: schedule.isActive,
                reminder_count: schedule.reminders.length,
                allow_window_minutes: schedule.allowWindowMinutes ?? schedule.graceMinutes ?? null,
            },
        }).then((result) => {
            if (!result.success) {
                console.warn('[useMedicationSchedule] schedule vectorize failed:', result.error);
            }
        }).catch((vectorErr) => {
            console.warn('[useMedicationSchedule] schedule vectorize error:', vectorErr);
        });
    }, [cloudEnabled, userId]);

    // ---- CRUD ----

    const addSchedule = useCallback(async (
        schedule: Omit<MedicationSchedule, 'id' | 'createdAt' | 'updatedAt'>
    ) => {
        setError(null);
        const normalizedStartDate = normalizeDateKey(schedule.startDate) || todayKey();
        const newSchedule: MedicationSchedule = {
            ...schedule,
            startDate: normalizedStartDate,
            frequency: normalizeFrequency(schedule.frequency),
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        if (cloudEnabled && userId) {
            const { data: inserted, error: insertError } = await supabase
                .from('medication_schedules')
                .insert(mapScheduleToDbInsertPayload(newSchedule, userId))
                .select(SCHEDULE_SELECT_COLUMNS)
                .single();

            if (insertError) {
                console.warn('[useMedicationSchedule] cloud insert failed, fallback local:', insertError.message);
                setError('云端保存失败，已保存在本地缓存');
                setSyncState('mixed');
            } else if (inserted) {
                const savedSchedule = mapRowToSchedule(inserted as MedicationScheduleRow);
                saveSchedules([...schedules, savedSchedule]);
                if (!anchorDate) {
                    saveAnchorDate(normalizedStartDate);
                }
                vectorizeSchedule(savedSchedule);
                setSyncState('cloud');
                setLastSyncedAt(new Date().toISOString());
                return;
            }
        }

        saveSchedules([...schedules, newSchedule]);
        if (!anchorDate) {
            saveAnchorDate(normalizedStartDate);
        }
    }, [schedules, saveSchedules, anchorDate, saveAnchorDate, cloudEnabled, userId, vectorizeSchedule]);

    const updateSchedule = useCallback(async (id: string, updates: Partial<MedicationSchedule>) => {
        setError(null);
        console.log('[updateSchedule] id=', id, 'updates=', JSON.stringify(updates).substring(0, 500));
        const existing = schedules.find((schedule) => schedule.id === id);
        if (!existing) return;

        const normalizedUpdates: Partial<MedicationSchedule> = {
            ...updates,
            ...(updates.frequency ? { frequency: normalizeFrequency(updates.frequency) } : {}),
            ...(updates.startDate ? { startDate: normalizeDateKey(updates.startDate) || updates.startDate } : {}),
            ...(updates.endDate ? { endDate: normalizeDateKey(updates.endDate) || updates.endDate } : {}),
        };

        const merged: MedicationSchedule = {
            ...existing,
            ...normalizedUpdates,
            frequency: normalizeFrequency(normalizedUpdates.frequency || existing.frequency),
            updatedAt: new Date().toISOString(),
        };

        const updated = schedules.map(s =>
            s.id === id
                ? merged
                : s
        );

        if (cloudEnabled && userId) {
            const { data: cloudRow, error: updateError } = await supabase
                .from('medication_schedules')
                .update(mapScheduleToDbUpdatePayload(merged))
                .eq('id', id)
                .eq('user_id', userId)
                .select(SCHEDULE_SELECT_COLUMNS)
                .single();

            if (updateError) {
                console.warn('[useMedicationSchedule] cloud update failed, fallback local:', updateError.message);
                setError('云端更新失败，已更新本地缓存');
                setSyncState('mixed');
            } else if (cloudRow) {
                const mapped = mapRowToSchedule(cloudRow as MedicationScheduleRow);
                const cloudUpdated = schedules.map(s => (s.id === id ? mapped : s));
                saveSchedules(cloudUpdated);
                if (normalizedUpdates.startDate) {
                    saveAnchorDate(normalizedUpdates.startDate);
                }
                vectorizeSchedule(mapped);
                setSyncState('cloud');
                setLastSyncedAt(new Date().toISOString());
                return;
            }
        }

        saveSchedules(updated);
        if (normalizedUpdates.startDate) {
            saveAnchorDate(normalizedUpdates.startDate);
        }
    }, [schedules, saveSchedules, saveAnchorDate, cloudEnabled, userId, vectorizeSchedule]);

    const deleteSchedule = useCallback(async (id: string) => {
        setError(null);
        if (cloudEnabled && userId) {
            const { error: deleteError } = await supabase
                .from('medication_schedules')
                .delete()
                .eq('id', id)
                .eq('user_id', userId);

            if (deleteError) {
                console.warn('[useMedicationSchedule] cloud delete failed:', deleteError.message);
                setError('删除失败，请稍后重试');
                setSyncState('mixed');
                return;
            }

            setSyncState('cloud');
            setLastSyncedAt(new Date().toISOString());
        }

        const filtered = schedules.filter(s => s.id !== id);
        saveSchedules(filtered);
    }, [schedules, saveSchedules, cloudEnabled, userId]);

    const syncMedicationLog = useCallback(async (params: {
        scheduleId: string;
        reminderId: string;
        dateKey: string;
        status: 'taken' | 'skipped';
        takenAt?: string;
    }) => {
        if (!cloudEnabled || !userId) return;

        const { scheduleId, reminderId, dateKey, status, takenAt } = params;
        const baseSchedule = schedules.find((schedule) => schedule.id === scheduleId);
        if (!baseSchedule) return;

        const scheduleForDate = buildScheduleForDate(baseSchedule, dateKey);
        const reminder = scheduleForDate.reminders.find((item) => item.id === reminderId)
            || baseSchedule.reminders.find((item) => item.id === reminderId);

        const reminderTime = reminder?.time || '00:00';
        const scheduledTime = reminderTime.length === 5 ? `${reminderTime}:00` : reminderTime;
        const takenTimestamp = takenAt || new Date().toISOString();

        const { error: logError } = await supabase
            .from('medication_logs')
            .upsert({
                user_id: userId,
                schedule_id: scheduleId,
                reminder_id: reminderId,
                medication_name: scheduleForDate.medicationName,
                dosage: reminder?.dosage || scheduleForDate.medicationDosage || null,
                scheduled_time: scheduledTime,
                scheduled_date: dateKey,
                taken_at: status === 'taken' ? takenTimestamp : null,
                status,
                confirmed_by: 'manual',
            }, {
                onConflict: 'user_id,schedule_id,scheduled_date,reminder_id',
            });

        if (logError) {
            console.warn('[useMedicationSchedule] medication_logs upsert failed:', logError.message);
            setError('服药记录云端同步失败，已保存在本地缓存');
            setSyncState('mixed');
            return;
        }
        setSyncState('cloud');
        setLastSyncedAt(new Date().toISOString());
    }, [cloudEnabled, userId, schedules, buildScheduleForDate]);

    // ---- Taken tracking (per-date) ----

    const markAsTaken = useCallback(async (scheduleId: string, reminderId: string, date?: string) => {
        const dateKey = date || todayKey();
        const baseSchedule = schedules.find(item => item.id === scheduleId);
        if (!baseSchedule) return;
        const schedule = buildScheduleForDate(baseSchedule, dateKey);
        const latestTakenTs = getLatestTakenTimestamp(takenRecords, reminderId);
        const minimumInterval = getMinimumDoseIntervalMinutes(schedule);
        const requiredGapMinutes = Math.max(60, Math.floor(minimumInterval * 0.8));
        const nowTs = Date.now();
        const localToday = todayKey();

        // Prevent accidental duplicate intake after timezone relocation or short repeated clicks.
        if (latestTakenTs !== null && dateKey >= localToday) {
            const elapsedMinutes = (nowTs - latestTakenTs) / 60000;
            if (elapsedMinutes >= 0 && elapsedMinutes < requiredGapMinutes) {
                setError('检测到短时间内重复服药记录，为避免多服，本次记录已拦截。');
                return;
            }
        }

        setError(null);
        const takenAt = new Date().toISOString();
        const newRecords = { ...takenRecords };
        const dateRecords = { ...(newRecords[dateKey] || {}) };
        dateRecords[reminderId] = {
            taken: true,
            takenAt,
            missed: false,
        };
        newRecords[dateKey] = dateRecords;
        saveTakenRecords(newRecords);
        await syncMedicationLog({
            scheduleId,
            reminderId,
            dateKey,
            status: 'taken',
            takenAt,
        });
    }, [takenRecords, saveTakenRecords, schedules, buildScheduleForDate, syncMedicationLog]);

    const markAsMissed = useCallback(async (scheduleId: string, reminderId: string, date?: string) => {
        setError(null);
        const dateKey = date || todayKey();
        const newRecords = { ...takenRecords };
        const dateRecords = { ...(newRecords[dateKey] || {}) };
        dateRecords[reminderId] = { taken: false, missed: true };
        newRecords[dateKey] = dateRecords;
        saveTakenRecords(newRecords);
        await syncMedicationLog({
            scheduleId,
            reminderId,
            dateKey,
            status: 'skipped',
        });
    }, [takenRecords, saveTakenRecords, syncMedicationLog]);

    const isReminderTaken = useCallback((reminderId: string, date?: string): boolean => {
        const dateKey = date || todayKey();
        return !!takenRecords[dateKey]?.[reminderId]?.taken;
    }, [takenRecords]);

    const setDateOverride = useCallback(async (scheduleId: string, date: string, override: ScheduleOverride) => {
        const updated = schedules.map(s => {
            if (s.id !== scheduleId) return s;
            const currentOverrides = s.dateOverrides || {};
            return {
                ...s,
                dateOverrides: {
                    ...currentOverrides,
                    [date]: {
                        ...currentOverrides[date],
                        ...override,
                    },
                },
                updatedAt: new Date().toISOString(),
            };
        });

        if (cloudEnabled && userId) {
            const target = updated.find((schedule) => schedule.id === scheduleId);
            if (target) {
                const { data: cloudRow, error: updateError } = await supabase
                    .from('medication_schedules')
                    .update({
                        date_overrides: target.dateOverrides || {},
                    })
                    .eq('id', scheduleId)
                    .eq('user_id', userId)
                    .select(SCHEDULE_SELECT_COLUMNS)
                    .single();

                if (updateError) {
                    console.warn('[useMedicationSchedule] date override cloud sync failed:', updateError.message);
                    setError('云端同步失败，已保存在本地缓存');
                    setSyncState('mixed');
                    saveSchedules(updated);
                    return;
                }

                if (cloudRow) {
                    const mapped = mapRowToSchedule(cloudRow as MedicationScheduleRow);
                    const cloudUpdated = updated.map((schedule) =>
                        schedule.id === scheduleId ? mapped : schedule
                    );
                    saveSchedules(cloudUpdated);
                    vectorizeSchedule(mapped);
                    setSyncState('cloud');
                    setLastSyncedAt(new Date().toISOString());
                    return;
                }
            }
        }

        saveSchedules(updated);
    }, [schedules, saveSchedules, cloudEnabled, userId, vectorizeSchedule]);

    const getSchedulesForDate = useCallback((date: string): MedicationSchedule[] => {
        return schedules
            .filter(schedule => {
                if (!schedule.isActive) return false;

                const startDate = normalizeDateKey(schedule.startDate) || schedule.startDate.split('T')[0];
                const endDate = schedule.endDate
                    ? (normalizeDateKey(schedule.endDate) || schedule.endDate.split('T')[0])
                    : undefined;

                if (date < startDate) return false;
                if (endDate && date > endDate) return false;
                if (schedule.dateOverrides?.[date]?.isDeleted) return false;

                return true;
            })
            .map(schedule => buildScheduleForDate(schedule, date));
    }, [schedules, buildScheduleForDate]);

    // ---- Today filter ----

    const getTodaySchedules = useCallback((): MedicationSchedule[] => {
        const today = todayKey();
        return getSchedulesForDate(today);
    }, [getSchedulesForDate]);

    // ---- Init ----

    useEffect(() => {
        loadSchedules();
    }, [loadSchedules]);

    useEffect(() => {
        const handleInvalidate = () => {
            void loadSchedules();
        };

        window.addEventListener(MEDICATION_SCHEDULES_INVALIDATED_EVENT, handleInvalidate);
        return () => {
            window.removeEventListener(MEDICATION_SCHEDULES_INVALIDATED_EVENT, handleInvalidate);
        };
    }, [loadSchedules]);

    return {
        schedules,
        takenRecords,
        anchorDate,
        syncState,
        lastSyncedAt,
        isLoading,
        isSaving,
        error,
        loadSchedules,
        addSchedule,
        createSchedule: addSchedule,
        updateSchedule,
        deleteSchedule,
        markAsTaken,
        markAsMissed,
        isReminderTaken,
        setDateOverride,
        getSchedulesForDate,
        getTodaySchedules,
        setAnchorDate,
    };
}

export default useMedicationSchedule;
