
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clearOfflineCache,
    decideSession,
    readOfflineContacts,
    readOfflineMessages,
    readOfflineUser,
    saveOfflineContacts,
    saveOfflineMessages,
    saveOfflineUser,
} from '../src/services/offline.ts';

function createStorage() {
    const values = new Map();

    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
        removeItem: (key) => {
            values.delete(key);
        },
    };
}

const akim = { id: 1, username: 'akim' };
const worker = { id: 2, username: 'worker' };
const outsider = { id: 3, username: 'outsider' };

function createMessage(id, senderId = 1, recipientId = 2) {
    return {
        id,
        senderId,
        recipientId,
        clientMessageId:
            `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
        text: `Сообщение ${id}`,
        createdAt: '2026-11-18T12:00:00.000Z',
    };
}

test('offline profile survives reload without credentials', () => {
    const storage = createStorage();
    const now = Date.now();

    saveOfflineUser(akim, storage, now);

    assert.deepEqual(
        readOfflineUser(storage, now),
        akim
    );

    assert.equal(
        storage.getItem('camplink.offline.profile.v1')
            .includes('password'),
        false
    );
});

test('offline profile expires after seven days', () => {
    const storage = createStorage();
    const now = Date.now();

    saveOfflineUser(akim, storage, now);

    const eightDays = 8 * 24 * 60 * 60 * 1000;

    assert.equal(
        readOfflineUser(storage, now + eightDays),
        null
    );
});

test('server outage does not log out cached user', () => {
    const result = decideSession('unreachable', akim);

    assert.deepEqual(result.user, akim);
    assert.equal(result.offline, true);
    assert.equal(result.invalidate, false);
});

test('explicit unauthorized response requires login', () => {
    const result = decideSession(401, akim);

    assert.equal(result.user, null);
    assert.equal(result.offline, false);
    assert.equal(result.invalidate, true);
});

test('successful server response restores online identity', () => {
    const result = decideSession(200, akim, worker);

    assert.deepEqual(result.user, worker);
    assert.equal(result.offline, false);
});

test('contacts are stored separately per user', () => {
    const storage = createStorage();

    saveOfflineContacts(1, [worker, outsider], storage);
    saveOfflineContacts(2, [akim], storage);

    assert.equal(
        readOfflineContacts(1, storage).length,
        2
    );

    assert.deepEqual(
        readOfflineContacts(2, storage),
        [akim]
    );
});

test('messages survive reload and remain isolated', () => {
    const storage = createStorage();

    saveOfflineMessages(
        1,
        2,
        [createMessage(1), createMessage(2)],
        storage
    );

    const restored = readOfflineMessages(1, 2, storage);

    assert.equal(restored.length, 2);
    assert.equal(restored[0].text, 'Сообщение 1');

    assert.deepEqual(
        readOfflineMessages(3, 2, storage),
        []
    );
});

test('message cache removes duplicates and keeps latest 50', () => {
    const storage = createStorage();

    const messages = Array.from(
        { length: 55 },
        (_, index) => createMessage(index + 1)
    );

    saveOfflineMessages(1, 2, messages, storage);
    saveOfflineMessages(1, 2, [createMessage(55)], storage);

    const result = readOfflineMessages(1, 2, storage);

    assert.equal(result.length, 50);
    assert.equal(result[0].id, 6);
    assert.equal(result.at(-1).id, 55);
});

test('foreign conversation messages are not cached', () => {
    const storage = createStorage();

    saveOfflineMessages(
        1,
        2,
        [createMessage(1, 3, 2)],
        storage
    );

    assert.deepEqual(
        readOfflineMessages(1, 2, storage),
        []
    );
});

test('logout clears the cached profile and history', () => {
    const storage = createStorage();

    saveOfflineUser(akim, storage);
    saveOfflineContacts(1, [worker], storage);
    saveOfflineMessages(
        1,
        2,
        [createMessage(1)],
        storage
    );

    clearOfflineCache(1, storage);

    assert.equal(readOfflineUser(storage), null);
    assert.deepEqual(readOfflineContacts(1, storage), []);
    assert.deepEqual(readOfflineMessages(1, 2, storage), []);
});

test('corrupted local data cannot crash cache loading', () => {
    const storage = createStorage();

    storage.setItem(
        'camplink.offline.profile.v1',
        '{broken'
    );

    storage.setItem(
        'camplink.offline.data.v1.1',
        '{broken'
    );

    assert.equal(readOfflineUser(storage), null);
    assert.deepEqual(readOfflineContacts(1, storage), []);
    assert.deepEqual(readOfflineMessages(1, 2, storage), []);
});
