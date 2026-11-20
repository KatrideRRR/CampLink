export type MessageReaction = {
    userId: number;
    emoji: string;
};

export type ReactionUpdate = {
    messageId: number;
    senderId: number;
    recipientId: number;
    reactions: MessageReaction[];
};

export const REACTION_CHOICES = [
    '❤️', '🔥', '💩',
] as const;

export const ACKNOWLEDGED_REACTION = '🫡';

export function isRightSwipe(
    dx: number,
    dy: number,
    minimum = 65
): boolean {
    return (
        dx >= minimum &&
        Math.abs(dy) <= 45 &&
        Math.abs(dy) < dx / 2
    );
}

export function isBackSwipe(
    startX: number,
    dx: number,
    dy: number
): boolean {
    return (
        startX <= 30 &&
        isRightSwipe(dx, dy, 85)
    );
}

export function applyReactionUpdate<
    T extends {
        id: number;
        reactions?: MessageReaction[];
    }
>(
    messages: T[],
    update: ReactionUpdate
): T[] {
    if (
        !Number.isSafeInteger(update?.messageId) ||
        !Array.isArray(update?.reactions)
    ) {
        return messages;
    }

    let found = false;

    const updated = messages.map(message => {
        if (message.id !== update.messageId) {
            return message;
        }

        found = true;

        return {
            ...message,
            reactions: update.reactions,
        };
    });

    return found ? updated : messages;
}
