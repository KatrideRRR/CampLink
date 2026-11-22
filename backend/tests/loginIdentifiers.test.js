import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeLoginIdentifier,
} from '../src/login-identifier.js';

import { createAppServer } from '../src/app.js';

test('login identifiers normalize email and phone', () => {
    assert.equal(
        normalizeLoginIdentifier(' User@Example.COM '),
        'user@example.com'
    );
    assert.equal(
        normalizeLoginIdentifier('8 (912) 345-67-89'),
        '+79123456789'
    );
    assert.equal(
        normalizeLoginIdentifier('+7 912 345-67-89'),
        '+79123456789'
    );
    assert.equal(normalizeLoginIdentifier('akim'), null);
    assert.equal(normalizeLoginIdentifier(''), null);
    assert.equal(normalizeLoginIdentifier('#1'), null);
});

test('HTTP login rejects nickname and accepts email/phone', {
    timeout: 15000,
}, async t => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    const user = store.registerUser({
        displayName: 'Akim Test',
        email: 'akim@example.com',
        phone: '+79123456789',
        password: 'secure-test-password-123',
    });

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    t.after(async () => {
        await new Promise(resolve => io.close(resolve));
        store.close();
    });

    const base =
        `http://127.0.0.1:${httpServer.address().port}`;

    async function login(username, password, native = false) {
        return fetch(
            base + (native
                ? '/api/auth/native-login'
                : '/api/auth/login'),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(native
                        ? { Origin: 'capacitor://localhost' }
                        : {}),
                },
                body: JSON.stringify({ username, password }),
            }
        );
    }

    const email = await login(
        'AKIM@EXAMPLE.COM',
        'secure-test-password-123'
    );
    assert.equal(email.status, 200);
    assert.equal((await email.json()).user.id, user.id);

    const phone = await login(
        '8 (912) 345-67-89',
        'secure-test-password-123'
    );
    assert.equal(phone.status, 200);
    assert.equal((await phone.json()).user.id, user.id);

    const nickname = await login(
        user.username,
        'secure-test-password-123'
    );
    assert.equal(nickname.status, 401);

    const wrong = await login(
        'akim@example.com',
        'incorrect-password'
    );
    assert.equal(wrong.status, 401);

    const native = await login(
        '+79123456789',
        'secure-test-password-123',
        true
    );
    assert.equal(native.status, 200);
    const nativeData = await native.json();
    assert.equal(nativeData.user.id, user.id);
    assert.match(nativeData.token, /^[a-f0-9]{64}$/);
});
