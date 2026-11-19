
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
    buildSnapshot,
    restoreSnapshot,
} from './native-cache-model';

const KEY = 'camplink.native.chat.snapshot.v1';

let lastSaved: string | null = null;

function isIos() {
    return Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === 'ios';
}

export async function backupIosSnapshot(
    userId: number
): Promise<boolean> {
    if (!isIos()) return false;

    const snapshot = buildSnapshot(
        userId,
        window.localStorage
    );

    if (!snapshot) return false;
    if (snapshot === lastSaved) return true;

    await Preferences.set({
        key: KEY,
        value: snapshot,
    });

    lastSaved = snapshot;
    return true;
}

export async function restoreIosSnapshot():
    Promise<boolean> {
    if (!isIos()) return false;

    const { value } = await Preferences.get({
        key: KEY,
    });

    return value
        ? restoreSnapshot(value, window.localStorage)
        : false;
}

export async function clearIosSnapshot():
    Promise<void> {
    if (!isIos()) return;

    await Preferences.remove({ key: KEY });
    lastSaved = null;
}
