import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyReadReceipt,
} from '../src/services/read-receipts.ts';

const readAt = '2026-11-20T12:00:00.000Z';

const messages = [
    {
        id: 10,
        senderId: 1,
        recipientId: 2,
        readAt: null,
    },
    {
        id: 11,
        senderId: 1,
        recipientId: 2,
        readAt: null,
    },
    {
        id: 12,
        senderId: 2,
        recipientId: 1,
        readAt: null,
    },
    {
        id: 13,
        senderId: 1,
        recipientId: 3,
        readAt: null,
    },
];

test('read receipt marks only eligible outgoing messages', () => {
    const updated = applyReadReceipt(
        messages,
        1,
        {
            readerId: 2,
            throughId: 11,
            readAt,
        }
    );

    assert.equal(updated[0].readAt, readAt);
    assert.equal(updated[1].readAt, readAt);

    // Входящее сообщение не меняется.
    assert.equal(updated[2].readAt, null);

    // Другая переписка не меняется.
    assert.equal(updated[3].readAt, null);
});

test('future messages remain unread', () => {
    const updated = applyReadReceipt(
        messages,
        1,
        {
            readerId: 2,
            throughId: 10,
            readAt,
        }
    );

    assert.equal(updated[0].readAt, readAt);
    assert.equal(updated[1].readAt, null);
});

test('invalid receipts are ignored', () => {
    const updated = applyReadReceipt(
        messages,
        1,
        {
            readerId: -1,
            throughId: 100,
            readAt,
        }
    );

    assert.equal(updated, messages);
});
