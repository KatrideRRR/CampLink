export function normalizePhone(value) {
    if (typeof value !== 'string') return null;

    let phone = value.trim().replace(/[\s()-]/g, '');

    if (/^8\d{10}$/.test(phone)) {
        phone = '+7' + phone.slice(1);
    } else if (/^7\d{10}$/.test(phone)) {
        phone = '+' + phone;
    }

    return /^\+[1-9]\d{7,14}$/.test(phone)
        ? phone
        : null;
}

export function validateRegistration(input) {
    const username =
        typeof input?.username === 'string'
            ? input.username.trim().toLowerCase()
            : '';

    const email =
        typeof input?.email === 'string'
            ? input.email.trim().toLowerCase()
            : '';

    const phone = normalizePhone(input?.phone);
    const password = input?.password;

    if (
        !/^[a-z0-9_]{3,24}$/.test(username) ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !phone ||
        typeof password !== 'string' ||
        password.length < 12 ||
        password.length > 128
    ) {
        return null;
    }

    return { username, email, phone, password };
}
