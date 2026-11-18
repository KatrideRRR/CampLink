
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAppServer } from '../../backend/src/app.js';
import {
    encodeMailPacket,
    decodeMailPacket,
    MAIL_SUBJECT,
} from '../src/protocol.js';
import { createMailStore } from '../src/store.js';
import {
    collectMailbox,
    forwardPending,
} from '../src/bridge.js';

const SIGNING_KEY = 'test-signing-key-0123456789-abcdefghijkl';
const GATEWAY_SECRET = 'test-gateway-key-0123456789-abcdefghij';

function makePacket(senderId = 1, recipientId = 2) {
    return {
        senderId,
        recipientId,
        clientMessageId: randomUUID(),
        clientCreatedAt: '2026-11-18T16:00:00.000Z',
        text: 'Сообщение через почту',
    };
}

function makeMimeMessage(packet) {
    const body = encodeMailPacket(packet, SIGNING_KEY);

    return Buffer.from(
        [
            'From: test@example.com',
            'To: gateway@example.com',
            `Subject: ${MAIL_SUBJECT}`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=utf-8',
            '',
            body,
        ].join('\r\n'),
        'utf8'
    );
}

test('mail packet signature protects message contents', () => {
    const packet = makePacket();

    const encoded = encodeMailPacket(
        packet,
        SIGNING_KEY
    );

    assert.deepEqual(
        decodeMailPacket(encoded, SIGNING_KEY),
        packet
    );

    const forged = JSON.parse(encoded);
    forged.packet.text = 'Изменённое сообщение';

    assert.throws(() => {
        decodeMailPacket(
            JSON.stringify(forged),
            SIGNING_KEY
        );
    }, /Invalid signature/);
});

test('IMAP message is parsed and queued once', async () => {
    const store = createMailStore(':memory:');
    const packet = makePacket();

    const seen = [];
    let released = false;

    const client = {
        async getMailboxLock() {
            return {
                release() {
                    released = true;
                },
            };
        },

        async search() {
            return [10, 11];
        },

        async fetchOne() {
            return {
                source: makeMimeMessage(packet),
            };
        },

        async messageFlagsAdd(uid) {
            seen.push(uid);
        },
    };

    try {
        const added = await collectMailbox(
            client,
            store,
            SIGNING_KEY
        );

        assert.equal(added, 1);
        assert.equal(store.countPending(), 1);
        assert.deepEqual(seen, [10, 11]);
        assert.equal(released, true);
    } finally {
        store.close();
    }
});

test('mail survives outage and reaches real backend', async (t) => {
    const directory = mkdtempSync(
        join(tmpdir(), 'camplink-bridge-')
    );

    const path = join(directory, 'bridge.sqlite');

    let queue = createMailStore(path);

    const {
        httpServer,
        io,
        store: backendStore,
    } = createAppServer({
        databasePath: ':memory:',
        emailGatewaySecret: GATEWAY_SECRET,
    });

    t.after(async () => {
        queue.close();

        await new Promise((resolve) => io.close(resolve));
        backendStore.close();

        rmSync(directory, {
            recursive: true,
            force: true,
        });
    });

    const akim = backendStore.createUser(
        'akim',
        'strong-password-123'
    );

    const worker = backendStore.createUser(
        'worker',
        'strong-password-456'
    );

    const packet = makePacket(akim.id, worker.id);

    queue.enqueue(packet);
    queue.enqueue(packet);

    assert.equal(queue.countPending(), 1);

    // Simulate a network outage.
    const failed = await forwardPending(queue, {
        backendUrl: 'http://127.0.0.1:5100',
        gatewaySecret: GATEWAY_SECRET,
        fetchImpl: async () => {
            throw new Error('Backend unavailable');
        },
    });

    assert.equal(failed, 0);
    assert.equal(queue.countPending(), 1);

    // Simulate restarting the independent bridge.
    queue.close();
    queue = createMailStore(path);

    assert.equal(queue.countPending(), 1);

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const port = httpServer.address().port;

    const forwarded = await forwardPending(queue, {
        backendUrl: `http://127.0.0.1:${port}`,
        gatewaySecret: GATEWAY_SECRET,
    });

    assert.equal(forwarded, 1);
    assert.equal(queue.countPending(), 0);

    const messages = backendStore.getConversation(
        akim.id,
        worker.id
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, packet.text);

    // A second retry must not duplicate the message.
    const again = await forwardPending(queue, {
        backendUrl: `http://127.0.0.1:${port}`,
        gatewaySecret: GATEWAY_SECRET,
    });

    assert.equal(again, 0);

    assert.equal(
        backendStore.getConversation(
            akim.id,
            worker.id
        ).length,
        1
    );
});
