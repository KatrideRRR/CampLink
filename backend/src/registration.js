import {
    parsePhoneNumberFromString,
} from 'libphonenumber-js/max';

export function normalizePhone(value) {
    if (typeof value !== 'string') return null;

    let phone = value.trim().replace(/[\s()-]/g, '');

    // Existing Russian 8-prefixed numbers.
    if (/^8\d{10}$/.test(phone)) {
        phone = '+7' + phone.slice(1);
    } else if (/^7\d{10}$/.test(phone)) {
        phone = '+' + phone;
    }

    const parsed = parsePhoneNumberFromString(
        phone,
        { defaultCountry: 'RU', extract: false }
    );

    return parsed?.isValid()
        ? parsed.number
        : null;
}

export function validateRegistration(input) {
    const username =
        typeof input?.username === 'string'
            ? input.username.trim().toLowerCase()
            : '';

    const hasDisplayName =
        typeof input?.displayName === 'string';

    const displayName = hasDisplayName
        ? input.displayName.trim().replace(/\s+/g, ' ')
        : username;

    const validUsername =
        /^[a-z0-9_]{3,24}$/.test(username);

    const validDisplayName =
        displayName.length >= 2 &&
        displayName.length <= 60 &&
        /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'-]*$/u
            .test(displayName);

    const email =
        typeof input?.email === 'string'
            ? input.email.trim().toLowerCase()
            : '';

    const phone = normalizePhone(input?.phone);
    const password = input?.password;

    if (
        !validDisplayName ||
        (!hasDisplayName && !validUsername) ||
        (username && !validUsername) ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !phone ||
        typeof password !== 'string' ||
        password.length < 12 ||
        password.length > 128
    ) {
        return null;
    }

    return {
        username: username || null,
        displayName,
        email,
        phone,
        password,
    };
}
