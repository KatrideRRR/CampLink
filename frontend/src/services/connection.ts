
import { io } from 'socket.io-client';
import {
    CAMPLINK_API_ORIGIN,
    getNativeToken,
    isBundledNative,
} from './native-auth';

export function connectToServer(
    onStatusChange: (connected: boolean) => void
) {
    const native = isBundledNative();

    const socket = io(
        native ? CAMPLINK_API_ORIGIN : window.location.origin,
        {
        path: '/socket.io',
        autoConnect: !native || getNativeToken() !== null,
        auth: native
            ? { token: getNativeToken() }
            : undefined,
        transports: ['websocket', 'polling'],
        tryAllTransports: true,
        reconnectionDelayMax: 3000,
        timeout: 10000,
        withCredentials: !native,
        reconnection: true,
        reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
        onStatusChange(true);
    });

    socket.on('disconnect', () => {
        onStatusChange(false);
    });

    socket.on('connect_error', () => {
        onStatusChange(false);
    });

    return socket;
}
