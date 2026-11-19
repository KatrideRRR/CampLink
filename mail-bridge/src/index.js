
import 'dotenv/config';
import { ImapFlow } from 'imapflow';

import { createMailStore } from './store.js';
import {
    collectMailbox,
    forwardPending,
} from './bridge.js';
import { createRelayServer } from './relay-server.js';
import { runBridgeWorkers } from './worker-loop.js';

const imapEnabled =
    process.env.CAMPLINK_IMAP_ENABLED !== 'false';

const required = [
    'CAMPLINK_EMAIL_GATEWAY_SECRET',
    'CAMPLINK_BACKEND_URL',
];

if (imapEnabled) {
    required.push(
        'CAMPLINK_IMAP_HOST',
        'CAMPLINK_IMAP_USER',
        'CAMPLINK_IMAP_PASSWORD',
        'CAMPLINK_MAIL_PACKET_SIGNING_KEY'
    );
}

const missing = required.filter(
    (key) => !process.env[key]
);

if (missing.length > 0) {
    console.error(
        'Missing Mail Bridge configuration:',
        missing.join(', ')
    );
    process.exit(1);
}

const store = createMailStore();
const lastFailureLog = new Map();
const controller = new AbortController();
const signal = controller.signal;

const relaySecret =
    process.env.CAMPLINK_RELAY_TOKEN_SECRET;

let relayServer = null;

if (relaySecret) {
    if (relaySecret.length < 32) {
        throw new Error('Invalid relay secret');
    }

    const allowedOrigins = (
        process.env.CAMPLINK_RELAY_ALLOWED_ORIGINS ??
        'http://127.0.0.1:5173,http://localhost:5173'
    )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    relayServer = createRelayServer({
        store,
        secret: relaySecret,
        allowedOrigins,
    });

    const port = Number(
        process.env.CAMPLINK_RELAY_PORT || 5200
    );

    const host =
        process.env.CAMPLINK_RELAY_HOST ??
        '127.0.0.1';

    relayServer.listen(port, host, () => {
        console.log(
            `CampLink Relay: http://${host}:${port}`
        );
    });
}

function stop() {
    controller.abort();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function pollMailbox() {
    if (signal.aborted) return 0;

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

        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        disableAutoIdle: true,
        logger: false,
    });

    client.on('error', (error) => {
        if (!signal.aborted) {
            console.error('IMAP error:', error.message);
        }
    });

    const onAbort = () => client.close();

    signal.addEventListener('abort', onAbort, {
        once: true,
    });

    try {
        await client.connect();

        if (signal.aborted) return 0;

        return await collectMailbox(
            client,
            store,
            process.env.CAMPLINK_MAIL_PACKET_SIGNING_KEY
        );
    } finally {
        signal.removeEventListener('abort', onAbort);

        if (signal.aborted) {
            client.close();
        } else {
            await client.logout().catch(() => {
                client.close();
            });
        }
    }
}

async function main() {
    console.log('CampLink Mail Bridge started');
    console.log(
        'IMAP:',
        imapEnabled ? 'enabled' : 'disabled'
    );
    console.log(
        'Pending packets:',
        store.countPending()
    );

    try {
        await runBridgeWorkers({
            poll: imapEnabled ? pollMailbox : null,


            forward: () =>
                forwardPending(store, {
                    backendUrl:
                    process.env.CAMPLINK_BACKEND_URL,
                    gatewaySecret:
                    process.env.CAMPLINK_EMAIL_GATEWAY_SECRET,

                    onFailure({ id, reason }) {
                        const now = Date.now();
                        const previous = lastFailureLog.get(id) ?? 0;

                        // Report an error at most once per 30 seconds
                        // to avoid flooding the terminal.
                        if (now - previous >= 30000) {
                            console.error(
                                `Mail Bridge packet #${id}: ${reason}`
                            );

                            lastFailureLog.set(id, now);
                        }
                    },
                }),


            pollIntervalMs: Math.max(
                10000,
                Number(
                    process.env.CAMPLINK_POLL_SECONDS || 30
                ) * 1000
            ),

            forwardIntervalMs: 5000,
            signal,

            onPollSuccess(count) {
                if (count > 0) {
                    console.log(
                        `New mail packets stored: ${count}`
                    );
                }
            },

            onPollError(error) {
                console.error(
                    'Mailbox polling failed:',
                    error.message
                );
            },

            onForwardSuccess(count) {
                if (count > 0) {
                    console.log(
                        `Packets forwarded: ${count}`
                    );
                }
            },

            onForwardError(error) {
                console.error(
                    'Backend forwarding failed:',
                    error.message
                );
            },
        });
    } finally {
        if (relayServer?.listening) {
            await new Promise((resolve) => {
                relayServer.close(resolve);
            });
        }

        store.close();
        console.log('CampLink Mail Bridge stopped');
    }
}

main().catch((error) => {
    console.error('Mail Bridge fatal error:', error);
    process.exitCode = 1;
});
