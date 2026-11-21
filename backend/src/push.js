import {
    applicationDefault,
    getApps,
    initializeApp,
} from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import {
    buildMessagePushPayload,
} from './push-payload.js';

export function createFirebasePushSender() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.warn('[FCM] Disabled: credentials not configured');
        return null;
    }

    const firebaseApp =
        getApps().find((app) => app.name === 'camplink-push') ??
        initializeApp(
            { credential: applicationDefault() },
            'camplink-push'
        );

    return async ({ tokens, message, senderUsername }) => {
        const invalidTokens = [];

        const payload = buildMessagePushPayload(
            message,
            senderUsername
        );

        for (let start = 0; start < tokens.length; start += 500) {
            const batch = tokens.slice(start, start + 500);

            const result = await getMessaging(firebaseApp)
                .sendEachForMulticast({
                    tokens: batch,

                    notification: payload.notification,

                    data: payload.data,

                    apns: {
                        headers: {
                            'apns-push-type': 'alert',
                            'apns-priority': '10',
                        },
                        payload: {
                            aps: {
                                sound: 'camplink_message.wav',
                            },
                        },
                    },
                });

            console.log(
                `[FCM] Message ${message.id}: ` +
                `${result.successCount}/${batch.length} accepted`
            );

            result.responses.forEach((response, index) => {
                if (response.success) return;

                const code =
                    response.error?.code ?? 'unknown';

                if (
                    code ===
                        'messaging/registration-token-not-registered' ||
                    code === 'messaging/invalid-registration-token'
                ) {
                    invalidTokens.push(batch[index]);
                } else {
                    console.error('[FCM] Token delivery:', code);
                }
            });
        }

        return invalidTokens;
    };
}
