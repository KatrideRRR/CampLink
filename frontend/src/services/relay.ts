
import type { QueuedMessage } from './outbox';
import type {
    MessageTransport,
    TransportResponse,
} from './transports';

export type RelayCredential = {
    token: string;
    expiresAt: number;
};

type RelayStorage = Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem'
>;

function storageKey(userId: number) {
    return `camplink.relay.credential.v1.${userId}`;
}

export function saveRelayCredential(
    userId: number,
    credential: RelayCredential,
    storage: RelayStorage = window.localStorage
) {
    if (
        !credential ||
        typeof credential.token !== 'string' ||
        !Number.isFinite(credential.expiresAt)
    ) {
        return;
    }

    storage.setItem(
        storageKey(userId),
        JSON.stringify(credential)
    );
}

export function readRelayCredential(
    userId: number,
    storage: RelayStorage = window.localStorage,
    now = Date.now()
): RelayCredential | null {
    try {
        const raw = storage.getItem(storageKey(userId));

        if (!raw) return null;

        const credential = JSON.parse(
            raw
        ) as RelayCredential;

        if (
            !credential ||
            typeof credential.token !== 'string' ||
            !Number.isFinite(credential.expiresAt) ||
            credential.expiresAt <= now + 1000
        ) {
            return null;
        }

        return credential;
    } catch {
        return null;
    }
}

export function clearRelayCredential(
    userId: number,
    storage: RelayStorage = window.localStorage
) {
    storage.removeItem(storageKey(userId));
}

function validRelayUrl(address: string): string | null {
    try {
        const url = new URL(address);

        const local =
            url.hostname === '127.0.0.1' ||
            url.hostname === 'localhost';

        if (
            url.protocol !== 'https:' &&
            !(local && url.protocol === 'http:')
        ) {
            return null;
        }

        if (url.username || url.password) {
            return null;
        }

        return url.origin;
    } catch {
        return null;
    }
}

export function createRelayTransport(
    userId: number,
    address: string
): MessageTransport {
    const baseUrl = validRelayUrl(address);

    return {
        id: 'secondary-relay',
        kind: 'relay',
        priority: 20,

        async isAvailable() {
            return (
                baseUrl !== null &&
                readRelayCredential(userId) !== null
            );
        },

        async send(
            message: QueuedMessage
        ): Promise<TransportResponse> {
            const credential = readRelayCredential(userId);

            if (!baseUrl || !credential) {
                throw new Error('Relay is unavailable');
            }

            const response = await fetch(
                `${baseUrl}/v1/messages`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization:
                            `Bearer ${credential.token}`,
                    },
                    body: JSON.stringify({
                        toUserId: message.toUserId,
                        clientMessageId: message.clientMessageId,
                        clientCreatedAt: message.createdAt,
                        text: message.text,
                    }),
                    signal: AbortSignal.timeout(5000),
                }
            );

            if (!response.ok) {
                if (
                    [400, 401, 403, 409, 429].includes(
                        response.status
                    )
                ) {
                    return {
                        ok: false,
                        error:
                            `Relay rejected message: ${response.status}`,
                    };
                }

                throw new Error('Relay network failure');
            }

            const result = await response.json() as {
                ok?: boolean;
                status?: string;
                clientMessageId?: string;
            };

            if (
                result.ok !== true ||
                result.status !== 'queued' ||
                result.clientMessageId !==
                message.clientMessageId
            ) {
                throw new Error('Invalid relay confirmation');
            }

            return {
                ok: true,
                queued: true,
            };
        },
    };
}
