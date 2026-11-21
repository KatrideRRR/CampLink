import type { MessageMedia } from './media-types';

import type { QueuedMessage } from './outbox';

export type TransportKind =
    | 'internet'
    | 'relay'
    | 'email'
    | 'sms'
    | 'mesh';

export type DeliveredMessage = {
    media?: MessageMedia;

    id: number;
    senderId: number;
    recipientId: number;
    clientMessageId: string;
    text: string;
    createdAt: string;
    clientCreatedAt?: string | null;
    serverReceivedAt?: string;
    replyToMessageId?: number | null;
    replyToText?: string | null;
    replyToSenderId?: number | null;
    reactions?: {
        userId: number;
        emoji: string;
    }[];
};

export type TransportResponse = {
    ok: boolean;
    queued?: boolean;
    message?: DeliveredMessage;
    error?: string;
};

export interface MessageTransport {
    readonly id: string;
    readonly kind: TransportKind;
    readonly priority: number;

    isAvailable(): Promise<boolean>;

    send(
        message: QueuedMessage
    ): Promise<TransportResponse>;
}
