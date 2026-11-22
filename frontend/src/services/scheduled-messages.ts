import { apiFetch } from './native-auth';

export type ScheduledMessage = {
    id: number;
    senderId: number;
    recipientId: number;
    clientMessageId: string;
    text: string;
    scheduledAt: string;
    createdAt: string;
    status: 'pending';
};

export async function listScheduledMessages(
    peerId: number
): Promise<ScheduledMessage[]> {
    const response = await apiFetch(
        `/api/scheduled-messages?peerId=${peerId}`,
        { cache: 'no-store' }
    );

    if (!response.ok) {
        throw new Error('Не удалось загрузить отложенные сообщения');
    }

    const data = await response.json() as {
        items: ScheduledMessage[];
    };

    return data.items;
}

export async function createScheduledMessage(input: {
    recipientId: number;
    clientMessageId: string;
    text: string;
    scheduledAt: string;
}): Promise<number> {
    const response = await apiFetch('/api/scheduled-messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
    });

    if (!response.ok) {
        throw new Error('Не удалось запланировать отправку');
    }

    const result = await response.json() as {
        id: number;
        ok: boolean;
    };

    return result.id;
}

export async function cancelScheduledMessage(
    id: number
): Promise<void> {
    const response = await apiFetch(
        `/api/scheduled-messages/${id}`,
        { method: 'DELETE' }
    );

    if (!response.ok) {
        throw new Error('Не удалось отменить отправку');
    }
}
