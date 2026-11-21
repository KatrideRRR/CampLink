export type IncomingNotice =
    | 'none'
    | 'toast'
    | 'bottom'
    | 'sound';

export type IncomingNoticeContext = {
    isOwnMessage: boolean;
    appVisible: boolean;
    alreadyKnown: boolean;
    viewingSenderChat: boolean;
    nearBottom: boolean;
};

export function decideIncomingNotice(
    context: IncomingNoticeContext
): IncomingNotice {
    if (
        context.isOwnMessage ||
        !context.appVisible ||
        context.alreadyKnown
    ) {
        return 'none';
    }

    if (!context.viewingSenderChat) {
        return 'toast';
    }

    return context.nearBottom
        ? 'sound'
        : 'bottom';
}
