
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';

test('users and messages survive database reopening', () => {
    const directory = mkdtempSync(
        join(tmpdir(), 'camplink-test-')
    );

    const dbPath = join(directory, 'test.sqlite');

    let store;

    try {
        store = createStore(dbPath);

        const first = store.createUser(
            'first',
            'strong-password-123'
        );

        const second = store.createUser(
            'second',
            'strong-password-456'
        );

        assert.equal(
            store.verifyCredentials(
                'first',
                'strong-password-123'
            )?.id,
            first.id
        );

        assert.equal(
            store.verifyCredentials(
                'first',
                'wrong-password'
            ),
            null
        );

        const result = store.saveMessage({
            senderId: first.id,
            recipientId: second.id,
            clientMessageId: randomUUID(),
            text: 'Persistent message',
        });

        assert.equal(result.created, true);

        store.close();
        store = null;

        store = createStore(dbPath);

        const messages = store.getConversation(
            first.id,
            second.id
        );

        assert.equal(messages.length, 1);
        assert.equal(
            messages[0].text,
            'Persistent message'
        );
    } finally {
        store?.close();

        rmSync(directory, {
            recursive: true,
            force: true,
        });
    }
});
