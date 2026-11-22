
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as connectClient } from 'socket.io-client';
import { createAppServer } from '../src/app.js';

test('authenticated private messaging', { timeout: 10000 }, async (t) => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    const akim = store.registerUser({
        displayName: 'Akim',
        email: 'akim@example.com',
        phone: '+79123450001',
        password: 'test-password-123',
    });

    const worker = store.registerUser({
        displayName: 'Worker',
        email: 'worker@example.com',
        phone: '+79123450002',
        password: 'test-password-456',
    });

    const outsider = store.registerUser({
        displayName: 'Outsider',
        email: 'outsider@example.com',
        phone: '+79123450003',
        password: 'test-password-789',
    });

    const clients = [];

    t.after(async () => {
        clients.forEach((client) => client.disconnect());

        await new Promise((resolve) => io.close(resolve));
        store.close();
    });

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const url = `http://127.0.0.1:${httpServer.address().port}`;

    async function login(username, password) {
        const response = await fetch(
            `${url}/api/auth/login`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            }
        );

        assert.equal(response.status, 200);

        const cookie = response.headers
            .get('set-cookie')
            ?.split(';')[0];

        assert.ok(cookie);

        return cookie;
    }

    async function connect(cookie) {
        const client = connectClient(url, {
            autoConnect: false,
            transports: ['websocket'],
            reconnection: false,
            extraHeaders: {
                Cookie: cookie,
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

    function send(client, payload) {
        return new Promise((resolve, reject) => {
            client.timeout(3000).emit(
                'chat:send',
                payload,
                (error, response) => {
                    if (error) return reject(error);
                    resolve(response);
                }
            );
        });
    }

    function waitForMessage(client) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Message was not received'));
            }, 3000);

            client.once('chat:new', (message) => {
                clearTimeout(timeout);
                resolve(message);
            });
        });
    }

    const invalidLogin = await fetch(
        `${url}/api/auth/login`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: 'akim@example.com',
                password: 'incorrect-password',
            }),
        }
    );

    assert.equal(invalidLogin.status, 401);

    const akimCookie = await login(
        'akim@example.com',
        'test-password-123'
    );

    const workerCookie = await login(
        'worker@example.com',
        'test-password-456'
    );

    const outsiderCookie = await login(
        'outsider@example.com',
        'test-password-789'
    );

    const akimClient = await connect(akimCookie);
    const workerClient = await connect(workerCookie);

    const newMessage = waitForMessage(workerClient);

    const payload = {
        toUserId: worker.id,
        clientMessageId: randomUUID(),
        text: 'Привет! Проверяем CampLink.',
    };

    const result = await send(akimClient, payload);

    assert.equal(result.ok, true);
    assert.equal(result.message.senderId, akim.id);
    assert.equal(result.message.recipientId, worker.id);
    assert.equal(result.message.text, payload.text);

    const received = await newMessage;

    assert.equal(received.id, result.message.id);
    assert.equal(received.text, payload.text);

    // Retrying the same message must not duplicate it.
    const duplicate = await send(akimClient, payload);

    assert.equal(duplicate.ok, true);
    assert.equal(
        duplicate.message.id,
        result.message.id
    );

    // Reusing the same ID with different text is rejected.
    const conflicting = await send(akimClient, {
        ...payload,
        text: 'Другой текст',
    });

    assert.equal(conflicting.ok, false);

    const history = await fetch(
        `${url}/api/messages/${akim.id}`,
        {
            headers: {
                Cookie: workerCookie,
            },
        }
    );

    assert.equal(history.status, 200);

    const historyData = await history.json();

    assert.equal(historyData.messages.length, 1);
    assert.equal(
        historyData.messages[0].text,
        payload.text
    );

    // An unrelated user cannot read this conversation.
    const outsiderHistory = await fetch(
        `${url}/api/messages/${worker.id}`,
        {
            headers: {
                Cookie: outsiderCookie,
            },
        }
    );

    const outsiderData = await outsiderHistory.json();

    assert.equal(outsiderHistory.status, 200);
    assert.deepEqual(outsiderData.messages, []);

    // User IDs must come from the session, not the payload.
    const forged = await send(akimClient, {
        toUserId: worker.id,
        senderId: outsider.id,
        clientMessageId: randomUUID(),
        text: 'Second message',
    });

    assert.equal(forged.ok, true);
    assert.equal(forged.message.senderId, akim.id);

    const offlineSequence = [
        {
            sender: 'akim',
            text: '1',
            clientMessageId: randomUUID(),
            clientCreatedAt:
                '2026-11-18T19:23:01.000+03:00',
        },
        {
            sender: 'worker',
            text: '2',
            clientMessageId: randomUUID(),
            clientCreatedAt:
                '2026-11-18T08:23:02.000-08:00',
        },
        {
            sender: 'akim',
            text: '3',
            clientMessageId: randomUUID(),
            clientCreatedAt:
                '2026-11-18T19:23:03.000+03:00',
        },
        {
            sender: 'worker',
            text: '4',
            clientMessageId: randomUUID(),
            clientCreatedAt:
                '2026-11-18T08:23:04.000-08:00',
        },
    ];

// Simulate independent offline queues:
// worker sends 2 and 4 before akim sends 1 and 3.
    for (const index of [1, 3, 0, 2]) {
        const item = offlineSequence[index];

        const fromAkim = item.sender === 'akim';

        const result = await send(
            fromAkim ? akimClient : workerClient,
            {
                toUserId: fromAkim ? worker.id : akim.id,
                clientMessageId: item.clientMessageId,
                clientCreatedAt: item.clientCreatedAt,
                text: item.text,
            }
        );

        assert.equal(result.ok, true);
    }

    const expectedIds = new Set(
        offlineSequence.map(
            (item) => item.clientMessageId
        )
    );

// Both participants must see the same order.
    for (const [cookie, peerId] of [
        [akimCookie, worker.id],
        [workerCookie, akim.id],
    ]) {
        const response = await fetch(
            `${url}/api/messages/${peerId}`,
            {
                headers: { Cookie: cookie },
            }
        );

        assert.equal(response.status, 200);

        const data = await response.json();

        const restored = data.messages.filter(
            (message) =>
                expectedIds.has(message.clientMessageId)
        );

        assert.deepEqual(
            restored.map((message) => message.text),
            ['1', '2', '3', '4']
        );

        assert.deepEqual(
            restored.map((message) => message.createdAt),
            offlineSequence.map(
                (item) =>
                    new Date(item.clientCreatedAt).toISOString()
            )
        );

        assert.ok(
            restored.every(
                (message) =>
                    typeof message.serverReceivedAt === 'string'
            )
        );
    }

    const workerReply = await send(workerClient, {
        toUserId: akim.id,
        clientMessageId: randomUUID(),
        text: 'Ответ сотрудника',
    });

    assert.equal(workerReply.ok, true);

    const akimFollowup = await send(akimClient, {
        toUserId: worker.id,
        clientMessageId: randomUUID(),
        text: 'Следующее сообщение',
    });

    assert.equal(akimFollowup.ok, true);

    const orderedResponse = await fetch(
        `${url}/api/messages/${worker.id}`,
        {
            headers: {
                Cookie: akimCookie,
            },
        }
    );

    assert.equal(orderedResponse.status, 200);

    const orderedData = await orderedResponse.json();

    assert.deepEqual(
        orderedData.messages.slice(-3).map(
            (message) => message.senderId
        ),
        [akim.id, worker.id, akim.id]
    );

    assert.deepEqual(
        orderedData.messages.slice(-3).map(
            (message) => message.text
        ),
        [
            'Second message',
            'Ответ сотрудника',
            'Следующее сообщение',
        ]
    );

    // Logout invalidates the original session.
    const logout = await fetch(
        `${url}/api/auth/logout`,
        {
            method: 'POST',
            headers: {
                Cookie: akimCookie,
                'Content-Type': 'application/json',
            },
            body: '{}',
        }
    );

    assert.equal(logout.status, 200);

    const afterLogout = await fetch(
        `${url}/api/auth/me`,
        {
            headers: {
                Cookie: akimCookie,
            },
        }
    );

    assert.equal(afterLogout.status, 401);
});
