const MAX_PREVIEW_LENGTH = 160;

export function buildMessagePushPayload(
    message,
    senderUsername
) {
    const name =
        typeof senderUsername === 'string' &&
        /^[a-z0-9_]{3,24}$/.test(senderUsername)
            ? `@${senderUsername}`
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
