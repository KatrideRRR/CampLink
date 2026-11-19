
import { setTimeout as sleep } from 'node:timers/promises';
import { forwardPending } from './bridge.js';

export async function runForwardWorker(
    store,
    {
        backendUrl,
        gatewaySecret,
        intervalMs = 5000,
        signal,
        fetchImpl,
        onCycle = () => {},
        onError = () => {},
    }
) {
    while (!signal?.aborted) {
        try {
            const delivered = await forwardPending(store, {
                backendUrl,
                gatewaySecret,
                fetchImpl,
            });

            onCycle({
                delivered,
                pending: store.countPending(),
            });
        } catch (error) {
            onError(error);
        }

        if (signal?.aborted) break;

        try {
            await sleep(
                intervalMs,
                undefined,
                signal ? { signal } : {}
            );
        } catch (error) {
            if (!signal?.aborted) {
                throw error;
            }
        }
    }
}
