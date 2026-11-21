export type PushChatTarget = {
    peerId: number;
    messageId: number | null;
};

function positiveId(value: unknown): number | null {
    if (
        typeof value !== 'string' ||
        !/^[1-9][0-9]*$/.test(value)
    ) {
        return null;
    }

    const id = Number(value);

    return Number.isSafeInteger(id)
        ? id
        : null;
}

export function parsePushChatTarget(
    value: unknown
): PushChatTarget | null {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
    ) {
        return null;
    }

    const data = value as Record<string, unknown>;
    const peerId = positiveId(data.peerId);

    if (peerId === null) return null;

    return {
        peerId,
        messageId: positiveId(data.messageId),
    };
}
