
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    deliverMessage,
} from '../src/services/delivery.ts';

const packet = {
    clientMessageId:
        '00000000-0000-4000-8000-000000000001',
    toUserId: 2,
    text: 'CampLink test',
    createdAt: '2026-11-18T16:00:00.000Z',
};

const delivered = {
    id: 1,
    senderId: 1,
    recipientId: 2,
    clientMessageId: packet.clientMessageId,
    text: packet.text,
    createdAt: packet.createdAt,
};

function transport({
                       id,
                       priority,
                       available = true,
                       send,
                   }) {
    return {
        id,
        kind: 'internet',
        priority,
        async isAvailable() {
            return available;
        },
        async send(message) {
            return send(message);
        },
    };
}

test('uses available primary transport', async () => {
    const used = [];

    const primary = transport({
        id: 'primary',
        priority: 10,
        send: async () => {
            used.push('primary');
            return { ok: true, message: delivered };
        },
    });

    const result = await deliverMessage(
        packet,
        [primary]
    );

    assert.equal(result.status, 'sent');
    assert.equal(result.transportId, 'primary');
    assert.deepEqual(used, ['primary']);
});

test('falls back when primary is unavailable', async () => {
    const used = [];

    const primary = transport({
        id: 'primary',
        priority: 10,
        available: false,
        send: async () => {
            used.push('primary');
            throw new Error('Should not be called');
        },
    });

    const backup = transport({
        id: 'backup',
        priority: 20,
        send: async (message) => {
            used.push('backup');
            assert.equal(
                message.clientMessageId,
                packet.clientMessageId
            );
            return { ok: true, message: delivered };
        },
    });

    const result = await deliverMessage(
        packet,
        [backup, primary]
    );

    assert.equal(result.status, 'sent');
    assert.equal(result.transportId, 'backup');
    assert.deepEqual(used, ['backup']);
});

test('tries backup after network failure', async () => {
    const primary = transport({
        id: 'primary',
        priority: 10,
        send: async () => {
            throw new Error('Network timeout');
        },
    });

    const backup = transport({
        id: 'backup',
        priority: 20,
        send: async () => ({
            ok: true,
            message: delivered,
        }),
    });

    const result = await deliverMessage(
        packet,
        [primary, backup]
    );

    assert.equal(result.status, 'sent');
    assert.equal(result.transportId, 'backup');
});

test('keeps message queued without transports', async () => {
    const result = await deliverMessage(packet, []);

    assert.equal(result.status, 'queued');
});

test('server rejection is not treated as network failure', async () => {
    let backupCalled = false;

    const primary = transport({
        id: 'primary',
        priority: 10,
        send: async () => ({
            ok: false,
            error: 'Invalid message',
        }),
    });

    const backup = transport({
        id: 'backup',
        priority: 20,
        send: async () => {
            backupCalled = true;
            return { ok: true, message: delivered };
        },
    });

    const result = await deliverMessage(
        packet,
        [primary, backup]
    );

    assert.equal(result.status, 'rejected');
    assert.equal(backupCalled, false);
});

test('rejects mismatched acknowledgement', async () => {
    const primary = transport({
        id: 'primary',
        priority: 10,
        send: async () => ({
            ok: true,
            message: {
                ...delivered,
                clientMessageId: 'wrong-id',
            },
        }),
    });

    const result = await deliverMessage(
        packet,
        [primary]
    );

    assert.equal(result.status, 'queued');
});

test('does not modify the original transport list', async () => {
    const backup = transport({
        id: 'backup',
        priority: 20,
        send: async () => ({
            ok: true,
            message: delivered,
        }),
    });

    const primary = transport({
        id: 'primary',
        priority: 10,
        send: async () => ({
            ok: true,
            message: delivered,
        }),
    });

    const list = [backup, primary];

    await deliverMessage(packet, list);

    assert.equal(list[0].id, 'backup');
    assert.equal(list[1].id, 'primary');
});


test('relay acceptance is not final delivery', async () => {
    const relay = {
        id: 'secondary-relay',
        kind: 'relay',
        priority: 20,

        async isAvailable() {
            return true;
        },

        async send() {
            return {
                ok: true,
                queued: true,
            };
        },
    };

    const result = await deliverMessage(
        packet,
        [relay]
    );

    assert.equal(result.status, 'relayed');
    assert.equal(result.transportId, 'secondary-relay');
});
