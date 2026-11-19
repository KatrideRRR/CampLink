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
    clearRelayCredential,
    createRelayTransport,
    saveRelayCredential,
    type RelayCredential,
} from './services/relay';
import { deliverMessage } from './services/delivery';
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
};

type SendResponse = {
    ok: boolean;
    message?: ChatMessage;
    error?: string;
};

async function apiGet<T>(url: string): Promise<T> {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error('Request failed');
    }

    return response.json() as Promise<T>;
}

async function apiPost<T>(
    url: string,
    body: Record<string, unknown>
): Promise<T> {
    const response = await fetch(url, {
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

    const socketRef = useRef<Socket | null>(null);
    const drainQueueRef = useRef<() => void>(() => {});
    const selectedPeerRef = useRef<number | null>(null);
    const messageListRef = useRef<HTMLDivElement | null>(null);
    const composerInputRef = useRef<HTMLInputElement | null>(null);

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
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    const list = messageListRef.current;
                    if (list) {
                        list.scrollTo({
                        top: list.scrollHeight,
                        behavior: window.matchMedia(
                            '(prefers-reduced-motion: reduce)'
                        ).matches ? 'auto' : 'smooth',
                    });
                    }
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

    useEffect(() => {
        let active = true;

        async function restoreSession() {
            const cached = readOfflineUser();

            let status: number | 'unreachable' = 'unreachable';
            let serverUser: User | null = null;

            const controller = new AbortController();

            const timer = window.setTimeout(() => {
                controller.abort();
            }, 4000);

            try {
                const response = await fetch('/api/auth/me', {
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

            if (result.invalidate && cached) {
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

        async function refreshRelayCredential() {
            try {
                const response = await fetch(
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
                    const next = readOutbox(me.id).find(
                        (message) =>
                            socket.connected ||
                            !relayedInSession.has(message.clientMessageId)
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
                            setError(
                                'Сервер отклонил сообщение: ' +
                                result.error
                            );
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

            clearOfflineCache(me.id);
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

    useEffect(() => {
        const list = messageListRef.current;

        if (list) {
            list.scrollTo({
                        top: list.scrollHeight,
                        behavior: window.matchMedia(
                            '(prefers-reduced-motion: reduce)'
                        ).matches ? 'auto' : 'smooth',
                    });
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
            const result = await apiPost<{ user: User }>(
                '/api/auth/login',
                { username, password }
            );

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
        } catch {
            setError('Не удалось завершить сессию');
            return;
        }
        if (me) {
            clearOfflineCache(me.id);
            clearRelayCredential(me.id);
        }
        setPendingMessages([]);
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

            setPendingMessages(pending);
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

                    {isNativeIos && (
                        <button
                            type="button"
                            className="text-button"
                            onClick={() => void enableIosPush()}
                            disabled={
                                pushStatus === 'requesting' ||
                                pushStatus === 'registered'
                            }
                        >
                            {pushStatus === 'registered'
                                ? 'Устройство зарегистрировано'
                                : pushStatus === 'requesting'
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
                <strong>{peer.username}</strong>
                <small>ID {peer.id}</small>
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
                                <strong>{selectedPeer.username}</strong>
                                <small>ID {selectedPeer.id}</small>
                            </div>
                        </header>

                        <div className="message-list" ref={messageListRef}>

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
                                                ? connected
                                                    ? 'Отправляем...'
                                                    : 'В очереди · ожидаем связь'
                                                : new Date(
                                                    message.createdAt
                                                ).toLocaleTimeString('ru-RU', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                        </small>
                                    </div>
                                );
                            })}

                            
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
        </main>
    );
}

export default App;
