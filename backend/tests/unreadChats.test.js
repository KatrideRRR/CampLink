import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as connectClient } from 'socket.io-client';
import { createStore } from '../src/store.js';
import { createAppServer } from '../src/app.js';

test('unread counts follow actual read receipts', () => {
    const store = createStore(':memory:');

    try {
        const akim = store.createUser(
            'akim', 'test-password-123'
        );
        const emir = store.createUser(
            'emir', 'test-password-456'
        );
        const eldar = store.createUser(
            'eldar', 'test-password-789'
        );

        const send = (senderId, recipientId) =>
            store.saveMessage({
                senderId,
                recipientId,
                clientMessageId: randomUUID(),
                text: 'Проверка непрочитанных',
            }).message;

        const first = send(emir.id, akim.id);
        const second = send(emir.id, akim.id);
        send(eldar.id, akim.id);
        send(akim.id, emir.id);

        const counts = store.getUnreadCounts(akim.id);

        assert.equal(
            counts.find(x => x.peerId === emir.id).unreadCount,
            2
        );
        assert.equal(
            counts.find(x => x.peerId === eldar.id).unreadCount,
            1
        );

        store.markConversationRead(
            akim.id, emir.id, first.id
        );

        assert.equal(
            store.getUnreadCounts(akim.id)
                .find(x => x.peerId === emir.id).unreadCount,
            1
        );

        store.markConversationRead(
            akim.id, emir.id, second.id
        );

        assert.equal(
            store.getUnreadCounts(akim.id)
                .some(x => x.peerId === emir.id),
            false
        );

        assert.equal(
            store.getUnreadCounts(akim.id)
                .find(x => x.peerId === eldar.id).unreadCount,
            1
        );
    } finally {
        store.close();
    }
});

test('unread updates arrive through Socket.IO', {
    timeout: 10000,
}, async t => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    const akim = store.createUser(
        'akim', 'test-password-123'
    );
    const emir = store.createUser(
        'emir', 'test-password-456'
    );

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const url =
        `http://127.0.0.1:${httpServer.address().port}`;
    const clients = [];

    t.after(async () => {
        clients.forEach(client => client.disconnect());
        await new Promise(resolve => io.close(resolve));
        store.close();
    });

    async function connect(user) {
        const client = connectClient(url, {
            autoConnect: false,
            transports: ['websocket'],
            reconnection: false,
            auth: {
                token: store.createSession(user.id),
            },
            extraHeaders: {
                Origin: 'capacitor://localhost',
            },
        });

        clients.push(client);

        const ready = new Promise((resolve, reject) => {
            client.once('connect', resolve);
            client.once('connect_error', reject);
        });

        client.connect();
        await ready;
        return client;
    }

    function waitFor(socket, event) {
        return new Promise(resolve => {
            socket.once(event, resolve);
        });
    }

    function emitAck(socket, event, payload) {
        return new Promise((resolve, reject) => {
            socket.timeout(3000).emit(
                event, payload,
                (error, result) =>
                    error ? reject(error) : resolve(result)
            );
        });
    }

    const sender = await connect(akim);
    const receiver = await connect(emir);

    const unreadEvent = waitFor(receiver, 'chat:unread');

    const sent = await emitAck(sender, 'chat:send', {
        toUserId: emir.id,
        clientMessageId: randomUUID(),
        text: 'Проверка подсветки',
    });

    assert.equal(sent.ok, true);

    const unread = await unreadEvent;
    assert.equal(unread.peerId, akim.id);
    assert.equal(unread.unreadCount, 1);

    const readEvent = waitFor(receiver, 'chat:unread');

    const ack = await emitAck(receiver, 'chat:read', {
        peerId: akim.id,
        throughId: sent.message.id,
    });

    assert.equal(ack.ok, true);

    const cleared = await readEvent;
    assert.equal(cleared.peerId, akim.id);
    assert.equal(cleared.unreadCount, 0);
});
