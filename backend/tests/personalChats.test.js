import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createStore } from '../src/store.js';
import { createAppServer } from '../src/app.js';

test('personal chats and latest-message ordering', () => {
    const store = createStore(':memory:');

    try {
        const akim = store.createUser(
            'akim', 'password-123456'
        );
        const emir = store.createUser(
            'emir', 'password-123456'
        );
        const eldar = store.createUser(
            'eldar', 'password-123456'
        );
        const erlan = store.createUser(
            'erlan', 'password-123456'
        );

        assert.deepEqual(store.listChats(akim.id), []);

        assert.equal(
            store.findUserByUsername('emir').id,
            emir.id
        );

        assert.equal(store.addContact(akim.id, emir.id), true);
        assert.equal(store.addContact(akim.id, emir.id), true);
        assert.equal(store.addContact(akim.id, akim.id), false);

        assert.deepEqual(
            store.listChats(akim.id).map(item => item.username),
            ['emir']
        );

        store.saveMessage({
            senderId: eldar.id,
            recipientId: akim.id,
            clientMessageId: randomUUID(),
            text: 'Привет от Эльдара',
        });

        assert.deepEqual(
            store.listChats(akim.id).map(item => item.username),
            ['eldar', 'emir']
        );

        store.saveMessage({
            senderId: akim.id,
            recipientId: emir.id,
            clientMessageId: randomUUID(),
            text: 'Привет Эмиру',
        });

        assert.deepEqual(
            store.listChats(akim.id).map(item => item.username),
            ['emir', 'eldar']
        );

        assert.equal(
            store.listChats(akim.id).some(
                item => item.id === erlan.id
            ),
            false
        );

        assert.deepEqual(
            store.listChats(emir.id).map(item => item.username),
            ['akim']
        );
    } finally {
        store.close();
    }
});

test('personal chat API requires authentication', async t => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    t.after(async () => {
        await new Promise(resolve => io.close(resolve));
        store.close();
    });

    const akim = store.createUser(
        'akim', 'password-123456'
    );
    const emir = store.createUser(
        'emir', 'password-123456'
    );
    store.createUser(
        'erlan', 'password-123456'
    );

    const token = store.createSession(akim.id);

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const base =
        `http://127.0.0.1:${httpServer.address().port}`;

    assert.equal(
        (await fetch(base + '/api/users')).status,
        401
    );

    const headers = {
        Authorization: `Bearer ${token}`,
    };

    const first = await fetch(base + '/api/users', {
        headers,
    });

    assert.deepEqual((await first.json()).users, []);

    const search = await fetch(
        base + '/api/users/search?username=emir',
        { headers }
    );

    assert.equal((await search.json()).user.id, emir.id);

    const added = await fetch(base + '/api/contacts', {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ peerId: emir.id }),
    });

    assert.equal(added.status, 200);

    const list = await fetch(base + '/api/users', {
        headers,
    });

    assert.deepEqual(
        (await list.json()).users.map(item => item.username),
        ['emir']
    );
});
