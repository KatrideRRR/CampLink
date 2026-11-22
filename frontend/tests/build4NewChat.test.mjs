import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialog = readFileSync(
    new URL(
        '../src/components/NewChatDialog.tsx',
        import.meta.url
    ),
    'utf8'
);

const css = readFileSync(
    new URL('../src/App.css', import.meta.url),
    'utf8'
);

test('dialog is rendered outside messenger layout', () => {
    assert.match(dialog, /createPortal\(/);
    assert.match(dialog, /document\.body/);
});

test('mobile dialog does not auto-focus search', () => {
    assert.match(dialog, /pointer: coarse/);
    assert.match(dialog, /Capacitor\.isNativePlatform\(\)/);
    assert.match(dialog, /preventScroll: true/);
});

test('search still supports all identifiers', () => {
    assert.match(dialog, /Имя, телефон, email, #ID/);
    assert.match(dialog, /api\/users\/suggest/);
    assert.match(dialog, /onChoose\(user, openChat\)/);
});

test('dialog keeps search and user actions', () => {
    assert.match(dialog, /role="dialog"/);
    assert.match(dialog, /aria-modal="true"/);
    assert.match(dialog, /Написать/);
    assert.match(dialog, /Добавить/);
});

test('search input avoids iOS text zoom', () => {
    assert.match(
        css,
        /\.new-chat-search input\s*\{[^}]*font-size:\s*16px/s
    );
});

test('modal follows visible viewport height', () => {
    assert.match(css, /--camplink-viewport-height/);
    assert.match(css, /--camplink-viewport-top/);
    assert.match(css, /safe-area-inset/);
});

test('modal uses compact responsive dimensions', () => {
    assert.match(css, /max-width:\s*400px/);
    assert.match(css, /max-height:\s*100%/);
    assert.match(css, /max-width:\s*520px/);
});
