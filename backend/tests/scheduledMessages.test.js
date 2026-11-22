import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
    mkdtempSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connectClient } from 'socket.io-client';
import { createAppServer } from '../src/app.js';
import { createStore } from '../src/store.js';

test('scheduled message: access, cancel, exactly one message', {
    timeout: 15000,
}, async t => {
    const pushCalls = [];

    const {
        httpServer,
        io,
        store,
        dispatchScheduledMessages,
    } = createAppServer({
        databasePath: ':memory:',
        pushSender: async payload => {
            pushCalls.push(payload);
            return [];
        },
    });

    const sender = store.createUser(
        'sender', 'password-123456'
    );
    const recipient = store.createUser(
        'recipient', 'password-123456'
    );
    const stranger = store.createUser(
        'stranger', 'password-123456'
    );

    const senderToken = store.createSession(sender.id);
    const recipientToken = store.createSession(recipient.id);
    const strangerToken = store.createSession(stranger.id);

    store.registerPushDevice(
        recipient.id,
        recipientToken,
        'fcm_' + 'a'.repeat(70),
        'fcm'
    );

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const base =
        `http://127.0.0.1:${httpServer.address().port}`;

    const recipientClient = connectClient(base, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: recipientToken },
    });

    t.after(async () => {
        recipientClient.disconnect();
        await new Promise(resolve => io.close(resolve));
        store.close();
    });

    await new Promise((resolve, reject) => {
        recipientClient.once('connect', resolve);
        recipientClient.once('connect_error', reject);
    });

    async function request(path, method, token, body) {
        return fetch(base + path, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
    }

    const scheduledAt = new Date(
        Date.now() + 180000
    ).toISOString();

    const payload = {
        recipientId: recipient.id,
        clientMessageId: randomUUID(),
        text: 'Запланированное сообщение',
        scheduledAt,
    };

    const unauthorized = await fetch(
        base + '/api/scheduled-messages',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }
    );

    assert.equal(unauthorized.status, 401);

    const invalid = await request(
        '/api/scheduled-messages',
        'POST',
        senderToken,
        {
            ...payload,
            scheduledAt: new Date(
                Date.now() - 10000
            ).toISOString(),
        }
    );

    assert.equal(invalid.status, 400);

    const created = await request(
        '/api/scheduled-messages',
        'POST',
        senderToken,
        payload
    );

    assert.equal(created.status, 201);
    const first = await created.json();

    const duplicate = await request(
        '/api/scheduled-messages',
        'POST',
        senderToken,
        payload
    );

    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).id, first.id);

    const conflict = await request(
        '/api/scheduled-messages',
        'POST',
        senderToken,
        { ...payload, text: 'Подмена текста' }
    );

    assert.equal(conflict.status, 409);

    const otherList = await request(
        '/api/scheduled-messages',
        'GET',
        strangerToken
    );

    assert.deepEqual((await otherList.json()).items, []);

    const otherCancel = await request(
        `/api/scheduled-messages/${first.id}`,
        'DELETE',
        strangerToken
    );

    assert.equal(otherCancel.status, 404);

    // Before the scheduled time nothing is delivered.
    assert.deepEqual(dispatchScheduledMessages(), []);

    const senderHistory = store.getConversation(
        sender.id, recipient.id
    );

    assert.deepEqual(senderHistory, []);

    const canceled = await request(
        `/api/scheduled-messages/${first.id}`,
        'DELETE',
        senderToken
    );

    assert.equal(canceled.status, 204);

    assert.deepEqual(
        dispatchScheduledMessages(Date.now() + 300000),
        []
    );

    const nextPayload = {
        ...payload,
        clientMessageId: randomUUID(),
    };

    const next = await request(
        '/api/scheduled-messages',
        'POST',
        senderToken,
        nextPayload
    );

    assert.equal(next.status, 201);

    const received = new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error('No chat:new event')),
            3000
        );

        recipientClient.once('chat:new', message => {
            clearTimeout(timeout);
            resolve(message);
        });
    });

    const delivered = dispatchScheduledMessages(
        Date.now() + 300000
    );

    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].text, nextPayload.text);

    const socketMessage = await received;

    assert.equal(socketMessage.id, delivered[0].id);

    assert.deepEqual(
        dispatchScheduledMessages(Date.now() + 400000),
        []
    );

    const history = store.getConversation(
        sender.id, recipient.id
    );

    assert.equal(history.length, 1);

    for (let i = 0; i < 50 && pushCalls.length === 0; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    assert.equal(pushCalls.length, 1);
    assert.equal(
        pushCalls[0].message.id,
        delivered[0].id
    );

    const pending = await request(
        '/api/scheduled-messages',
        'GET',
        senderToken
    );

    assert.deepEqual((await pending.json()).items, []);
});

test('scheduled messages survive SQLite restart', () => {
    const directory = mkdtempSync(
        join(tmpdir(), 'camplink-scheduled-')
    );

    const databasePath = join(directory, 'test.sqlite');
    let store = null;

    try {
        store = createStore(databasePath);

        const sender = store.createUser(
            'scheduled_sender', 'password-123456'
        );
        const recipient = store.createUser(
            'scheduled_peer', 'password-123456'
        );

        const scheduledAt = Date.now() + 180000;

        store.scheduleMessage({
            senderId: sender.id,
            recipientId: recipient.id,
            clientMessageId: randomUUID(),
            text: 'После перезапуска',
            scheduledAt,
        });

        store.close();
        store = createStore(databasePath);

        assert.equal(
            store.listScheduledMessages(sender.id).length,
            1
        );

        const messages = store.dispatchDueScheduledMessages(
            scheduledAt + 1000
        );

        assert.equal(messages.length, 1);
        assert.equal(messages[0].text, 'После перезапуска');

        assert.deepEqual(
            store.dispatchDueScheduledMessages(
                scheduledAt + 2000
            ),
            []
        );
    } finally {
        if (store) store.close();
        rmSync(directory, {
            recursive: true,
            force: true,
        });
    }
});
