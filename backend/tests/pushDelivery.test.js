import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAppServer } from '../src/app.js';

test('FCM delivery: recipient, idempotency and invalid tokens',
    async (t) => {
        const calls = [];
        const secret = 'test-gateway-secret'.repeat(3);
        const { httpServer, io, store } = createAppServer({
            databasePath: ':memory:',
            emailGatewaySecret: secret,
            pushSender: async ({ tokens, message }) => {
                calls.push({ tokens, message });
                return [invalidToken];
            },
        });

        t.after(async () => {
            await new Promise((resolve) => io.close(resolve));
            store.close();
        });

        const sender = store.createUser(
            'sender',
            'test-password-123'
        );
        const recipient = store.createUser(
            'recipient',
            'test-password-456'
        );
        const outsider = store.createUser(
            'outsider',
            'test-password-789'
        );

        const token = 'fcm_' + 'a'.repeat(70);
        const invalidToken = 'fcm_' + 'b'.repeat(70);
        const outsiderToken = 'fcm_' + 'c'.repeat(70);

        store.registerPushDevice(
            recipient.id,
            store.createSession(recipient.id),
            token,
            'fcm'
        );
        store.registerPushDevice(
            recipient.id,
            store.createSession(recipient.id),
            invalidToken,
            'fcm'
        );
        store.registerPushDevice(
            outsider.id,
            store.createSession(outsider.id),
            outsiderToken,
            'fcm'
        );

        // APNs tokens must never be passed to Firebase.
        store.registerPushDevice(
            recipient.id,
            store.createSession(recipient.id),
            'd'.repeat(64),
            'apns'
        );

        await new Promise((resolve, reject) => {
            httpServer.once('error', reject);
            httpServer.listen(0, '127.0.0.1', resolve);
        });

        const base =
            `http://127.0.0.1:${httpServer.address().port}`;

        const payload = {
            senderId: sender.id,
            recipientId: recipient.id,
            clientMessageId: randomUUID(),
            clientCreatedAt: new Date().toISOString(),
            text: 'Test notification',
        };

        async function ingest() {
            return fetch(`${base}/api/internal/email/ingest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-camplink-gateway-secret': secret,
                },
                body: JSON.stringify(payload),
            });
        }

        const first = await ingest();
        assert.equal(first.status, 201);

        async function waitFor(check) {
            for (let i = 0; i < 50; i++) {
                if (check()) return;
                await new Promise((resolve) =>
                    setTimeout(resolve, 10)
                );
            }
            assert.fail('Push event was not completed');
        }

        await waitFor(() =>
            calls.length === 1 &&
            !store.getPushDevices(recipient.id)
                .some((device) => device.token === invalidToken)
        );

        assert.deepEqual(
            [...calls[0].tokens].sort(),
            [token, invalidToken].sort()
        );
        assert.equal(
            calls[0].message.recipientId,
            recipient.id
        );
        assert.equal(
            calls[0].message.senderId,
            sender.id
        );

        assert.equal(
            store.getPushDevices(outsider.id)[0].token,
            outsiderToken
        );

        const duplicate = await ingest();
        assert.equal(duplicate.status, 200);

        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(calls.length, 1);
        assert.equal(
            store.getConversation(sender.id, recipient.id).length,
            1
        );
    }
);
