
/// <reference types="@capacitor-firebase/messaging" />
import type { CapacitorConfig } from '@capacitor/cli';

const testServerUrl =
    process.env.CAMPLINK_NATIVE_TEST_URL?.trim();

const bundledNative =
    process.env.CAMPLINK_BUNDLED_NATIVE === '1';

if (testServerUrl && bundledNative) {
    throw new Error(
        'Cannot combine remote test and bundled mode'
    );
}

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
        : bundledNative
            ? undefined
            : {
                appStartPath: '/offline-shell.html',
                allowNavigation: ['chat.camplink.ru'],
                errorPath: 'offline-shell.html',
            },
};

export default config;
