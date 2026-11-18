
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MAIL_DB = fileURLToPath(
    new URL('../data/bridge.sqlite', import.meta.url)
);

export function createMailStore(
    databasePath = DEFAULT_MAIL_DB
) {
    if (databasePath !== ':memory:') {
        mkdirSync(dirname(databasePath), {
            recursive: true,
        });
    }

    const db = new Database(databasePath);

    if (databasePath !== ':memory:') {
        db.pragma('journal_mode = WAL');
    }

    db.exec(`
    CREATE TABLE IF NOT EXISTS mail_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      client_message_id TEXT NOT NULL,
      packet_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(sender_id, client_message_id)
    );
  `);

    return {
        enqueue(packet) {
            const serialized = JSON.stringify(packet);

            const result = db.prepare(`
        INSERT OR IGNORE INTO mail_queue (
          sender_id,
          client_message_id,
          packet_json,
          created_at
        )
        VALUES (?, ?, ?, ?)
      `).run(
                packet.senderId,
                packet.clientMessageId,
                serialized,
                new Date().toISOString()
            );

            const existing = db.prepare(`
        SELECT id, packet_json
        FROM mail_queue
        WHERE sender_id = ?
          AND client_message_id = ?
      `).get(
                packet.senderId,
                packet.clientMessageId
            );

            if (existing.packet_json !== serialized) {
                throw new Error('Conflicting message ID');
            }

            return {
                id: existing.id,
                created: result.changes === 1,
            };
        },

        pending(limit = 50) {
            return db.prepare(`
        SELECT id, packet_json
        FROM mail_queue
        WHERE status = 'pending'
        ORDER BY id
        LIMIT ?
      `).all(limit).map((row) => ({
                id: row.id,
                packet: JSON.parse(row.packet_json),
            }));
        },

        markDelivered(id) {
            db.prepare(`
        UPDATE mail_queue
        SET status = 'delivered',
            last_error = NULL
        WHERE id = ?
      `).run(id);
        },

        recordFailure(id, message) {
            db.prepare(`
        UPDATE mail_queue
        SET attempts = attempts + 1,
            last_error = ?
        WHERE id = ?
      `).run(String(message).slice(0, 300), id);
        },

        countPending() {
            return db.prepare(`
        SELECT COUNT(*) AS total
        FROM mail_queue
        WHERE status = 'pending'
      `).get().total;
        },

        close() {
            db.close();
        },
    };
}
