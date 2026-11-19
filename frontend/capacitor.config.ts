
/// <reference types="@capacitor-firebase/messaging" />
import type { CapacitorConfig } from '@capacitor/cli';

const testServerUrl =
    process.env.CAMPLINK_NATIVE_TEST_URL?.trim();

if (
    testServerUrl &&
    !testServerUrl.startsWith('https://')
) {
    throw new Error(
        'Native test server must use HTTPS'
    );
}

const config: CapacitorConfig = {
    appId: 'ru.camplink.app',
    appName: 'CampLink',
    webDir: 'dist',

    plugins: {
        Keyboard: {
            resize: 'native',
        },
        FirebaseMessaging: {
            presentationOptions: [],
        },
    },

    experimental: {
        ios: {
            spm: {
                packageOptions: {
                    '@capacitor-firebase/messaging': {
                        symlink: true,
                    },
                },
            },
        },
    },

    server: testServerUrl
        ? {
            url: testServerUrl,
            errorPath: 'offline-shell.html',
        }
        : {
            appStartPath: '/offline-shell.html',
            allowNavigation: ['chat.camplink.ru'],
            errorPath: 'offline-shell.html',
        },
};

export default config;
