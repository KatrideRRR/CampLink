const SOUND_KEY = 'camplink.message-sound.v1';

let audioContext: AudioContext | null = null;
let lastPlayedAt = 0;

export function readNotificationSoundEnabled(): boolean {
    try {
        return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
        return true;
    }
}

export function saveNotificationSoundEnabled(
    enabled: boolean
): void {
    try {
        localStorage.setItem(
            SOUND_KEY,
            enabled ? 'on' : 'off'
        );
    } catch {
        // Storage may be unavailable.
    }
}

export async function unlockNotificationSound(): Promise<void> {
    try {
        if (!audioContext) {
            audioContext = new AudioContext();
        }

        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
    } catch {
        // Browser may prohibit audio until user interaction.
    }
}

export function playNotificationSound(): void {
    if (!readNotificationSoundEnabled()) return;
    if (!audioContext || audioContext.state !== 'running') {
        return;
    }

    const nowMs = Date.now();

    // Prevent several nearly simultaneous messages
    // from producing a loud sequence of sounds.
    if (nowMs - lastPlayedAt < 500) return;

    lastPlayedAt = nowMs;

    try {
        const now = audioContext.currentTime + 0.01;

        const tones = [
            { frequency: 784, start: 0, duration: 0.13 },
            { frequency: 988, start: 0.14, duration: 0.17 },
        ];

        for (const tone of tones) {
            const start = now + tone.start;
            const end = start + tone.duration;

            const oscillator = audioContext.createOscillator();
            const volume = audioContext.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(
                tone.frequency,
                start
            );

            volume.gain.setValueAtTime(0.0001, start);
            volume.gain.exponentialRampToValueAtTime(
                0.018,
                start + 0.025
            );
            volume.gain.exponentialRampToValueAtTime(
                0.0001,
                end
            );

            oscillator.connect(volume);
            volume.connect(audioContext.destination);

            oscillator.start(start);
            oscillator.stop(end + 0.01);
        }
    } catch {
        // Notification UI still works without sound.
    }
}
