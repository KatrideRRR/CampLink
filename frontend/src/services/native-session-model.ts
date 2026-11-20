export type NativeSession = {
    token: string;
    expiresAt: number;
};

export function isBundledNativeOrigin(
    platform: string,
    origin: string
): boolean {
    return (
        (platform === 'ios' &&
            origin === 'capacitor://localhost') ||
        (platform === 'android' &&
            origin === 'https://localhost')
    );
}

export function makeNativeSession(
    token: string,
    expiresInSeconds: number,
    now = Date.now()
): NativeSession {
    if (
        typeof token !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(token) ||
        !Number.isSafeInteger(expiresInSeconds) ||
        expiresInSeconds < 60 ||
        expiresInSeconds > 30 * 24 * 60 * 60
    ) {
        throw new Error('Invalid native session');
    }

    return {
        token: token.toLowerCase(),
        expiresAt: now + expiresInSeconds * 1000,
    };
}

export function readNativeSession(
    raw: string | null,
    now = Date.now()
): NativeSession | null {
    if (!raw) return null;

    try {
        const data: unknown = JSON.parse(raw);

        if (!data || typeof data !== 'object') {
            return null;
        }

        const session = data as Partial<NativeSession>;

        if (
            typeof session.token !== 'string' ||
            !/^[a-f0-9]{64}$/.test(session.token) ||
            typeof session.expiresAt !== 'number' ||
            !Number.isFinite(session.expiresAt) ||
            session.expiresAt <= now
        ) {
            return null;
        }

        return {
            token: session.token,
            expiresAt: session.expiresAt,
        };
    } catch {
        return null;
    }
}
