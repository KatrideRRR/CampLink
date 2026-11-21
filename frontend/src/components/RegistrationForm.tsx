import { useState, type FormEvent } from 'react';
import PhoneInput, {
    isValidPhoneNumber,
    type Value,
} from 'react-phone-number-input';
import ru from 'react-phone-number-input/locale/ru';
import flags from 'react-phone-number-input/flags';
import 'react-phone-number-input/style.css';

export type RegistrationPayload = {
    displayName: string;
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
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState<Value>();
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [localError, setLocalError] = useState('');

    async function submit(event: FormEvent) {
        event.preventDefault();
        setLocalError('');

        const name = displayName.trim()
            .replace(/\s+/g, ' ');

        if (
            name.length < 2 ||
            name.length > 60 ||
            !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'-]*$/u
                .test(name)
        ) {
            setLocalError(
                'Введите имя или никнейм от 2 до 60 символов'
            );
            return;
        }

        if (!phone || !isValidPhoneNumber(phone)) {
            setLocalError(
                'Проверьте номер телефона и код страны'
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
                displayName: name,
                email: email.trim().toLowerCase(),
                phone,
                password,
            });
        } catch {
            // Error is displayed by the parent.
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
                    type="text"
                    value={displayName}
                    onChange={event =>
                        setDisplayName(event.target.value)
                    }
                    placeholder="Имя или никнейм"
                    aria-label="Имя или никнейм"
                    autoComplete="name"
                    maxLength={60}
                    required
                />

                <PhoneInput
                    className="registration-phone"
                    defaultCountry="RU"
                    international
                    countryCallingCodeEditable={false}
                    labels={ru}
                    flags={flags}
                    value={phone}
                    onChange={setPhone}
                    placeholder="Номер телефона"
                    aria-label="Номер телефона"
                    autoComplete="tel"
                    required
                />

                <input
                    type="email"
                    value={email}
                    onChange={event =>
                        setEmail(event.target.value)
                    }
                    placeholder="Электронная почта"
                    autoComplete="email"
                    required
                />

                <input
                    type="password"
                    value={password}
                    onChange={event =>
                        setPassword(event.target.value)
                    }
                    placeholder="Пароль (от 12 символов)"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                />

                <input
                    type="password"
                    value={confirmation}
                    onChange={event =>
                        setConfirmation(event.target.value)
                    }
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
