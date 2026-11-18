
import { simpleParser } from 'mailparser';
import {
    decodeMailPacket,
    MAIL_SUBJECT,
} from './protocol.js';

const MAX_EMAIL_BYTES = 64 * 1024;

export async function collectMailbox(
    client,
    store,
    signingKey
) {
    const lock = await client.getMailboxLock('INBOX');

    let stored = 0;

    try {
        const found = await client.search(
            {
                seen: false,
                subject: MAIL_SUBJECT,
            },
            { uid: true }
        );

        const uids = Array.isArray(found)
            ? found.slice(0, 50)
            : [];

        for (const uid of uids) {
            const message = await client.fetchOne(
                uid,
                { source: true },
                { uid: true }
            );

            if (!message?.source) continue;

            try {
                if (message.source.length > MAX_EMAIL_BYTES) {
                    throw new Error('Oversized email');
                }

                const parsed = await simpleParser(
                    message.source
                );

                if (parsed.subject !== MAIL_SUBJECT) {
                    continue;
                }

                const packet = decodeMailPacket(
                    parsed.text?.trim() ?? '',
                    signingKey
                );

                const result = store.enqueue(packet);

                if (result.created) stored += 1;
            } catch (error) {
                console.warn(
                    'Mail Bridge rejected an email:',
                    error.message
                );
            }

            // Dedicated CampLink inbox: processed mail is
            // marked as read, including invalid packets.
            await client.messageFlagsAdd(
                uid,
                ['\\Seen'],
                { uid: true }
            );
        }
    } finally {
        lock.release();
    }

    return stored;
}

export async function forwardPending(
    store,
    {
        backendUrl,
        gatewaySecret,
        fetchImpl = fetch,
    }
) {
    if (
        typeof gatewaySecret !== 'string' ||
        gatewaySecret.length < 32
    ) {
        throw new Error('Missing gateway secret');
    }

    const endpoint = new URL(
        '/api/internal/email/ingest',
        backendUrl
    );

    const local =
        endpoint.hostname === '127.0.0.1' ||
        endpoint.hostname === 'localhost';

    if (endpoint.protocol !== 'https:' && !local) {
        throw new Error('HTTPS is required');
    }

    let delivered = 0;

    for (const item of store.pending()) {
        try {
            const response = await fetchImpl(
                endpoint.toString(),
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-camplink-gateway-secret':
                        gatewaySecret,
                    },
                    body: JSON.stringify(item.packet),
                    signal: AbortSignal.timeout(7000),
                }
            );

            if (!response.ok) {
                throw new Error(
                    `Backend HTTP ${response.status}`
                );
            }

            const result = await response.json();

            if (
                result.ok !== true ||
                result.message?.clientMessageId !==
                item.packet.clientMessageId ||
                result.message?.senderId !==
                item.packet.senderId ||
                result.message?.recipientId !==
                item.packet.recipientId
            ) {
                throw new Error(
                    'Invalid backend acknowledgement'
                );
            }

            store.markDelivered(item.id);
            delivered += 1;
        } catch (error) {
            store.recordFailure(
                item.id,
                error.message ?? 'Unknown delivery error'
            );
        }
    }

    return delivered;
}
