
import type { QueuedMessage } from './outbox';

export type ConfirmedMessage = {
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

export type TimelineItem =
    | {
    status: 'confirmed';
    message: ConfirmedMessage;
}
    | {
    status: 'pending';
    message: QueuedMessage;
};

export function buildChatTimeline(
    confirmed: ConfirmedMessage[],
    pending: QueuedMessage[],
    ownId: number,
    peerId: number
): TimelineItem[] {
    const conversation = confirmed.filter(
        (message) =>
            (message.senderId === ownId &&
                message.recipientId === peerId) ||
            (message.senderId === peerId &&
                message.recipientId === ownId)
    );

    const confirmedIds = new Set(
        conversation.map((message) => message.clientMessageId)
    );

    const queued = pending.filter(
        (message) =>
            message.toUserId === peerId &&
            !confirmedIds.has(message.clientMessageId)
    );

    const timeline: TimelineItem[] = [
        ...conversation.map(
            (message): TimelineItem => ({
                status: 'confirmed',
                message,
            })
        ),
        ...queued.map(
            (message): TimelineItem => ({
                status: 'pending',
                message,
            })
        ),
    ];

    return timeline.sort((a, b) => {
        const first = Date.parse(a.message.createdAt);
        const second = Date.parse(b.message.createdAt);

        if (
            Number.isFinite(first) &&
            Number.isFinite(second) &&
            first !== second
        ) {
            return first - second;
        }

        // The server ID breaks timestamp ties.
        if (
            a.status === 'confirmed' &&
            b.status === 'confirmed'
        ) {
            return a.message.id - b.message.id;
        }

        return 0;
    });
}
