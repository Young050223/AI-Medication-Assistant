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

// ===================== Hook =====================

/**
 * 服药计划管理 Hook
 * 数据按用户 ID 隔离存储
 * taken 状态按日期隔离，存储在 medication_taken_<userId> 中
 */
export function useMedicationSchedule(): UseMedicationScheduleReturn {
    const { user } = useAuth();
    const userId = user?.id;
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

    const [schedules, setSchedules] = useState<MedicationSchedule[]>([]);
    const [takenRecords, setTakenRecords] = useState<TakenRecords>({});
    const [anchorDate, setAnchorDateState] = useState<string | null>(null);
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

    // ---- Load ----

    const loadSchedules = useCallback(async () => {
        if (!storageKey || !takenKey || !anchorKey) {
            setSchedules([]);
            setTakenRecords({});
            setAnchorDateState(null);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Load schedules
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                const migrated = Array.isArray(parsed)
                    ? parsed.map((schedule: MedicationSchedule) => ({
                        ...schedule,
                        frequency: normalizeFrequency(schedule.frequency),
                    }))
                    : [];
                setSchedules(migrated);

                // Migration: move old reminder.taken into takenRecords
                const storedTaken = localStorage.getItem(takenKey);
                let taken: TakenRecords = storedTaken ? JSON.parse(storedTaken) : {};
                let migrationNeeded = false;

                for (const schedule of migrated) {
                    for (const reminder of schedule.reminders) {
                        if (reminder.taken) {
                            // Determine which date this was taken on
                            const takenDate = reminder.takenAt
                                ? (normalizeDateKey(reminder.takenAt) || todayKey())
                                : todayKey(); // fallback if no takenAt
                            if (!taken[takenDate]) taken[takenDate] = {};
                            if (!taken[takenDate][reminder.id]) {
                                taken[takenDate][reminder.id] = {
                                    taken: true,
                                    takenAt: reminder.takenAt || new Date().toISOString(),
                                };
                                migrationNeeded = true;
                            }
                            // Clear old taken flag on reminder
                            reminder.taken = false;
                            reminder.takenAt = undefined;
                        }
                    }
                }

                if (migrationNeeded) {
                    localStorage.setItem(storageKey, JSON.stringify(migrated));
                    localStorage.setItem(takenKey, JSON.stringify(taken));
                }

                setTakenRecords(taken);
                const storedAnchor = normalizeDateKey(localStorage.getItem(anchorKey));
                const derivedAnchor = deriveAnchorDate(migrated) || todayKey();
                const resolvedAnchor = storedAnchor || derivedAnchor;
                saveAnchorDate(resolvedAnchor);
            } else {
                setSchedules([]);
                // Still load taken records
                const storedTaken = localStorage.getItem(takenKey);
                setTakenRecords(storedTaken ? JSON.parse(storedTaken) : {});
                const storedAnchor = normalizeDateKey(localStorage.getItem(anchorKey));
                saveAnchorDate(storedAnchor || todayKey());
            }
        } catch (err) {
            console.error('[useMedicationSchedule] Load error:', err);
            setError('加载服药计划失败');
        } finally {
            setIsLoading(false);
        }
    }, [storageKey, takenKey, anchorKey, saveAnchorDate]);

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

    // ---- CRUD ----

    const addSchedule = useCallback(async (
        schedule: Omit<MedicationSchedule, 'id' | 'createdAt' | 'updatedAt'>
    ) => {
        const normalizedStartDate = normalizeDateKey(schedule.startDate) || todayKey();
        const newSchedule: MedicationSchedule = {
            ...schedule,
            startDate: normalizedStartDate,
            frequency: normalizeFrequency(schedule.frequency),
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        saveSchedules([...schedules, newSchedule]);
        if (!anchorDate) {
            saveAnchorDate(normalizedStartDate);
        }
    }, [schedules, saveSchedules, anchorDate, saveAnchorDate]);

    const updateSchedule = useCallback(async (id: string, updates: Partial<MedicationSchedule>) => {
        console.log('[updateSchedule] id=', id, 'updates=', JSON.stringify(updates).substring(0, 500));
        const normalizedUpdates: Partial<MedicationSchedule> = {
            ...updates,
            ...(updates.frequency ? { frequency: normalizeFrequency(updates.frequency) } : {}),
            ...(updates.startDate ? { startDate: normalizeDateKey(updates.startDate) || updates.startDate } : {}),
            ...(updates.endDate ? { endDate: normalizeDateKey(updates.endDate) || updates.endDate } : {}),
        };
        const updated = schedules.map(s =>
            s.id === id
                ? { ...s, ...normalizedUpdates, updatedAt: new Date().toISOString() }
                : s
        );
        const target = updated.find(s => s.id === id);
        console.log('[updateSchedule] AFTER merge schedule=', JSON.stringify(target).substring(0, 500));
        console.log('[updateSchedule] dateOverrides keys=', target?.dateOverrides ? Object.keys(target.dateOverrides) : 'none');
        saveSchedules(updated);
        if (normalizedUpdates.startDate) {
            saveAnchorDate(normalizedUpdates.startDate);
        }
    }, [schedules, saveSchedules, saveAnchorDate]);

    const deleteSchedule = useCallback(async (id: string) => {
        const filtered = schedules.filter(s => s.id !== id);
        saveSchedules(filtered);
    }, [schedules, saveSchedules]);

    // ---- Taken tracking (per-date) ----

    const markAsTaken = useCallback(async (scheduleId: string, reminderId: string, date?: string) => {
        const dateKey = date || todayKey();
        const schedule = schedules.find(item => item.id === scheduleId);
        const latestTakenTs = getLatestTakenTimestamp(takenRecords, reminderId);
        const minimumInterval = schedule ? getMinimumDoseIntervalMinutes(schedule) : 24 * 60;
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
        const newRecords = { ...takenRecords };
        const dateRecords = { ...(newRecords[dateKey] || {}) };
        dateRecords[reminderId] = {
            taken: true,
            takenAt: new Date().toISOString(),
            missed: false,
        };
        newRecords[dateKey] = dateRecords;
        saveTakenRecords(newRecords);
    }, [takenRecords, saveTakenRecords, schedules]);

    const markAsMissed = useCallback(async (_scheduleId: string, reminderId: string, date?: string) => {
        const dateKey = date || todayKey();
        const newRecords = { ...takenRecords };
        const dateRecords = { ...(newRecords[dateKey] || {}) };
        dateRecords[reminderId] = { taken: false, missed: true };
        newRecords[dateKey] = dateRecords;
        saveTakenRecords(newRecords);
    }, [takenRecords, saveTakenRecords]);

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
        saveSchedules(updated);
    }, [schedules, saveSchedules]);

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

    return {
        schedules,
        takenRecords,
        anchorDate,
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
