
import { io } from 'socket.io-client';

export function connectToServer(
    onStatusChange: (connected: boolean) => void
) {
    const socket = io({
        path: '/socket.io',
        autoConnect: false,
        transports: ['websocket', 'polling'],
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

    socket.connect();

    return () => {
        socket.disconnect();
    };
}
