import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    formatVoiceTime,
    voiceBarLevels,
} from '../src/services/voice-visualization.ts';

function source(path) {
    return readFileSync(
        new URL(path, import.meta.url),
        'utf8'
    );
}

const app = source('../src/App.tsx');
const bubble = source('../src/components/MediaBubble.tsx');
const recording = source(
    '../src/components/VoiceRecordingBar.tsx'
);
const player = source(
    '../src/components/VoiceMessagePlayer.tsx'
);

test('voice timer formats seconds and minutes', () => {
    assert.equal(formatVoiceTime(0), '0:00');
    assert.equal(formatVoiceTime(9.8), '0:09');
    assert.equal(formatVoiceTime(65), '1:05');
    assert.equal(formatVoiceTime(90), '1:30');
    assert.equal(formatVoiceTime(-10), '0:00');
    assert.equal(formatVoiceTime(Infinity), '0:00');
});

test('waveform uses actual spectrum values', () => {
    const silent = new Uint8Array(128);
    const loud = new Uint8Array(128).fill(220);

    const silentBars = voiceBarLevels(silent, 28);
    const loudBars = voiceBarLevels(loud, 28);

    assert.equal(silentBars.length, 28);
    assert.equal(loudBars.length, 28);

    assert.ok(silentBars.every(value => value === 0));
    assert.ok(loudBars.every(value => value > 0));
    assert.ok(loudBars.every(value => value <= 1));
});

test('recorder listens to microphone through Web Audio', () => {
    assert.match(recording, /createMediaStreamSource\(stream\)/);
    assert.match(recording, /createAnalyser\(\)/);
    assert.match(recording, /getByteFrequencyData\(spectrum\)/);
    assert.match(recording, /requestAnimationFrame\(draw\)/);
    assert.match(recording, /audioContext\.close\(\)/);
});

test('recording has cancel and send actions', () => {
    assert.match(app, /<VoiceRecordingBar/);
    assert.match(app, /stopVoiceRecording\(true\)/);
    assert.match(app, /stopVoiceRecording\(false\)/);
    assert.match(app, /Отменить голосовое сообщение/);
    assert.match(app, /Отправить голосовое сообщение/);
});

test('voice messages use one visual bubble', () => {
    assert.match(app, /voice-only/);
    assert.match(bubble, /<VoiceMessagePlayer url=\{url\}/);
    assert.doesNotMatch(bubble, /className="voice-message"/);
});

test('voice player can play, pause and seek', () => {
    assert.match(player, /audio\.play\(\)/);
    assert.match(player, /audio\.pause\(\)/);
    assert.match(player, /audio\.currentTime = time/);
    assert.match(player, /preload="metadata"/);
});
