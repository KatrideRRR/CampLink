
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildSnapshot,
    restoreSnapshot,
} from '../src/services/native-cache-model.ts';

function storage() {
    const values = new Map();

    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
    };
}

test('native snapshot preserves chats and outbox', () => {
    const oldStore = storage();

    oldStore.setItem(
        'camplink.offline.profile.v1',
        JSON.stringify({
            user: { id: 1, username: 'akim' },
            verifiedAt: Date.now(),
        })
    );

    oldStore.setItem(
        'camplink.offline.data.v1.1',
        JSON.stringify({
            contacts: [{ id: 2, username: 'worker' }],
            threads: {},
        })
    );

    oldStore.setItem(
        'camplink.outbox.v1.1',
        JSON.stringify([{
            clientMessageId:
                '00000000-0000-4000-8000-000000000001',
            toUserId: 2,
            text: 'Офлайн-сообщение',
            createdAt: new Date().toISOString(),
        }])
    );

    const snapshot = buildSnapshot(1, oldStore);

    assert.ok(snapshot);
    assert.equal(buildSnapshot(2, oldStore), null);

    const newStore = storage();

    assert.equal(
        restoreSnapshot(snapshot, newStore),
        true
    );

    const queue = JSON.parse(
        newStore.getItem('camplink.outbox.v1.1')
    );

    assert.equal(queue.length, 1);
    assert.equal(
        queue[0].text,
        'Офлайн-сообщение'
    );

    // Do not overwrite newer local messages.
    newStore.setItem('camplink.outbox.v1.1', '[]');

    assert.equal(
        restoreSnapshot(snapshot, newStore),
        true
    );

    assert.equal(
        newStore.getItem('camplink.outbox.v1.1'),
        '[]'
    );

    // Do not import another user's data.
    const anotherUser = storage();

    anotherUser.setItem(
        'camplink.offline.profile.v1',
        JSON.stringify({
            user: { id: 99, username: 'another' },
            verifiedAt: Date.now(),
        })
    );

    assert.equal(
        restoreSnapshot(snapshot, anotherUser),
        false
    );
});
