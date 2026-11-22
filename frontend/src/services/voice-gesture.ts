export type VoiceGestureAction =
    | 'keep'
    | 'lock'
    | 'send'
    | 'cancel';

export type VoiceGestureHint =
    | 'holding'
    | 'lock'
    | 'cancel';

type VoiceGesture = {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    elapsedMs: number;
};

export function previewVoiceGesture(
    gesture: Pick<
        VoiceGesture,
        'startX' | 'startY' | 'currentX' | 'currentY'
    >
): VoiceGestureHint {
    const dx = gesture.currentX - gesture.startX;
    const dy = gesture.currentY - gesture.startY;

    if (dx <= -85 && Math.abs(dx) >= Math.abs(dy) * 0.7) {
        return 'cancel';
    }

    if (dy <= -65 && Math.abs(dy) >= Math.abs(dx) * 0.7) {
        return 'lock';
    }

    return 'holding';
}

export function classifyVoiceGesture(
    gesture: VoiceGesture
): VoiceGestureAction {
    const preview = previewVoiceGesture(gesture);

    if (preview === 'cancel') return 'cancel';
    if (preview === 'lock') return 'lock';

    // A quick tap starts a hands-free recording.
    if (gesture.elapsedMs < 320) return 'keep';

    // Releasing after a longer hold sends the recording.
    return 'send';
}
