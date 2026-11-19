
import 'dotenv/config';
import { createMailStore } from './store.js';
import { runForwardWorker } from './forward-worker.js';

const backendUrl = process.env.CAMPLINK_BACKEND_URL;
const gatewaySecret =
    process.env.CAMPLINK_EMAIL_GATEWAY_SECRET;

if (
    !backendUrl ||
    !gatewaySecret ||
    gatewaySecret.length < 32
) {
    console.error(
        'Настрой CAMPLINK_BACKEND_URL и ' +
        'CAMPLINK_EMAIL_GATEWAY_SECRET'
    );
    process.exit(1);
}

const store = createMailStore();
const controller = new AbortController();

function stop() {
    controller.abort();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.log('CampLink Mail Forward Worker запущен');
console.log('Сообщений в очереди:', store.countPending());

let lastPending = null;

try {
    await runForwardWorker(store, {
        backendUrl,
        gatewaySecret,
        intervalMs: 5000,
        signal: controller.signal,

        onCycle({ delivered, pending }) {
            if (delivered > 0 || pending !== lastPending) {
                console.log(
                    `Передано: ${delivered}, ` +
                    `осталось в очереди: ${pending}`
                );
            }

            lastPending = pending;
        },

        onError(error) {
            console.error(
                'Ошибка почтового моста:',
                error.message
            );
        },
    });
} finally {
    store.close();
    console.log('Mail Forward Worker остановлен');
}
