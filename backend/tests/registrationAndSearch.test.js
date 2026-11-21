import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppServer } from '../src/app.js';
import {
    normalizePhone,
    validateRegistration,
} from '../src/registration.js';

test('registration validates phone, email and password', () => {
    assert.equal(
        normalizePhone('8 (912) 345-67-89'),
        '+79123456789'
    );

    assert.equal(
        normalizePhone('+7 912 345-67-89'),
        '+79123456789'
    );

    assert.equal(
        validateRegistration({
            username: 'newuser',
            email: 'test@example.com',
            phone: '+79123456789',
            password: 'short',
        }),
        null
    );
});

test('open registration and private user suggestions', {
    timeout: 15000,
}, async t => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    t.after(async () => {
        await new Promise(resolve => io.close(resolve));
        store.close();
    });

    const legacy = store.createUser(
        'legacy', 'legacy-password-123'
    );

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const base =
        `http://127.0.0.1:${httpServer.address().port}`;

    const registration = {
        username: 'newuser',
        email: 'New.User@example.com',
        phone: '8 (912) 345-67-89',
        password: 'secure-password-123',
    };

    async function register(body) {
        return fetch(base + '/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    }

    const created = await register(registration);

    assert.equal(created.status, 201);

    const result = await created.json();

    assert.equal(result.user.username, 'newuser');
    assert.equal(result.user.email, undefined);
    assert.equal(result.user.phone, undefined);

    const duplicate = await register(registration);

    assert.equal(duplicate.status, 409);

    const invalid = await register({
        ...registration,
        username: 'another',
        password: '123',
    });

    assert.equal(invalid.status, 400);

    assert.equal(
        store.verifyCredentials(
            'New.User@example.com',
            registration.password
        )?.id,
        result.user.id
    );

    assert.equal(
        store.verifyCredentials(
            '8 (912) 345-67-89',
            registration.password
        )?.id,
        result.user.id
    );

    assert.equal(
        store.verifyCredentials(
            'legacy',
            'legacy-password-123'
        )?.id,
        legacy.id
    );

    const session = store.createSession(legacy.id);

    const headers = {
        Authorization: `Bearer ${session}`,
    };

    async function search(q) {
        const response = await fetch(
            base + '/api/users/suggest?q=' +
            encodeURIComponent(q),
            { headers }
        );

        assert.equal(response.status, 200);

        return (await response.json()).users;
    }

    const byName = await search('new');
    const byPhone = await search('9123456');
    const byEmail = await search('new.u');

    for (const matches of [
        byName, byPhone, byEmail,
    ]) {
        assert.equal(matches[0].username, 'newuser');

        assert.deepEqual(
            Object.keys(matches[0]).sort(),
            ['displayName', 'id', 'username']
        );
    }

    const withoutAuth = await fetch(
        base + '/api/users/suggest?q=new'
    );

    assert.equal(withoutAuth.status, 401);

    assert.equal(
        store.listChats(legacy.id).length,
        0
    );
});
