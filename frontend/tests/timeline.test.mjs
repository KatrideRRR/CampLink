
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildChatTimeline,
} from '../src/services/timeline.ts';

function confirmed(
    id,
    senderId,
    recipientId,
    time,
    text
) {
    return {
        id,
        senderId,
        recipientId,
        clientMessageId: `message-${id}`,
        text,
        createdAt: `2026-11-18T${time}Z`,
    };
}

test('alternating senders stay chronological', () => {
    const messages = [
        confirmed(3, 1, 2, '14:03:00', 'Третье'),
        confirmed(1, 1, 2, '14:01:00', 'Первое'),
        confirmed(2, 2, 1, '14:02:00', 'Второе'),
    ];

    const timeline = buildChatTimeline(
        messages,
        [],
        1,
        2
    );

    assert.deepEqual(
        timeline.map((item) => item.message.text),
        ['Первое', 'Второе', 'Третье']
    );
});

test('pending message keeps its chronological place', () => {
    const messages = [
        confirmed(1, 1, 2, '14:01:00', 'Первое'),
        confirmed(3, 2, 1, '14:03:00', 'Третье'),
    ];

    const pending = [{
        clientMessageId: 'pending-2',
        toUserId: 2,
        text: 'Второе',
        createdAt: '2026-11-18T14:02:00Z',
    }];

    const timeline = buildChatTimeline(
        messages,
        pending,
        1,
        2
    );

    assert.deepEqual(
        timeline.map((item) => item.message.text),
        ['Первое', 'Второе', 'Третье']
    );

    assert.deepEqual(
        timeline.map((item) => item.status),
        ['confirmed', 'pending', 'confirmed']
    );
});

test('confirmation replaces pending without duplication', () => {
    const message = confirmed(
        5,
        1,
        2,
        '14:02:00',
        'Подтверждено'
    );

    const pending = [{
        clientMessageId: message.clientMessageId,
        toUserId: 2,
        text: 'Подтверждено',
        createdAt: '2026-11-18T14:01:59Z',
    }];

    const timeline = buildChatTimeline(
        [message],
        pending,
        1,
        2
    );

    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].status, 'confirmed');
});

test('equal timestamps use server message ID', () => {
    const messages = [
        confirmed(9, 1, 2, '14:00:00', 'Позже'),
        confirmed(7, 2, 1, '14:00:00', 'Раньше'),
    ];

    const timeline = buildChatTimeline(
        messages,
        [],
        1,
        2
    );

    assert.deepEqual(
        timeline.map((item) => item.message.id),
        [7, 9]
    );
});

test('messages from other conversations are excluded', () => {
    const messages = [
        confirmed(1, 1, 2, '14:00:00', 'Нужное'),
        confirmed(2, 1, 3, '14:01:00', 'Чужой чат'),
    ];

    const timeline = buildChatTimeline(
        messages,
        [],
        1,
        2
    );

    assert.deepEqual(
        timeline.map((item) => item.message.text),
        ['Нужное']
    );
});
