
import {
    createHmac,
    timingSafeEqual,
} from 'node:crypto';

export const MAIL_SUBJECT = 'CampLink Packet v1';

export function validatePacket(packet) {
    if (!packet || typeof packet !== 'object') {
        throw new Error('Invalid packet');
    }

    const {
        senderId,
        recipientId,
        clientMessageId,
        clientCreatedAt,
        text,
    } = packet;

    const validTime =
        typeof clientCreatedAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
            .test(clientCreatedAt) &&
        Number.isFinite(Date.parse(clientCreatedAt));

    if (
        !Number.isSafeInteger(senderId) ||
        !Number.isSafeInteger(recipientId) ||
        senderId <= 0 ||
        recipientId <= 0 ||
        senderId === recipientId ||
        typeof clientMessageId !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(clientMessageId) ||
        !validTime ||
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > 2000 ||
        text !== text.trim()
    ) {
        throw new Error('Invalid packet fields');
    }
}

function signatureFor(packet, secret) {
    if (
        typeof secret !== 'string' ||
        secret.length < 32
    ) {
        throw new Error('Invalid signing secret');
    }

    const canonical = JSON.stringify([
        1,
        packet.senderId,
        packet.recipientId,
        packet.clientMessageId,
        packet.clientCreatedAt,
        packet.text,
    ]);

    return createHmac('sha256', secret)
        .update(canonical)
        .digest('hex');
}

export function encodeMailPacket(packet, secret) {
    validatePacket(packet);

    return JSON.stringify({
        version: 1,
        packet,
        signature: signatureFor(packet, secret),
    });
}

export function decodeMailPacket(body, secret) {
    if (
        typeof body !== 'string' ||
        body.length > 10000
    ) {
        throw new Error('Invalid email body');
    }

    const envelope = JSON.parse(body);

    if (
        !envelope ||
        envelope.version !== 1 ||
        typeof envelope.signature !== 'string' ||
        !/^[a-f0-9]{64}$/.test(envelope.signature)
    ) {
        throw new Error('Invalid envelope');
    }

    validatePacket(envelope.packet);

    const expected = Buffer.from(
        signatureFor(envelope.packet, secret),
        'hex'
    );

    const received = Buffer.from(
        envelope.signature,
        'hex'
    );

    if (!timingSafeEqual(received, expected)) {
        throw new Error('Invalid signature');
    }

    return envelope.packet;
}
