
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    loadThemePreference,
    nextThemePreference,
    resolveTheme,
    saveThemePreference,
} from '../src/services/theme.ts';

test('system theme follows OS preference', () => {
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
});

test('manual preference overrides the OS', () => {
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
});

test('theme switcher cycles through all modes', () => {
    assert.equal(nextThemePreference('system'), 'light');
    assert.equal(nextThemePreference('light'), 'dark');
    assert.equal(nextThemePreference('dark'), 'system');
});

test('theme preference is saved and restored', () => {
    const values = new Map();

    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };

    assert.equal(loadThemePreference(storage), 'system');

    saveThemePreference('light', storage);

    assert.equal(loadThemePreference(storage), 'light');

    values.set('camplink.theme', 'invalid');

    assert.equal(loadThemePreference(storage), 'system');
});
