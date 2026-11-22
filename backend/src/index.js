import 'dotenv/config';
import { createAppServer } from './app.js';
import { createFirebasePushSender } from './push.js';

const PORT = Number(process.env.PORT || 5100);
const HOST = '127.0.0.1';

const {
    httpServer,
    dispatchScheduledMessages,
} = createAppServer({
    pushSender: createFirebasePushSender(),
});

function runScheduledDispatch() {
    try {
        const sent = dispatchScheduledMessages();

        if (sent.length > 0) {
            console.info(
                `[Scheduled] Delivered ${sent.length} messages`
            );
        }
    } catch (error) {
        console.error(
            '[Scheduled] Dispatch failed:',
            error?.message ?? error
        );
    }
}

// One server-side scheduler, independent of user devices.
const scheduleTimer = setInterval(
    runScheduledDispatch,
    1000
);
scheduleTimer.unref();

httpServer.listen(PORT, HOST, () => {
    console.log(
        `CampLink API: http://${HOST}:${PORT}`
    );

    // Also process overdue messages after a restart.
    runScheduledDispatch();
});
