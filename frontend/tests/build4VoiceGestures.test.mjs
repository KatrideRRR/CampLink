import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    classifyVoiceGesture,
    previewVoiceGesture,
} from '../src/services/voice-gesture.ts';

function gesture(
    endX,
    endY,
    elapsedMs
) {
    return {
        startX: 200,
        startY: 400,
        currentX: endX,
        currentY: endY,
        elapsedMs,
    };
}

test('quick tap keeps recording active', () => {
    assert.equal(
        classifyVoiceGesture(gesture(200, 400, 120)),
        'keep'
    );
});

test('long hold release sends audio', () => {
    assert.equal(
        classifyVoiceGesture(gesture(200, 400, 1100)),
        'send'
    );
});

test('upward swipe locks recording', () => {
    assert.equal(
        classifyVoiceGesture(gesture(200, 300, 500)),
        'lock'
    );
});

test('left swipe cancels recording', () => {
    assert.equal(
        classifyVoiceGesture(gesture(90, 400, 500)),
        'cancel'
    );
});

test('upward swipe works even when quick', () => {
    assert.equal(
        classifyVoiceGesture(gesture(200, 300, 140)),
        'lock'
    );
});

test('small movement is not a swipe', () => {
    assert.equal(
        classifyVoiceGesture(gesture(195, 390, 150)),
        'keep'
    );
});

test('gesture preview shows correct intent', () => {
    assert.equal(
        previewVoiceGesture(gesture(200, 300, 100)),
        'lock'
    );

    assert.equal(
        previewVoiceGesture(gesture(90, 400, 100)),
        'cancel'
    );

    assert.equal(
        previewVoiceGesture(gesture(200, 400, 100)),
        'holding'
    );
});

test('App connects pointer gestures to recorder', () => {
    const app = readFileSync(
        new URL('../src/App.tsx', import.meta.url),
        'utf8'
    );

    assert.match(app, /onPointerDown=\{beginVoicePointer\}/);
    assert.match(app, /onPointerMove=\{moveVoicePointer\}/);
    assert.match(app, /onPointerUp=\{endVoicePointer\}/);
    assert.match(app, /onPointerCancel=\{cancelVoicePointer\}/);
    assert.match(app, /setPointerCapture\(event\.pointerId\)/);
    assert.match(app, /classifyVoiceGesture\(/);
});

test('recorder handles pending microphone permission', () => {
    const app = readFileSync(
        new URL('../src/App.tsx', import.meta.url),
        'utf8'
    );

    assert.match(app, /voiceStartPendingRef/);
    assert.match(app, /voiceDeferredActionRef/);
    assert.match(app, /voiceStartGenerationRef/);
});
