import type { QueuedMessage } from './outbox';

export function selectNextPendingMessage(
    messages: QueuedMessage[],
    connected: boolean,
    relayed: Set<string>,
    rejected: Set<string>
): QueuedMessage | undefined {
    return messages.find(message => {
        const id = message.clientMessageId;

        if (rejected.has(id)) {
            return false;
        }

        if (!connected && relayed.has(id)) {
            return false;
        }

        return true;
    });
}
