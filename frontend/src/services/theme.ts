
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'camplink.theme';

type StorageReader = {
    getItem(key: string): string | null;
};

type StorageWriter = {
    setItem(key: string, value: string): void;
};

export function resolveTheme(
    preference: ThemePreference,
    systemDark: boolean
): 'light' | 'dark' {
    if (preference === 'system') {
        return systemDark ? 'dark' : 'light';
    }

    return preference;
}

export function nextThemePreference(
    current: ThemePreference
): ThemePreference {
    if (current === 'system') return 'light';
    if (current === 'light') return 'dark';
    return 'system';
}

export function loadThemePreference(
    storage?: StorageReader
): ThemePreference {
    try {
        const value = (
            storage ?? window.localStorage
        ).getItem(STORAGE_KEY);

        if (
            value === 'light' ||
            value === 'dark' ||
            value === 'system'
        ) {
            return value;
        }
    } catch {
        // Storage can be unavailable.
    }

    return 'system';
}

export function saveThemePreference(
    value: ThemePreference,
    storage?: StorageWriter
): void {
    try {
        (storage ?? window.localStorage).setItem(
            STORAGE_KEY,
            value
        );
    } catch {
        // The theme still works for this session.
    }
}
