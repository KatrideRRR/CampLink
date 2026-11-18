
import type { QueuedMessage } from './outbox';

export type TransportKind =
    | 'internet'
    | 'email'
    | 'sms'
    | 'mesh';

export type DeliveredMessage = {
    id: number;
    senderId: number;
    recipientId: number;
    clientMessageId: string;
    text: string;
    createdAt: string;
    clientCreatedAt?: string | null;
    serverReceivedAt?: string;
};

export type TransportResponse = {
    ok: boolean;
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
