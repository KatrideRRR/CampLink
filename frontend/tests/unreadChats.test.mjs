import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeUnreadCounts,
    updateUnreadCount,
    loadUnreadCounts,
    saveUnreadCounts,
    clearUnreadCounts,
} from '../src/services/unread-chats.ts';

test('unread snapshot restores valid counts', () => {
    const counts = normalizeUnreadCounts([
        { peerId: 2, unreadCount: 3 },
        { peerId: 3, unreadCount: 0 },
        { peerId: -1, unreadCount: 8 },
        { peerId: 4, unreadCount: -2 },
    ]);

    assert.deepEqual(counts, { 2: 3 });
});

test('reading one chat does not clear another', () => {
    const before = { 2: 3, 3: 1 };

    const after = updateUnreadCount(before, {
        peerId: 2,
        unreadCount: 0,
    });

    assert.deepEqual(after, { 3: 1 });
    assert.deepEqual(before, { 2: 3, 3: 1 });
});

test('new incoming messages update the badge', () => {
    const result = updateUnreadCount(
        { 2: 1 },
        { peerId: 2, unreadCount: 2 }
    );

    assert.deepEqual(result, { 2: 2 });
});

test('last known counts survive local restart', () => {
    const values = new Map();

    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };

    saveUnreadCounts(1, { 2: 4 }, storage);

    assert.deepEqual(
        loadUnreadCounts(1, storage),
        { 2: 4 }
    );

    assert.deepEqual(
        loadUnreadCounts(3, storage),
        {}
    );

    clearUnreadCounts(1, storage);

    assert.deepEqual(
        loadUnreadCounts(1, storage),
        {}
    );
});
