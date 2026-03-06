/**
 * Local date helpers for medication schedule logic.
 * Always treat YYYY-MM-DD as local calendar date to avoid UTC drift.
 */

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (value: number): string => value.toString().padStart(2, '0');

export const formatLocalDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    return `${year}-${month}-${day}`;
};

export const parseDateKeyAsLocalDate = (dateKey: string): Date => {
    const trimmed = dateKey.trim();
    const matched = DATE_KEY_PATTERN.exec(trimmed);
    if (matched) {
        const year = Number(matched[1]);
        const month = Number(matched[2]);
        const day = Number(matched[3]);
        return new Date(year, month - 1, day);
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return new Date();
    }

    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

export const normalizeDateKey = (value?: string | null): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (DATE_KEY_PATTERN.test(trimmed)) {
        return trimmed;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return formatLocalDateKey(parsed);
};

