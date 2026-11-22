import {
    useEffect,
    useState,
    type FormEvent,
} from 'react';
import { passkeysAvailable } from '../services/passkeys';
import PhoneInput, {
    isValidPhoneNumber,
    type Value,
} from 'react-phone-number-input';
import ru from 'react-phone-number-input/locale/ru';
import flags from 'react-phone-number-input/flags';
import 'react-phone-number-input/style.css';

export type LoginCredentials = {
    identifier: string;
    password: string;
};

type Props = {
    error: string;
    onSubmit: (credentials: LoginCredentials) => Promise<boolean>;
    onRegister: () => void;
    onPasskeyLogin: () => Promise<boolean>;
};

export function LoginForm({
    error,
    onSubmit,
    onRegister,
    onPasskeyLogin,
}: Props) {
    const [mode, setMode] = useState<'phone' | 'email'>('phone');
    const [phone, setPhone] = useState<Value>();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [localError, setLocalError] = useState('');
    const [passkeyReady, setPasskeyReady] = useState(false);
    const [passkeyBusy, setPasskeyBusy] = useState(false);

    useEffect(() => {
        let active = true;
        void passkeysAvailable().then(available => {
            if (active) setPasskeyReady(available);
        });
        return () => { active = false; };
    }, []);

    async function passkeyLogin() {
        if (passkeyBusy) return;
        setPasskeyBusy(true);
        setLocalError('');

        try {
            await onPasskeyLogin();
        } catch {
            setLocalError('Не удалось войти по ключу доступа');
        } finally {
            setPasskeyBusy(false);
        }
    }

    function switchMode(next: 'phone' | 'email') {
        setMode(next);
        setLocalError('');
    }

    async function submit(event: FormEvent) {
        event.preventDefault();

        if (busy) return;

        setLocalError('');

        const identifier = mode === 'email'
            ? email.trim().toLowerCase()
            : phone ?? '';

        if (
            mode === 'phone' &&
            (!phone || !isValidPhoneNumber(phone))
        ) {
            setLocalError('Проверьте номер и код страны');
            return;
        }

        if (
            mode === 'email' &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
        ) {
            setLocalError('Введите корректный email');
            return;
        }

        if (!password) {
            setLocalError('Введите пароль');
            return;
        }

        setBusy(true);

        try {
            const success = await onSubmit({
                identifier,
                password,
            });

            if (success) setPassword('');
        } catch {
            setLocalError('Не удалось подключиться к серверу');
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <form
                className="login-form"
                onSubmit={event => void submit(event)}
                autoComplete="on"
            >
                <div
                    className="login-mode"
                    role="group"
                    aria-label="Способ входа"
                >
                    <button
                        type="button"
                        className={mode === 'phone' ? 'selected' : ''}
                        aria-pressed={mode === 'phone'}
                        onClick={() => switchMode('phone')}
                    >
                        Телефон
                    </button>
                    <button
                        type="button"
                        className={mode === 'email' ? 'selected' : ''}
                        aria-pressed={mode === 'email'}
                        onClick={() => switchMode('email')}
                    >
                        Email
                    </button>
                </div>

                {mode === 'phone' ? (
                    <PhoneInput
                        className="login-phone"
                        defaultCountry="RU"
                        international
                        countryCallingCodeEditable={false}
                        labels={ru}
                        flags={flags}
                        value={phone}
                        onChange={setPhone}
                        placeholder="Номер телефона"
                        aria-label="Номер телефона"
                        autoComplete="username"
                        required
                    />
                ) : (
                    <input
                        type="email"
                        name="username"
                        value={email}
                        onChange={event => setEmail(event.target.value)}
                        placeholder="Электронная почта"
                        aria-label="Электронная почта"
                        autoComplete="username"
                        inputMode="email"
                        maxLength={254}
                        required
                    />
                )}

                <input
                    type="password"
                    name="password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    placeholder="Пароль"
                    aria-label="Пароль"
                    autoComplete="current-password"
                    required
                />

                {(localError || error) && (
                    <p className="error" role="alert">
                        {localError || error}
                    </p>
                )}

                <button type="submit" disabled={busy}>
                    {busy ? 'Входим…' : 'Войти'}
                </button>
            </form>

            {passkeyReady && (
                <button
                    type="button"
                    className="passkey-action"
                    disabled={passkeyBusy}
                    onClick={() => void passkeyLogin()}
                >
                    {passkeyBusy
                        ? 'Подтверждаем…'
                        : 'Войти по лицу, отпечатку или ключу'}
                </button>
            )}

            <button
                type="button"
                className="registration-back"
                onClick={onRegister}
            >
                Создать аккаунт
            </button>
        </>
    );
}
