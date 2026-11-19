
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    issueRelayTicket,
    verifyRelayTicket,
} from '../../shared/relay-ticket.js';

const SECRET =
    'test-relay-token-secret-1234567890-abcdef';

test('relay ticket identifies its owner', () => {
    const now = 1800000000000;

    const credential = issueRelayTicket(
        12,
        SECRET,
        now
    );

    const decoded = verifyRelayTicket(
        credential.token,
        SECRET,
        now
    );

    assert.equal(decoded.userId, 12);
    assert.equal(decoded.expiresAt, credential.expiresAt);
});

test('tampered and expired tickets are rejected', () => {
    const now = 1800000000000;
    const credential = issueRelayTicket(12, SECRET, now);

    const [payload, signature] =
        credential.token.split('.');

    const tampered = Buffer.from(
        JSON.stringify({
            version: 1,
            userId: 99,
            issuedAt: now,
            expiresAt: credential.expiresAt,
        })
    ).toString('base64url');

    assert.equal(
        verifyRelayTicket(
            `${tampered}.${signature}`,
            SECRET,
            now
        ),
        null
    );

    assert.equal(
        verifyRelayTicket(
            credential.token,
            SECRET,
            credential.expiresAt
        ),
        null
    );

    assert.ok(payload.length > 0);
});
