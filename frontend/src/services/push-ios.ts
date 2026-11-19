import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';

export type PushStatus =
    | 'off'
    | 'requesting'
    | 'registered'
    | 'denied'
    | 'error';

export const isNativeIos =
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'ios';

async function saveToken(token: string): Promise<void> {
    if (!token) {
        throw new Error('Empty FCM token');
    }

    const response = await fetch('/api/push/devices', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            provider: 'fcm',
            token,
        }),
    });

    if (!response.ok) {
        throw new Error('FCM device registration failed');
    }
}

export function observePushRegistration(
    onStatus: (status: PushStatus) => void
): () => void {
    if (!isNativeIos) return () => {};

    let disposed = false;

    const subscription = FirebaseMessaging.addListener(
        'tokenReceived',
        async ({ token }) => {
            if (!token || disposed) return;

            try {
                await saveToken(token);

                if (!disposed) {
                    onStatus('registered');
                }
            } catch {
                if (!disposed) {
                    onStatus('error');
                }
            }
        }
    );

    return () => {
        disposed = true;

        void subscription
            .then((listener) => listener.remove())
            .catch(() => {});
    };
}

export async function registerIosPush():
    Promise<'registered' | 'denied'> {
    let permission =
        await FirebaseMessaging.checkPermissions();

    if (permission.receive === 'prompt') {
        permission =
            await FirebaseMessaging.requestPermissions();
    }

    if (permission.receive !== 'granted') {
        return 'denied';
    }

    const result = await FirebaseMessaging.getToken();

    await saveToken(result.token);

    return 'registered';
}
