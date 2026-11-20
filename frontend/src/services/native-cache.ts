
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
    createSnapshotWriteQueue,
} from './snapshot-write-queue';
import {
    buildSnapshot,
    restoreSnapshot,
} from './native-cache-model';

const KEY = 'camplink.native.chat.snapshot.v1';

const snapshotWrites = createSnapshotWriteQueue(
    async (value) => {
        await Preferences.set({
            key: KEY,
            value,
        });
    }
);

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
    await snapshotWrites.save(snapshot);
    return true;
}

export async function restoreIosSnapshot():
    Promise<boolean> {
    if (!isIos()) return false;

    await snapshotWrites.flush();

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

    await snapshotWrites.flush();
    await Preferences.remove({ key: KEY });
    snapshotWrites.reset();
}
