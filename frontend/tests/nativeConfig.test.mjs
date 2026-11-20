import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const frontendDir = fileURLToPath(
    new URL('../', import.meta.url)
);

function readConfig(bundled) {
    const result = spawnSync(
        process.execPath,
        [
            '--experimental-strip-types',
            '--input-type=module',
            '-e',
            'import config from "./capacitor.config.ts";' +
            'process.stdout.write(' +
            'JSON.stringify(config.server ?? null))',
        ],
        {
            cwd: frontendDir,
            encoding: 'utf8',
            env: {
                ...process.env,
                CAMPLINK_NATIVE_TEST_URL: '',
                CAMPLINK_BUNDLED_NATIVE:
                    bundled ? '1' : '0',
            },
        }
    );

    assert.equal(result.status, 0, result.stderr);

    return JSON.parse(result.stdout);
}

test('default native build retains remote mode', () => {
    const server = readConfig(false);

    assert.equal(
        server.appStartPath,
        '/offline-shell.html'
    );
});

test('bundled native build loads local React', () => {
    assert.equal(readConfig(true), null);
});
