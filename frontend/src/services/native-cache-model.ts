
type Store = Pick<Storage, 'getItem' | 'setItem'>;

const PROFILE = 'camplink.offline.profile.v1';
const DATA = 'camplink.offline.data.v1.';
const OUTBOX = 'camplink.outbox.v1.';

type Snapshot = {
    version: 1;
    userId: number;
    profile: string;
    data: string | null;
    outbox: string | null;
};

export function buildSnapshot(
    userId: number,
    store: Store
): string | null {
    try {
        const profile = store.getItem(PROFILE);

        if (!profile) return null;

        const parsed = JSON.parse(profile);

        if (
            !Number.isSafeInteger(userId) ||
            userId <= 0 ||
            parsed?.user?.id !== userId
        ) {
            return null;
        }

        const snapshot: Snapshot = {
            version: 1,
            userId,
            profile,
            data: store.getItem(DATA + userId),
            outbox: store.getItem(OUTBOX + userId),
        };

        return JSON.stringify(snapshot);
    } catch {
        return null;
    }
}

export function restoreSnapshot(
    raw: string,
    store: Store
): boolean {
    try {
        const snapshot = JSON.parse(raw) as Snapshot;

        if (
            snapshot.version !== 1 ||
            !Number.isSafeInteger(snapshot.userId) ||
            snapshot.userId <= 0 ||
            typeof snapshot.profile !== 'string'
        ) {
            return false;
        }

        const profile = JSON.parse(snapshot.profile);

        if (profile?.user?.id !== snapshot.userId) {
            return false;
        }

        const existing = store.getItem(PROFILE);

        if (
            existing &&
            JSON.parse(existing)?.user?.id !== snapshot.userId
        ) {
            return false;
        }

        // Existing local data takes priority.
        if (!existing) {
            store.setItem(PROFILE, snapshot.profile);
        }

        for (const [key, value] of [
            [DATA + snapshot.userId, snapshot.data],
            [OUTBOX + snapshot.userId, snapshot.outbox],
        ] as const) {
            if (
                typeof value === 'string' &&
                !store.getItem(key)
            ) {
                JSON.parse(value);
                store.setItem(key, value);
            }
        }

        return true;
    } catch {
        return false;
    }
}
