
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runBridgeWorkers,
} from '../src/worker-loop.js';

test(
    'forwarding continues while IMAP is stalled',
    { timeout: 3000 },
    async () => {
        const controller = new AbortController();

        let releasePoll;
        let pollStarted = false;
        let forwarded = 0;

        const stalledPoll = new Promise((resolve) => {
            releasePoll = resolve;
        });

        await runBridgeWorkers({
            signal: controller.signal,
            pollIntervalMs: 10,
            forwardIntervalMs: 10,

            async poll() {
                pollStarted = true;
                return stalledPoll;
            },

            async forward() {
                forwarded += 1;
                return 1;
            },

            onForwardSuccess() {
                controller.abort();
                releasePoll(0);
            },
        });

        assert.equal(pollStarted, true);
        assert.equal(forwarded, 1);
    }
);

test(
    'IMAP failure does not stop forwarding',
    { timeout: 3000 },
    async () => {
        const controller = new AbortController();

        let mailErrors = 0;
        let deliveries = 0;

        await runBridgeWorkers({
            signal: controller.signal,
            pollIntervalMs: 10,
            forwardIntervalMs: 10,

            async poll() {
                throw new Error('Gmail unavailable');
            },

            async forward() {
                deliveries += 1;
                return 1;
            },

            onPollError() {
                mailErrors += 1;
            },

            onForwardSuccess() {
                controller.abort();
            },
        });

        assert.ok(mailErrors >= 1);
        assert.equal(deliveries, 1);
    }
);

test(
    'relay forwarding works without IMAP worker',
    { timeout: 3000 },
    async () => {
        const controller = new AbortController();

        let attempts = 0;

        await runBridgeWorkers({
            signal: controller.signal,
            poll: null,
            forwardIntervalMs: 10,

            async forward() {
                attempts += 1;

                if (attempts === 2) {
                    controller.abort();
                }

                return attempts;
            },
        });

        assert.equal(attempts, 2);
    }
);
