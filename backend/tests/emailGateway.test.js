
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as connectClient } from 'socket.io-client';
import { createAppServer } from '../src/app.js';

const SECRET = 'test-secret-for-camplink-email-gateway-123';

test(
    'email gateway authorization, delivery and deduplication',
    { timeout: 10000 },
    async (t) => {
        const { httpServer, io, store } = createAppServer({
            databasePath: ':memory:',
            emailGatewaySecret: SECRET,
        });

        const akim = store.createUser(
            'akim',
            'strong-test-password-123'
        );

        const worker = store.createUser(
            'worker',
            'strong-test-password-456'
        );

        await new Promise((resolve, reject) => {
            httpServer.once('error', reject);
            httpServer.listen(0, '127.0.0.1', resolve);
        });

        const url =
            `http://127.0.0.1:${httpServer.address().port}`;

        const clients = [];

        t.after(async () => {
            for (const client of clients) {
                client.disconnect();
            }

            await new Promise((resolve) => io.close(resolve));
            store.close();
        });

        const envelope = {
            senderId: akim.id,
            recipientId: worker.id,
            clientMessageId: randomUUID(),
            clientCreatedAt:
                '2026-11-18T19:30:00.000+03:00',
            text: 'CampLink через почтовый шлюз',
        };

        async function ingest(body, secret = SECRET) {
            return fetch(`${url}/api/internal/email/ingest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-camplink-gateway-secret': secret,
                },
                body: JSON.stringify(body),
            });
        }

        // Unknown gateway cannot submit messages.
        const unauthorized = await ingest(
            envelope,
            'wrong-secret'
        );

        assert.equal(unauthorized.status, 401);

        // Malformed packets are rejected.
        const malformed = await ingest({
            ...envelope,
            recipientId: 'invalid',
        });

        assert.equal(malformed.status, 400);

        // Log in the receiving user.
        const login = await fetch(
            `${url}/api/auth/login`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: 'worker',
                    password: 'strong-test-password-456',
                }),
            }
        );

        assert.equal(login.status, 200);

        const cookie = login.headers
            .get('set-cookie')
            ?.split(';')[0];

        assert.ok(cookie);

        const client = connectClient(url, {
            autoConnect: false,
            transports: ['websocket'],
            reconnection: false,
            extraHeaders: {
                Cookie: cookie,
            },
        });

        clients.push(client);

        await new Promise((resolve, reject) => {
            client.once('connect', resolve);
            client.once('connect_error', reject);
            client.connect();
        });

        const notification = new Promise(
            (resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('No delivery event'));
                }, 3000);

                client.once('chat:new', (message) => {
                    clearTimeout(timeout);
                    resolve(message);
                });
            }
        );

        // Simulate a trusted mail bridge forwarding a packet.
        const first = await ingest(envelope);

        assert.equal(first.status, 201);

        const firstResult = await first.json();

        assert.equal(firstResult.ok, true);
        assert.equal(firstResult.duplicate, false);

        const received = await notification;

        assert.equal(received.text, envelope.text);
        assert.equal(received.senderId, akim.id);
        assert.equal(received.recipientId, worker.id);
        assert.equal(
            received.createdAt,
            '2026-11-18T16:30:00.000Z'
        );

        // Repeated mail delivery must not create duplicates.
        const retry = await ingest(envelope);

        assert.equal(retry.status, 200);

        const retryResult = await retry.json();

        assert.equal(retryResult.duplicate, true);
        assert.equal(
            retryResult.message.id,
            firstResult.message.id
        );

        // An ID cannot be reused for different content.
        const conflict = await ingest({
            ...envelope,
            text: 'Изменённое сообщение',
        });

        assert.equal(conflict.status, 409);

        // The message appears in the ordinary conversation.
        const history = await fetch(
            `${url}/api/messages/${akim.id}`,
            {
                headers: { Cookie: cookie },
            }
        );

        assert.equal(history.status, 200);

        const data = await history.json();

        assert.equal(data.messages.length, 1);
        assert.equal(
            data.messages[0].text,
            envelope.text
        );
    }
);

test('gateway is disabled without a secret', async (t) => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
        emailGatewaySecret: '',
    });

    await new Promise((resolve) => {
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    t.after(async () => {
        await new Promise((resolve) => io.close(resolve));
        store.close();
    });

    const url =
        `http://127.0.0.1:${httpServer.address().port}`;

    const response = await fetch(
        `${url}/api/internal/email/ingest`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: '{}',
        }
    );

    assert.equal(response.status, 503);
});
