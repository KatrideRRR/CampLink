import test from 'node:test';
import assert from 'node:assert/strict';

import {
    sortChatList,
    readChatList,
    saveChatList,
} from '../src/services/chat-list.ts';

test('most recently active conversation comes first', () => {
    const peers = [
        { id: 1, username: 'eldar', lastMessageId: 11 },
        { id: 2, username: 'emir', lastMessageId: 20 },
        { id: 3, username: 'erlan', lastMessageId: null },
    ];

    assert.deepEqual(
        sortChatList(peers).map(peer => peer.username),
        ['emir', 'eldar', 'erlan']
    );
});

test('personal chat cache ignores old global user cache', () => {
    const values = new Map();

    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };

    values.set(
        'camplink.offline.data.v1.1',
        JSON.stringify({ contacts: [
            { id: 2, username: 'emir' },
            { id: 3, username: 'erlan' },
        ] })
    );

    assert.deepEqual(readChatList(1, storage), []);

    saveChatList(1, [
        { id: 2, username: 'emir', lastMessageId: 12 },
    ], storage);

    assert.deepEqual(
        readChatList(1, storage).map(peer => peer.username),
        ['emir']
    );
});
