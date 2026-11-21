import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createStore } from '../src/store.js';
import { createAppServer } from '../src/app.js';

test('exact ID search finds only the requested user', () => {
    const store = createStore(':memory:');

    try {
        const owner = store.createUser(
            'owner', 'password-123456'
        );
        const first = store.createUser(
            'first', 'password-123456'
        );
        const second = store.createUser(
            'second', 'password-123456'
        );

        assert.deepEqual(
            store.suggestUsers(owner.id, `#${first.id}`)
                .map(user => user.id),
            [first.id]
        );

        assert.deepEqual(
            store.suggestUsers(owner.id, `#${second.id}`)
                .map(user => user.id),
            [second.id]
        );

        assert.deepEqual(
            store.suggestUsers(owner.id, `#${owner.id}`),
            []
        );

        assert.deepEqual(
            store.suggestUsers(owner.id, '#999999'),
            []
        );

        assert.deepEqual(
            store.suggestUsers(owner.id, String(first.id)),
            []
        );
    } finally {
        store.close();
    }
});

test('authenticated API supports short #ID', async t => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    t.after(async () => {
        await new Promise(resolve => io.close(resolve));
        store.close();
    });

    const owner = store.createUser(
        'owner', 'password-123456'
    );
    const target = store.createUser(
        'target', 'password-123456'
    );

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const base =
        `http://127.0.0.1:${httpServer.address().port}`;

    const path =
        '/api/users/suggest?q=' +
        encodeURIComponent(`#${target.id}`);

    const unauthorized = await fetch(base + path);
    assert.equal(unauthorized.status, 401);

    const token = store.createSession(owner.id);

    const response = await fetch(base + path, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    assert.equal(response.status, 200);

    const payload = await response.json();

    assert.equal(payload.users.length, 1);
    assert.equal(payload.users[0].id, target.id);

    assert.deepEqual(
        Object.keys(payload.users[0]).sort(),
        ['displayName', 'id', 'username']
    );
});

test('native iOS notification sound is bundled', () => {
    const sound = readFileSync(
        new URL(
            '../../frontend/ios/App/App/camplink_message.wav',
            import.meta.url
        )
    );

    assert.equal(sound.toString('ascii', 0, 4), 'RIFF');
    assert.equal(sound.toString('ascii', 8, 12), 'WAVE');
    assert.equal(sound.readUInt16LE(20), 1);
    assert.equal(sound.readUInt16LE(22), 1);
    assert.equal(sound.readUInt32LE(24), 44100);

    const project = readFileSync(
        new URL(
            '../../frontend/ios/App/App.xcodeproj/project.pbxproj',
            import.meta.url
        ),
        'utf8'
    );

    assert.match(
        project,
        /camplink_message\.wav in Resources/
    );

    const push = readFileSync(
        new URL('../src/push.js', import.meta.url),
        'utf8'
    );

    assert.match(
        push,
        /sound:\s*'camplink_message\.wav'/
    );

    // Apple's notification sound limit is 30 seconds.
    assert.ok(sound.length < 44100 * 2 * 30 + 44);
});
