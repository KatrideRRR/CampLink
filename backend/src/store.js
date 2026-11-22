
import Database from 'better-sqlite3';
import {
    randomBytes,
    scryptSync,
    timingSafeEqual,
    createHash,
} from 'node:crypto';
import { mkdirSync } from 'node:fs';
import {
    normalizePhone,
    validateRegistration,
} from './registration.js';
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
        displayName: row.display_name ?? row.username,
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

    CREATE TABLE IF NOT EXISTS user_contacts (
      owner_id INTEGER NOT NULL,
      peer_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, peer_id),
      CHECK (owner_id <> peer_id),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (peer_id) REFERENCES users(id)
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

    CREATE TABLE IF NOT EXISTS media_attachments (
      id TEXT PRIMARY KEY,
      message_id INTEGER NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'voice')),
      mime_type TEXT NOT NULL,
      file_name TEXT NOT NULL UNIQUE,
      bytes INTEGER NOT NULL CHECK (bytes > 0),
      FOREIGN KEY (message_id)
        REFERENCES messages(id) ON DELETE CASCADE
    );

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

    const userColumns = db.pragma('table_info(users)');

    if (!userColumns.some(c => c.name === 'email')) {
        db.exec('ALTER TABLE users ADD COLUMN email TEXT');
    }

    if (!userColumns.some(c => c.name === 'phone')) {
        db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    }

    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS
            idx_users_email_unique ON users(email);
        CREATE UNIQUE INDEX IF NOT EXISTS
            idx_users_phone_unique ON users(phone);
    `);

    if (!userColumns.some(c => c.name === 'display_name')) {
        db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
    }

    if (!userColumns.some(c => c.name === 'display_name_search')) {
        db.exec(
            'ALTER TABLE users ADD COLUMN display_name_search TEXT'
        );
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

    const selectMedia = db.prepare(`
        SELECT id, kind, mime_type AS mimeType, bytes
        FROM media_attachments
        WHERE message_id = ?
    `);

    const listReactions = db.prepare(`
        SELECT user_id AS userId, emoji
        FROM message_reactions
        WHERE message_id = ?
        ORDER BY user_id
    `);

    function decorateMessage(row) {
        if (!row) return null;
        const media = selectMedia.get(row.id);

        return {
            ...row,
            ...(media ? { media } : {}),
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

        registerUser(input) {
            const data = validateRegistration(input);

            if (!data) {
                throw new Error('Invalid registration');
            }

            // Technical login remains compatible with older accounts.
            const username = data.username ??
                'cl_' + randomBytes(8).toString('hex');

            const salt = randomBytes(16).toString('hex');
            const passwordHash = scryptSync(
                data.password, salt, 64
            ).toString('hex');

            const createdAt = new Date().toISOString();

            const result = db.prepare(`
                INSERT INTO users (
                    username,
                    display_name,
                    display_name_search,
                    email,
                    phone,
                    password_salt,
                    password_hash,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                username,
                data.displayName,
                data.displayName.toLocaleLowerCase('ru'),
                data.email,
                data.phone,
                salt,
                passwordHash,
                createdAt
            );

            return this.getUserById(
                Number(result.lastInsertRowid)
            );
        },

        suggestUsers(viewerId, query) {
            if (
                !Number.isSafeInteger(viewerId) ||
                typeof query !== 'string'
            ) {
                return [];
            }

            const text = query.trim()
                .replace(/\s+/g, ' ')
                .toLocaleLowerCase('ru');

            // A # prefix distinguishes user IDs from phones.
            if (/^#[1-9]\d{0,14}$/.test(text)) {
                const id = Number(text.slice(1));

                if (!Number.isSafeInteger(id)) {
                    return [];
                }

                const user = db.prepare(`
                    SELECT
                        id,
                        username,
                        COALESCE(
                            display_name, username
                        ) AS displayName
                    FROM users
                    WHERE id = ? AND id <> ?
                `).get(id, viewerId);

                return user ? [user] : [];
            }

            const name = text.replace(/^@/, '');
            const digits = text.replace(/\D/g, '');
            const clauses = [];
            const values = [];

            if (/^[a-z0-9_]{3,24}$/.test(name)) {
                clauses.push('instr(username, ?) = 1');
                values.push(name);
            }

            if (
                text.length >= 3 &&
                text.length <= 60 &&
                /^[\p{L}\p{M}\p{N} .'-]+$/u.test(text)
            ) {
                clauses.push(
                    'instr(display_name_search, ?) > 0'
                );
                values.push(text);
            }

            if (
                text.length >= 5 &&
                text.length <= 64 &&
                /^[a-z0-9._%+@-]+$/.test(text)
            ) {
                clauses.push('instr(email, ?) = 1');
                values.push(text);
            }

            if (
                digits.length >= 7 &&
                digits.length <= 15 &&
                /^[\d\s+()-]+$/.test(text)
            ) {
                clauses.push(
                    "instr(replace(phone, '+', ''), ?) > 0"
                );
                values.push(digits);
            }

            if (!clauses.length) return [];

            return db.prepare(`
                SELECT
                    id,
                    username,
                    COALESCE(display_name, username) AS displayName
                FROM users
                WHERE id != ?
                  AND (${clauses.join(' OR ')})
                ORDER BY username
                LIMIT 8
            `).all(viewerId, ...values);
        },

        getUserById(id) {
            const row = db.prepare(
                'SELECT * FROM users WHERE id = ?'
            ).get(id);

            return publicUser(row);
        },

        verifyCredentials(username, password, options = {}) {
            if (
                typeof username !== 'string' ||
                typeof password !== 'string'
            ) {
                return null;
            }

            const identifier =
                username.trim().toLowerCase();

            const phone = normalizePhone(identifier);

            const row = options.emailOrPhoneOnly
                ? db.prepare(`
                    SELECT * FROM users
                    WHERE email = ? OR phone = ?
                    LIMIT 1
                `).get(identifier, phone)
                : db.prepare(`
                    SELECT * FROM users
                    WHERE username = ?
                       OR email = ?
                       OR phone = ?
                    LIMIT 1
                `).get(identifier, identifier, phone);

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

        findUserByUsername(username) {
            if (
                typeof username !== 'string' ||
                !/^[a-z0-9_]{3,24}$/.test(username)
            ) {
                return null;
            }

            return publicUser(
                db.prepare(
                    'SELECT * FROM users WHERE username = ?'
                ).get(username)
            );
        },

        addContact(ownerId, peerId) {
            if (
                !Number.isSafeInteger(ownerId) ||
                !Number.isSafeInteger(peerId) ||
                ownerId <= 0 ||
                peerId <= 0 ||
                ownerId === peerId ||
                !this.getUserById(peerId)
            ) {
                return false;
            }

            db.prepare(`
                INSERT OR IGNORE INTO user_contacts (
                    owner_id, peer_id, created_at
                )
                VALUES (?, ?, ?)
            `).run(
                ownerId,
                peerId,
                new Date().toISOString()
            );

            return true;
        },

        listChats(userId) {
            return db.prepare(`
                SELECT
                    u.id,
                    u.username,
                    COALESCE(
                        u.display_name, u.username
                    ) AS displayName,
                    (
                        SELECT MAX(m.id)
                        FROM messages m
                        WHERE
                            (m.sender_id = ?
                             AND m.recipient_id = u.id)
                            OR
                            (m.recipient_id = ?
                             AND m.sender_id = u.id)
                    ) AS lastMessageId
                FROM users u
                WHERE u.id != ?
                  AND (
                      EXISTS (
                          SELECT 1
                          FROM user_contacts c
                          WHERE c.owner_id = ?
                            AND c.peer_id = u.id
                      )
                      OR EXISTS (
                          SELECT 1
                          FROM messages m
                          WHERE
                              (m.sender_id = ?
                               AND m.recipient_id = u.id)
                              OR
                              (m.recipient_id = ?
                               AND m.sender_id = u.id)
                      )
                  )
                ORDER BY
                    lastMessageId DESC,
                    u.username COLLATE NOCASE ASC
            `).all(
                userId, userId, userId,
                userId, userId, userId
            );
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

        saveMediaMessage({
            senderId,
            recipientId,
            clientMessageId,
            clientCreatedAt,
            replyToMessageId = null,
            mediaId,
            kind,
            mimeType,
            fileName,
            bytes,
        }) {
            if (
                !['image', 'voice'].includes(kind) ||
                typeof mediaId !== 'string' ||
                typeof mimeType !== 'string' ||
                typeof fileName !== 'string' ||
                !Number.isSafeInteger(bytes) ||
                bytes <= 0
            ) {
                throw new Error('Invalid attachment');
            }

            return db.transaction(() => {
                const result = this.saveMessage({
                    senderId,
                    recipientId,
                    clientMessageId,
                    clientCreatedAt,
                    replyToMessageId,
                    text: kind === 'image'
                        ? 'Фото'
                        : 'Голосовое сообщение',
                });

                if (result.created) {
                    db.prepare(`
                        INSERT INTO media_attachments (
                            id, message_id, kind,
                            mime_type, file_name, bytes
                        ) VALUES (?, ?, ?, ?, ?, ?)
                    `).run(
                        mediaId,
                        result.message.id,
                        kind,
                        mimeType,
                        fileName,
                        bytes
                    );
                } else {
                    const existing =
                        selectMedia.get(result.message.id);

                    if (
                        !existing ||
                        existing.kind !== kind
                    ) {
                        throw new Error(
                            'Media message ID conflict'
                        );
                    }
                }

                return {
                    created: result.created,
                    message: decorateMessage(
                        selectMessage.get(result.message.id)
                    ),
                };
            })();
        },

        getMediaForUser(userId, mediaId) {
            return db.prepare(`
                SELECT a.id,
                       a.kind,
                       a.mime_type AS mimeType,
                       a.file_name AS fileName,
                       a.bytes
                FROM media_attachments a
                JOIN messages m ON m.id = a.message_id
                WHERE a.id = ?
                  AND (
                      m.sender_id = ?
                      OR m.recipient_id = ?
                  )
            `).get(mediaId, userId, userId) ?? null;
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
