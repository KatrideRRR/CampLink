import Database from 'better-sqlite3';
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

test('legacy message database migrates safely', () => {
    const directory = mkdtempSync(
        join(tmpdir(), 'camplink-migration-')
    );

    const dbPath = join(directory, 'legacy.sqlite');

    let store;

    try {
        // Simulate the old database schema.
        const legacy = new Database(dbPath);

        legacy.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        client_message_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(sender_id, client_message_id)
      );

      INSERT INTO messages (
        sender_id,
        recipient_id,
        client_message_id,
        text,
        created_at
      )
      VALUES (
        1,
        2,
        'legacy-message-1',
        'Старое сообщение',
        '2026-11-18T12:00:00.000Z'
      );
    `);

        legacy.close();

        // Startup must add the new column automatically.
        store = createStore(dbPath);

        const messages = store.getConversation(1, 2);

        assert.equal(messages.length, 1);
        assert.equal(
            messages[0].text,
            'Старое сообщение'
        );

        assert.equal(
            messages[0].createdAt,
            '2026-11-18T12:00:00.000Z'
        );

        assert.equal(
            messages[0].clientCreatedAt,
            null
        );

        store.close();
        store = null;

        // Repeated startup must also succeed.
        store = createStore(dbPath);

        assert.equal(
            store.getConversation(1, 2).length,
            1
        );
    } finally {
        store?.close();

        rmSync(directory, {
            recursive: true,
            force: true,
        });
    }
});

