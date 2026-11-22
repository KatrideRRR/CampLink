import { useState } from 'react';

type Props = {
    onEnable: () => Promise<boolean>;
    onDismiss: () => void;
};

export function PasskeySetupPrompt({
    onEnable,
    onDismiss,
}: Props) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);

    async function enable() {
        if (busy) return;

        setBusy(true);
        setError(false);

        try {
            const success = await onEnable();

            if (!success) {
                setError(true);
            }
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="passkey-offer-overlay">
            <section
                className="passkey-offer-card"
                role="dialog"
                aria-modal="true"
                aria-label="Быстрый вход в CampLink"
            >
                <div className="passkey-offer-icon"
                     aria-hidden="true">
                    <svg
                        viewBox="0 0 24 24"
                        width="32"
                        height="32"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                    >
                        <path d="M8 3H6a3 3 0 0 0-3 3v2
                                 M16 3h2a3 3 0 0 1 3 3v2
                                 M3 16v2a3 3 0 0 0 3 3h2
                                 M21 16v2a3 3 0 0 1-3 3h-2" />
                        <path d="M9 10h.01M15 10h.01
                                 M9 15c2 2 4 2 6 0" />
                    </svg>
                </div>

                <h2>Включить быстрый вход?</h2>

                <p>
                    Создайте ключ доступа и входите в CampLink
                    с помощью Face ID, отпечатка пальца
                    или кода устройства — без ввода пароля.
                </p>

                <button
                    type="button"
                    className="passkey-offer-enable"
                    disabled={busy}
                    onClick={() => void enable()}
                >
                    {busy
                        ? 'Подключаем…'
                        : 'Включить быстрый вход'}
                </button>

                <button
                    type="button"
                    className="passkey-offer-later"
                    disabled={busy}
                    onClick={onDismiss}
                >
                    Не сейчас
                </button>

                {error && (
                    <p className="settings-error" role="alert">
                        Не удалось создать ключ доступа.
                        Можно попробовать позже в настройках.
                    </p>
                )}
            </section>
        </div>
    );
}
