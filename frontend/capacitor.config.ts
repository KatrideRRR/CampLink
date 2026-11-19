
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

    ...(testServerUrl
        ? {
            server: {
                url: testServerUrl,
            },
        }
        : {}),
};

export default config;
