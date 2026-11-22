import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    isBackSwipe,
} from '../src/services/message-interactions.ts';

const app = readFileSync(
    new URL('../src/App.tsx', import.meta.url),
    'utf8'
);

const css = readFileSync(
    new URL('../src/App.css', import.meta.url),
    'utf8'
);

test('back swipe requires rightward movement', () => {
    assert.equal(isBackSwipe(12, 110, 10), true);
    assert.equal(isBackSwipe(12, 30, 2), false);
    assert.equal(isBackSwipe(60, 110, 10), false);
    assert.equal(isBackSwipe(12, 110, 80), false);
});

test('chat listens to full swipe lifecycle', () => {
    assert.match(
        app,
        /onTouchStartCapture=\{beginEdgeSwipe\}/
    );
    assert.match(
        app,
        /onTouchMoveCapture=\{moveEdgeSwipe\}/
    );
    assert.match(
        app,
        /onTouchEndCapture=\{endEdgeSwipe\}/
    );
    assert.match(
        app,
        /onTouchCancelCapture=\{cancelEdgeSwipe\}/
    );
});

test('swipe follows finger and can be cancelled', () => {
    assert.match(app, /--camplink-chat-swipe-x/);
    assert.match(app, /is-edge-swiping/);
    assert.match(app, /clearEdgeSwipe\(panel\)/);
    assert.match(app, /returnToChats\(\)/);
});

test('mobile chat slides instead of disappearing', () => {
    assert.match(css, /camplink-nav-duration:\s*320ms/);
    assert.match(css, /translate3d\(100%, 0, 0\)/);
    assert.match(css, /translate3d\(-12%, 0, 0\)/);
    assert.match(
        css,
        /\.chat\.is-edge-swiping\s*\{[^}]*transition:\s*none/s
    );

    assert.equal(
        css.includes(
            '.mobile-chat-open .sidebar,\\n' +
            '.messenger.is-mobile.mobile-contacts-open .chat {\\n' +
            '    display: none;'
        ),
        false
    );
});

test('reduced motion is supported', () => {
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /--camplink-nav-duration:\s*0ms/);
});
