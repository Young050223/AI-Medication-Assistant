export type ThemeMode = 'light' | 'dark' | 'auto';
export type FontSizePreset = 'small' | 'medium' | 'large';

export const THEME_STORAGE_KEY = 'theme';
export const FONT_SIZE_STORAGE_KEY = 'font_size_preset';
export const DEFAULT_THEME_MODE: ThemeMode = 'auto';
export const DEFAULT_FONT_SIZE_PRESET: FontSizePreset = 'medium';

export function getStoredThemeMode(): ThemeMode {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') {
        return stored;
    }
    return DEFAULT_THEME_MODE;
}

export function getStoredFontSizePreset(): FontSizePreset {
    const stored = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (stored === 'small' || stored === 'medium' || stored === 'large') {
        return stored;
    }
    return DEFAULT_FONT_SIZE_PRESET;
}

export function applyTheme(mode: ThemeMode) {
    if (mode === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        return;
    }

    document.documentElement.setAttribute('data-theme', mode);
}

export function persistThemeMode(mode: ThemeMode) {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    applyTheme(mode);
}

export function applyFontSizePreset(preset: FontSizePreset) {
    document.documentElement.setAttribute('data-font-size', preset);
}

export function persistFontSizePreset(preset: FontSizePreset) {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, preset);
    applyFontSizePreset(preset);
}
