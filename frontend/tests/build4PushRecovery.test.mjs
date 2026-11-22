import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(
    new URL(path, import.meta.url),
    'utf8'
);

const app = read('../src/App.tsx');
const settings = read('../src/components/SettingsPage.tsx');
const css = read('../src/App.css');

test('Push re-registers after iOS returns to foreground', () => {
    assert.match(app, /restoreIosPushRegistration\(\)/);
    assert.match(app, /appStateChange/);
    assert.match(app, /visibilitychange/);
    assert.match(app, /60000/);
});

test('settings show incoming messages', () => {
    assert.match(
        app,
        /document\.querySelector\('\.settings-screen'\) === null/
    );
    assert.match(app, /setSettingsOpen\(false\)/);
    assert.match(
        css,
        /\.messenger \.incoming-toast\s*\{[^}]*z-index:\s*8100/s
    );
});

test('Push diagnostics are accessible in settings', () => {
    assert.match(settings, /Проверить подключение/);
    assert.match(settings, /Отправить тестовый Push/);
    assert.match(settings, /registeredDevices/);
    assert.match(settings, /serverEnabled/);
    assert.match(app, /\/api\/push\/status/);
    assert.match(app, /\/api\/push\/test/);
});
