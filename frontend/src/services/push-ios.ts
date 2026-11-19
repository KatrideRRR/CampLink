
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export type PushStatus =
    | 'off'
    | 'requesting'
    | 'registered'
    | 'denied'
    | 'error';

export const isNativeIos =
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'ios';

export function observePushRegistration(
    onStatus: (status: PushStatus) => void
): () => void {
    if (!isNativeIos) return () => {};

    let disposed = false;

    const subscriptions = Promise.all([
        PushNotifications.addListener(
            'registration',
            (token) => {
                if (!disposed) {
                    onStatus(
                        token.value ? 'registered' : 'error'
                    );
                }
            }
        ),
        PushNotifications.addListener(
            'registrationError',
            (event) => {
                console.warn(
                    'APNs registration failed',
                    event.error
                );

                if (!disposed) {
                    onStatus('error');
                }
            }
        ),
    ]);

    return () => {
        disposed = true;

        void subscriptions.then((handles) =>
            Promise.all(
                handles.map((handle) => handle.remove())
            )
        ).catch(() => {});
    };
}

export async function registerIosPush():
    Promise<'requesting' | 'denied'> {
    let permission =
        await PushNotifications.checkPermissions();

    if (permission.receive === 'prompt') {
        permission =
            await PushNotifications.requestPermissions();
    }

    if (permission.receive !== 'granted') {
        return 'denied';
    }

    await PushNotifications.register();

    return 'requesting';
}
