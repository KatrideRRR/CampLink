
export type QueuedMessage = {
    clientMessageId: string;
    toUserId: number;
    text: string;
    createdAt: string;
    replyToMessageId?: number;
    replyToText?: string;
    replyToSenderId?: number;
};

type StorageLike = Pick<
    Storage,
    'getItem' | 'setItem'
>;

const MAX_PENDING = 100;

function storageKey(userId: number): string {
    return `camplink.outbox.v1.${userId}`;
}

function isQueuedMessage(
    value: unknown
): value is QueuedMessage {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const item = value as Partial<QueuedMessage>;

    return (
        typeof item.clientMessageId === 'string' &&
        /^[a-f0-9-]{36}$/i.test(item.clientMessageId) &&
        Number.isSafeInteger(item.toUserId) &&
        Number(item.toUserId) > 0 &&
        typeof item.text === 'string' &&
        item.text.trim().length > 0 &&
        item.text.length <= 2000 &&
        typeof item.createdAt === 'string' &&
        Number.isFinite(Date.parse(item.createdAt)) &&
        (
            item.replyToMessageId === undefined ||
            (
                Number.isSafeInteger(item.replyToMessageId) &&
                Number(item.replyToMessageId) > 0 &&
                typeof item.replyToText === 'string' &&
                item.replyToText.length <= 2000 &&
                Number.isSafeInteger(item.replyToSenderId) &&
                Number(item.replyToSenderId) > 0
            )
        )
    );
}

export function readOutbox(
    userId: number,
    storage?: StorageLike
): QueuedMessage[] {
    try {
        const source = storage ?? window.localStorage;
        const raw = source.getItem(storageKey(userId));

        if (!raw) return [];

        const parsed: unknown = JSON.parse(raw);

        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter(isQueuedMessage)
            .slice(0, MAX_PENDING);
    } catch {
        return [];
    }
}

export function enqueueOutboxMessage(
    userId: number,
    message: QueuedMessage,
    storage?: StorageLike
): QueuedMessage[] {
    if (
        !Number.isSafeInteger(userId) ||
        userId <= 0 ||
        !isQueuedMessage(message)
    ) {
        throw new Error('Invalid queued message');
    }

    const source = storage ?? window.localStorage;
    const pending = readOutbox(userId, source);

    if (
        pending.some(
            (item) =>
                item.clientMessageId === message.clientMessageId
        )
    ) {
        return pending;
    }

    if (pending.length >= MAX_PENDING) {
        throw new Error('Outbox is full');
    }

    const updated = [...pending, message];

    source.setItem(
        storageKey(userId),
        JSON.stringify(updated)
    );

    return updated;
}

export function removeOutboxMessage(
    userId: number,
    clientMessageId: string,
    storage?: StorageLike
): QueuedMessage[] {
    const source = storage ?? window.localStorage;

    const updated = readOutbox(userId, source).filter(
        (message) =>
            message.clientMessageId !== clientMessageId
    );

    source.setItem(
        storageKey(userId),
        JSON.stringify(updated)
    );

    return updated;
}
