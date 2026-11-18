
import Database from 'better-sqlite3';
import {
    randomBytes,
    scryptSync,
    timingSafeEqual,
    createHash,
} from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DB_PATH = fileURLToPath(
    new URL('../data/camplink.sqlite', import.meta.url)
);

const hashToken = (token) =>
    createHash('sha256').update(token).digest('hex');

function publicUser(row) {
    if (!row) return null;

    return {
        id: row.id,
        username: row.username,
        createdAt: row.created_at,
    };
}

function normalizeClientCreatedAt(value) {
    // Compatibility with previously created messages.
    if (value === undefined || value === null) {
        return null;
    }

    // ISO 8601 with an explicit timezone.
    const isoPattern =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

    if (
        typeof value !== 'string' ||
        !isoPattern.test(value)
    ) {
        throw new Error('Invalid client creation time');
    }

    const timestamp = Date.parse(value);

    if (!Number.isFinite(timestamp)) {
        throw new Error('Invalid client creation time');
    }

    // Always store an absolute UTC timestamp.
    return new Date(timestamp).toISOString();
}

export function createStore(databasePath = DEFAULT_DB_PATH) {
    if (databasePath !== ':memory:') {
        mkdirSync(dirname(databasePath), { recursive: true });
    }

    const db = new Database(databasePath);
    db.pragma('foreign_keys = ON');

    if (databasePath !== ':memory:') {
        db.pragma('journal_mode = WAL');
    }

    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      client_message_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (recipient_id) REFERENCES users(id),
      UNIQUE(sender_id, client_message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_sender
      ON messages(sender_id, recipient_id, id);

    CREATE INDEX IF NOT EXISTS idx_messages_recipient
      ON messages(recipient_id, sender_id, id);
  `);

    const messageColumns = db.pragma(
        'table_info(messages)'
    );

    const hasClientCreatedAt = messageColumns.some(
        (column) => column.name === 'client_created_at'
    );

    if (!hasClientCreatedAt) {
        db.exec(`
    ALTER TABLE messages
    ADD COLUMN client_created_at TEXT
  `);
    }

    const selectMessage = db.prepare(`
        SELECT
            id,
            sender_id AS senderId,
            recipient_id AS recipientId,
            client_message_id AS clientMessageId,
            text,
            COALESCE(
                    client_created_at,
                    created_at
            ) AS createdAt,
            client_created_at AS clientCreatedAt,
            created_at AS serverReceivedAt
        FROM messages
        WHERE id = ?
    `);

    return {
        createUser(username, password) {
            if (
                typeof username !== 'string' ||
                !/^[a-z0-9_]{3,24}$/.test(username) ||
                typeof password !== 'string' ||
                password.length < 12
            ) {
                throw new Error('Invalid user credentials');
            }

            const salt = randomBytes(16).toString('hex');
            const passwordHash = scryptSync(
                password,
                salt,
                64
            ).toString('hex');

            const createdAt = new Date().toISOString();

            const result = db.prepare(`
        INSERT INTO users (
          username, password_salt,
          password_hash, created_at
        )
        VALUES (?, ?, ?, ?)
      `).run(username, salt, passwordHash, createdAt);

            return this.getUserById(Number(result.lastInsertRowid));
        },

        getUserById(id) {
            const row = db.prepare(
                'SELECT * FROM users WHERE id = ?'
            ).get(id);

            return publicUser(row);
        },

        verifyCredentials(username, password) {
            if (
                typeof username !== 'string' ||
                typeof password !== 'string'
            ) {
                return null;
            }

            const row = db.prepare(
                'SELECT * FROM users WHERE username = ?'
            ).get(username);

            if (!row) return null;

            const computed = scryptSync(
                password,
                row.password_salt,
                64
            );

            const expected = Buffer.from(
                row.password_hash,
                'hex'
            );

            if (!timingSafeEqual(computed, expected)) {
                return null;
            }

            return publicUser(row);
        },

        createSession(userId) {
            const token = randomBytes(32).toString('hex');
            const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

            db.prepare(`
        INSERT INTO sessions
          (token_hash, user_id, expires_at)
        VALUES (?, ?, ?)
      `).run(hashToken(token), userId, expiresAt);

            return token;
        },

        getSessionUser(token) {
            if (
                typeof token !== 'string' ||
                !/^[a-f0-9]{64}$/.test(token)
            ) {
                return null;
            }

            const row = db.prepare(`
        SELECT u.*
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.expires_at > ?
      `).get(hashToken(token), Date.now());

            return publicUser(row);
        },

        deleteSession(token) {
            if (!token || !/^[a-f0-9]{64}$/.test(token)) {
                return;
            }

            db.prepare(
                'DELETE FROM sessions WHERE token_hash = ?'
            ).run(hashToken(token));
        },

        listUsers(excludeId) {
            return db.prepare(`
        SELECT id, username, created_at AS createdAt
        FROM users
        WHERE id != ?
        ORDER BY username
      `).all(excludeId);
        },

        saveMessage({
                        senderId,
                        recipientId,
                        clientMessageId,
                        text,
                        clientCreatedAt,
                    }) {
            const normalizedClientTime =
                normalizeClientCreatedAt(clientCreatedAt);

            const serverReceivedAt =
                new Date().toISOString();

            const result = db.prepare(`
    INSERT OR IGNORE INTO messages (
      sender_id,
      recipient_id,
      client_message_id,
      text,
      created_at,
      client_created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
                senderId,
                recipientId,
                clientMessageId,
                text,
                serverReceivedAt,
                normalizedClientTime
            );

            const row = db.prepare(`
    SELECT id, recipient_id, text
    FROM messages
    WHERE sender_id = ?
      AND client_message_id = ?
  `).get(senderId, clientMessageId);

            if (
                !row ||
                row.recipient_id !== recipientId ||
                row.text !== text
            ) {
                throw new Error('Message ID conflict');
            }

            return {
                created: result.changes === 1,
                message: selectMessage.get(row.id),
            };
        },

        getConversation(userId, peerId) {
            const rows = db.prepare(`
                SELECT
                    id,
                    sender_id AS senderId,
                    recipient_id AS recipientId,
                    client_message_id AS clientMessageId,
                    text,
                    COALESCE(
                            client_created_at,
                            created_at
                    ) AS createdAt,
                    client_created_at AS clientCreatedAt,
                    created_at AS serverReceivedAt
                FROM messages
                WHERE
                    (sender_id = ? AND recipient_id = ?)
                   OR
                    (sender_id = ? AND recipient_id = ?)
                ORDER BY
                    COALESCE(client_created_at, created_at) DESC,
                    id DESC
                    LIMIT 100
            `).all(userId, peerId, peerId, userId);

            return rows.reverse();
        },

        close() {
            db.close();
        },
    };
}
