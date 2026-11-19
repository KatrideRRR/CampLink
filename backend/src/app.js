import {
    createHash,
    timingSafeEqual,
} from 'node:crypto';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createStore } from './store.js';
import {
    issueRelayTicket,
} from '../../shared/relay-ticket.js';

const COOKIE_NAME = 'camplink_session';
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;

function gatewaySecretsMatch(received, expected) {
    if (
        typeof received !== 'string' ||
        typeof expected !== 'string' ||
        expected.length < 32
    ) {
        return false;
    }

    const hash = (value) =>
        createHash('sha256').update(value).digest();

    return timingSafeEqual(
        hash(received),
        hash(expected)
    );
}

function readSessionToken(header = '') {
    const match = header.match(
        /(?:^|;\s*)camplink_session=([a-f0-9]{64})(?:;|$)/
    );

    return match?.[1] ?? null;
}

const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
};

export function createAppServer(options = {}) {
    const store = createStore(options.databasePath);
    const app = express();

    app.disable('x-powered-by');
    app.use(express.json({ limit: '8kb' }));

    const httpServer = createServer(app);

    const allowedOrigins = (
        process.env.CAMPLINK_ALLOWED_ORIGINS ||
        'http://localhost:5173,http://127.0.0.1:5173'
    )
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    const io = new Server(httpServer, {
        transports: ['websocket', 'polling'],
        cors: {
            origin: allowedOrigins,
            credentials: true,
        },
        allowRequest: (request, callback) => {
            const origin = request.headers.origin;

            callback(
                null,
                !origin || allowedOrigins.includes(origin)
            );
        },
    });

    function persistAndBroadcast(payload) {
        const result = store.saveMessage(payload);

        if (result.created) {
            io.to(`user:${payload.senderId}`)
                .to(`user:${payload.recipientId}`)
                .emit('chat:new', result.message);
        }

        return result;
    }

    const loginAttempts = new Map();

    function requireAuth(req, res, next) {
        const token = readSessionToken(req.headers.cookie);
        const user = store.getSessionUser(token);

        if (!user) {
            return res.status(401).json({
                error: 'Unauthorized',
            });
        }

        req.user = user;
        req.sessionToken = token;
        next();
    }

    app.get('/api/health', (_req, res) => {
        res.json({
            ok: true,
            service: 'camplink-api',
            protocolVersion: 1,
        });
    });

    app.post('/api/internal/email/ingest', (req, res) => {
        const gatewaySecret =
            options.emailGatewaySecret ??
            process.env.CAMPLINK_EMAIL_GATEWAY_SECRET;

        if (
            typeof gatewaySecret !== 'string' ||
            gatewaySecret.length < 32
        ) {
            return res.status(503).json({
                error: 'Email gateway is not configured',
            });
        }

        const providedSecret =
            req.get('x-camplink-gateway-secret');

        if (
            !gatewaySecretsMatch(
                providedSecret,
                gatewaySecret
            )
        ) {
            return res.status(401).json({
                error: 'Unauthorized gateway',
            });
        }

        const {
            senderId,
            recipientId,
            clientMessageId,
            clientCreatedAt,
            text,
        } = req.body ?? {};

        const validId =
            typeof clientMessageId === 'string' &&
            /^[a-f0-9-]{36}$/i.test(clientMessageId);

        const validTime =
            typeof clientCreatedAt === 'string' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
                .test(clientCreatedAt) &&
            Number.isFinite(Date.parse(clientCreatedAt));

        if (
            !Number.isSafeInteger(senderId) ||
            !Number.isSafeInteger(recipientId) ||
            senderId <= 0 ||
            recipientId <= 0 ||
            senderId === recipientId ||
            !validId ||
            !validTime ||
            typeof text !== 'string' ||
            !text.trim() ||
            text.length > 2000
        ) {
            return res.status(400).json({
                error: 'Invalid email message envelope',
            });
        }

        if (
            !store.getUserById(senderId) ||
            !store.getUserById(recipientId)
        ) {
            return res.status(404).json({
                error: 'User not found',
            });
        }

        try {
            const result = persistAndBroadcast({
                senderId,
                recipientId,
                clientMessageId,
                clientCreatedAt,
                text: text.trim(),
            });

            return res.status(result.created ? 201 : 200)
                .json({
                    ok: true,
                    duplicate: !result.created,
                    message: result.message,
                });
        } catch {
            return res.status(409).json({
                error: 'Message could not be accepted',
            });
        }
    });

    app.post('/api/auth/login', (req, res) => {
        const username =
            typeof req.body?.username === 'string'
                ? req.body.username.trim().toLowerCase()
                : '';

        const password = req.body?.password;
        const key = `${req.ip}:${username}`;

        const now = Date.now();
        const previous = loginAttempts.get(key);

        if (previous && now - previous.first > 900000) {
            loginAttempts.delete(key);
        }

        const attempt = loginAttempts.get(key);

        if (attempt?.count >= 8) {
            return res.status(429).json({
                error: 'Too many login attempts',
            });
        }

        const user = store.verifyCredentials(
            username,
            password
        );

        if (!user) {
            const current = loginAttempts.get(key) || {
                count: 0,
                first: now,
            };

            current.count += 1;
            loginAttempts.set(key, current);

            return res.status(401).json({
                error: 'Invalid credentials',
            });
        }

        loginAttempts.delete(key);

        const token = store.createSession(user.id);

        res.cookie(COOKIE_NAME, token, {
            ...cookieOptions,
            maxAge: SESSION_AGE,
        });

        res.json({ user });
    });

    app.get('/api/auth/me', requireAuth, (req, res) => {
        res.json({ user: req.user });
    });

    app.post('/api/push/devices', requireAuth, (req, res) => {
        const origin = req.get('origin');

        if (origin && !allowedOrigins.includes(origin)) {
            return res.status(403).json({
                error: 'Forbidden origin',
            });
        }

        const { provider, token } = req.body ?? {};

        if (
            provider !== 'apns' ||
            typeof token !== 'string' ||
            !/^[a-f0-9]{64}$/i.test(token)
        ) {
            return res.status(400).json({
                error: 'Invalid push device',
            });
        }

        try {
            store.registerPushDevice(
                req.user.id,
                req.sessionToken,
                token.toLowerCase()
            );

            return res.sendStatus(204);
        } catch {
            return res.status(401).json({
                error: 'Invalid session',
            });
        }
    });

    app.get('/api/relay/credential', requireAuth, (req, res) => {
        const secret =
            options.relayTokenSecret ??
            process.env.CAMPLINK_RELAY_TOKEN_SECRET;

        if (
            typeof secret !== 'string' ||
            secret.length < 32
        ) {
            return res.status(503).json({
                error: 'Relay is not configured',
            });
        }

        const credential = issueRelayTicket(
            req.user.id,
            secret
        );

        res.set('Cache-Control', 'no-store');

        return res.json(credential);
    });

    app.post('/api/auth/logout', requireAuth, (req, res) => {
        const token = req.sessionToken;

        store.deleteSession(token);

        for (const socket of io.sockets.sockets.values()) {
            if (socket.data.sessionToken === token) {
                socket.disconnect(true);
            }
        }

        res.clearCookie(COOKIE_NAME, cookieOptions);
        res.json({ ok: true });
    });

    app.get('/api/users', requireAuth, (req, res) => {
        res.json({
            users: store.listUsers(req.user.id),
        });
    });

    app.get(
        '/api/messages/:peerId',
        requireAuth,
        (req, res) => {
            const peerId = Number(req.params.peerId);

            if (
                !Number.isSafeInteger(peerId) ||
                peerId <= 0 ||
                !store.getUserById(peerId)
            ) {
                return res.status(404).json({
                    error: 'User not found',
                });
            }

            res.json({
                messages: store.getConversation(
                    req.user.id,
                    peerId
                ),
            });
        }
    );

    io.use((socket, next) => {
        const token = readSessionToken(
            socket.request.headers.cookie
        );

        const user = store.getSessionUser(token);

        if (!user) {
            return next(new Error('Unauthorized'));
        }

        socket.data.user = user;
        socket.data.sessionToken = token;

        next();
    });

    io.on('connection', (socket) => {
        const user = socket.data.user;

        socket.join(`user:${user.id}`);

        socket.emit('system:hello', {
            ready: true,
            protocolVersion: 1,
            userId: user.id,
        });

        socket.on('chat:send', (payload, acknowledgement) => {
            const reply =
                typeof acknowledgement === 'function'
                    ? acknowledgement
                    : () => {};

            if (!store.getSessionUser(socket.data.sessionToken)) {
                socket.disconnect(true);
                return reply({
                    ok: false,
                    error: 'Unauthorized',
                });
            }

            const toUserId = payload?.toUserId;
            const text = payload?.text;
            const clientMessageId = payload?.clientMessageId;

            const clientCreatedAt = payload?.clientCreatedAt;

            if (
                !Number.isSafeInteger(toUserId) ||
                toUserId <= 0 ||
                toUserId === user.id ||
                !store.getUserById(toUserId) ||
                typeof text !== 'string' ||
                !text.trim() ||
                text.length > 2000 ||
                typeof clientMessageId !== 'string' ||
                !/^[a-f0-9-]{36}$/i.test(clientMessageId)
            ) {
                return reply({
                    ok: false,
                    error: 'Invalid message',
                });
            }

            try {
                const result = persistAndBroadcast({
                    senderId: user.id,
                    recipientId: toUserId,
                    clientMessageId,
                    text: text.trim(),
                    clientCreatedAt,
                });

                reply({
                    ok: true,
                    message: result.message,
                });
            } catch {
                reply({
                    ok: false,
                    error: 'Message could not be saved',
                });
            }
        });
    });

    return { app, httpServer, io, store };
}
