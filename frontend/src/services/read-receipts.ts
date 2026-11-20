export type ReadReceipt = {
    readerId: number;
    throughId: number;
    readAt: string;
};

type MessageWithReceipt = {
    id: number;
    senderId: number;
    recipientId: number;
    readAt?: string | null;
};

export function applyReadReceipt<T extends MessageWithReceipt>(
    messages: T[],
    ownId: number,
    receipt: ReadReceipt
): T[] {
    if (
        !Number.isSafeInteger(receipt.readerId) ||
        receipt.readerId <= 0 ||
        !Number.isSafeInteger(receipt.throughId) ||
        receipt.throughId <= 0 ||
        typeof receipt.readAt !== 'string' ||
        !Number.isFinite(Date.parse(receipt.readAt))
    ) {
        return messages;
    }

    let changed = false;

    const updated = messages.map(message => {
        if (
            message.senderId !== ownId ||
            message.recipientId !== receipt.readerId ||
            message.id > receipt.throughId ||
            message.readAt
        ) {
            return message;
        }

        changed = true;

        return {
            ...message,
            readAt: receipt.readAt,
        };
    });

    return changed ? updated : messages;
}
