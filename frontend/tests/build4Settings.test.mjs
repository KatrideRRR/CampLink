import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(
    new URL('../src/App.tsx', import.meta.url),
    'utf8'
);

const settings = readFileSync(
    new URL(
        '../src/components/SettingsPage.tsx',
        import.meta.url
    ),
    'utf8'
);

const sound = readFileSync(
    new URL(
        '../src/services/notification-sound.ts',
        import.meta.url
    ),
    'utf8'
);

test('settings page is connected to messenger', () => {
    assert.match(app, /<SettingsPage/);
    assert.match(app, /setSettingsOpen\(true\)/);
    assert.match(app, /onThemeChange=/);
    assert.match(app, /onLogout=\{handleLogout\}/);
});

test('main header has profile, new chat and settings', () => {
    assert.match(app, /className="profile-summary"/);
    assert.match(app, /aria-label="Новый чат"/);
    assert.match(app, /aria-label="Открыть настройки"/);
});

test('chat back button is compact', () => {
    assert.match(
        app,
        /aria-label="Вернуться к списку чатов"/
    );
    assert.doesNotMatch(
        app,
        /<span>Чаты<\/span>/
    );
});

test('sound toggle is absent from main header', () => {
    assert.doesNotMatch(
        app,
        /className="theme-button sound-toggle"/
    );
    assert.doesNotMatch(
        sound,
        /if \(!readNotificationSoundEnabled\(\)\) return;/
    );
});

test('settings offer theme, push and logout', () => {
    assert.match(settings, /Тема оформления/);
    assert.match(settings, /Push-уведомления/);
    assert.match(settings, /Выйти из аккаунта/);
    assert.match(settings, /onLogout/);
});
