import {
    useEffect,
    useRef,
    useState,
} from 'react';
import { apiFetch } from '../services/native-auth';

export type FoundUser = {
    id: number;
    username: string;
};

type Props = {
    onClose: () => void;
    onChoose: (
        user: FoundUser,
        openChat: boolean
    ) => Promise<void>;
    existingIds: number[];
};

export function NewChatDialog({
    onClose,
    onChoose,
    existingIds,
}: Props) {
    const [query, setQuery] = useState('');
    const [users, setUsers] = useState<FoundUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') onClose();
        }

        document.addEventListener('keydown', onKeyDown);

        return () =>
            document.removeEventListener(
                'keydown', onKeyDown
            );
    }, [onClose]);

    useEffect(() => {
        let active = true;

        const q = query.trim();
        const digits = q.replace(/\D/g, '');
        const phoneQuery = /^[\d\s+()-]+$/.test(q);

        const valid =
            q.length >= 3 &&
            q.length <= 64 &&
            (!phoneQuery || digits.length >= 7);

        setUsers([]);
        setError('');

        if (!valid) {
            setLoading(false);
            return;
        }

        setLoading(true);

        const timer = window.setTimeout(async () => {
            try {
                const response = await apiFetch(
                    '/api/users/suggest?q=' +
                    encodeURIComponent(q),
                    { cache: 'no-store' }
                );

                if (!response.ok) {
                    throw new Error('Search failed');
                }

                const result = await response.json() as {
                    users: FoundUser[];
                };

                if (active) {
                    setUsers(result.users);
                }
            } catch {
                if (active) {
                    setError('Не удалось выполнить поиск');
                }
            } finally {
                if (active) setLoading(false);
            }
        }, 350);

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [query]);

    async function choose(
        user: FoundUser,
        openChat: boolean
    ) {
        if (busyId !== null) return;

        setBusyId(user.id);
        setError('');

        try {
            await onChoose(user, openChat);
            onClose();
        } catch {
            setError(
                'Не удалось выполнить действие. ' +
                'Проверьте соединение.'
            );
        } finally {
            setBusyId(null);
        }
    }

    return (
        <div
            className="new-chat-overlay"
            onMouseDown={event => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section
                className="new-chat-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Новый чат"
            >
                <header>
                    <strong>Новый чат</strong>
                    <button
                        type="button"
                        className="new-chat-close"
                        aria-label="Закрыть"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </header>

                <div className="new-chat-search">
                    <input
                        ref={inputRef}
                        type="search"
                        value={query}
                        onChange={event =>
                            setQuery(event.target.value)
                        }
                        placeholder="Никнейм, телефон или email"
                        aria-label="Поиск пользователей"
                        autoComplete="off"
                        maxLength={64}
                    />
                </div>

                {error && (
                    <p className="new-chat-error" role="alert">
                        {error}
                    </p>
                )}

                <div className="new-chat-results">
                    {loading && (
                        <p className="new-chat-hint">
                            Ищем пользователей…
                        </p>
                    )}

                    {!loading && users.length === 0 && (
                        <p className="new-chat-hint">
                            {query.trim().length < 3
                                ? 'Начните вводить никнейм, телефон или email'
                                : 'Совпадений пока нет'}
                        </p>
                    )}

                    {users.map(user => {
                        const added = existingIds.includes(
                            user.id
                        );

                        return (
                            <div
                                className="new-chat-user"
                                key={user.id}
                            >
                                <span className="avatar">
                                    {user.username[0].toUpperCase()}
                                </span>

                                <strong>@{user.username}</strong>

                                <div className="new-chat-user-actions">
                                    <button
                                        type="button"
                                        disabled={
                                            added ||
                                            busyId !== null
                                        }
                                        onClick={() =>
                                            void choose(user, false)
                                        }
                                    >
                                        {added
                                            ? 'Добавлен'
                                            : 'Добавить'}
                                    </button>

                                    <button
                                        type="button"
                                        className="new-chat-write"
                                        disabled={busyId !== null}
                                        onClick={() =>
                                            void choose(user, true)
                                        }
                                    >
                                        Написать
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <p className="new-chat-footer">
                    Телефоны и электронные адреса
                    других пользователей скрыты.
                </p>
            </section>
        </div>
    );
}
