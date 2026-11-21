import test from 'node:test';
import assert from 'node:assert/strict';

import {
    decideIncomingNotice,
} from '../src/services/notification-policy.ts';

const normal = {
    isOwnMessage: false,
    appVisible: true,
    alreadyKnown: false,
    viewingSenderChat: false,
    nearBottom: true,
};

test('message in chat list shows toast', () => {
    assert.equal(
        decideIncomingNotice(normal),
        'toast'
    );
});

test('message from another chat shows toast', () => {
    assert.equal(
        decideIncomingNotice({
            ...normal,
            viewingSenderChat: false,
            nearBottom: false,
        }),
        'toast'
    );
});

test('reading old messages shows bottom notice', () => {
    assert.equal(
        decideIncomingNotice({
            ...normal,
            viewingSenderChat: true,
            nearBottom: false,
        }),
        'bottom'
    );
});

test('current chat at bottom only plays sound', () => {
    assert.equal(
        decideIncomingNotice({
            ...normal,
            viewingSenderChat: true,
            nearBottom: true,
        }),
        'sound'
    );
});

test('own messages do not notify', () => {
    assert.equal(
        decideIncomingNotice({
            ...normal,
            isOwnMessage: true,
        }),
        'none'
    );
});

test('duplicate messages do not notify', () => {
    assert.equal(
        decideIncomingNotice({
            ...normal,
            alreadyKnown: true,
        }),
        'none'
    );
});

test('hidden application leaves notification to OS', () => {
    assert.equal(
        decideIncomingNotice({
            ...normal,
            appVisible: false,
        }),
        'none'
    );
});
