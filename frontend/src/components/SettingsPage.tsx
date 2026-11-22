import { useEffect, useState } from 'react';
import {
    listCampLinkPasskeys,
    type RegisteredPasskey,
} from '../services/passkeys';
import type { ThemePreference } from '../services/theme';
import type { PushStatus } from '../services/push-ios';

export type PushDiagnostics = {
    serverEnabled: boolean;
    registeredDevices: number;
};

export type PushTestResult = {
    scheduledInSeconds: number;
    deviceCount: number;
};

type Props = {
    displayName: string;
    userId: number;
    themePreference: ThemePreference;
    onThemeChange: (value: ThemePreference) => void;
    nativeIos: boolean;
    pushStatus: PushStatus;
    onEnablePush: () => void;
    onCheckPush: () => Promise<PushDiagnostics>;
    onTestPush: () => Promise<PushTestResult>;
    onBack: () => void;
    onLogout: () => Promise<boolean>;
    onCreatePasskey: () => Promise<boolean>;
};

const themes: {
    value: ThemePreference;
    label: string;
}[] = [
    { value: 'system', label: 'Авто' },
    { value: 'light', label: 'Светлая' },
    { value: 'dark', label: 'Тёмная' },
];

const pushLabels: Record<PushStatus, string> = {
    off: 'Не подключены',
    requesting: 'Подключение…',
    registered: 'Подключены',
    denied: 'Запрещены в настройках iPhone',
    error: 'Ошибка подключения',
};

export function SettingsPage({
    displayName,
    userId,
    themePreference,
    onThemeChange,
    nativeIos,
    pushStatus,
    onEnablePush,
    onCheckPush,
    onTestPush,
    onBack,
    onLogout,
    onCreatePasskey,
}: Props) {
    const [busy, setBusy] = useState(false);
    const [logoutError, setLogoutError] = useState(false);
    const [pushChecking, setPushChecking] = useState(false);
    const [pushTesting, setPushTesting] = useState(false);
    const [pushReport, setPushReport] =
        useState<PushDiagnostics | null>(null);
    const [pushMessage, setPushMessage] = useState('');
    const [pushError, setPushError] = useState('');

    async function checkPush() {
        setPushChecking(true);
        setPushError('');
        setPushMessage('');

        try {
            setPushReport(await onCheckPush());
        } catch {
            setPushError(
                'Не удалось проверить Push на сервере'
            );
        } finally {
            setPushChecking(false);
        }
    }

    async function testPush() {
        setPushTesting(true);
        setPushError('');
        setPushMessage('');

        try {
            const result = await onTestPush();
            setPushMessage(
                `Тест запланирован через ` +
                `${result.scheduledInSeconds} сек. ` +
                `Заблокируйте iPhone прямо сейчас.`
            );
        } catch {
            setPushError(
                'Тест не запущен. Проверьте подключение ' +
                'и повторите не раньше чем через 30 секунд.'
            );
        } finally {
            setPushTesting(false);
        }
    }
    const [passkeyState, setPasskeyState] =
        useState<'idle' | 'busy' | 'ok' | 'error'>('idle');

    const [keys, setKeys] =
        useState<RegisteredPasskey[] | null>(null);

    const [keysError, setKeysError] = useState(false);
    const [keysRevision, setKeysRevision] = useState(0);

    useEffect(() => {
        let active = true;

        void listCampLinkPasskeys()
            .then(result => {
                if (!active) return;
                setKeys(result);
                setKeysError(false);
            })
            .catch(() => {
                if (!active) return;
                setKeysError(true);
            });

        return () => {
            active = false;
        };
    }, [userId, keysRevision]);

    async function addPasskey() {
        if (passkeyState === 'busy') return;
        setPasskeyState('busy');

        try {
            const success = await onCreatePasskey();
            setPasskeyState(success ? 'ok' : 'error');

            if (success) {
                setKeysRevision(value => value + 1);
            }
        } catch {
            setPasskeyState('error');
        }
    }

    async function logout() {
        if (busy) return;

        setBusy(true);
        setLogoutError(false);

        try {
            const success = await onLogout();

            if (!success) {
                setLogoutError(true);
            }
        } catch {
            setLogoutError(true);
        } finally {
            setBusy(false);
        }
    }

    return (
        <section
            className="settings-screen"
            role="dialog"
            aria-modal="true"
            aria-label="Настройки"
        >
            <div className="settings-content">
                <header className="settings-topbar">
                    <button
                        className="settings-back"
                        type="button"
                        onClick={onBack}
                        aria-label="Закрыть настройки"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="24"
                            height="24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="m15 18-6-6 6-6" />
                        </svg>
                    </button>
                    <h1>Настройки</h1>
                </header>

                <div className="settings-profile">
                    <div className="avatar settings-avatar">
                        {displayName.trim().charAt(0).toUpperCase() || '?'}
                    </div>
                    <div className="settings-profile-text">
                        <strong>{displayName}</strong>
                        <span>ID: {userId}</span>
                    </div>
                </div>

                <div className="settings-group">
                    <h2>Внешний вид</h2>
                    <div className="settings-card">
                        <div className="settings-row">
                            <div>
                                <strong>Тема оформления</strong>
                                <p>Как выглядит CampLink</p>
                            </div>
                        </div>
                        <div
                            className="settings-theme-options"
                            role="group"
                            aria-label="Тема оформления"
                        >
                            {themes.map(theme => (
                                <button
                                    key={theme.value}
                                    type="button"
                                    aria-pressed={
                                        themePreference === theme.value
                                    }
                                    className={
                                        themePreference === theme.value
                                            ? 'selected'
                                            : ''
                                    }
                                    onClick={() =>
                                        onThemeChange(theme.value)
                                    }
                                >
                                    {theme.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="settings-group">
                    <h2>Безопасность</h2>
                    <div className="settings-card">
                        <div className="settings-row">
                            <div>
                                <strong>Ключ доступа</strong>
                                <p>
                                    Вход по Face ID, отпечатку
                                    или коду устройства без пароля
                                </p>
                            </div>
                        </div>
                        {keysError ? (
                            <button
                                type="button"
                                className="settings-passkey-button"
                                onClick={() => {
                                    setKeysError(false);
                                    setKeys(null);
                                    setKeysRevision(value => value + 1);
                                }}
                            >
                                Повторить проверку ключей
                            </button>
                        ) : keys === null ? (
                            <p className="settings-key-status">
                                Проверяем ключи доступа…
                            </p>
                        ) : (
                            <>
                                <p
                                    className="settings-key-status"
                                    role="status"
                                >
                                    {keys.length > 0
                                        ? `Ключи доступа подключены: ${keys.length}`
                                        : 'Ключи доступа пока не добавлены'}
                                </p>

                                <button
                                    type="button"
                                    className="settings-passkey-button"
                                    disabled={passkeyState === 'busy'}
                                    onClick={() => void addPasskey()}
                                >
                                    {passkeyState === 'busy'
                                        ? 'Создаём ключ…'
                                        : keys.length > 0
                                            ? 'Добавить ещё один ключ'
                                            : 'Включить быстрый вход'}
                                </button>
                            </>
                        )}
                        {passkeyState === 'ok' && (
                            <p role="status" className="settings-passkey-ok">
                                Ключ доступа сохранён
                            </p>
                        )}
                        {passkeyState === 'error' && (
                            <p role="alert" className="settings-error">
                                Не удалось создать ключ.
                                Проверьте поддержку устройства
                                и привязку домена.
                            </p>
                        )}
                    </div>
                </div>

                <div className="settings-group">
                    <h2>Уведомления</h2>
                    <div className="settings-card">
                        <div className="settings-row">
                            <div>
                                <strong>Звук сообщений</strong>
                                <p>
                                    Включён по умолчанию.
                                    Учитываются настройки устройства.
                                </p>
                            </div>
                        </div>

                        <div className="settings-separator" />

                        <div className="settings-row">
                            <div>
                                <strong>Push-уведомления</strong>
                                <p>
                                    {nativeIos
                                        ? pushLabels[pushStatus]
                                        : 'Настраиваются в приложении iOS'}
                                </p>
                            </div>
                            {nativeIos && pushStatus !== 'registered' && (
                                <button
                                    className="settings-push-button"
                                    type="button"
                                    disabled={pushStatus === 'requesting'}
                                    onClick={onEnablePush}
                                >
                                    {pushStatus === 'requesting'
                                        ? 'Подключаем'
                                        : 'Включить'}
                                </button>
                            )}
                        </div>

                        {nativeIos && (
                            <div className="settings-push-tools">
                                <button
                                    type="button"
                                    disabled={pushChecking}
                                    onClick={() => void checkPush()}
                                >
                                    {pushChecking
                                        ? 'Проверяем…'
                                        : 'Проверить подключение'}
                                </button>

                                {pushReport && (
                                    <div
                                        className="settings-push-report"
                                        role="status"
                                    >
                                        <span>
                                            Сервер Firebase:
                                            {' '}
                                            {pushReport.serverEnabled
                                                ? 'включён'
                                                : 'не настроен'}
                                        </span>
                                        <span>
                                            FCM-устройств:
                                            {' '}
                                            {pushReport.registeredDevices}
                                        </span>
                                    </div>
                                )}

                                <button
                                    type="button"
                                    disabled={
                                        pushTesting ||
                                        pushChecking ||
                                        pushStatus !== 'registered' ||
                                        pushReport?.serverEnabled === false ||
                                        pushReport?.registeredDevices === 0
                                    }
                                    onClick={() => void testPush()}
                                >
                                    {pushTesting
                                        ? 'Запускаем…'
                                        : 'Отправить тестовый Push'}
                                </button>

                                {pushMessage && (
                                    <p role="status">{pushMessage}</p>
                                )}
                                {pushError && (
                                    <p
                                        className="settings-error"
                                        role="alert"
                                    >
                                        {pushError}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="settings-group">
                    <h2>О приложении</h2>
                    <div className="settings-card">
                        <div className="settings-row">
                            <div>
                                <strong>CampLink</strong>
                                <p>Версия 1.0 · Тестирование</p>
                            </div>
                        </div>
                        <div className="settings-separator" />
                        <div className="settings-row">
                            <div>
                                <strong>Перед публичным выпуском</strong>
                                <p>
                                    Добавим документы, контакты
                                    поддержки и удаление аккаунта.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    className="settings-logout"
                    disabled={busy}
                    onClick={() => void logout()}
                >
                    {busy ? 'Выходим…' : 'Выйти из аккаунта'}
                </button>

                {logoutError && (
                    <p className="settings-error" role="alert">
                        Не удалось завершить сессию.
                        Проверьте соединение.
                    </p>
                )}
            </div>
        </section>
    );
}
