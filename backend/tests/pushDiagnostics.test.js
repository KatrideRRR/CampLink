import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/app.js';

test('push diagnostics are private and test push is delayed', {
    timeout: 15000,
}, async t => {
    const calls = [];

    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
        pushTestDelayMs: 20,
        pushSender: async request => {
            calls.push(request);
            return [];
        },
    });

    t.after(async () => {
        await new Promise(resolve => io.close(resolve));
        store.close();
    });

    const user = store.registerUser({
        displayName: 'Push Tester',
        email: 'push-diag@example.com',
        phone: '+79123450100',
        password: 'secure-test-password-123',
    });

    const other = store.registerUser({
        displayName: 'Other User',
        email: 'other-diag@example.com',
        phone: '+79123450101',
        password: 'secure-test-password-456',
    });

    const token = store.createSession(user.id);
    const otherSession = store.createSession(other.id);
    const fcmToken = 'fcm_' + 'a'.repeat(70);

    store.registerPushDevice(
        user.id,
        token,
        fcmToken,
        'fcm'
    );

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const base =
        `http://127.0.0.1:${httpServer.address().port}`;

    const auth = {
        Authorization: `Bearer ${token}`,
    };

    const unauthorized = await fetch(
        base + '/api/push/status'
    );

    assert.equal(unauthorized.status, 401);

    const status = await fetch(
        base + '/api/push/status',
        { headers: auth }
    );

    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
        serverEnabled: true,
        registeredDevices: 1,
    });

    const otherStatus = await fetch(
        base + '/api/push/status',
        {
            headers: {
                Authorization: `Bearer ${otherSession}`,
            },
        }
    );

    assert.deepEqual(await otherStatus.json(), {
        serverEnabled: true,
        registeredDevices: 0,
    });

    const denied = await fetch(
        base + '/api/push/test',
        { method: 'POST' }
    );

    assert.equal(denied.status, 401);

    const testPush = await fetch(
        base + '/api/push/test',
        {
            method: 'POST',
            headers: auth,
        }
    );

    assert.equal(testPush.status, 202);

    const result = await testPush.json();
    assert.equal(result.deviceCount, 1);

    const repeated = await fetch(
        base + '/api/push/test',
        {
            method: 'POST',
            headers: auth,
        }
    );

    assert.equal(repeated.status, 429);

    for (let i = 0; i < 50 && calls.length === 0; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].tokens, [fcmToken]);
    assert.equal(calls[0].message.recipientId, user.id);
    assert.equal(calls[0].senderUsername, 'CampLink');
});
