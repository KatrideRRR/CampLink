import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/app.js';

test('passkey enrollment and login are protected', {
    timeout: 15000,
}, async t => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    t.after(async () => {
        await new Promise(resolve => io.close(resolve));
        store.close();
    });

    const user = store.registerUser({
        displayName: 'Passkey Tester',
        email: 'passkey@example.com',
        phone: '+79123450018',
        password: 'secure-test-password-123',
    });

    const token = store.createSession(user.id);

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const base =
        `http://127.0.0.1:${httpServer.address().port}`;

    async function post(path, body, authorized = false) {
        return fetch(base + path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(authorized
                    ? { Authorization: `Bearer ${token}` }
                    : {}),
            },
            body: JSON.stringify(body),
        });
    }

    const unauthorized = await post(
        '/api/passkeys/register/options',
        {}
    );

    assert.equal(unauthorized.status, 401);

    const start = await post(
        '/api/passkeys/register/options',
        {},
        true
    );

    assert.equal(start.status, 200);

    const registration = await start.json();

    assert.match(registration.requestId, /^[0-9a-f-]{36}$/);
    assert.ok(registration.options.challenge);
    assert.equal(
        registration.options.authenticatorSelection
            .userVerification,
        'required'
    );

    const invalidCredential = {
        id: 'not-a-valid-credential',
        type: 'public-key',
        response: {},
    };

    const failedRegistration = await post(
        '/api/passkeys/register/verify',
        {
            requestId: registration.requestId,
            credential: invalidCredential,
        },
        true
    );

    assert.equal(failedRegistration.status, 400);

    const replay = await post(
        '/api/passkeys/register/verify',
        {
            requestId: registration.requestId,
            credential: invalidCredential,
        },
        true
    );

    assert.equal(replay.status, 400);

    assert.deepEqual(store.listPasskeys(user.id), []);

    const loginStart = await post(
        '/api/passkeys/login/options',
        {}
    );

    assert.equal(loginStart.status, 200);

    const challenge = await loginStart.json();

    assert.ok(challenge.options.challenge);
    assert.equal(
        challenge.options.userVerification,
        'required'
    );

    const failedLogin = await post(
        '/api/passkeys/login/verify',
        {
            requestId: challenge.requestId,
            credential: invalidCredential,
        }
    );

    assert.equal(failedLogin.status, 401);

    const replayLogin = await post(
        '/api/passkeys/login/verify',
        {
            requestId: challenge.requestId,
            credential: invalidCredential,
        }
    );

    assert.equal(replayLogin.status, 401);

    const listed = await fetch(base + '/api/passkeys', {
        headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).keys, []);
});

test('expired challenges cannot be consumed', () => {
    const { io, store } = createAppServer({
        databasePath: ':memory:',
    });

    try {
        store.savePasskeyChallenge({
            id: '11111111-1111-4111-8111-111111111111',
            kind: 'login',
            challenge: 'test-challenge',
        });

        const first = store.takePasskeyChallenge(
            '11111111-1111-4111-8111-111111111111',
            'login'
        );

        assert.equal(first.challenge, 'test-challenge');

        const second = store.takePasskeyChallenge(
            '11111111-1111-4111-8111-111111111111',
            'login'
        );

        assert.equal(second, null);
    } finally {
        io.close();
        store.close();
    }
});
