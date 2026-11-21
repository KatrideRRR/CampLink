export type ChatPeer = {
    id: number;
    username: string;
    displayName?: string;
    lastMessageId: number | null;
};

type ChatStorage = Pick<
    Storage,
    'getItem' | 'setItem'
>;

const PREFIX = 'camplink.chat-list.v1.';

function validPeer(value: unknown): value is ChatPeer {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const peer = value as Partial<ChatPeer>;

    return (
        Number.isSafeInteger(peer.id) &&
        Number(peer.id) > 0 &&
        typeof peer.username === 'string' &&
        /^[a-z0-9_]{3,24}$/.test(peer.username) &&
        (
            peer.lastMessageId === null ||
            (
                Number.isSafeInteger(peer.lastMessageId) &&
                Number(peer.lastMessageId) > 0
            )
        )
    );
}

export function sortChatList(
    peers: ChatPeer[]
): ChatPeer[] {
    return peers.filter(validPeer).sort((a, b) => {
        const first = a.lastMessageId ?? 0;
        const second = b.lastMessageId ?? 0;

        if (first !== second) {
            return second - first;
        }

        return a.username.localeCompare(b.username);
    });
}

export function readChatList(
    userId: number,
    storage?: ChatStorage
): ChatPeer[] {
    try {
        const source = storage ?? window.localStorage;
        const raw = source.getItem(PREFIX + userId);

        if (!raw) return [];

        const parsed: unknown = JSON.parse(raw);

        return Array.isArray(parsed)
            ? sortChatList(parsed)
            : [];
    } catch {
        return [];
    }
}

export function saveChatList(
    userId: number,
    peers: ChatPeer[],
    storage?: ChatStorage
): void {
    try {
        const source = storage ?? window.localStorage;

        source.setItem(
            PREFIX + userId,
            JSON.stringify(sortChatList(peers))
        );
    } catch {
        // A storage failure does not block online chats.
    }
}
