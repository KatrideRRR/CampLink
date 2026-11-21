import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildMessagePushPayload,
} from '../src/push-payload.js';

test('push shows sender and message text', () => {
    const result = buildMessagePushPayload(
        {
            id: 42,
            senderId: 7,
            text: 'Привет! Завтра в 10 встречаемся?',
        },
        'emir'
    );

    assert.deepEqual(result, {
        notification: {
            title: '@emir',
            body: 'Привет! Завтра в 10 встречаемся?',
        },
        data: {
            peerId: '7',
            messageId: '42',
        },
    });
});

test('multiline text is readable in notification', () => {
    const result = buildMessagePushPayload(
        {
            id: 1,
            senderId: 2,
            text: 'Первая строка\nВторая строка',
        },
        'akim'
    );

    assert.equal(
        result.notification.body,
        'Первая строка Вторая строка'
    );
});

test('long messages are safely shortened', () => {
    const result = buildMessagePushPayload(
        {
            id: 3,
            senderId: 2,
            text: '🔥'.repeat(300),
        },
        'emir'
    );

    assert.equal(
        Array.from(result.notification.body).length,
        160
    );

    assert.ok(
        result.notification.body.endsWith('…')
    );
});

test('invalid sender name uses a safe fallback', () => {
    const result = buildMessagePushPayload(
        { id: 1, senderId: 2, text: 'Привет' },
        null
    );

    assert.equal(
        result.notification.title,
        'Пользователь'
    );
});
