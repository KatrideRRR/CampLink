import { Passkeys } from '@capawesome/capacitor-passkeys';
import {
    apiFetch,
    isBundledNative,
} from './native-auth';

type User = {
    id: number;
    username: string;
    displayName?: string;
};

type LoginResult = {
    user: User;
    token?: string;
    expiresInSeconds?: number;
};

async function postJSON<T>(
    path: string,
    data: unknown = {}
): Promise<T> {
    const response = await apiFetch(path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(
            response.status === 429
                ? 'Слишком много попыток. Попробуйте позже.'
                : response.status === 401
                    ? 'Ключ не удалось подтвердить'
                    : 'Не удалось выполнить операцию с ключом'
        );
    }

    return await response.json() as T;
}

export async function passkeysAvailable(): Promise<boolean> {
    try {
        const result = await Passkeys.isAvailable();
        return result.available;
    } catch {
        return false;
    }
}

export async function createCampLinkPasskey():
    Promise<void> {
    const start = await postJSON<{
        requestId: string;
        options: Parameters<typeof Passkeys.createPasskey>[0];
    }>('/api/passkeys/register/options');

    const credential = await Passkeys.createPasskey(
        start.options
    );

    await postJSON('/api/passkeys/register/verify', {
        requestId: start.requestId,
        credential,
    });
}

export async function loginWithCampLinkPasskey():
    Promise<LoginResult> {
    const start = await postJSON<{
        requestId: string;
        options: Parameters<typeof Passkeys.getPasskey>[0];
    }>('/api/passkeys/login/options');

    const credential = await Passkeys.getPasskey(
        start.options
    );

    return postJSON<LoginResult>(
        isBundledNative()
            ? '/api/passkeys/login/native-verify'
            : '/api/passkeys/login/verify',
        {
            requestId: start.requestId,
            credential,
        }
    );
}

export type RegisteredPasskey = {
    id: string;
    createdAt: string;
};

export async function listCampLinkPasskeys():
    Promise<RegisteredPasskey[]> {
    const response = await apiFetch('/api/passkeys', {
        cache: 'no-store',
    });

    if (!response.ok) {
        throw new Error('Не удалось получить ключи доступа');
    }

    const data = await response.json() as {
        keys: RegisteredPasskey[];
    };

    return data.keys;
}
