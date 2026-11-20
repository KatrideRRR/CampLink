import {
    useEffect,
    useRef,
    useState,
    type FormEvent,
} from 'react';
import type { Socket } from 'socket.io-client';
import { Capacitor } from '@capacitor/core';
import { connectToServer } from './services/connection';
import {
    apiFetch,
    isBundledNative,
    restoreNativeSession,
    saveNativeSession,
    clearNativeSession,
} from './services/native-auth';
import {
    enqueueOutboxMessage,
    readOutbox,
    removeOutboxMessage,
    type QueuedMessage,
} from './services/outbox';
import { observeIosLifecycle } from './services/ios-native';
import {
    clearOfflineCache,
    decideSession,
    readOfflineContacts,
    readOfflineMessages,
    readOfflineUser,
    saveOfflineContacts,
    saveOfflineMessages,
    saveOfflineUser,
} from './services/offline';
import {
    isNativeIos,
    observePushRegistration,
    observePushNavigation,
    restoreIosPushRegistration,
    registerIosPush,
    type PushStatus,
} from './services/push-ios';
import {
    backupIosSnapshot,
    restoreIosSnapshot,
    clearIosSnapshot,
} from './services/native-cache';
import {
    clearRelayCredential,
    createRelayTransport,
    saveRelayCredential,
    type RelayCredential,
} from './services/relay';
import { deliverMessage } from './services/delivery';
import {
    applyReadReceipt,
    type ReadReceipt,
} from './services/read-receipts';
import {
    selectNextPendingMessage,
} from './services/outbox-selection';
import type { MessageTransport } from './services/transports';
import { buildChatTimeline } from './services/timeline';
import {
    loadThemePreference,
    nextThemePreference,
    resolveTheme,
    saveThemePreference,
    type ThemePreference,
} from './services/theme';
import './App.css';

type User = {
    id: number;
    username: string;
};

type ChatMessage = {
    id: number;
    senderId: number;
    recipientId: number;
    clientMessageId: string;
    text: string;
    createdAt: string;
    readAt?: string | null;
};

type SendResponse = {
    ok: boolean;
    message?: ChatMessage;
    error?: string;
};

async function apiGet<T>(url: string): Promise<T> {
    const response = await apiFetch(url);

    if (!response.ok) {
        throw new Error('Request failed');
    }

    return response.json() as Promise<T>;
}

async function apiPost<T>(
    url: string,
    body: Record<string, unknown>
): Promise<T> {
    const response = await apiFetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error('Request failed');
    }

    return response.json() as Promise<T>;
}

function mergeMessages(
    previous: ChatMessage[],
    incoming: ChatMessage[]
): ChatMessage[] {
    const messages = new Map<number, ChatMessage>();

    for (const message of [...previous, ...incoming]) {
        messages.set(message.id, message);
    }

    return [...messages.values()].sort((a, b) => a.id - b.id);
}

function belongsToChat(
    message: ChatMessage,
    ownId: number,
    peerId: number
) {
    return (
        (message.senderId === ownId &&
            message.recipientId === peerId) ||
        (message.senderId === peerId &&
            message.recipientId === ownId)
    );
}

function snapshotChatNow(userId: number): void {
    void backupIosSnapshot(userId).catch(error => {
        console.warn(
            '[CampLink] Immediate cache backup failed',
            error
        );
    });
}

function App() {

    const [themePreference, setThemePreference] =
        useState<ThemePreference>(loadThemePreference);

    useEffect(() => {
        const media = window.matchMedia(
            '(prefers-color-scheme: dark)'
        );

        const applyTheme = () => {
            document.documentElement.dataset.theme =
                resolveTheme(themePreference, media.matches);
        };

        applyTheme();

        media.addEventListener('change', applyTheme);

        return () => {
            media.removeEventListener('change', applyTheme);
        };
    }, [themePreference]);

    const [pushStatus, setPushStatus] =
        useState<PushStatus>('off');

    useEffect(() => {
        return observePushRegistration(setPushStatus);
    }, []);

    async function enableIosPush() {
        setPushStatus('requesting');

        try {
            const result = await registerIosPush();
            setPushStatus(result);
        } catch (error) {
            console.error('APNs setup failed', error);
            setPushStatus('error');
        }
    }

    function cycleTheme() {
        const next = nextThemePreference(themePreference);

        saveThemePreference(next);
        setThemePreference(next);
    }

    const themeLabel =
        themePreference === 'system'
            ? 'Системная'
            : themePreference === 'light'
                ? 'Светлая'
                : 'Тёмная';

    const [loading, setLoading] = useState(true);
    const [offlinePreview, setOfflinePreview] = useState(false);
    const [me, setMe] = useState<User | null>(null);

    useEffect(() => {
        if (!me || !Capacitor.isNativePlatform()) {
            return;
        }

        let confirmed = false;

        const save = () => {
            void backupIosSnapshot(me.id)
                .then((saved) => {
                    if (saved && !confirmed) {
                        confirmed = true;
                        console.info(
                            '[CampLink] Native chat cache saved'
                        );
                    }
                })
                .catch((error) => {
                    console.warn(
                        '[CampLink] Cache backup failed',
                        error
                    );
                });
        };

        save();

        const timer = window.setInterval(save, 3000);

        return () => {
            window.clearInterval(timer);
        };
    }, [me]);

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const [peers, setPeers] = useState<User[]>([]);
    const [selectedPeerId, setSelectedPeerId] =
        useState<number | null>(null);
    const [mobileChatOpen, setMobileChatOpen] = useState(false);
    const [pendingPushPeerId, setPendingPushPeerId] =
        useState<number | null>(null);

    useEffect(() => {
        return observePushNavigation(setPendingPushPeerId);
    }, []);

    const [mobileView, setMobileView] = useState(
        () => Capacitor.isNativePlatform() ||
            window.matchMedia('(max-width: 900px)').matches
    );

    useEffect(() => {
        const query = window.matchMedia('(max-width: 900px)');

        const update = () => {
            setMobileView(
                Capacitor.isNativePlatform() || query.matches
            );
        };

        query.addEventListener('change', update);

        return () => {
            query.removeEventListener('change', update);
        };
    }, []);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [connected, setConnected] = useState(false);
    const [showOfflineBanner, setShowOfflineBanner] =
        useState(false);
    const [pendingMessages, setPendingMessages] =
        useState<QueuedMessage[]>([]);
    const [error, setError] = useState('');
    const [rejectedMessageIds, setRejectedMessageIds] =
        useState<string[]>([]);

    const [onlineIds, setOnlineIds] =
        useState<number[]>([]);
    const [toast, setToast] = useState<{
        peerId: number;
        name: string;
        text: string;
    } | null>(null);

    const peersRef = useRef<User[]>([]);

    useEffect(() => {
        peersRef.current = peers;
    }, [peers]);

    useEffect(() => {
        if (!toast) return;

        const timer = window.setTimeout(
            () => setToast(null),
            4500
        );

        return () => window.clearTimeout(timer);
    }, [toast]);

    const socketRef = useRef<Socket | null>(null);
    const drainQueueRef = useRef<() => void>(() => {});
    const selectedPeerRef = useRef<number | null>(null);
    const messageListRef = useRef<HTMLDivElement | null>(null);
    const composerInputRef = useRef<HTMLInputElement | null>(null);
    const forceScrollAfterSendRef = useRef(false);
    const nearBottomRef = useRef(true);
    const previousScrollPeerRef = useRef<number | null>(null);
    const [showJumpToBottom, setShowJumpToBottom] =
        useState(false);

    const lastReadSentRef = useRef<string | null>(null);
    const readPendingRef = useRef<string | null>(null);
    const keyboardFollowBottomRef = useRef(true);

    useEffect(() => {
        if (!me || pendingPushPeerId === null) return;

        if (pendingPushPeerId !== me.id) {
            selectedPeerRef.current = pendingPushPeerId;
            setSelectedPeerId(pendingPushPeerId);
            setMessages(
                readOfflineMessages(me.id, pendingPushPeerId)
            );
            setMobileChatOpen(true);
        }

        setPendingPushPeerId(null);
    }, [me, pendingPushPeerId]);

    useEffect(() => {
        if (!me || !isNativeIos) return;

        let active = true;

        void restoreIosPushRegistration()
            .then((registered) => {
                if (active && registered) {
                    setPushStatus('registered');
                }
            })
            .catch(() => {
                if (active) setPushStatus('error');
            });

        return () => {
            active = false;
        };
    }, [me]);

    useEffect(() => {
        if (!me || connected) {
            setShowOfflineBanner(false);
            return;
        }

        const timer = window.setTimeout(() => {
            setShowOfflineBanner(true);
        }, 3000);

        return () => window.clearTimeout(timer);
    }, [me, connected]);

    useEffect(() => {
        const reconnect = () => {
            const socket = socketRef.current;
            if (!socket) return;

            socket.disconnect();
            socket.connect();
        };

        const scrollToLatest = () => {
            if (!keyboardFollowBottomRef.current) return;

            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    const list = messageListRef.current;

                    if (!list) return;

                    list.scrollTo({
                        top: list.scrollHeight,
                        behavior: 'auto',
                    });

                    nearBottomRef.current = true;
                });
            });
        };

        return observeIosLifecycle(
            reconnect,
            scrollToLatest,
            (available) => {
                const socket = socketRef.current;
                if (!socket) return;

                socket.disconnect();

                if (available) {
                    socket.connect();
                }
            },
            () => {
                keyboardFollowBottomRef.current =
                    nearBottomRef.current;
            }
        );
    }, []);

    const selectedPeer =
        peers.find((peer) => peer.id === selectedPeerId) ??
        null;

    const timeline =
        me && selectedPeerId !== null
            ? buildChatTimeline(
                messages,
                pendingMessages,
                me.id,
                selectedPeerId
            )
            : [];

    function markVisibleMessagesRead() {
        const socket = socketRef.current;

        if (
            !me ||
            !socket?.connected ||
            selectedPeerId === null ||
            document.visibilityState !== 'visible' ||
            (mobileView && !mobileChatOpen) ||
            !nearBottomRef.current
        ) {
            return;
        }

        const lastIncomingId = messages.reduce(
            (maximum, message) => {
                if (
                    message.senderId === selectedPeerId &&
                    message.recipientId === me.id
                ) {
                    return Math.max(maximum, message.id);
                }

                return maximum;
            },
            0
        );

        if (lastIncomingId === 0) return;

        const key =
            `${me.id}:${selectedPeerId}:${lastIncomingId}`;

        if (
            lastReadSentRef.current === key ||
            readPendingRef.current === key
        ) {
            return;
        }

        readPendingRef.current = key;

        socket.timeout(5000).emit(
            'chat:read',
            {
                peerId: selectedPeerId,
                throughId: lastIncomingId,
            },
            (
                error: Error | null,
                response?: { ok?: boolean }
            ) => {
                if (readPendingRef.current === key) {
                    readPendingRef.current = null;
                }

                if (!error && response?.ok) {
                    lastReadSentRef.current = key;
                }
            }
        );
    }

    useEffect(() => {
        const update = () => markVisibleMessagesRead();

        update();

        document.addEventListener(
            'visibilitychange', update
        );
        window.addEventListener('focus', update);

        return () => {
            document.removeEventListener(
                'visibilitychange', update
            );
            window.removeEventListener('focus', update);
        };
    }, [
        me,
        messages,
        selectedPeerId,
        connected,
        mobileView,
        mobileChatOpen,
    ]);

    function previewFor(peerId: number): string {
        if (!me) return '';

        const history = readOfflineMessages(
            me.id, peerId
        );
        const confirmed = history.at(-1);

        const queued = pendingMessages
            .filter(item => item.toUserId === peerId)
            .at(-1);

        if (
            queued &&
            (!confirmed ||
                Date.parse(queued.createdAt) >=
                Date.parse(confirmed.createdAt))
        ) {
            return `Вы: ${queued.text}`;
        }

        if (!confirmed) return 'Нет сообщений';

        return (
            (confirmed.senderId === me.id
                ? 'Вы: ' : '') + confirmed.text
        );
    }

    useEffect(() => {
        let active = true;

        async function restoreSession() {
            if (isBundledNative()) {
                try {
                    await restoreIosSnapshot();
                    await restoreNativeSession();
                } catch (error) {
                    console.warn(
                        'Native session restore failed',
                        error
                    );
                }
            }

            const cached = readOfflineUser();

            let status: number | 'unreachable' = 'unreachable';
            let serverUser: User | null = null;

            const controller = new AbortController();

            const timer = window.setTimeout(() => {
                controller.abort();
            }, 4000);

            try {
                const response = await apiFetch('/api/auth/me', {
                    cache: 'no-store',
                    signal: controller.signal,
                });

                status = response.status;

                if (response.ok) {
                    const result = await response.json() as {
                        user: User;
                    };

                    serverUser = result.user;
                }
            } catch {
                status = 'unreachable';
            } finally {
                window.clearTimeout(timer);
            }

            if (!active) return;

            const result = decideSession(
                status,
                cached,
                serverUser
            );

            if (
                result.invalidate &&
                cached &&
                !isBundledNative()
            ) {
                clearOfflineCache(cached.id);
            }

            if (result.user && !result.offline) {
                saveOfflineUser(result.user);
            }

            setMe(result.user);
            setOfflinePreview(result.offline);

            if (!result.user && status !== 401) {
                setError(
                    'Сервер недоступен. Для первого входа нужна связь.'
                );
            }

            setLoading(false);
        }

        void restoreSession();

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!me) return;

        let active = true;


        const cachedContacts = readOfflineContacts(me.id);

        setPeers(cachedContacts);

        if (
            cachedContacts.length > 0 &&
            selectedPeerRef.current === null
        ) {
            selectedPeerRef.current = cachedContacts[0].id;
            setSelectedPeerId(cachedContacts[0].id);
        }

        apiGet<{ users: User[] }>('/api/users')
            .then(({ users }) => {
                if (!active) return;

                saveOfflineContacts(me.id, users);

                setPeers(users);

                if (users.length > 0 && selectedPeerRef.current === null) {
                    selectedPeerRef.current = users[0].id;
                    setSelectedPeerId(users[0].id);
                }
            })
            .catch(() => {
                if (active && cachedContacts.length === 0) {
                    setError('Не удалось загрузить контакты');
                }
            });

        const socket = connectToServer(setConnected);
        socketRef.current = socket;

        const relayTransport = createRelayTransport(
            me.id,
            import.meta.env.VITE_CAMPLINK_RELAY_URL ?? ''
        );

        const relayedInSession = new Set<string>();
        const rejectedInSession = new Set<string>();

        setRejectedMessageIds([]);

        async function refreshRelayCredential() {
            try {
                const response = await apiFetch(
                    '/api/relay/credential',
                    { cache: 'no-store' }
                );

                if (!response.ok) return;

                const credential =
                    await response.json() as RelayCredential;

                if (active) {
                    saveRelayCredential(me.id, credential);
                }
            } catch {
                // Existing credential stays available offline.
            }
        }

        void refreshRelayCredential();

        const internetTransport: MessageTransport = {
            id: 'primary-internet',
            kind: 'internet',
            priority: 10,

            async isAvailable() {
                return socket.connected;
            },

            async send(message) {
                return new Promise((resolve, reject) => {
                    socket.timeout(5000).emit(
                        'chat:send',
                        {
                            toUserId: message.toUserId,
                            clientMessageId: message.clientMessageId,
                            text: message.text,
                            clientCreatedAt: message.createdAt,
                        },
                        (
                            error: Error | null,
                            response?: SendResponse
                        ) => {
                            if (error) {
                                reject(error);
                                return;
                            }

                            if (!response) {
                                reject(
                                    new Error('No server acknowledgement')
                                );
                                return;
                            }

                            resolve(response);
                        }
                    );
                });
            },
        };

        setPendingMessages(readOutbox(me.id));

        let flushing = false;

        async function drainQueue() {
            if (!active || flushing) {
                return;
            }

            flushing = true;

            try {

                while (active) {
                    const next = selectNextPendingMessage(
                        readOutbox(me.id),
                        socket.connected,
                        relayedInSession,
                        rejectedInSession
                    );

                    if (!next) break;

                    const result = await deliverMessage(next, [
                        internetTransport,
                        relayTransport,
                    ]);

                    if (!active) break;

                    if (result.status === 'relayed') {
                        relayedInSession.add(next.clientMessageId);
                        continue;
                    }

                    if (result.status !== 'sent') {
                        if (result.status === 'rejected') {
                            rejectedInSession.add(
                                next.clientMessageId
                            );

                            setRejectedMessageIds(current => [
                                ...new Set([
                                    ...current,
                                    next.clientMessageId,
                                ]),
                            ]);

                            setError(
                                'Некоторые сообщения не доставлены. ' +
                                'Они сохранены в очереди.'
                            );

                            continue;
                        }

                        break;
                    }

                    const response: SendResponse = {
                        ok: true,
                        message: result.message,
                    };

                    if (!active) break;

                    if (!response?.ok || !response.message) {
                        break;
                    }

                    try {
                        setPendingMessages(
                            removeOutboxMessage(
                                me.id,
                                next.clientMessageId
                            )
                        );
                    } catch {
                        setError(
                            'Не удалось обновить локальную очередь'
                        );
                        break;
                    }

                    const message = response.message;
                    saveOfflineMessages(
                        me.id,
                        message.recipientId,
                        [message]
                    );

                    snapshotChatNow(me.id);

                    const peerId = selectedPeerRef.current;

                    if (
                        peerId !== null &&
                        belongsToChat(message, me.id, peerId)
                    ) {
                        setMessages((current) =>
                            mergeMessages(current, [message])
                        );
                    }
                }
            } finally {
                flushing = false;
            }
        }

        drainQueueRef.current = () => {
            void drainQueue();
        };

        socket.on('presence:snapshot', (
            payload: { userIds?: unknown }
        ) => {
            if (!Array.isArray(payload?.userIds)) return;

            setOnlineIds(
                payload.userIds.filter(
                    (id): id is number =>
                        Number.isSafeInteger(id) && id > 0
                )
            );
        });

        socket.on('presence:update', (
            payload: { userId?: unknown; online?: unknown }
        ) => {
            const id = payload?.userId;

            if (
                typeof id !== 'number' ||
                !Number.isSafeInteger(id) ||
                id <= 0 ||
                typeof payload.online !== 'boolean'
            ) return;

            setOnlineIds(current =>
                payload.online
                    ? [...new Set([...current, id])]
                    : current.filter(item => item !== id)
            );
        });

        socket.on('disconnect', () => {
            setOnlineIds([]);
        });

        socket.on('chat:read', (receipt: ReadReceipt) => {
            if (
                !active ||
                !Number.isSafeInteger(receipt?.readerId) ||
                receipt.readerId === me.id
            ) {
                return;
            }

            const history = readOfflineMessages(
                me.id, receipt.readerId
            );

            const updated = applyReadReceipt(
                history, me.id, receipt
            );

            if (updated !== history) {
                saveOfflineMessages(
                    me.id,
                    receipt.readerId,
                    updated
                );
                snapshotChatNow(me.id);
            }

            if (
                selectedPeerRef.current === receipt.readerId
            ) {
                setMessages(current =>
                    applyReadReceipt(
                        current, me.id, receipt
                    )
                );
            }
        });

        socket.on('chat:new', (message: ChatMessage) => {

            const partnerId =
                message.senderId === me.id
                    ? message.recipientId
                    : message.senderId;

            saveOfflineMessages(
                me.id,
                partnerId,
                [message]
            );

            snapshotChatNow(me.id);

            setPeers(current => [...current]);

            if (
                message.senderId !== me.id &&
                (
                    message.senderId !== selectedPeerRef.current ||
                    document.querySelector(
                        '.messenger.is-mobile.mobile-contacts-open'
                    ) !== null
                ) &&
                document.visibilityState === 'visible'
            ) {
                const sender = peersRef.current.find(
                    peer => peer.id === message.senderId
                );

                setToast({
                    peerId: message.senderId,
                    name: sender?.username ?? 'Новое сообщение',
                    text: message.text,
                });
            }

            if (message.senderId === me.id) {
                const queued = readOutbox(me.id);

                if (
                    queued.some(
                        (item) =>
                            item.clientMessageId ===
                            message.clientMessageId
                    )
                ) {
                    try {
                        setPendingMessages(
                            removeOutboxMessage(
                                me.id,
                                message.clientMessageId
                            )
                        );

                        rejectedInSession.delete(
                            message.clientMessageId
                        );

                        setRejectedMessageIds(current =>
                            current.filter(
                                id => id !== message.clientMessageId
                            )
                        );

                        snapshotChatNow(me.id);
                    } catch {
                        // The message remains queued for a safe retry.
                    }
                }
            }

            const peerId = selectedPeerRef.current;

            if (
                peerId !== null &&
                belongsToChat(message, me.id, peerId)
            ) {
                setMessages((current) =>
                    mergeMessages(current, [message])
                );
            }
        });

        socket.on('connect', () => {
            relayedInSession.clear();
            rejectedInSession.clear();
            setRejectedMessageIds([]);
            void refreshRelayCredential();
            setOfflinePreview(false);
            void drainQueue();
            const peerId = selectedPeerRef.current;

            if (peerId === null) return;

            apiGet<{ messages: ChatMessage[] }>(
                `/api/messages/${peerId}`
            )
                .then(({ messages: history }) => {
                    if (!active) return;

                    const cached = saveOfflineMessages(
                        me.id,
                        peerId,
                        history
                    );

                    if (selectedPeerRef.current === peerId) {
                        setMessages((current) =>
                            mergeMessages(
                                current.filter((message) =>
                                    belongsToChat(message, me.id, peerId)
                                ),
                                cached
                            )
                        );
                    }
                })
                .catch(() => {});
        });

        socket.on('connect_error', (socketError: Error) => {
            if (socketError.message !== 'Unauthorized') {
                return;
            }

            if (!active) return;

            if (isBundledNative()) {
                void clearNativeSession().catch(
                    error => console.warn(
                        'Native session cleanup failed',
                        error
                    )
                );
            } else {
                clearOfflineCache(me.id);
            }

            clearRelayCredential(me.id);
            setMe(null);
            setPeers([]);
            setMessages([]);
            setConnected(false);
            setOfflinePreview(false);
            setError('Сессия истекла. Войдите снова.');
        });

        const retryTimer = window.setInterval(() => {
            void drainQueue();
        }, 10000);

        return () => {
            active = false;
            window.clearInterval(retryTimer);
            drainQueueRef.current = () => {};
            socket.disconnect();
            socketRef.current = null;
            setConnected(false);
        };
    }, [me]);

    useEffect(() => {
        if (!me || selectedPeerId === null) return;

        let active = true;

        setMessages(
            readOfflineMessages(me.id, selectedPeerId)
        );

        apiGet<{ messages: ChatMessage[] }>(
            `/api/messages/${selectedPeerId}`
        )
            .then(({ messages: history }) => {
                if (!active) return;

                const cached = saveOfflineMessages(
                    me.id,
                    selectedPeerId,
                    history
                );

                setMessages((current) =>
                    mergeMessages(
                        current.filter((message) =>
                            belongsToChat(
                                message,
                                me.id,
                                selectedPeerId
                            )
                        ),
                        cached
                    )
                );
            })
            .catch(() => {
                if (
                    active &&
                    readOfflineMessages(
                        me.id,
                        selectedPeerId
                    ).length === 0
                ) {
                    setError('История пока недоступна');
                }
            });

        return () => {
            active = false;
        };
    }, [me, selectedPeerId]);

    function handleMessageScroll() {
        const list = messageListRef.current;
        if (!list) return;

        const remaining =
            list.scrollHeight -
            list.clientHeight -
            list.scrollTop;

        const nearBottom = remaining <= 100;
        nearBottomRef.current = nearBottom;

        setShowJumpToBottom(
            !nearBottom &&
            list.scrollHeight > list.clientHeight + 120
        );

        if (nearBottom) {
            markVisibleMessagesRead();
        }
    }

    function scrollToChatBottom(
        behavior: ScrollBehavior = 'smooth'
    ) {
        const list = messageListRef.current;
        if (!list) return;

        nearBottomRef.current = true;
        setShowJumpToBottom(false);

        list.scrollTo({
            top: list.scrollHeight,
            behavior: window.matchMedia(
                '(prefers-reduced-motion: reduce)'
            ).matches ? 'auto' : behavior,
        });
    }

    useEffect(() => {
        const list = messageListRef.current;
        if (!list) return;

        const peerChanged =
            previousScrollPeerRef.current !== selectedPeerId;

        previousScrollPeerRef.current = selectedPeerId;

        const sent = forceScrollAfterSendRef.current;
        forceScrollAfterSendRef.current = false;

        if (peerChanged) {
            nearBottomRef.current = true;
            setShowJumpToBottom(false);

            list.scrollTo({
                top: list.scrollHeight,
                behavior: 'instant',
            });
            return;
        }

        if (sent) {
            scrollToChatBottom('smooth');
            return;
        }

        // Не мешаем человеку читать старые сообщения.
        if (nearBottomRef.current) {
            list.scrollTo({
                top: list.scrollHeight,
                behavior: 'instant',
            });
        } else {
            handleMessageScroll();
        }
    }, [
        messages,
        pendingMessages,
        selectedPeerId,
        mobileChatOpen,
    ]);

    function selectPeer(id: number) {
        setMobileChatOpen(true);

        if (selectedPeerRef.current === id) {
            return;
        }

        selectedPeerRef.current = id;
        setSelectedPeerId(id);

        setMessages(
            me ? readOfflineMessages(me.id, id) : []
        );

        setDraft('');
        setError('');
    }

    async function handleLogin(event: FormEvent) {
        event.preventDefault();
        setError('');

        try {
            const native = isBundledNative();

            const result = await apiPost<{
                user: User;
                token?: string;
                expiresInSeconds?: number;
            }>(
                native
                    ? '/api/auth/native-login'
                    : '/api/auth/login',
                { username, password }
            );

            if (native) {
                try {
                    await saveNativeSession(
                        result.token ?? '',
                        result.expiresInSeconds ?? 0
                    );
                } catch {
                    setError(
                        'Не удалось сохранить защищённую сессию'
                    );
                    return;
                }
            }

            setPassword('');
            saveOfflineUser(result.user);
            setOfflinePreview(false);
            setMe(result.user);
        } catch {
            setError('Неверный логин или пароль');
        }
    }

    async function handleLogout() {
        try {
            await apiPost('/api/auth/logout', {});
            await clearNativeSession();
        } catch {
            setError('Не удалось завершить сессию');
            return;
        }
        if (me) {
            clearOfflineCache(me.id);
            clearRelayCredential(me.id);
            await clearIosSnapshot();
        }
        setPendingMessages([]);
        lastReadSentRef.current = null;
        readPendingRef.current = null;
        socketRef.current?.disconnect();
        selectedPeerRef.current = null;
        setMe(null);
        setPeers([]);
        setSelectedPeerId(null);
        setMobileChatOpen(false);
        setMessages([]);
        setConnected(false);
        setError('');
    }


    function handleSend(event: FormEvent) {
        event.preventDefault();

        const text = draft.trim();

        if (
            !me ||
            !text ||
            text.length > 2000 ||
            selectedPeerId === null
        ) {
            return;
        }

        try {
            const pending = enqueueOutboxMessage(
                me.id,
                {
                    clientMessageId: crypto.randomUUID(),
                    toUserId: selectedPeerId,
                    text,
                    createdAt: new Date().toISOString(),
                }
            );

            forceScrollAfterSendRef.current = true;
            setPendingMessages(pending);
            snapshotChatNow(me.id);
            setDraft('');
            setError('');

            if (mobileView) {
                composerInputRef.current?.focus({
                    preventScroll: true,
                });
            }

            drainQueueRef.current();
        } catch {
            setError(
                'Не удалось сохранить сообщение на устройстве'
            );
        }
    }


    if (loading) {
        return <main className="loading">CampLink</main>;
    }

    if (!me) {
        return (
            <main className="login-page">
                <div className="login-card">
                    <button
                        type="button"
                        className="theme-button login-theme-button"
                        onClick={cycleTheme}
                        title={`Тема: ${themeLabel}`}
                        aria-label={`Переключить тему. Сейчас: ${themeLabel}`}
                    >
                        ◐
                    </button>
                    <div className="brand-icon">C</div>
                    <h1>CampLink</h1>
                    <p>Связь без границ.</p>

                    <form onSubmit={handleLogin}>
                        <input
                            value={username}
                            onChange={(event) =>
                                setUsername(event.target.value)
                            }
                            placeholder="Логин"
                            autoComplete="username"
                            required
                        />

                        <input
                            type="password"
                            value={password}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                            placeholder="Пароль"
                            autoComplete="current-password"
                            required
                        />

                        <button type="submit">Войти</button>
                    </form>

                    {error && <p className="error">{error}</p>}

                    <p className="hint">
                        Доступ только по приглашению.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <main className={`messenger ${mobileView ? 'is-mobile' : ''} ${
            mobileChatOpen ? 'mobile-chat-open' : 'mobile-contacts-open'
        }`}>

            <aside className="sidebar">
                <div className="sidebar-header">
                    <div className="brand">
                        <div className="brand-icon">C</div>
                        <strong>CampLink</strong>
                    </div>


                    <div className="sidebar-actions">
                        <div
                            className={`connection-indicator ${
                                connected ? 'is-online' : ''
                            }`}
                            title={
                                connected
                                    ? 'Соединение установлено'
                                    : 'Соединение отсутствует'
                            }
                        />

                        <button
                            type="button"
                            className="theme-button"
                            onClick={cycleTheme}
                            title={`Тема: ${themeLabel}`}
                            aria-label={`Переключить тему. Сейчас: ${themeLabel}`}
                        >
                            ◐
                        </button>
                    </div>

                </div>

                <div className="account">
                    <span>@{me.username}</span>

                    {isNativeIos && pushStatus !== 'registered' && (
                        <button
                            type="button"
                            className="text-button"
                            onClick={() => void enableIosPush()}
                            disabled={pushStatus === 'requesting'}
                        >
                            {pushStatus === 'requesting'
                                    ? 'Подключаем…'
                                    : pushStatus === 'denied'
                                        ? 'Push запрещён'
                                        : pushStatus === 'error'
                                            ? 'Ошибка Push'
                                            : 'Включить Push'}
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={handleLogout}
                        className="text-button"
                    >
                        Выйти
                    </button>
                </div>

                <div className="section-heading">Сообщения</div>

                <nav className="contact-list">
                    {peers.map((peer) => (
                        <button
                            key={peer.id}
                            type="button"
                            className={`contact ${
                                selectedPeerId === peer.id
                                    ? 'selected'
                                    : ''
                            }`}
                            onClick={() => selectPeer(peer.id)}
                        >
              <span className="avatar">
                {peer.username[0].toUpperCase()}
              </span>
                            <span className="contact-info">
                <span className="contact-name-row">
                    <strong>{peer.username}</strong>
                    {onlineIds.includes(peer.id) && (
                        <span
                            className="presence-dot"
                            title="В сети"
                        />
                    )}
                </span>
                <small className="last-message-preview">
                    {previewFor(peer.id)}
                </small>
              </span>
                        </button>
                    ))}
                </nav>

                {peers.length === 0 && (
                    <p className="empty-contacts">
                        Пока нет других пользователей.
                    </p>
                )}
            </aside>

            <section className="chat">

                {(showOfflineBanner || offlinePreview) && (
                    <div className="offline-banner" role="status">
                        Нет соединения с сервером.
                        Доступна сохранённая история.
                        Новые сообщения будут отправлены позже.
                    </div>
                )}

                {selectedPeer ? (
                    <>
                        <header className="chat-header">
                            <button
                                type="button"
                                className="mobile-back"
                                onClick={() => setMobileChatOpen(false)}
                                aria-label="Вернуться к списку чатов"
                            >
                                ‹ <span>Чаты</span>
                            </button>
                            <div className="avatar">
                                {selectedPeer.username[0].toUpperCase()}
                            </div>

                            <div>
                                <span className="contact-name-row">
                                    <strong>{selectedPeer.username}</strong>
                                    {onlineIds.includes(selectedPeer.id) && (
                                        <span
                                            className="presence-dot"
                                            title="В сети"
                                        />
                                    )}
                                </span>
                            </div>
                        </header>

                        <div className="chat-scroll-region">
                            <div
                                className="message-list"
                                ref={messageListRef}
                                onScroll={handleMessageScroll}
                            >

                            {timeline.length === 0 && (
                                <p className="empty-chat">
                                    Начните переписку
                                </p>
                            )}

                            {timeline.map((item) => {
                                const isPending = item.status === 'pending';

                                const isOutgoing =
                                    isPending ||
                                    (
                                        item.status === 'confirmed' &&
                                        item.message.senderId === me.id
                                    );

                                const message = item.message;

                                const isRead =
                                    item.status === 'confirmed' &&
                                    Boolean(item.message.readAt);

                                const key = isPending
                                    ? `pending:${message.clientMessageId}`
                                    : `confirmed:${item.message.id}`;

                                return (
                                    <div
                                        key={key}
                                        className={`message ${
                                            isOutgoing ? 'outgoing' : 'incoming'
                                        }${isPending ? ' queued' : ''}`}
                                    >
                                        <div className="message-text">
                                            {message.text}
                                        </div>

                                        <small>
                                            {item.status === 'pending'
                                                ? rejectedMessageIds.includes(
                                                    message.clientMessageId
                                                )
                                                    ? 'Не доставлено · нужна проверка'
                                                    : connected
                                                        ? 'Отправляем...'
                                                        : 'В очереди · ожидаем связь'
                                                : (
                                                    <>
                                                        {new Date(
                                                            message.createdAt
                                                        ).toLocaleTimeString(
                                                            'ru-RU',
                                                            {
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                            }
                                                        )}

                                                        {isOutgoing && (
                                                            <span
                                                                className={
                                                                    `receipt-icon ${
                                                                        isRead
                                                                            ? 'is-read'
                                                                            : ''
                                                                    }`
                                                                }
                                                                title={
                                                                    isRead
                                                                        ? 'Прочитано'
                                                                        : 'Отправлено на сервер'
                                                                }
                                                            >
                                                                {isRead ? '✓✓' : '✓'}
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                        </small>
                                    </div>
                                );
                            })}

                            
                        </div>

                            {showJumpToBottom && (
                                <button
                                    type="button"
                                    className="jump-to-bottom"
                                    aria-label="К последним сообщениям"
                                    title="К последним сообщениям"
                                    onClick={() =>
                                        scrollToChatBottom('smooth')
                                    }
                                >
                                    ↓
                                </button>
                            )}
                        </div>

                        {error && (
                            <div className="chat-error">{error}</div>
                        )}

                        <form
                            className="composer"
                            onSubmit={handleSend}
                        >
                            <input
                                ref={composerInputRef}
                                value={draft}
                                onChange={(event) =>
                                    setDraft(event.target.value)
                                }
                                placeholder="Сообщение"
                                maxLength={2000}
                            />

                            <button
                                type="submit"
                                disabled={!draft.trim()}
                                onMouseDown={(event) => {
                                    if (mobileView) {
                                        event.preventDefault();
                                    }
                                }}
                            >
                                Отправить
                            </button>
                        </form>
                    </>
                ) : (
                    <div className="no-chat">
                        Выберите собеседника
                    </div>
                )}
            </section>

            {toast && (
                <button
                    type="button"
                    className="incoming-toast"
                    onClick={() => {
                        selectPeer(toast.peerId);
                        setToast(null);
                    }}
                >
                    <strong>{toast.name}</strong>
                    <span>{toast.text}</span>
                </button>
            )}
        </main>
    );
}

export default App;
