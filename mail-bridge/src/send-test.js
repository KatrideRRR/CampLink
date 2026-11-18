
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import {
    encodeMailPacket,
    MAIL_SUBJECT,
} from './protocol.js';

const senderId = Number(process.argv[2]);
const recipientId = Number(process.argv[3]);
const text = process.argv.slice(4).join(' ').trim();

if (
    !Number.isSafeInteger(senderId) ||
    !Number.isSafeInteger(recipientId) ||
    senderId <= 0 ||
    recipientId <= 0 ||
    senderId === recipientId ||
    !text
) {
    console.error(
        'Usage: npm run mail:test -w mail-bridge -- 1 2 "Привет"'
    );
    process.exit(1);
}

const port = Number(
    process.env.CAMPLINK_SMTP_PORT || 465
);

const transport = nodemailer.createTransport({
    host: process.env.CAMPLINK_SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
        user: process.env.CAMPLINK_SMTP_USER,
        pass: process.env.CAMPLINK_SMTP_PASSWORD,
    },
});

const packet = {
    senderId,
    recipientId,
    clientMessageId: randomUUID(),
    clientCreatedAt: new Date().toISOString(),
    text,
};

const body = encodeMailPacket(
    packet,
    process.env.CAMPLINK_MAIL_PACKET_SIGNING_KEY
);

const info = await transport.sendMail({
    from: process.env.CAMPLINK_SMTP_USER,
    to: process.env.CAMPLINK_MAIL_ADDRESS,
    subject: MAIL_SUBJECT,
    text: body,
});

console.log('SMTP accepted test message');
console.log('Message ID:', info.messageId);
console.log('CampLink packet ID:', packet.clientMessageId);
console.log(
    'Check Mail Bridge for final ingestion confirmation.'
);
