
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

export function createAppServer() {
    const app = express();
    app.disable('x-powered-by');

    app.get('/api/health', (_req, res) => {
        res.json({
            ok: true,
            service: 'camplink-api',
            protocolVersion: 1,
        });
    });

    const httpServer = createServer(app);

    const io = new Server(httpServer, {
        transports: ['websocket', 'polling'],
        cors: {
            origin: [
                'http://localhost:5173',
                'http://127.0.0.1:5173',
            ],
            methods: ['GET', 'POST'],
        },
    });

    io.on('connection', (socket) => {
        socket.emit('system:hello', {
            protocolVersion: 1,
            ready: true,
        });
    });

    return { app, httpServer, io };
}
