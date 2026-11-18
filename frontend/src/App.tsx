import {
    useEffect,
    useRef,
    useState,
    type FormEvent,
} from 'react';
import type { Socket } from 'socket.io-client';
import { connectToServer } from './services/connection';
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
    const [me, setMe] = useState<User | null>(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const [peers, setPeers] = useState<User[]>([]);
    const [selectedPeerId, setSelectedPeerId] =
        useState<number | null>(null);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [connected, setConnected] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');

    const socketRef = useRef<Socket | null>(null);
    const selectedPeerRef = useRef<number | null>(null);
    const chatEndRef = useRef<HTMLDivElement | null>(null);

    const selectedPeer =
        peers.find((peer) => peer.id === selectedPeerId) ??
        null;

    useEffect(() => {
        let active = true;

        apiGet<{ user: User }>('/api/auth/me')
            .then(({ user }) => {
                if (active) setMe(user);
            })
            .catch(() => {
                // No session yet: show login screen.
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!me) return;

        let active = true;

        apiGet<{ users: User[] }>('/api/users')
            .then(({ users }) => {
                if (!active) return;
                setPeers(users);

                if (users.length > 0 && selectedPeerRef.current === null) {
                    selectedPeerRef.current = users[0].id;
                    setSelectedPeerId(users[0].id);
                }
            })
            .catch(() => {
                if (active) setError('Не удалось загрузить контакты');
            });

        const socket = connectToServer(setConnected);
        socketRef.current = socket;

        socket.on('chat:new', (message: ChatMessage) => {
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
            const peerId = selectedPeerRef.current;

            if (peerId === null) return;

            apiGet<{ messages: ChatMessage[] }>(
                `/api/messages/${peerId}`
            )
                .then(({ messages: history }) => {
                    if (selectedPeerRef.current === peerId) {
                        setMessages((current) =>
                            mergeMessages(
                                current.filter((message) =>
                                    belongsToChat(message, me.id, peerId)
                                ),
                                history
                            )
                        );
                    }
                })
                .catch(() => {});
        });

        return () => {
            active = false;
            socket.disconnect();
            socketRef.current = null;
            setConnected(false);
        };
    }, [me]);

    useEffect(() => {
        if (!me || selectedPeerId === null) return;

        let active = true;

        apiGet<{ messages: ChatMessage[] }>(
            `/api/messages/${selectedPeerId}`
        )
            .then(({ messages: history }) => {
                if (active) {
                    setMessages((current) =>
                        mergeMessages(
                            current.filter((message) =>
                                belongsToChat(
                                    message,
                                    me.id,
                                    selectedPeerId
                                )
                            ),
                            history
                        )
                    );
                }
            })
            .catch(() => {
                if (active) setError('Не удалось загрузить историю');
            });

        return () => {
            active = false;
        };
    }, [me, selectedPeerId]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({
            behavior: 'smooth',
        });
    }, [messages]);

    function selectPeer(id: number) {
        selectedPeerRef.current = id;
        setSelectedPeerId(id);
        setMessages([]);
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

        socketRef.current?.disconnect();
        selectedPeerRef.current = null;
        setMe(null);
        setPeers([]);
        setSelectedPeerId(null);
        setMessages([]);
        setConnected(false);
        setError('');
    }

    function handleSend(event: FormEvent) {
        event.preventDefault();

        const text = draft.trim();
        const socket = socketRef.current;

        if (
            !text ||
            text.length > 2000 ||
            !socket?.connected ||
            selectedPeerId === null ||
            sending
        ) {
            return;
        }

        setSending(true);
        setError('');

        socket.timeout(5000).emit(
            'chat:send',
            {
                toUserId: selectedPeerId,
                text,
                clientMessageId: crypto.randomUUID(),
            },
            (err: Error | null, response?: SendResponse) => {
                setSending(false);

                if (err || !response?.ok || !response.message) {
                    setError(
                        'Не удалось подтвердить отправку сообщения'
                    );
                    return;
                }

                setDraft('');

                if (selectedPeerRef.current === selectedPeerId) {
                    const message = response.message;

                    setMessages((current) =>
                        mergeMessages(current, [message])
                    );
                }
            }
        );
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
        <main className="messenger">
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
                {selectedPeer ? (
                    <>
                        <header className="chat-header">
                            <div className="avatar">
                                {selectedPeer.username[0].toUpperCase()}
                            </div>

                            <div>
                                <strong>{selectedPeer.username}</strong>
                                <small>ID {selectedPeer.id}</small>
                            </div>
                        </header>

                        <div className="message-list">
                            {messages.length === 0 && (
                                <p className="empty-chat">
                                    Начните переписку
                                </p>
                            )}

                            {messages.map((message) => (
                                <div
                                    key={message.id}
                                    className={`message ${
                                        message.senderId === me.id
                                            ? 'outgoing'
                                            : 'incoming'
                                    }`}
                                >
                                    <div className="message-text">
                                        {message.text}
                                    </div>

                                    <small>
                                        {new Date(
                                            message.createdAt
                                        ).toLocaleTimeString('ru-RU', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </small>
                                </div>
                            ))}

                            <div ref={chatEndRef} />
                        </div>

                        {error && (
                            <div className="chat-error">{error}</div>
                        )}

                        <form
                            className="composer"
                            onSubmit={handleSend}
                        >
                            <input
                                value={draft}
                                onChange={(event) =>
                                    setDraft(event.target.value)
                                }
                                placeholder={
                                    connected
                                        ? 'Сообщение'
                                        : 'Ожидаем подключения...'
                                }
                                maxLength={2000}
                                disabled={!connected || sending}
                            />

                            <button
                                type="submit"
                                disabled={
                                    !connected ||
                                    !draft.trim() ||
                                    sending
                                }
                            >
                                {sending ? '...' : 'Отправить'}
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
