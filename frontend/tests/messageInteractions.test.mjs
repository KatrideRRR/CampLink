import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isRightSwipe,
    isBackSwipe,
    applyReactionUpdate,
    ACKNOWLEDGED_REACTION,
    REACTION_CHOICES,
} from '../src/services/message-interactions.ts';

import {
    enqueueOutboxMessage,
    readOutbox,
} from '../src/services/outbox.ts';

test('message swipe is distinct from edge navigation', () => {
    assert.equal(isRightSwipe(90, 8), true);
    assert.equal(isRightSwipe(20, 5), false);
    assert.equal(isRightSwipe(100, 90), false);

    assert.equal(isBackSwipe(12, 110, 12), true);
    assert.equal(isBackSwipe(80, 110, 12), false);
    assert.equal(isBackSwipe(12, 30, 2), false);
});

test('double tap uses the acknowledge reaction', () => {
    assert.equal(ACKNOWLEDGED_REACTION, '🫡');
    assert.deepEqual(
        REACTION_CHOICES,
        ['❤️', '🔥', '💩']
    );
});

test('reaction update changes only matching message', () => {
    const messages = [
        { id: 10, text: 'Первое', reactions: [] },
        { id: 11, text: 'Второе', reactions: [] },
    ];

    const changed = applyReactionUpdate(
        messages,
        {
            messageId: 10,
            senderId: 1,
            recipientId: 2,
            reactions: [
                { userId: 2, emoji: '🫡' },
            ],
        }
    );

    assert.equal(changed[0].reactions.length, 1);
    assert.equal(changed[1].reactions.length, 0);
    assert.equal(messages[0].reactions.length, 0);
});

test('offline reply preserves its original reference', () => {
    const values = new Map();

    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };

    const reply = {
        clientMessageId:
            '00000000-0000-4000-8000-000000000123',
        toUserId: 2,
        text: 'Хорошо, договорились',
        createdAt: '2026-11-20T19:00:00.000Z',
        replyToMessageId: 42,
        replyToSenderId: 2,
        replyToText: 'Давай завтра в 10',
    };

    enqueueOutboxMessage(1, reply, storage);

    assert.deepEqual(
        readOutbox(1, storage)[0],
        reply
    );
});
