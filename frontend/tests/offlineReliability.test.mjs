import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createSnapshotWriteQueue,
} from '../src/services/snapshot-write-queue.ts';

import {
    selectNextPendingMessage,
} from '../src/services/outbox-selection.ts';

function message(id, toUserId) {
    return {
        clientMessageId: id,
        toUserId,
        text: `Сообщение ${id}`,
        createdAt: new Date().toISOString(),
    };
}

test('backup snapshots are written in order', async () => {
    const events = [];
    let releaseFirst;

    const firstGate = new Promise(resolve => {
        releaseFirst = resolve;
    });

    const queue = createSnapshotWriteQueue(
        async snapshot => {
            events.push(`start:${snapshot}`);

            if (snapshot === 'old') {
                await firstGate;
            }

            events.push(`done:${snapshot}`);
        }
    );

    const first = queue.save('old');
    const second = queue.save('new');

    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(events, ['start:old']);

    releaseFirst();

    await Promise.all([first, second]);

    assert.deepEqual(events, [
        'start:old',
        'done:old',
        'start:new',
        'done:new',
    ]);

    await queue.save('new');

    assert.equal(events.length, 4);
});

test('failed snapshot does not block later backups', async () => {
    const written = [];

    const queue = createSnapshotWriteQueue(
        async value => {
            if (value === 'broken') {
                throw new Error('Storage unavailable');
            }

            written.push(value);
        }
    );

    await assert.rejects(queue.save('broken'));

    await queue.save('recovered');

    assert.deepEqual(written, ['recovered']);
});

test('rejected recipient does not block other recipients', () => {
    const messages = [
        message('old-worker', 2),
        message('to-emir', 3),
        message('to-eldar', 4),
    ];

    const rejected = new Set(['old-worker']);

    const next = selectNextPendingMessage(
        messages,
        true,
        new Set(),
        rejected
    );

    assert.equal(next.clientMessageId, 'to-emir');

    rejected.add('to-emir');

    assert.equal(
        selectNextPendingMessage(
            messages,
            true,
            new Set(),
            rejected
        ).clientMessageId,
        'to-eldar'
    );

    assert.equal(messages.length, 3);
});

test('relay queue is skipped until reconnect', () => {
    const messages = [
        message('relayed', 3),
        message('waiting', 4),
    ];

    const relayed = new Set(['relayed']);

    assert.equal(
        selectNextPendingMessage(
            messages,
            false,
            relayed,
            new Set()
        ).clientMessageId,
        'waiting'
    );

    assert.equal(
        selectNextPendingMessage(
            messages,
            true,
            relayed,
            new Set()
        ).clientMessageId,
        'relayed'
    );
});
