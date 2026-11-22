import { useState } from 'react';

type Props = {
    text: string;
    onClose: () => void;
    onSchedule: (date: string) => Promise<boolean>;
};

function localDateTime(date: Date): string {
    const local = new Date(
        date.getTime() - date.getTimezoneOffset() * 60000
    );

    return local.toISOString().slice(0, 16);
}

function tomorrowMorning(): Date {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date;
}

export function ScheduledSendDialog({
    text,
    onClose,
    onSchedule,
}: Props) {
    const [value, setValue] = useState(() =>
        localDateTime(new Date(Date.now() + 3600000))
    );

    const [choice, setChoice] = useState<
        'hour' | 'tomorrow' | 'custom'
    >('hour');

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    function choose(
        option: 'hour' | 'tomorrow' | 'custom'
    ) {
        setChoice(option);
        setError('');

        if (option === 'hour') {
            setValue(localDateTime(
                new Date(Date.now() + 3600000)
            ));
        }

        if (option === 'tomorrow') {
            setValue(localDateTime(tomorrowMorning()));
        }
    }

    async function submit() {
        if (busy) return;

        const date = new Date(value);
        const timestamp = date.getTime();

        if (
            !Number.isFinite(timestamp) ||
            timestamp < Date.now() + 60000 ||
            timestamp > Date.now() + 90 * 86400000
        ) {
            setError(
                'Выберите время не раньше чем через минуту ' +
                'и не позднее чем через 90 дней.'
            );
            return;
        }

        setBusy(true);
        setError('');

        try {
            const ok = await onSchedule(date.toISOString());

            if (!ok) {
                setError('Не удалось сохранить время отправки');
            }
        } catch {
            setError('Не удалось сохранить сообщение');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="scheduled-overlay">
            <section
                className="scheduled-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Отложенная отправка"
            >
                <header>
                    <h2>Отправить позже</h2>
                    <button
                        type="button"
                        aria-label="Закрыть"
                        onClick={onClose}
                        disabled={busy}
                    >
                        ×
                    </button>
                </header>

                <p className="scheduled-preview">{text}</p>

                <div className="scheduled-presets">
                    <button
                        type="button"
                        className={choice === 'hour' ? 'selected' : ''}
                        onClick={() => choose('hour')}
                    >
                        Сегодня, через час
                    </button>
                    <button
                        type="button"
                        className={
                            choice === 'tomorrow' ? 'selected' : ''
                        }
                        onClick={() => choose('tomorrow')}
                    >
                        Завтра в 09:00
                    </button>
                    <button
                        type="button"
                        className={
                            choice === 'custom' ? 'selected' : ''
                        }
                        onClick={() => choose('custom')}
                    >
                        Выбрать время
                    </button>
                </div>

                <label className="scheduled-date-label">
                    Дата и время отправки
                    <input
                        type="datetime-local"
                        value={value}
                        min={localDateTime(
                            new Date(Date.now() + 60000)
                        )}
                        max={localDateTime(
                            new Date(Date.now() + 90 * 86400000)
                        )}
                        onChange={event => {
                            setValue(event.target.value);
                            setChoice('custom');
                        }}
                    />
                </label>

                {error && (
                    <p className="scheduled-error" role="alert">
                        {error}
                    </p>
                )}

                <button
                    type="button"
                    className="scheduled-confirm"
                    disabled={busy}
                    onClick={() => void submit()}
                >
                    {busy
                        ? 'Сохраняем…'
                        : 'Запланировать отправку'}
                </button>
            </section>
        </div>
    );
}
