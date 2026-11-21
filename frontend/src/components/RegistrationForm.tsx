import { useState, type FormEvent } from 'react';

export type RegistrationPayload = {
    username: string;
    email: string;
    phone: string;
    password: string;
};

type Props = {
    error: string;
    onBack: () => void;
    onSubmit: (
        values: RegistrationPayload
    ) => Promise<void>;
};

export function RegistrationForm({
    error,
    onBack,
    onSubmit,
}: Props) {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [localError, setLocalError] = useState('');

    async function submit(event: FormEvent) {
        event.preventDefault();
        setLocalError('');

        if (!/^[a-z0-9_]{3,24}$/.test(
            username.trim().toLowerCase()
        )) {
            setLocalError(
                'Никнейм: 3–24 символа, латиница, цифры или _'
            );
            return;
        }

        if (password.length < 12) {
            setLocalError(
                'Пароль должен содержать минимум 12 символов'
            );
            return;
        }

        if (password !== confirmation) {
            setLocalError('Пароли не совпадают');
            return;
        }

        setBusy(true);

        try {
            await onSubmit({
                username: username.trim().toLowerCase(),
                email: email.trim().toLowerCase(),
                phone: phone.trim(),
                password,
            });
        } catch {
            // The parent shows a server-specific error.
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <h2 className="registration-title">
                Создать аккаунт
            </h2>

            <form
                className="registration-form"
                onSubmit={event => void submit(event)}
            >
                <input
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="Никнейм"
                    autoComplete="username"
                    minLength={3}
                    maxLength={24}
                    required
                />

                <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="Телефон: +7 900 000-00-00"
                    autoComplete="tel"
                    required
                />

                <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Электронная почта"
                    autoComplete="email"
                    required
                />

                <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Пароль (минимум 12 символов)"
                    autoComplete="new-password"
                    minLength={12}
                    required
                />

                <input
                    type="password"
                    value={confirmation}
                    onChange={e => setConfirmation(e.target.value)}
                    placeholder="Повторите пароль"
                    autoComplete="new-password"
                    required
                />

                {(localError || error) && (
                    <p className="error" role="alert">
                        {localError || error}
                    </p>
                )}

                <button type="submit" disabled={busy}>
                    {busy
                        ? 'Создаём аккаунт…'
                        : 'Зарегистрироваться'}
                </button>
            </form>

            <button
                type="button"
                className="registration-back"
                onClick={onBack}
            >
                Уже есть аккаунт? Войти
            </button>

            <p className="registration-note">
                Телефон и email пока не подтверждаются кодом.
            </p>
        </>
    );
}
