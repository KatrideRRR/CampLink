import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(
    new URL(path, import.meta.url),
    'utf8'
);

const app = read('../src/App.tsx');
const login = read('../src/components/LoginForm.tsx');
const settings = read('../src/components/SettingsPage.tsx');
const service = read('../src/services/passkeys.ts');

test('passkey login is connected to CampLink', () => {
    assert.match(app, /handlePasskeyLogin/);
    assert.match(app, /loginWithCampLinkPasskey/);
    assert.match(app, /saveNativeSession/);
    assert.match(login, /onPasskeyLogin/);
});

test('passkey enrollment requires the logged-in account', () => {
    assert.match(settings, /onCreatePasskey/);
    assert.match(app, /createCampLinkPasskey/);
    assert.match(service, /register\/options/);
    assert.match(service, /register\/verify/);
});

test('client uses native WebAuthn plugin', () => {
    assert.match(service, /Passkeys\.createPasskey/);
    assert.match(service, /Passkeys\.getPasskey/);
    assert.match(service, /Passkeys\.isAvailable/);
});

test('password login stays available', () => {
    assert.match(login, /current-password/);
    assert.match(login, /Телефон/);
    assert.match(login, /Email/);
});
