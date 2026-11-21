const MAX_PREVIEW_LENGTH = 160;

export function buildMessagePushPayload(
    message,
    senderUsername
) {
    const value =
        typeof senderUsername === 'string'
            ? senderUsername.trim()
            : '';

    const name =
        /^[a-z0-9_]{3,24}$/.test(value)
            ? `@${value}`
            : (
                value.length >= 2 &&
                value.length <= 60 &&
                /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'-]*$/u
                    .test(value)
            )
                ? value
                : 'Пользователь';

    const text =
        typeof message?.text === 'string'
            ? message.text.replace(/\s+/g, ' ').trim()
            : '';

    const chars = Array.from(text);

    const preview = chars.length > MAX_PREVIEW_LENGTH
        ? chars.slice(0, MAX_PREVIEW_LENGTH - 1)
            .join('') + '…'
        : text;

    return {
        notification: {
            title: name,
            body: preview || 'Новое сообщение',
        },
        data: {
            peerId: String(message.senderId),
            messageId: String(message.id),
        },
    };
}
