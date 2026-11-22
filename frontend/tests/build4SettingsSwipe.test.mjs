import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    isBackSwipe,
} from '../src/services/message-interactions.ts';

const settings = readFileSync(
    new URL(
        '../src/components/SettingsPage.tsx',
        import.meta.url
    ),
    'utf8'
);

const css = readFileSync(
    new URL('../src/App.css', import.meta.url),
    'utf8'
);

test('edge swipe uses same threshold as chat', () => {
    assert.equal(isBackSwipe(12, 110, 10), true);
    assert.equal(isBackSwipe(12, 30, 2), false);
    assert.equal(isBackSwipe(60, 110, 10), false);
    assert.equal(isBackSwipe(12, 110, 80), false);
});

test('settings handle complete swipe lifecycle', () => {
    assert.match(settings, /onTouchStartCapture=\{beginSettingsSwipe\}/);
    assert.match(settings, /onTouchMoveCapture=\{moveSettingsSwipe\}/);
    assert.match(settings, /onTouchEndCapture=\{endSettingsSwipe\}/);
    assert.match(settings, /onTouchCancelCapture=\{cancelSettingsSwipe\}/);
});

test('settings close only after valid swipe', () => {
    assert.match(settings, /isBackSwipe\(start\.x, dx, dy\)/);
    assert.match(settings, /closeSettings\(\)/);
    assert.match(settings, /onClick=\{closeSettings\}/);
    assert.match(settings, /resetSettingsSwipe/);
});

test('settings animate in both directions', () => {
    assert.match(css, /camplink-settings-enter/);
    assert.match(css, /is-settings-swiping/);
    assert.match(css, /is-settings-closing/);
    assert.match(css, /translate3d\(100%, 0, 0\)/);
    assert.match(css, /prefers-reduced-motion: reduce/);
});
