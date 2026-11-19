
import type { QueuedMessage } from './outbox';
import type {
    DeliveredMessage,
    MessageTransport,
    TransportKind,
} from './transports';

export type DeliveryResult =
    | {
    status: 'sent';
    channel: TransportKind;
    transportId: string;
    message: DeliveredMessage;
}
    | {
    status: 'relayed';
    channel: TransportKind;
    transportId: string;
}
    | {
    status: 'queued';
    error: string;
}
    | {
    status: 'rejected';
    error: string;
};

export async function deliverMessage(
    message: QueuedMessage,
    transports: MessageTransport[]
): Promise<DeliveryResult> {
    const ordered = [...transports].sort(
        (a, b) => a.priority - b.priority
    );

    for (const transport of ordered) {
        let available = false;

        try {
            available = await transport.isAvailable();
        } catch {
            continue;
        }

        if (!available) continue;

        try {
            const response = await transport.send(message);

            if (!response.ok) {
                return {
                    status: 'rejected',
                    error:
                        response.error ??
                        'Message rejected by server',
                };
            }

            if (response.queued === true) {
                return {
                    status: 'relayed',
                    channel: transport.kind,
                    transportId: transport.id,
                };
            }

            if (
                !response.message ||
                response.message.clientMessageId !==
                message.clientMessageId
            ) {
                throw new Error(
                    'Invalid delivery acknowledgement'
                );
            }

            return {
                status: 'sent',
                channel: transport.kind,
                transportId: transport.id,
                message: response.message,
            };
        } catch {
            // This channel may be temporarily unreachable.
            // Try the next available transport.
        }
    }

    return {
        status: 'queued',
        error: 'No transport confirmed delivery',
    };
}
