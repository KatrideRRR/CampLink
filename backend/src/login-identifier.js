import { normalizePhone } from './registration.js';

export function normalizeLoginIdentifier(value) {
    if (typeof value !== 'string') return null;

    const input = value.trim();

    if (!input || input.length > 254) {
        return null;
    }

    if (
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)
    ) {
        return input.toLowerCase();
    }

    return normalizePhone(input);
}
