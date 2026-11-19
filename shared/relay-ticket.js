
import {
    createHmac,
    timingSafeEqual,
} from 'node:crypto';

const TICKET_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function requireSecret(secret) {
    if (
        typeof secret !== 'string' ||
        secret.length < 32
    ) {
        throw new Error('Invalid relay token secret');
    }
}

function sign(data, secret) {
    return createHmac('sha256', secret)
        .update(data)
        .digest('base64url');
}

export function issueRelayTicket(
    userId,
    secret,
    now = Date.now()
) {
    requireSecret(secret);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error('Invalid user');
    }

    const expiresAt = now + TICKET_LIFETIME_MS;

    const payload = Buffer.from(JSON.stringify({
        version: 1,
        userId,
        issuedAt: now,
        expiresAt,
    })).toString('base64url');

    const signature = sign(payload, secret);

    return {
        token: `${payload}.${signature}`,
        expiresAt,
    };
}

export function verifyRelayTicket(
    token,
    secret,
    now = Date.now()
) {
    requireSecret(secret);

    if (
        typeof token !== 'string' ||
        token.length > 1024 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    ) {
        return null;
    }

    const [payload, signature] = token.split('.');

    const expected = Buffer.from(
        sign(payload, secret),
        'base64url'
    );
    const supplied = Buffer.from(
        signature,
        'base64url'
    );

    if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
    ) {
        return null;
    }

    try {
        const data = JSON.parse(
            Buffer.from(payload, 'base64url').toString()
        );

        if (
            data.version !== 1 ||
            !Number.isSafeInteger(data.userId) ||
            data.userId <= 0 ||
            !Number.isSafeInteger(data.issuedAt) ||
            !Number.isSafeInteger(data.expiresAt) ||
            data.issuedAt > now ||
            data.expiresAt <= now ||
            data.expiresAt - data.issuedAt >
            TICKET_LIFETIME_MS
        ) {
            return null;
        }

        return data;
    } catch {
        return null;
    }
}
