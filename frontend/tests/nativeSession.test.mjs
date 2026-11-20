import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isBundledNativeOrigin,
    makeNativeSession,
    readNativeSession,
} from '../src/services/native-session-model.ts';

test('native origins are strictly separated', () => {
    assert.equal(
        isBundledNativeOrigin(
            'ios', 'capacitor://localhost'
        ),
        true
    );

    assert.equal(
        isBundledNativeOrigin(
            'android', 'https://localhost'
        ),
        true
    );

    assert.equal(
        isBundledNativeOrigin(
            'ios', 'https://chat.camplink.ru'
        ),
        false
    );

    assert.equal(
        isBundledNativeOrigin(
            'web', 'https://localhost'
        ),
        false
    );

    assert.equal(
        isBundledNativeOrigin(
            'android', 'capacitor://localhost'
        ),
        false
    );
});

test('native token can be stored and restored', () => {
    const now = Date.now();
    const token = 'a'.repeat(64);

    const session = makeNativeSession(
        token, 3600, now
    );

    const restored = readNativeSession(
        JSON.stringify(session),
        now + 1000
    );

    assert.deepEqual(restored, session);

    assert.equal(
        readNativeSession(
            JSON.stringify(session),
            now + 3600 * 1000
        ),
        null
    );
});

test('invalid native credentials are rejected', () => {
    assert.throws(() =>
        makeNativeSession('invalid', 3600)
    );

    assert.throws(() =>
        makeNativeSession('a'.repeat(64), -1)
    );

    assert.equal(readNativeSession('{bad json'), null);

    assert.equal(
        readNativeSession(
            JSON.stringify({
                token: 'invalid',
                expiresAt: Date.now() + 100000,
            })
        ),
        null
    );
});
