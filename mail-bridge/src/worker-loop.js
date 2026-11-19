
import { setTimeout as sleep } from 'node:timers/promises';

async function runLoop(
    job,
    {
        intervalMs,
        signal,
        onSuccess = () => {},
        onError = () => {},
    }
) {
    while (!signal.aborted) {
        try {
            const result = await job();
            onSuccess(result);
        } catch (error) {
            onError(error);
        }

        if (signal.aborted) break;

        try {
            await sleep(
                intervalMs,
                undefined,
                { signal }
            );
        } catch (error) {
            if (signal.aborted) break;
            throw error;
        }
    }
}

export function runBridgeWorkers({
                                     poll,
                                     forward,
                                     pollIntervalMs = 30000,
                                     forwardIntervalMs = 5000,
                                     signal,
                                     onPollSuccess = () => {},
                                     onPollError = () => {},
                                     onForwardSuccess = () => {},
                                     onForwardError = () => {},
                                 }) {
    if (!signal || typeof forward !== 'function') {
        throw new Error('Invalid bridge workers');
    }

    const workers = [];

    if (typeof poll === 'function') {
        workers.push(
            runLoop(poll, {
                intervalMs: pollIntervalMs,
                signal,
                onSuccess: onPollSuccess,
                onError: onPollError,
            })
        );
    }

    workers.push(
        runLoop(forward, {
            intervalMs: forwardIntervalMs,
            signal,
            onSuccess: onForwardSuccess,
            onError: onForwardError,
        })
    );

    return Promise.all(workers);
}
