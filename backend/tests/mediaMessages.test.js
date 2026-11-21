import test from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';
import {
    mkdtempSync,
    readdirSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAppServer } from '../src/app.js';
import {
    inspectMedia,
    MAX_MEDIA_BYTES,
} from '../src/media-format.js';

const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.alloc(32),
]);

test('media type validation rejects unsupported files', () => {
    assert.deepEqual(
        inspectMedia('image', 'image/png', png),
        {
            extension: 'png',
            mimeType: 'image/png',
            kind: 'image',
        }
    );

    assert.equal(
        inspectMedia(
            'image',
            'image/svg+xml',
            Buffer.from('<svg></svg>')
        ),
        null
    );

    assert.equal(
        inspectMedia(
            'image',
            'image/png',
            Buffer.from('not a real png file')
        ),
        null
    );

    assert.equal(
        inspectMedia(
            'image',
            'image/png',
            Buffer.alloc(MAX_MEDIA_BYTES + 1)
        ),
        null
    );
});

test('media upload, access control and idempotency', {
    timeout: 15000,
}, async t => {
    const directory = mkdtempSync(
        join(tmpdir(), 'camplink-media-test-')
    );

    const {
        httpServer,
        io,
        store,
    } = createAppServer({
        databasePath: ':memory:',
        mediaDirectory: directory,
    });

    t.after(async () => {
        await new Promise(resolve => io.close(resolve));
        store.close();

        rmSync(directory, {
            recursive: true,
            force: true,
        });
    });

    const sender = store.createUser(
        'sender', 'test-password-123'
    );
    const recipient = store.createUser(
        'recipient', 'test-password-456'
    );
    const outsider = store.createUser(
        'outsider', 'test-password-789'
    );

    const senderToken = store.createSession(sender.id);
    const recipientToken =
        store.createSession(recipient.id);
    const outsiderToken = store.createSession(outsider.id);

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const base =
        `http://127.0.0.1:${httpServer.address().port}`;

    const id = randomUUID();

    const path = `/api/media/send?` +
        new URLSearchParams({
            toUserId: String(recipient.id),
            clientMessageId: id,
            kind: 'image',
        });

    async function upload() {
        return fetch(base + path, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${senderToken}`,
                'Content-Type': 'image/png',
            },
            body: png,
        });
    }

    const unauthorized = await fetch(
        base + '/api/media/send',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'image/png',
            },
            body: png,
        }
    );

    assert.equal(unauthorized.status, 401);

    const first = await upload();
    assert.equal(first.status, 201);

    const result = await first.json();

    assert.equal(result.ok, true);
    assert.equal(result.message.text, 'Фото');
    assert.equal(result.message.media.kind, 'image');

    const mediaId = result.message.media.id;

    const mediaUrl =
        `${base}/api/media/${mediaId}`;

    const recipientGet = await fetch(mediaUrl, {
        headers: {
            Authorization: `Bearer ${recipientToken}`,
        },
    });

    assert.equal(recipientGet.status, 200);

    const received = Buffer.from(
        await recipientGet.arrayBuffer()
    );

    assert.deepEqual(received, png);

    const outsiderGet = await fetch(mediaUrl, {
        headers: {
            Authorization: `Bearer ${outsiderToken}`,
        },
    });

    assert.equal(outsiderGet.status, 404);

    const duplicate = await upload();

    assert.equal(duplicate.status, 200);

    const duplicateResult = await duplicate.json();

    assert.equal(
        duplicateResult.message.id,
        result.message.id
    );

    assert.equal(
        store.getConversation(
            sender.id, recipient.id
        ).length,
        1
    );

    assert.equal(readdirSync(directory).length, 1);
});
