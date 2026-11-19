import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/app.js';

test('FCM token registration and session revocation', async (t) => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    t.after(async () => {
        await new Promise((resolve) => io.close(resolve));
        store.close();
    });

    const user = store.createUser(
        'fcmtester',
        'test-password-123'
    );

    const session = store.createSession(user.id);

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const base =
        `http://127.0.0.1:${httpServer.address().port}`;

    async function register(token, provider = 'fcm', cookie = session) {
        return fetch(`${base}/api/push/devices`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(cookie ? {
                    Cookie: `camplink_session=${cookie}`,
                } : {}),
            },
            body: JSON.stringify({ provider, token }),
        });
    }

    const token = 'fcm_test_' + 'a'.repeat(90);

    assert.equal((await register(token, 'fcm', null)).status, 401);
    assert.equal((await register('short')).status, 400);
    assert.equal((await register(token, 'unknown')).status, 400);

    assert.equal((await register(token)).status, 204);
    assert.equal((await register(token)).status, 204);

    assert.deepEqual(store.getPushDevices(user.id), [
        { provider: 'fcm', token },
    ]);

    const logout = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: {
            Cookie: `camplink_session=${session}`,
            'Content-Type': 'application/json',
        },
        body: '{}',
    });

    assert.equal(logout.status, 200);
    assert.deepEqual(store.getPushDevices(user.id), []);
    assert.equal((await register(token)).status, 401);
});
