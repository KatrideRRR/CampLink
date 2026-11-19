
import { createServer } from 'node:http';
import {
    verifyRelayTicket,
} from '../../shared/relay-ticket.js';
import { validatePacket } from './protocol.js';

const MAX_BODY_BYTES = 8192;

export function createRelayServer({
                                      store,
                                      secret,
                                      allowedOrigins = [],
                                  }) {
    if (
        typeof secret !== 'string' ||
        secret.length < 32
    ) {
        throw new Error('Relay secret is not configured');
    }

    const allowed = new Set(allowedOrigins);
    const attempts = new Map();

    return createServer(async (req, res) => {
        const send = (status, data) => {
            res.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify(data));
        };

        const origin = req.headers.origin;

        if (origin && !allowed.has(origin)) {
            return send(403, {
                error: 'Origin not allowed',
            });
        }

        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader(
                'Access-Control-Allow-Headers',
                'Authorization, Content-Type'
            );
            res.setHeader(
                'Access-Control-Allow-Methods',
                'POST, OPTIONS'
            );
        }

        if (
            req.url === '/v1/messages' &&
            req.method === 'OPTIONS'
        ) {
            res.writeHead(204);
            return res.end();
        }

        if (
            req.url === '/health' &&
            req.method === 'GET'
        ) {
            return send(200, {
                ok: true,
                service: 'camplink-relay',
            });
        }

        if (
            req.url !== '/v1/messages' ||
            req.method !== 'POST'
        ) {
            return send(404, {
                error: 'Not found',
            });
        }

        const authorization =
            req.headers.authorization ?? '';

        const token = authorization.startsWith('Bearer ')
            ? authorization.slice(7)
            : '';

        const credential = verifyRelayTicket(
            token,
            secret
        );

        if (!credential) {
            return send(401, {
                error: 'Invalid relay credential',
            });
        }

        // Basic per-account rate limiting.
        const now = Date.now();
        const previous = attempts.get(credential.userId);

        const current =
            !previous || now - previous.startedAt >= 60000
                ? { startedAt: now, count: 0 }
                : previous;

        current.count += 1;
        attempts.set(credential.userId, current);

        if (current.count > 60) {
            return send(429, {
                error: 'Rate limit exceeded',
            });
        }

        try {
            if (
                !req.headers['content-type']
                    ?.toLowerCase()
                    .startsWith('application/json')
            ) {
                return send(415, {
                    error: 'JSON required',
                });
            }

            const chunks = [];
            let bytes = 0;

            for await (const chunk of req) {
                bytes += chunk.length;

                if (bytes > MAX_BODY_BYTES) {
                    return send(413, {
                        error: 'Message too large',
                    });
                }

                chunks.push(chunk);
            }

            const incoming = JSON.parse(
                Buffer.concat(chunks).toString('utf8')
            );

            const packet = {
                senderId: credential.userId,
                recipientId: incoming.toUserId,
                clientMessageId: incoming.clientMessageId,
                clientCreatedAt: incoming.clientCreatedAt,
                text: incoming.text,
            };

            validatePacket(packet);

            const result = store.enqueue(packet);

            return send(202, {
                ok: true,
                status: 'queued',
                clientMessageId: packet.clientMessageId,
                duplicate: !result.created,
            });
        } catch (error) {
            if (error.message === 'Conflicting message ID') {
                return send(409, {
                    error: 'Message ID conflict',
                });
            }

            return send(400, {
                error: 'Invalid message',
            });
        }
    });
}
