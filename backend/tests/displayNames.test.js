import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../src/store.js';
import {
    normalizePhone,
    validateRegistration,
} from '../src/registration.js';
import {
    buildMessagePushPayload,
} from '../src/push-payload.js';

test('international phone normalization', () => {
    assert.equal(
        normalizePhone('8 (912) 345-67-89'),
        '+79123456789'
    );

    assert.equal(
        normalizePhone('+1 213 373 4253'),
        '+12133734253'
    );

    assert.equal(
        normalizePhone('+380 50 123 45 67'),
        '+380501234567'
    );

    assert.equal(normalizePhone('123'), null);
});

test('display names support spaces and Cyrillic', () => {
    const values = validateRegistration({
        displayName: 'Аким Аджиаметов',
        email: 'akim-new@example.com',
        phone: '+79123456789',
        password: 'secure-password-123',
    });

    assert.equal(
        values?.displayName,
        'Аким Аджиаметов'
    );

    assert.equal(values?.username, null);
});

test('legacy usernames and new display names coexist', () => {
    const store = createStore(':memory:');

    try {
        const legacy = store.createUser(
            'legacy', 'legacy-password-123'
        );

        const modern = store.registerUser({
            displayName: 'Иван Петров',
            email: 'ivan-new@example.com',
            phone: '+79123456789',
            password: 'secure-password-123',
        });

        assert.equal(modern.displayName, 'Иван Петров');

        assert.ok(
            /^cl_[a-f0-9]{16}$/.test(modern.username)
        );

        assert.equal(
            store.suggestUsers(legacy.id, 'иван')[0].id,
            modern.id
        );

        assert.equal(
            store.verifyCredentials(
                'ivan-new@example.com',
                'secure-password-123'
            )?.id,
            modern.id
        );

        assert.equal(
            store.getUserById(legacy.id).displayName,
            'legacy'
        );

        assert.equal(
            buildMessagePushPayload(
                { id: 5, senderId: modern.id, text: 'Привет' },
                modern.displayName
            ).notification.title,
            'Иван Петров'
        );
    } finally {
        store.close();
    }
});
