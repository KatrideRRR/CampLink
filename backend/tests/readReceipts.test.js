import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as connectClient } from 'socket.io-client';
import { createAppServer } from '../src/app.js';

test('read receipts are authenticated and persisted', {
    timeout: 10000,
}, async (t) => {
    const server = createAppServer({
        databasePath: ':memory:',
    });

    const { httpServer, io, store } = server;

    const akim = store.createUser(
        'akim', 'strong-password-123'
    );
    const emir = store.createUser(
        'emir', 'strong-password-456'
    );
    const eldar = store.createUser(
        'eldar', 'strong-password-789'
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
        const token = store.createSession(user.id);

        const client = connectClient(url, {
            autoConnect: false,
            transports: ['websocket'],
            reconnection: false,
            auth: { token },
            extraHeaders: {
                Origin: 'capacitor://localhost',
            },
        });

        clients.push(client);

        await new Promise((resolve, reject) => {
            client.once('connect', resolve);
            client.once('connect_error', reject);
            client.connect();
        });

        return client;
    }

    async function markRead(client, peerId, throughId) {
        return new Promise((resolve, reject) => {
            client.timeout(3000).emit(
                'chat:read',
                { peerId, throughId },
                (error, response) =>
                    error ? reject(error) : resolve(response)
            );
        });
    }

    const akimClient = await connect(akim);
    const emirClient = await connect(emir);

    const message = store.saveMessage({
        senderId: akim.id,
        recipientId: emir.id,
        clientMessageId: randomUUID(),
        text: 'Проверяем галочки',
    }).message;

    const otherMessage = store.saveMessage({
        senderId: akim.id,
        recipientId: eldar.id,
        clientMessageId: randomUUID(),
        text: 'Чужая переписка',
    }).message;

    assert.equal(message.readAt, null);

    const receiptEvent = new Promise(resolve => {
        akimClient.once('chat:read', resolve);
    });

    const ack = await markRead(
        emirClient, akim.id, message.id
    );

    assert.equal(ack.ok, true);

    const receipt = await receiptEvent;

    assert.equal(receipt.readerId, emir.id);
    assert.equal(receipt.throughId, message.id);

    const updated = store.getConversation(
        akim.id, emir.id
    );

    assert.ok(updated[0].readAt);

    // Повторное прочтение безопасно.
    const repeated = await markRead(
        emirClient, akim.id, message.id
    );

    assert.equal(repeated.ok, true);

    // Нельзя пометить сообщение,
    // адресованное другому пользователю.
    const forged = await markRead(
        emirClient, akim.id, otherMessage.id
    );

    assert.equal(forged.ok, false);

    assert.equal(
        store.getConversation(
            akim.id, eldar.id
        )[0].readAt,
        null
    );
});
