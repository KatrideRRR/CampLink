import type { MessageMedia } from './media-types';

export type OfflineUser = {
    id: number;
    username: string;
    displayName?: string;
};

export type OfflineMessage = {
    media?: MessageMedia;

    id: number;
    senderId: number;
    recipientId: number;
    clientMessageId: string;
    text: string;
    createdAt: string;
    readAt?: string | null;
    replyToMessageId?: number | null;
    replyToText?: string | null;
    replyToSenderId?: number | null;
    reactions?: {
        userId: number;
        emoji: string;
    }[];
};

type StorageLike = Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem'
>;

type OfflineData = {
    contacts: OfflineUser[];
    threads: Record<string, unknown>;
};

const PROFILE_KEY = 'camplink.offline.profile.v1';
const DATA_PREFIX = 'camplink.offline.data.v1.';
const MAX_CONTACTS = 50;
const MAX_MESSAGES = 50;
const OFFLINE_DAYS = 7;

function getStorage(storage?: StorageLike) {
    return storage ?? window.localStorage;
}

function isUser(value: unknown): value is OfflineUser {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const user = value as Partial<OfflineUser>;

    return (
        Number.isSafeInteger(user.id) &&
        Number(user.id) > 0 &&
        typeof user.username === 'string' &&
        user.username.length > 0 &&
        user.username.length <= 24
    );
}

function isMessage(
    value: unknown
): value is OfflineMessage {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const message = value as Partial<OfflineMessage>;

    return (
        Number.isSafeInteger(message.id) &&
        Number(message.id) > 0 &&
        Number.isSafeInteger(message.senderId) &&
        Number.isSafeInteger(message.recipientId) &&
        typeof message.clientMessageId === 'string' &&
        typeof message.text === 'string' &&
        typeof message.createdAt === 'string'
    );
}

function emptyData(): OfflineData {
    return { contacts: [], threads: {} };
}

function readData(
    userId: number,
    storage?: StorageLike
): OfflineData {
    try {
        const raw = getStorage(storage).getItem(
            DATA_PREFIX + userId
        );

        if (!raw) return emptyData();

        const parsed: unknown = JSON.parse(raw);

        if (!parsed || typeof parsed !== 'object') {
            return emptyData();
        }

        const data = parsed as Partial<OfflineData>;

        return {
            contacts: Array.isArray(data.contacts)
                ? data.contacts
                    .filter(isUser)
                    .slice(0, MAX_CONTACTS)
                : [],
            threads:
                data.threads &&
                typeof data.threads === 'object' &&
                !Array.isArray(data.threads)
                    ? data.threads
                    : {},
        };
    } catch {
        return emptyData();
    }
}

function writeData(
    userId: number,
    data: OfflineData,
    storage?: StorageLike
): void {
    try {
        getStorage(storage).setItem(
            DATA_PREFIX + userId,
            JSON.stringify(data)
        );
    } catch {
        // Online messaging must continue even if cache is full.
    }
}

export function saveOfflineUser(
    user: OfflineUser,
    storage?: StorageLike,
    now = Date.now()
): void {
    if (!isUser(user)) return;

    try {
        getStorage(storage).setItem(
            PROFILE_KEY,
            JSON.stringify({ user, verifiedAt: now })
        );
    } catch {
        // Offline access will remain unavailable.
    }
}

export function readOfflineUser(
    storage?: StorageLike,
    now = Date.now()
): OfflineUser | null {
    try {
        const raw = getStorage(storage).getItem(PROFILE_KEY);

        if (!raw) return null;

        const saved: unknown = JSON.parse(raw);

        if (!saved || typeof saved !== 'object') {
            return null;
        }

        const profile = saved as {
            user?: unknown;
            verifiedAt?: unknown;
        };

        if (
            !isUser(profile.user) ||
            typeof profile.verifiedAt !== 'number'
        ) {
            return null;
        }

        const age = now - profile.verifiedAt;
        const maxAge = OFFLINE_DAYS * 24 * 60 * 60 * 1000;

        if (age < 0 || age >= maxAge) {
            return null;
        }

        return profile.user;
    } catch {
        return null;
    }
}

export function decideSession(
    status: number | 'unreachable',
    cached: OfflineUser | null,
    serverUser: OfflineUser | null = null
) {
    if (status === 401) {
        return {
            user: null,
            offline: false,
            invalidate: true,
        };
    }

    if (status === 200 && isUser(serverUser)) {
        return {
            user: serverUser,
            offline: false,
            invalidate: false,
        };
    }

    return {
        user: cached,
        offline: cached !== null,
        invalidate: false,
    };
}

export function readOfflineContacts(
    userId: number,
    storage?: StorageLike
): OfflineUser[] {
    return readData(userId, storage).contacts;
}

export function saveOfflineContacts(
    userId: number,
    contacts: OfflineUser[],
    storage?: StorageLike
): void {
    const data = readData(userId, storage);

    data.contacts = contacts
        .filter(isUser)
        .filter((user) => user.id !== userId)
        .slice(0, MAX_CONTACTS);

    writeData(userId, data, storage);
}

function compareMessageTime(
    a: OfflineMessage,
    b: OfflineMessage
): number {
    const first = Date.parse(a.createdAt);
    const second = Date.parse(b.createdAt);

    if (
        Number.isFinite(first) &&
        Number.isFinite(second) &&
        first !== second
    ) {
        return first - second;
    }

    return a.id - b.id;
}

export function readOfflineMessages(
    userId: number,
    peerId: number,
    storage?: StorageLike
): OfflineMessage[] {
    const data = readData(userId, storage);
    const thread = data.threads[String(peerId)];

    if (!Array.isArray(thread)) return [];

    return thread
        .filter(isMessage)
        .filter(
            (message) =>
                (message.senderId === userId &&
                    message.recipientId === peerId) ||
                (message.senderId === peerId &&
                    message.recipientId === userId)
        )
        .sort(compareMessageTime)
        .slice(-MAX_MESSAGES);
}

export function saveOfflineMessages(
    userId: number,
    peerId: number,
    incoming: OfflineMessage[],
    storage?: StorageLike
): OfflineMessage[] {
    const data = readData(userId, storage);
    const combined = new Map<number, OfflineMessage>();

    for (const message of [
        ...readOfflineMessages(userId, peerId, storage),
        ...incoming,
    ]) {
        if (
            !isMessage(message) ||
            !(
                (message.senderId === userId &&
                    message.recipientId === peerId) ||
                (message.senderId === peerId &&
                    message.recipientId === userId)
            )
        ) {
            continue;
        }

        combined.set(message.id, message);
    }

    const updated = [...combined.values()]
        .sort(compareMessageTime)
        .slice(-MAX_MESSAGES);

    data.threads[String(peerId)] = updated;

    writeData(userId, data, storage);

    return updated;
}

export function clearOfflineCache(
    userId: number,
    storage?: StorageLike
): void {
    const source = getStorage(storage);
    const profile = readOfflineUser(source);

    try {
        source.removeItem(DATA_PREFIX + userId);

        if (profile?.id === userId) {
            source.removeItem(PROFILE_KEY);
        }
    } catch {
        // Storage may be unavailable.
    }
}
