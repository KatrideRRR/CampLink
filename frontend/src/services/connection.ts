
import { io } from 'socket.io-client';

export function connectToServer(
    onStatusChange: (connected: boolean) => void
) {
    const socket = io({
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        tryAllTransports: true,
        reconnectionDelayMax: 3000,
        timeout: 10000,
        withCredentials: true,
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
