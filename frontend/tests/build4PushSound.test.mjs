import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sound = readFileSync(
    new URL('../src/services/notification-sound.ts', import.meta.url),
    'utf8'
);

const xcode = readFileSync(
    new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url),
    'utf8'
);

const wav = readFileSync(
    new URL('../ios/App/App/camplink_message.wav', import.meta.url)
);

test('foreground sound has a prominent output level', () => {
    assert.match(sound, /oscillator\.type = 'triangle'/);
    assert.match(sound, /0\.65,/);
    assert.doesNotMatch(sound, /0\.018,/);
    assert.match(sound, /playNotificationSound/);
});

test('notification sound is included in Xcode resources', () => {
    assert.match(
        xcode,
        /camplink_message\.wav in Resources/
    );
});

test('native sound is valid and sufficiently strong', () => {
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');

    let format = null;
    let data = null;

    for (let at = 12; at + 8 <= wav.length;) {
        const tag = wav.toString('ascii', at, at + 4);
        const size = wav.readUInt32LE(at + 4);
        const start = at + 8;

        if (start + size > wav.length) break;

        if (tag === 'fmt ') {
            format = {
                codec: wav.readUInt16LE(start),
                channels: wav.readUInt16LE(start + 2),
                rate: wav.readUInt32LE(start + 4),
                bits: wav.readUInt16LE(start + 14),
            };
        }

        if (tag === 'data') {
            data = wav.subarray(start, start + size);
        }

        at = start + size + (size % 2);
    }

    assert.ok(format);
    assert.ok(data);

    assert.equal(format.codec, 1);
    assert.equal(format.channels, 1);
    assert.equal(format.bits, 16);

    const duration =
        data.length /
        (format.rate * format.channels * 2);

    assert.ok(duration > 1);
    assert.ok(duration < 30);

    let sum = 0;
    let peak = 0;
    const count = data.length / 2;

    for (let i = 0; i < data.length; i += 2) {
        const value = data.readInt16LE(i) / 32768;
        sum += value * value;
        peak = Math.max(peak, Math.abs(value));
    }

    const rms = Math.sqrt(sum / count);

    assert.ok(peak >= 0.9);
    assert.ok(peak <= 1);
    assert.ok(rms > 0.2);
});
