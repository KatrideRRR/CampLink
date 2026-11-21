import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parsePushChatTarget,
} from '../src/services/push-navigation.ts';

test('push opens the correct chat and message', () => {
    const result = parsePushChatTarget({
        peerId: '12',
        messageId: '345',
    });

    assert.deepEqual(result, {
        peerId: 12,
        messageId: 345,
    });
});

test('old push notifications still open a chat', () => {
    const result = parsePushChatTarget({
        peerId: '12',
    });

    assert.deepEqual(result, {
        peerId: 12,
        messageId: null,
    });
});

test('malformed push data cannot select a chat', () => {
    assert.equal(
        parsePushChatTarget({ peerId: '-1' }),
        null
    );

    assert.equal(
        parsePushChatTarget({ peerId: '999999999999999999' }),
        null
    );

    assert.equal(
        parsePushChatTarget(null),
        null
    );
});

test('invalid message id does not block chat navigation', () => {
    assert.deepEqual(
        parsePushChatTarget({
            peerId: '5',
            messageId: 'not-a-number',
        }),
        {
            peerId: 5,
            messageId: null,
        }
    );
});
