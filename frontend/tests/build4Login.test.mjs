import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(
    new URL(path, import.meta.url),
    'utf8'
);

const app = read('../src/App.tsx');
const login = read('../src/components/LoginForm.tsx');
const css = read('../src/App.css');
const bar = read('../src/components/VoiceRecordingBar.tsx');

test('new login form is connected', () => {
    assert.match(app, /<LoginForm/);
    assert.match(app, /username: identifier/);
    assert.match(app, /native-login/);
});

test('only email and phone appear as login methods', () => {
    assert.match(login, /Телефон/);
    assert.match(login, /Email/);
    assert.match(login, /isValidPhoneNumber/);
    assert.doesNotMatch(login, /Никнейм/);
});

test('saved password autofill hints are present', () => {
    assert.match(login, /autoComplete="username"/);
    assert.match(login, /autoComplete="current-password"/);
    assert.match(login, /name="password"/);
});

test('login has scrollable keyboard-safe layout', () => {
    assert.match(css, /scroll-padding-bottom:\s*32px/);
    assert.match(css, /--camplink-viewport-height/);
    assert.match(css, /overflow-y:\s*auto/);
});

test('voice gestures have animated visual states', () => {
    assert.match(bar, /voice-record-\$\{gesture\}/);
    assert.match(bar, /gesture === 'cancel'/);
    assert.match(css, /voice-lock-pop/);
    assert.match(css, /voice-panel-enter/);
});
