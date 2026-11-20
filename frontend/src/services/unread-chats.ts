export type UnreadCounts = Record<number, number>;

type StorageLike = Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem'
>;

function validId(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value > 0
    );
}

function validCount(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0
    );
}

export function normalizeUnreadCounts(
    items: unknown
): UnreadCounts {
    const result: UnreadCounts = {};

    if (!Array.isArray(items)) return result;

    for (const item of items) {
        if (
            !item ||
            typeof item !== 'object' ||
            !validId(item.peerId) ||
            !validCount(item.unreadCount)
        ) {
            continue;
        }

        if (item.unreadCount > 0) {
            result[item.peerId] = item.unreadCount;
        }
    }

    return result;
}

export function updateUnreadCount(
    current: UnreadCounts,
    payload: unknown
): UnreadCounts {
    if (!payload || typeof payload !== 'object') {
        return current;
    }

    const item = payload as {
        peerId?: unknown;
        unreadCount?: unknown;
    };

    if (
        !validId(item.peerId) ||
        !validCount(item.unreadCount)
    ) {
        return current;
    }

    const next = { ...current };

    if (item.unreadCount === 0) {
        delete next[item.peerId];
    } else {
        next[item.peerId] = item.unreadCount;
    }

    return next;
}

function storageKey(userId: number) {
    return `camplink.unread.v1.${userId}`;
}

export function loadUnreadCounts(
    userId: number,
    storage: StorageLike = window.localStorage
): UnreadCounts {
    try {
        const raw = storage.getItem(storageKey(userId));
        if (!raw) return {};

        const saved: unknown = JSON.parse(raw);

        if (
            !saved ||
            typeof saved !== 'object' ||
            Array.isArray(saved)
        ) {
            return {};
        }

        return normalizeUnreadCounts(
            Object.entries(saved).map(
                ([peerId, unreadCount]) => ({
                    peerId: Number(peerId),
                    unreadCount,
                })
            )
        );
    } catch {
        return {};
    }
}

export function saveUnreadCounts(
    userId: number,
    counts: UnreadCounts,
    storage: StorageLike = window.localStorage
): void {
    try {
        storage.setItem(
            storageKey(userId),
            JSON.stringify(counts)
        );
    } catch {
        // Server remains authoritative.
    }
}

export function clearUnreadCounts(
    userId: number,
    storage: StorageLike = window.localStorage
): void {
    try {
        storage.removeItem(storageKey(userId));
    } catch {
        // Local storage may be unavailable.
    }
}
