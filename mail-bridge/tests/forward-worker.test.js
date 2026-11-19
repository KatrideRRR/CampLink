
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createMailStore } from '../src/store.js';
import { runForwardWorker } from '../src/forward-worker.js';

const SECRET =
    'test-gateway-secret-1234567890-abcdefghij';

test(
    'worker automatically retries after backend outage',
    { timeout: 5000 },
    async () => {
        const store = createMailStore(':memory:');
        const controller = new AbortController();

        const packet = {
            senderId: 1,
            recipientId: 2,
            clientMessageId: randomUUID(),
            clientCreatedAt:
                '2026-11-18T16:00:00.000Z',
            text: 'Проверка автоматической доставки',
        };

        store.enqueue(packet);

        let attempts = 0;
        const cycles = [];

        const safetyTimer = setTimeout(() => {
            controller.abort();
        }, 2000);

        try {
            await runForwardWorker(store, {
                backendUrl: 'http://127.0.0.1:5100',
                gatewaySecret: SECRET,
                intervalMs: 10,
                signal: controller.signal,

                async fetchImpl() {
                    attempts += 1;

                    if (attempts === 1) {
                        throw new Error('Backend is offline');
                    }

                    return {
                        ok: true,
                        async json() {
                            return {
                                ok: true,
                                message: {
                                    id: 1,
                                    senderId: packet.senderId,
                                    recipientId: packet.recipientId,
                                    clientMessageId:
                                    packet.clientMessageId,
                                    text: packet.text,
                                    createdAt:
                                    packet.clientCreatedAt,
                                },
                            };
                        },
                    };
                },

                onCycle(result) {
                    cycles.push(result);

                    if (result.delivered === 1) {
                        controller.abort();
                    }
                },
            });

            assert.equal(attempts, 2);
            assert.equal(cycles[0].pending, 1);
            assert.equal(cycles[1].delivered, 1);
            assert.equal(store.countPending(), 0);
        } finally {
            clearTimeout(safetyTimer);
            store.close();
        }
    }
);
