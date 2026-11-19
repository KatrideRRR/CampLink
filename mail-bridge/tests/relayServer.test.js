
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
    createAppServer,
} from '../../backend/src/app.js';

import {
    createMailStore,
} from '../src/store.js';

import {
    createRelayServer,
} from '../src/relay-server.js';

import {
    forwardPending,
} from '../src/bridge.js';

const SECRET =
    'test-relay-token-secret-1234567890-abcdef';

const GATEWAY =
    'test-email-gateway-secret-1234567890-abcdef';

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    return `http://127.0.0.1:${server.address().port}`;
}

test(
    'authenticated relay queues offline and forwards once',
    { timeout: 10000 },
    async (t) => {
        const main = createAppServer({
            databasePath: ':memory:',
            relayTokenSecret: SECRET,
            emailGatewaySecret: GATEWAY,
        });

        const bridgeStore = createMailStore(':memory:');

        const akim = main.store.createUser(
            'akim',
            'strong-password-123'
        );

        const worker = main.store.createUser(
            'worker',
            'strong-password-456'
        );

        const relay = createRelayServer({
            store: bridgeStore,
            secret: SECRET,
            allowedOrigins: [
                'http://127.0.0.1:5173',
            ],
        });

        t.after(async () => {
            await new Promise((resolve) =>
                relay.close(resolve)
            );

            await new Promise((resolve) =>
                main.io.close(resolve)
            );

            bridgeStore.close();
            main.store.close();
        });

        const mainUrl = await listen(main.httpServer);
        const relayUrl = await listen(relay);

        const login = await fetch(
            `${mainUrl}/api/auth/login`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: 'akim',
                    password: 'strong-password-123',
                }),
            }
        );

        assert.equal(login.status, 200);

        const cookie = login.headers
            .get('set-cookie')
            ?.split(';')[0];

        assert.ok(cookie);

        const credentialResponse = await fetch(
            `${mainUrl}/api/relay/credential`,
            {
                headers: { Cookie: cookie },
            }
        );

        assert.equal(credentialResponse.status, 200);

        const credential =
            await credentialResponse.json();

        const packet = {
            toUserId: worker.id,
            clientMessageId: randomUUID(),
            clientCreatedAt:
                '2026-11-19T08:00:00.000Z',
            text: 'Сообщение через резерв',
            senderId: worker.id,
        };

        const submit = (token, body = packet) =>
            fetch(`${relayUrl}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'http://127.0.0.1:5173',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

        const unauthorized = await submit('bad-ticket');

        assert.equal(unauthorized.status, 401);

        const accepted = await submit(credential.token);

        assert.equal(accepted.status, 202);

        const acceptedBody = await accepted.json();

        assert.equal(acceptedBody.status, 'queued');
        assert.equal(acceptedBody.duplicate, false);

        // Retry must not create a duplicate.
        const duplicate = await submit(credential.token);

        assert.equal(duplicate.status, 202);
        assert.equal(
            (await duplicate.json()).duplicate,
            true
        );

        assert.equal(bridgeStore.countPending(), 1);

        // The client has not received final delivery yet.
        assert.equal(
            main.store.getConversation(
                akim.id,
                worker.id
            ).length,
            0
        );

        // Simulate backend network outage.
        const offlineResult = await forwardPending(
            bridgeStore,
            {
                backendUrl: mainUrl,
                gatewaySecret: GATEWAY,
                fetchImpl: async () => {
                    throw new Error('Backend offline');
                },
            }
        );

        assert.equal(offlineResult, 0);
        assert.equal(bridgeStore.countPending(), 1);

        // Connection is restored.
        const delivered = await forwardPending(
            bridgeStore,
            {
                backendUrl: mainUrl,
                gatewaySecret: GATEWAY,
            }
        );

        assert.equal(delivered, 1);
        assert.equal(bridgeStore.countPending(), 0);

        const messages = main.store.getConversation(
            akim.id,
            worker.id
        );

        assert.equal(messages.length, 1);
        assert.equal(messages[0].senderId, akim.id);
        assert.equal(messages[0].recipientId, worker.id);
        assert.equal(messages[0].text, packet.text);

        // The senderId supplied by the client was forged.
        // The relay correctly used the signed identity.
        assert.notEqual(
            messages[0].senderId,
            packet.senderId
        );
    }
);
