import { Capacitor } from '@capacitor/core';
import { SecureStorage } from
    '@aparajita/capacitor-secure-storage';

import {
    isBundledNativeOrigin,
    makeNativeSession,
    readNativeSession,
    type NativeSession,
} from './native-session-model';

const SESSION_KEY = 'camplink.native.session.v1';

export const CAMPLINK_API_ORIGIN =
    'https://chat.camplink.ru';

let currentSession: NativeSession | null = null;

export function isBundledNative(): boolean {
    return (
        Capacitor.isNativePlatform() &&
        isBundledNativeOrigin(
            Capacitor.getPlatform(),
            window.location.origin
        )
    );
}

export function getNativeToken(): string | null {
    if (!isBundledNative()) return null;

    if (
        !currentSession ||
        currentSession.expiresAt <= Date.now()
    ) {
        return null;
    }

    return currentSession.token;
}

export async function restoreNativeSession():
    Promise<boolean> {
    if (!isBundledNative()) return false;

    const raw = await SecureStorage.getItem(SESSION_KEY);
    const stored = readNativeSession(raw);

    currentSession = stored;

    if (raw && !stored) {
        await SecureStorage.removeItem(SESSION_KEY);
    }

    return stored !== null;
}

export async function saveNativeSession(
    token: string,
    expiresInSeconds: number
): Promise<void> {
    if (!isBundledNative()) {
        throw new Error('Native session unavailable');
    }

    const session = makeNativeSession(
        token,
        expiresInSeconds
    );

    // Сначала сохраняем в Keychain/Keystore.
    // Только затем разрешаем сетевым вызовам
    // пользоваться новой сессией.
    await SecureStorage.setItem(
        SESSION_KEY,
        JSON.stringify(session)
    );

    currentSession = session;
}

export async function clearNativeSession():
    Promise<void> {
    if (!isBundledNative()) return;

    await SecureStorage.removeItem(SESSION_KEY);
    currentSession = null;
}

export function apiFetch(
    path: string,
    options: RequestInit = {}
): Promise<Response> {
    if (!path.startsWith('/api/')) {
        throw new Error('Invalid API path');
    }

    if (!isBundledNative()) {
        return fetch(path, options);
    }

    const headers = new Headers(options.headers);
    const token = getNativeToken();

    if (token) {
        headers.set(
            'Authorization',
            `Bearer ${token}`
        );
    }

    return fetch(
        `${CAMPLINK_API_ORIGIN}${path}`,
        {
            ...options,
            headers,
            credentials: 'omit',
        }
    );
}
