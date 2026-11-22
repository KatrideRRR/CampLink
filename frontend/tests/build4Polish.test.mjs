import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
    return readFileSync(
        new URL(path, import.meta.url),
        'utf8'
    );
}

const app = read('../src/App.tsx');
const settings = read('../src/components/SettingsPage.tsx');
const prompt = read('../src/components/PasskeySetupPrompt.tsx');
const passkeys = read('../src/services/passkeys.ts');
const player = read('../src/components/VoiceMessagePlayer.tsx');
const media = read('../src/components/MediaBubble.tsx');
const css = read('../src/App.css');

test('settings load registered keys from server', () => {
    assert.match(passkeys, /listCampLinkPasskeys/);
    assert.match(passkeys, /api\/passkeys/);
    assert.match(settings, /listCampLinkPasskeys\(\)/);
    assert.match(settings, /Ключи доступа подключены/);
    assert.match(settings, /Добавить ещё один ключ/);
});

test('first password login can offer passkey setup', () => {
    assert.match(app, /setPasskeyOfferUserId/);
    assert.match(app, /<PasskeySetupPrompt/);
    assert.match(app, /keys\.length === 0/);
    assert.match(prompt, /Включить быстрый вход/);
    assert.match(prompt, /Не сейчас/);
});

test('voice player allows parent message gestures', () => {
    assert.doesNotMatch(
        player,
        /onTouchStart=\{event => event\.stopPropagation\(\)\}/
    );
    assert.doesNotMatch(
        player,
        /onDoubleClick=\{event => event\.stopPropagation\(\)\}/
    );
    assert.match(player, /onReact\(\)/);
    assert.match(media, /onReact=\{onReact\}/);
});

test('audio playback and seeking remain independent', () => {
    assert.match(app, /target\.closest\(/);
    assert.match(app, /button, input, a/);
    assert.match(player, /audio\.play\(\)/);
    assert.match(player, /audio\.pause\(\)/);
    assert.match(player, /audio\.currentTime = time/);
});

test('microphone follows gesture progress', () => {
    assert.match(app, /voiceGestureActive/);
    assert.match(app, /className="voice-drag-mic"/);
    assert.match(css, /--voice-lift/);
    assert.match(css, /--voice-cancel-progress/);
    assert.match(css, /voice-drag-appear/);
});
