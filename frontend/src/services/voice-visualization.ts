export function formatVoiceTime(seconds: number): string {
    const safe = Number.isFinite(seconds)
        ? Math.max(0, Math.floor(seconds))
        : 0;

    const minutes = Math.floor(safe / 60);
    const remainder = safe % 60;

    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function voiceBarLevels(
    spectrum: Uint8Array,
    barCount = 28
): number[] {
    const count = Math.max(1, Math.min(64, Math.floor(barCount)));

    if (spectrum.length === 0) {
        return Array(count).fill(0);
    }

    const first = spectrum.length > 2 ? 2 : 0;
    const last = Math.min(spectrum.length - 1, 110);
    const span = Math.max(1, last - first + 1);

    return Array.from({ length: count }, (_, index) => {
        const start = Math.min(
            last,
            first + Math.floor(index * span / count)
        );

        const end = Math.min(
            last + 1,
            first + Math.ceil((index + 1) * span / count)
        );

        let total = 0;

        for (let i = start; i < end; i++) {
            total += spectrum[i];
        }

        const average = total / Math.max(1, end - start);

        return Math.min(1, Math.sqrt(average / 255) * 1.15);
    });
}
