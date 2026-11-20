import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as connectClient } from 'socket.io-client';
import { createAppServer } from '../src/app.js';

test('replies and reactions are secure and persistent', {
    timeout: 10000,
}, async (t) => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    const akim = store.createUser(
        'akim', 'test-password-123'
    );
    const emir = store.createUser(
        'emir', 'test-password-456'
    );
    const eldar = store.createUser(
        'eldar', 'test-password-789'
    );

    const original = store.saveMessage({
        senderId: akim.id,
        recipientId: emir.id,
        clientMessageId: randomUUID(),
        text: 'Проверь документы',
    }).message;

    assert.equal(original.replyToMessageId, null);

    const reply = store.saveMessage({
        senderId: emir.id,
        recipientId: akim.id,
        clientMessageId: randomUUID(),
        text: 'Принял!',
        replyToMessageId: original.id,
    }).message;

    assert.equal(
        reply.replyToMessageId,
        original.id
    );
    assert.equal(
        reply.replyToText,
        'Проверь документы'
    );
    assert.equal(
        reply.replyToSenderId,
        akim.id
    );

    assert.throws(() => store.saveMessage({
        senderId: eldar.id,
        recipientId: akim.id,
        clientMessageId: randomUUID(),
        text: 'Поддельная цитата',
        replyToMessageId: original.id,
    }));

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

        const socket = connectClient(url, {
            autoConnect: false,
            transports: ['websocket'],
            reconnection: false,
            auth: { token },
            extraHeaders: {
                Origin: 'capacitor://localhost',
            },
        });

        clients.push(socket);

        await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
            socket.connect();
        });

        return socket;
    }

    async function react(socket, messageId, emoji) {
        return new Promise((resolve, reject) => {
            socket.timeout(3000).emit(
                'chat:reaction',
                { messageId, emoji },
                (error, result) =>
                    error ? reject(error) : resolve(result)
            );
        });
    }

    const akimSocket = await connect(akim);
    const emirSocket = await connect(emir);
    const eldarSocket = await connect(eldar);

    const event = new Promise(resolve => {
        akimSocket.once('chat:reaction', resolve);
    });

    assert.equal(
        (await react(emirSocket, original.id, '🫡')).ok,
        true
    );

    const update = await event;
    assert.equal(update.messageId, original.id);
    assert.equal(update.reactions.length, 1);
    assert.equal(update.reactions[0].emoji, '🫡');

    const history = store.getConversation(
        akim.id, emir.id
    );
    assert.equal(history[0].reactions.length, 1);

    // Повторное нажатие снимает реакцию.
    assert.equal(
        (await react(emirSocket, original.id, '🫡')).ok,
        true
    );
    assert.equal(
        store.getConversation(
            akim.id, emir.id
        )[0].reactions.length,
        0
    );

    // Третий пользователь не имеет доступа.
    assert.equal(
        (await react(eldarSocket, original.id, '❤️')).ok,
        false
    );

    // Произвольные emoji сервер не принимает.
    assert.equal(
        (await react(emirSocket, original.id, '❌')).ok,
        false
    );

    // История ответов сохраняется.
    const messages = store.getConversation(
        akim.id, emir.id
    );

    assert.equal(messages.length, 2);
    assert.equal(
        messages[1].replyToMessageId,
        original.id
    );
});
