
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

    CREATE TABLE IF NOT EXISTS push_devices (
      provider TEXT NOT NULL,
      token TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      session_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider, token),
      FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (session_hash)
        REFERENCES sessions(token_hash) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_push_devices_user
      ON push_devices(user_id);

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id)
        REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_message_reactions_message
      ON message_reactions(message_id);

    CREATE TABLE IF NOT EXISTS message_reads (
      reader_id INTEGER NOT NULL,
      peer_id INTEGER NOT NULL,
      last_read_message_id INTEGER NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (reader_id, peer_id),
      FOREIGN KEY (reader_id)
        REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (peer_id)
        REFERENCES users(id) ON DELETE CASCADE
    );
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

    const hasReplyTo = messageColumns.some(
        column => column.name === 'reply_to_message_id'
    );

    if (!hasReplyTo) {
        db.exec(`
            ALTER TABLE messages
            ADD COLUMN reply_to_message_id INTEGER
            REFERENCES messages(id)
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
            created_at AS serverReceivedAt,
            (
                SELECT r.read_at
                FROM message_reads r
                WHERE r.reader_id = messages.recipient_id
                  AND r.peer_id = messages.sender_id
                  AND r.last_read_message_id >= messages.id
            ) AS readAt,
            reply_to_message_id AS replyToMessageId,
            (
                SELECT text FROM messages original
                WHERE original.id = messages.reply_to_message_id
            ) AS replyToText,
            (
                SELECT sender_id FROM messages original
                WHERE original.id = messages.reply_to_message_id
            ) AS replyToSenderId
        FROM messages
        WHERE id = ?
    `);

    const listReactions = db.prepare(`
        SELECT user_id AS userId, emoji
        FROM message_reactions
        WHERE message_id = ?
        ORDER BY user_id
    `);

    function decorateMessage(row) {
        if (!row) return null;
        return {
            ...row,
            reactions: listReactions.all(row.id),
        };
    }

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

        registerPushDevice(userId, sessionToken, token, provider = 'apns') {
            const sessionHash = hashToken(sessionToken);
            const session = db.prepare(`
                SELECT user_id
                FROM sessions
                WHERE token_hash = ?
                  AND expires_at > ?
            `).get(sessionHash, Date.now());

            if (!session || session.user_id !== userId) {
                throw new Error('Invalid push session');
            }

            db.prepare(`
                INSERT INTO push_devices (
                    provider, token, user_id,
                    session_hash, updated_at
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(provider, token)
                DO UPDATE SET
                    user_id = excluded.user_id,
                    session_hash = excluded.session_hash,
                    updated_at = excluded.updated_at
            `).run(
                provider,
                token,
                userId,
                sessionHash,
                new Date().toISOString()
            );
        },

        getPushDevices(userId) {
            return db.prepare(`
                SELECT p.provider, p.token
                FROM push_devices p
                JOIN sessions s
                  ON s.token_hash = p.session_hash
                WHERE p.user_id = ?
                  AND s.expires_at > ?
                ORDER BY p.updated_at DESC
            `).all(userId, Date.now());
        },

        removePushDevice(userId, provider, token) {
            db.prepare(`
                DELETE FROM push_devices
                WHERE user_id = ?
                  AND provider = ?
                  AND token = ?
            `).run(userId, provider, token);
        },

        getUnreadCounts(userId) {
            if (
                !Number.isSafeInteger(userId) ||
                userId <= 0
            ) {
                return [];
            }

            return db.prepare(`
                SELECT
                    m.sender_id AS peerId,
                    COUNT(*) AS unreadCount
                FROM messages m
                LEFT JOIN message_reads r
                    ON r.reader_id = m.recipient_id
                   AND r.peer_id = m.sender_id
                WHERE m.recipient_id = ?
                  AND m.id > COALESCE(
                      r.last_read_message_id, 0
                  )
                GROUP BY m.sender_id
            `).all(userId);
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
                        replyToMessageId = null,
                    }) {
            const normalizedClientTime =
                normalizeClientCreatedAt(clientCreatedAt);

            if (replyToMessageId !== null) {
                if (
                    !Number.isSafeInteger(replyToMessageId) ||
                    replyToMessageId <= 0
                ) {
                    throw new Error('Invalid reply target');
                }

                const original = db.prepare(`
                    SELECT id FROM messages
                    WHERE id = ?
                      AND (
                        (sender_id = ? AND recipient_id = ?)
                        OR
                        (sender_id = ? AND recipient_id = ?)
                      )
                `).get(
                    replyToMessageId,
                    senderId, recipientId,
                    recipientId, senderId
                );

                if (!original) {
                    throw new Error('Reply target not in conversation');
                }
            }

            const serverReceivedAt =
                new Date().toISOString();

            const result = db.prepare(`
    INSERT OR IGNORE INTO messages (
      sender_id,
      recipient_id,
      client_message_id,
      text,
      created_at,
      client_created_at,
      reply_to_message_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
                senderId,
                recipientId,
                clientMessageId,
                text,
                serverReceivedAt,
                normalizedClientTime,
                replyToMessageId
            );

            const row = db.prepare(`
    SELECT id, recipient_id, text,
           reply_to_message_id AS replyToMessageId
    FROM messages
    WHERE sender_id = ?
      AND client_message_id = ?
  `).get(senderId, clientMessageId);

            if (
                !row ||
                row.recipient_id !== recipientId ||
                row.text !== text ||
                row.replyToMessageId !== replyToMessageId
            ) {
                throw new Error('Message ID conflict');
            }

            return {
                created: result.changes === 1,
                message: decorateMessage(
                    selectMessage.get(row.id)
                ),
            };
        },

        toggleReaction(userId, messageId, emoji) {
            if (
                !Number.isSafeInteger(userId) ||
                !Number.isSafeInteger(messageId) ||
                !['❤️', '🔥', '💩', '🫡'].includes(emoji)
            ) {
                return null;
            }

            const message = db.prepare(`
                SELECT sender_id AS senderId,
                       recipient_id AS recipientId
                FROM messages
                WHERE id = ?
            `).get(messageId);

            if (
                !message ||
                (
                    message.senderId !== userId &&
                    message.recipientId !== userId
                )
            ) {
                return null;
            }

            const update = db.transaction(() => {
                const previous = db.prepare(`
                    SELECT emoji FROM message_reactions
                    WHERE message_id = ? AND user_id = ?
                `).get(messageId, userId);

                if (previous?.emoji === emoji) {
                    db.prepare(`
                        DELETE FROM message_reactions
                        WHERE message_id = ? AND user_id = ?
                    `).run(messageId, userId);
                } else {
                    db.prepare(`
                        INSERT INTO message_reactions (
                            message_id, user_id,
                            emoji, created_at
                        ) VALUES (?, ?, ?, ?)
                        ON CONFLICT(message_id, user_id)
                        DO UPDATE SET
                            emoji = excluded.emoji,
                            created_at = excluded.created_at
                    `).run(
                        messageId,
                        userId,
                        emoji,
                        new Date().toISOString()
                    );
                }
            });

            update();

            return {
                messageId,
                ...message,
                reactions: listReactions.all(messageId),
            };
        },

        markConversationRead(readerId, peerId, throughId) {
            if (
                !Number.isSafeInteger(readerId) ||
                !Number.isSafeInteger(peerId) ||
                !Number.isSafeInteger(throughId) ||
                readerId <= 0 ||
                peerId <= 0 ||
                throughId <= 0 ||
                readerId === peerId
            ) {
                return null;
            }

            const target = db.prepare(`
                SELECT id FROM messages
                WHERE id = ?
                  AND sender_id = ?
                  AND recipient_id = ?
            `).get(throughId, peerId, readerId);

            if (!target) return null;

            const readAt = new Date().toISOString();

            const result = db.prepare(`
                INSERT INTO message_reads (
                    reader_id, peer_id,
                    last_read_message_id, read_at
                )
                VALUES (?, ?, ?, ?)
                ON CONFLICT(reader_id, peer_id)
                DO UPDATE SET
                    last_read_message_id =
                        excluded.last_read_message_id,
                    read_at = excluded.read_at
                WHERE excluded.last_read_message_id >
                    message_reads.last_read_message_id
            `).run(
                readerId, peerId, throughId, readAt
            );

            return {
                changed: result.changes > 0,
                readerId,
                peerId,
                throughId,
                readAt,
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
                    created_at AS serverReceivedAt,
                    (
                        SELECT r.read_at
                        FROM message_reads r
                        WHERE r.reader_id = messages.recipient_id
                          AND r.peer_id = messages.sender_id
                          AND r.last_read_message_id >= messages.id
                    ) AS readAt,
                    reply_to_message_id AS replyToMessageId,
                    (
                        SELECT text FROM messages original
                        WHERE original.id = messages.reply_to_message_id
                    ) AS replyToText,
                    (
                        SELECT sender_id FROM messages original
                        WHERE original.id = messages.reply_to_message_id
                    ) AS replyToSenderId
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

            return rows.reverse().map(decorateMessage);
        },

        close() {
            db.close();
        },
    };
}
