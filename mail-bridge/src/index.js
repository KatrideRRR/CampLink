
import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { createMailStore } from './store.js';
import {
    collectMailbox,
    forwardPending,
} from './bridge.js';

const required = [
    'CAMPLINK_IMAP_HOST',
    'CAMPLINK_IMAP_USER',
    'CAMPLINK_IMAP_PASSWORD',
    'CAMPLINK_MAIL_PACKET_SIGNING_KEY',
    'CAMPLINK_EMAIL_GATEWAY_SECRET',
    'CAMPLINK_BACKEND_URL',
];

const missing = required.filter(
    (name) => !process.env[name]
);

if (missing.length > 0) {
    console.error(
        'Missing Mail Bridge configuration:',
        missing.join(', ')
    );
    process.exit(1);
}

const store = createMailStore();

const intervalSeconds = Math.max(
    10,
    Number(process.env.CAMPLINK_POLL_SECONDS) || 30
);

async function pollOnce() {
    const client = new ImapFlow({
        host: process.env.CAMPLINK_IMAP_HOST,
        port: Number(
            process.env.CAMPLINK_IMAP_PORT || 993
        ),
        secure: true,
        auth: {
            user: process.env.CAMPLINK_IMAP_USER,
            pass: process.env.CAMPLINK_IMAP_PASSWORD,
        },
        logger: false,
    });

    client.on('error', (error) => {
        console.error('IMAP error:', error.message);
    });

    await client.connect();

    try {
        return await collectMailbox(
            client,
            store,
            process.env.CAMPLINK_MAIL_PACKET_SIGNING_KEY
        );
    } finally {
        await client.logout().catch(() => {});
    }
}

const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    console.log('CampLink Mail Bridge started');

    while (true) {
        try {
            const stored = await pollOnce();

            if (stored > 0) {
                console.log(
                    `New mail packets stored: ${stored}`
                );
            }
        } catch (error) {
            console.error(
                'Mailbox polling failed:',
                error.message
            );
        }

        try {
            const delivered = await forwardPending(
                store,
                {
                    backendUrl:
                    process.env.CAMPLINK_BACKEND_URL,
                    gatewaySecret:
                    process.env.CAMPLINK_EMAIL_GATEWAY_SECRET,
                }
            );

            if (delivered > 0) {
                console.log(
                    `Packets forwarded: ${delivered}`
                );
            }
        } catch (error) {
            console.error(
                'Backend forwarding failed:',
                error.message
            );
        }

        await sleep(intervalSeconds * 1000);
    }
}

main().catch((error) => {
    console.error(error);
    store.close();
    process.exitCode = 1;
});
