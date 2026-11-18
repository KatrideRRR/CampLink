
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    enqueueOutboxMessage,
    readOutbox,
    removeOutboxMessage,
} from '../src/services/outbox.ts';

function createStorage() {
    const values = new Map();

    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
    };
}

const message = {
    clientMessageId:
        '00000000-0000-4000-8000-000000000001',
    toUserId: 2,
    text: 'Тестовое сообщение',
    createdAt: '2026-11-18T12:00:00.000Z',
};

test('message survives queue reload', () => {
    const storage = createStorage();

    enqueueOutboxMessage(1, message, storage);

    const restored = readOutbox(1, storage);

    assert.equal(restored.length, 1);
    assert.deepEqual(restored[0], message);
});

test('queued messages are scoped by user', () => {
    const storage = createStorage();

    enqueueOutboxMessage(1, message, storage);

    assert.equal(readOutbox(1, storage).length, 1);
    assert.equal(readOutbox(3, storage).length, 0);
});

test('duplicate client ID does not duplicate queue', () => {
    const storage = createStorage();

    enqueueOutboxMessage(1, message, storage);
    enqueueOutboxMessage(1, message, storage);

    assert.equal(readOutbox(1, storage).length, 1);
});

test('confirmed message is removed from queue', () => {
    const storage = createStorage();

    enqueueOutboxMessage(1, message, storage);

    removeOutboxMessage(
        1,
        message.clientMessageId,
        storage
    );

    assert.deepEqual(readOutbox(1, storage), []);
});

test('invalid messages are rejected', () => {
    const storage = createStorage();

    assert.throws(() => {
        enqueueOutboxMessage(
            1,
            { ...message, text: '' },
            storage
        );
    });
});

test('storage failure does not report success', () => {
    const storage = {
        getItem: () => null,
        setItem: () => {
            throw new Error('Storage unavailable');
        },
    };

    assert.throws(() => {
        enqueueOutboxMessage(1, message, storage);
    });
});

test('queue has a maximum capacity', () => {
    const storage = createStorage();

    for (let i = 0; i < 100; i++) {
        enqueueOutboxMessage(
            1,
            {
                ...message,
                clientMessageId:
                    `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            },
            storage
        );
    }

    assert.equal(readOutbox(1, storage).length, 100);

    assert.throws(() => {
        enqueueOutboxMessage(
            1,
            {
                ...message,
                clientMessageId:
                    '00000000-0000-4000-8000-999999999999',
            },
            storage
        );
    });
});
