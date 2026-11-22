import {
    createHash,
    randomUUID,
    timingSafeEqual,
} from 'node:crypto';
import express from 'express';
import { mountPasskeyRoutes } from './passkeys.js';
import {
    normalizeLoginIdentifier,
} from './login-identifier.js';
import {
    validateRegistration,
} from './registration.js';
import {
    mkdirSync,
    writeFileSync,
    unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
    inspectMedia,
    MAX_MEDIA_BYTES,
} from './media-format.js';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import {
    createStore,
    DEFAULT_DB_PATH,
} from './store.js';
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

function readBearerToken(header) {
    if (typeof header !== 'string') return null;

    const match = /^Bearer ([a-f0-9]{64})$/i.exec(header);

    return match ? match[1].toLowerCase() : null;
}

const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
};

export function createAppServer(options = {}) {
    const store = createStore(options.databasePath);

    const mediaDirectory =
        options.mediaDirectory ??
        process.env.CAMPLINK_MEDIA_DIRECTORY ??
        join(
            dirname(
                options.databasePath &&
                options.databasePath !== ':memory:'
                    ? options.databasePath
                    : DEFAULT_DB_PATH
            ),
            'media'
        );

    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', 'loopback');
    app.use('/api/passkeys', express.json({
        limit: '32kb',
    }));
    app.use(express.json({ limit: '8kb' }));

    const httpServer = createServer(app);

    const allowedOrigins = (
        process.env.CAMPLINK_ALLOWED_ORIGINS ||
        'http://localhost:5173,http://127.0.0.1:5173'
    )
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    const nativeOrigins = new Set([
        'capacitor://localhost',
        'https://localhost',
    ]);

    app.use((req, res, next) => {
        const origin = req.get('origin');

        if (!nativeOrigins.has(origin)) {
            return next();
        }

        res.vary('Origin');
        res.set({
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods':
                'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers':
                'Content-Type, Authorization',
        });

        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }

        next();
    });

    const io = new Server(httpServer, {
        transports: ['websocket', 'polling'],
        cors: {
            origin: [
                ...allowedOrigins,
                ...nativeOrigins,
            ],
            credentials: true,
        },
        allowRequest: (request, callback) => {
            const origin = request.headers.origin;

            callback(
                null,
                !origin ||
                allowedOrigins.includes(origin) ||
                nativeOrigins.has(origin)
            );
        },
    });

    function deliverPush(message) {
        if (typeof options.pushSender !== 'function') {
            return;
        }

        try {
            const tokens = [
                ...new Set(
                    store.getPushDevices(message.recipientId)
                        .filter((device) => device.provider === 'fcm')
                        .map((device) => device.token)
                ),
            ];

            if (tokens.length === 0) return;

            void Promise.resolve()
                .then(() => options.pushSender({
                    message,
                    tokens,
                    senderUsername:
                        store.getUserById(
                            message.senderId
                        )?.displayName ?? null,
                }))
                .then((invalidTokens) => {
                    if (!Array.isArray(invalidTokens)) return;

                    for (const token of invalidTokens) {
                        if (!tokens.includes(token)) continue;

                        store.removePushDevice(
                            message.recipientId,
                            'fcm',
                            token
                        );
                    }
                })
                .catch((error) => {
                    console.error(
                        '[FCM] Delivery failed:',
                        error?.message ?? 'Unknown error'
                    );
                });
        } catch (error) {
            console.error(
                '[FCM] Scheduling failed:',
                error?.message ?? 'Unknown error'
            );
        }
    }

    function emitUnreadCount(userId, peerId) {
        const item = store.getUnreadCounts(userId)
            .find(row => row.peerId === peerId);

        io.to(`user:${userId}`).emit(
            'chat:unread',
            {
                peerId,
                unreadCount: item?.unreadCount ?? 0,
            }
        );
    }

    function broadcastSavedMessage(message) {
        io.to(`user:${message.senderId}`)
            .to(`user:${message.recipientId}`)
            .emit('chat:new', message);

        emitUnreadCount(
            message.recipientId,
            message.senderId
        );

        deliverPush(message);
    }

    function persistAndBroadcast(payload) {
        const result = store.saveMessage(payload);

        if (result.created) {
            broadcastSavedMessage(result.message);
        }

        return result;
    }

    function dispatchScheduledMessages(now = Date.now()) {
        const messages =
            store.dispatchDueScheduledMessages(now);

        for (const message of messages) {
            broadcastSavedMessage(message);
        }

        return messages;
    }

    const loginAttempts = new Map();
    const registrationAttempts = new Map();
    const searchAttempts = new Map();

    function requireAuth(req, res, next) {
        const authorization = req.get('authorization');
        const origin = req.get('origin');

        if (
            authorization &&
            origin &&
            !nativeOrigins.has(origin)
        ) {
            return res.status(403).json({
                error: 'Forbidden origin',
            });
        }

        const token = authorization
            ? readBearerToken(authorization)
            : readSessionToken(req.headers.cookie);

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

    app.post([
        '/api/auth/register',
        '/api/auth/native-register',
    ], (req, res) => {
        const native =
            req.path === '/api/auth/native-register';
        const origin = req.get('origin');

        if (
            native &&
            origin &&
            !nativeOrigins.has(origin)
        ) {
            return res.status(403).json({
                error: 'Forbidden origin',
            });
        }

        if (!native && origin) {
            const sameHost = (() => {
                try {
                    return new URL(origin).host ===
                        req.get('host');
                } catch {
                    return false;
                }
            })();

            if (
                !sameHost &&
                !allowedOrigins.includes(origin)
            ) {
                return res.status(403).json({
                    error: 'Forbidden origin',
                });
            }
        }

        const data = validateRegistration(req.body);

        if (!data) {
            return res.status(400).json({
                error: 'Invalid registration data',
            });
        }

        const key = req.ip ?? 'unknown';
        const now = Date.now();
        let attempt = registrationAttempts.get(key);

        if (!attempt || now - attempt.started > 3600000) {
            attempt = { started: now, count: 0 };
        }

        if (attempt.count >= 5) {
            return res.status(429).json({
                error: 'Too many registrations',
            });
        }

        attempt.count++;
        registrationAttempts.set(key, attempt);

        let user;

        try {
            user = store.registerUser(data);
        } catch (error) {
            if (
                String(error?.code ?? '').startsWith(
                    'SQLITE_CONSTRAINT'
                )
            ) {
                return res.status(409).json({
                    error: 'Registration conflict',
                });
            }

            console.error(
                '[Registration] Failed:',
                error?.message
            );

            return res.status(500).json({
                error: 'Registration unavailable',
            });
        }

        const token = store.createSession(user.id);

        res.set('Cache-Control', 'no-store');

        if (native) {
            return res.status(201).json({
                user,
                token,
                expiresInSeconds:
                    Math.floor(SESSION_AGE / 1000),
            });
        }

        res.cookie(COOKIE_NAME, token, {
            ...cookieOptions,
            maxAge: SESSION_AGE,
        });

        return res.status(201).json({ user });
    });

    app.post([
        '/api/auth/login',
        '/api/auth/native-login',
    ], (req, res) => {
        const native =
            req.path === '/api/auth/native-login';

        const origin = req.get('origin');

        if (
            native &&
            origin &&
            !nativeOrigins.has(origin)
        ) {
            return res.status(403).json({
                error: 'Forbidden origin',
            });
        }
        const username = normalizeLoginIdentifier(
            req.body?.username
        );

        const password = req.body?.password;
        const key = `${req.ip}:${username ?? 'invalid'}`;

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

        const user = username
            ? store.verifyCredentials(
                username,
                password,
                { emailOrPhoneOnly: true }
            )
            : null;

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

        res.set('Cache-Control', 'no-store');

        if (native) {
            return res.json({
                user,
                token,
                expiresInSeconds:
                    Math.floor(SESSION_AGE / 1000),
            });
        }

        res.cookie(COOKIE_NAME, token, {
            ...cookieOptions,
            maxAge: SESSION_AGE,
        });

        res.json({ user });
    });

    app.get('/api/auth/me', requireAuth, (req, res) => {
        res.json({ user: req.user });
    });

    mountPasskeyRoutes({
        app,
        store,
        requireAuth,
        nativeOrigins,
        sessionAge: SESSION_AGE,
        cookieName: COOKIE_NAME,
        cookieOptions,
    });

    // Push diagnostics never expose actual device tokens.
    const pushTestAttempts = new Map();

    app.get('/api/push/status', requireAuth, (req, res) => {
        const registeredDevices = store
            .getPushDevices(req.user.id)
            .filter(device => device.provider === 'fcm')
            .length;

        res.set('Cache-Control', 'no-store');

        return res.json({
            serverEnabled:
                typeof options.pushSender === 'function',
            registeredDevices,
        });
    });

    app.post('/api/push/test', requireAuth, (req, res) => {
        const origin = req.get('origin');

        if (
            origin &&
            !allowedOrigins.includes(origin) &&
            !nativeOrigins.has(origin)
        ) {
            return res.status(403).json({
                error: 'Forbidden origin',
            });
        }

        if (typeof options.pushSender !== 'function') {
            return res.status(503).json({
                error: 'FCM sender is not configured',
            });
        }

        const tokens = [
            ...new Set(
                store.getPushDevices(req.user.id)
                    .filter(device => device.provider === 'fcm')
                    .map(device => device.token)
            ),
        ];

        if (tokens.length === 0) {
            return res.status(409).json({
                error: 'No registered FCM devices',
            });
        }

        const now = Date.now();
        const previous = pushTestAttempts.get(req.user.id) ?? 0;

        if (now - previous < 30000) {
            return res.status(429).json({
                error: 'Retry after 30 seconds',
            });
        }

        pushTestAttempts.set(req.user.id, now);

        const delay = options.pushTestDelayMs ?? 8000;
        const recipientId = req.user.id;

        setTimeout(() => {
            void Promise.resolve()
                .then(() => options.pushSender({
                    tokens,
                    senderUsername: 'CampLink',
                    message: {
                        id: 0,
                        senderId: 0,
                        recipientId,
                        text: 'Проверка Push-уведомлений CampLink',
                    },
                }))
                .then(invalidTokens => {
                    if (!Array.isArray(invalidTokens)) return;

                    for (const token of invalidTokens) {
                        if (!tokens.includes(token)) continue;
                        store.removePushDevice(
                            recipientId,
                            'fcm',
                            token
                        );
                    }
                })
                .catch(error => {
                    console.error(
                        '[FCM] Test notification failed:',
                        error?.message ?? 'Unknown error'
                    );
                });
        }, delay);

        res.set('Cache-Control', 'no-store');

        return res.status(202).json({
            scheduledInSeconds: Math.ceil(delay / 1000),
            deviceCount: tokens.length,
        });
    });

    app.post('/api/push/devices', requireAuth, (req, res) => {
        const origin = req.get('origin');

        if (
            origin &&
            !allowedOrigins.includes(origin) &&
            !nativeOrigins.has(origin)
        ) {
            return res.status(403).json({
                error: 'Forbidden origin',
            });
        }

        const { provider, token } = req.body ?? {};

        const validApns =
            provider === 'apns' &&
            typeof token === 'string' &&
            /^[a-f0-9]{64}$/i.test(token);

        const validFcm =
            provider === 'fcm' &&
            typeof token === 'string' &&
            /^[A-Za-z0-9:_-]{20,2048}$/.test(token);

        if (!validApns && !validFcm) {
            return res.status(400).json({
                error: 'Invalid push device',
            });
        }

        try {
            store.registerPushDevice(
                req.user.id,
                req.sessionToken,
                validApns ? token.toLowerCase() : token,
                provider
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

    app.post(
        '/api/media/send',
        requireAuth,
        express.raw({
            type: '*/*',
            limit: MAX_MEDIA_BYTES,
        }),
        (req, res) => {
            const origin = req.get('origin');

            if (
                origin &&
                !allowedOrigins.includes(origin) &&
                !nativeOrigins.has(origin)
            ) {
                return res.status(403).json({
                    error: 'Forbidden origin',
                });
            }

            const recipientId = Number(
                req.query.toUserId
            );
            const clientMessageId =
                req.query.clientMessageId;
            const kind = req.query.kind;
            const rawReplyTo = req.query.replyToMessageId;

            const replyToMessageId =
                rawReplyTo === undefined
                    ? null
                    : Number(rawReplyTo);

            const mimeType = (
                req.get('content-type') ?? ''
            ).split(';')[0].trim().toLowerCase();

            const valid =
                inspectMedia(kind, mimeType, req.body);

            if (
                !valid ||
                !Number.isSafeInteger(recipientId) ||
                recipientId <= 0 ||
                recipientId === req.user.id ||
                !store.getUserById(recipientId) ||
                typeof clientMessageId !== 'string' ||
                !/^[a-f0-9-]{36}$/i.test(clientMessageId) ||
                (
                    replyToMessageId !== null &&
                    (
                        !Number.isSafeInteger(replyToMessageId) ||
                        replyToMessageId <= 0
                    )
                )
            ) {
                return res.status(400).json({
                    error: 'Invalid media message',
                });
            }

            const mediaId = randomUUID();
            const fileName =
                mediaId + '.' + valid.extension;
            const path = join(mediaDirectory, fileName);

            try {
                mkdirSync(mediaDirectory, {
                    recursive: true,
                    mode: 0o700,
                });

                writeFileSync(path, req.body, {
                    flag: 'wx',
                    mode: 0o600,
                });
            } catch {
                return res.status(500).json({
                    error: 'Media storage unavailable',
                });
            }

            let result;

            try {
                result = store.saveMediaMessage({
                    senderId: req.user.id,
                    recipientId,
                    clientMessageId,
                    replyToMessageId,
                    mediaId,
                    kind,
                    mimeType,
                    fileName,
                    bytes: req.body.length,
                });
            } catch (error) {
                try {
                    unlinkSync(path);
                } catch (cleanupError) {
                    console.error(
                        '[Media] Cleanup failed:',
                        cleanupError
                    );
                }

                console.error(
                    '[Media] Message save failed:',
                    error?.message
                );

                return res.status(400).json({
                    error: 'Media message could not be saved',
                });
            }

            if (!result.created) {
                // Duplicate upload: keep the original file.
                try {
                    unlinkSync(path);
                } catch (error) {
                    console.error(
                        '[Media] Duplicate cleanup failed:',
                        error
                    );
                }
            } else {
                // A notification error must never delete
                // an already committed attachment.
                try {
                    io.to('user:' + req.user.id)
                        .to('user:' + recipientId)
                        .emit('chat:new', result.message);

                    emitUnreadCount(
                        recipientId,
                        req.user.id
                    );

                    deliverPush(result.message);
                } catch (error) {
                    console.error(
                        '[Media] Notification failed:',
                        error
                    );
                }
            }

            return res.status(
                result.created ? 201 : 200
            ).json({
                ok: true,
                message: result.message,
            });
        }
    );

    app.get('/api/media/:id', requireAuth, (req, res) => {
        const record = store.getMediaForUser(
            req.user.id,
            req.params.id
        );

        if (!record) {
            return res.status(404).json({
                error: 'Media not found',
            });
        }

        res.set({
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy':
                "default-src 'none'",
        });

        res.type(record.mimeType);

        return res.sendFile(
            join(mediaDirectory, record.fileName),
            (error) => {
                if (error && !res.headersSent) {
                    res.status(404).end();
                }
            }
        );
    });

    app.get('/api/users', requireAuth, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({
            users: store.listChats(req.user.id),
        });
    });

    app.get(
        '/api/users/suggest',
        requireAuth,
        (req, res) => {
            const q = req.query.q;

            if (
                typeof q !== 'string' ||
                q.length > 64 ||
                (
                    q.length < 3 &&
                    !/^#[1-9]$/.test(q)
                )
            ) {
                return res.status(400).json({
                    error: 'Invalid search',
                });
            }

            const key = req.user.id;
            const now = Date.now();
            let attempt = searchAttempts.get(key);

            if (!attempt || now - attempt.started > 60000) {
                attempt = { started: now, count: 0 };
            }

            if (attempt.count >= 40) {
                return res.status(429).json({
                    error: 'Search rate limit',
                });
            }

            attempt.count++;
            searchAttempts.set(key, attempt);

            res.set('Cache-Control', 'no-store');

            return res.json({
                users: store.suggestUsers(
                    req.user.id, q
                ),
            });
        }
    );

    app.get(
        '/api/users/search',
        requireAuth,
        (req, res) => {
            const username = req.query.username;

            if (
                typeof username !== 'string' ||
                !/^[a-z0-9_]{3,24}$/.test(username)
            ) {
                return res.status(400).json({
                    error: 'Invalid username',
                });
            }

            const user =
                store.findUserByUsername(username);

            res.set('Cache-Control', 'no-store');
            res.json({
                user: user?.id === req.user.id
                    ? null
                    : user,
            });
        }
    );

    // Scheduled messages use the authenticated sender.
    function validateScheduledOrigin(req, res, next) {
        const origin = req.get('origin');

        if (
            origin &&
            !allowedOrigins.includes(origin) &&
            !nativeOrigins.has(origin)
        ) {
            return res.status(403).json({
                error: 'Forbidden origin',
            });
        }

        next();
    }

    app.get('/api/scheduled-messages', requireAuth, (req, res) => {
        let peerId = null;

        if (req.query.peerId !== undefined) {
            peerId = Number(req.query.peerId);

            if (
                !Number.isSafeInteger(peerId) ||
                peerId <= 0
            ) {
                return res.status(400).json({
                    error: 'Invalid peer ID',
                });
            }
        }

        res.set('Cache-Control', 'no-store');

        return res.json({
            items: store.listScheduledMessages(
                req.user.id,
                peerId
            ),
        });
    });

    app.post(
        '/api/scheduled-messages',
        requireAuth,
        validateScheduledOrigin,
        (req, res) => {
            const {
                recipientId,
                clientMessageId,
                text,
                scheduledAt,
            } = req.body ?? {};

            const time =
                typeof scheduledAt === 'string'
                    ? Date.parse(scheduledAt)
                    : NaN;

            const now = Date.now();

            if (
                !Number.isSafeInteger(recipientId) ||
                recipientId <= 0 ||
                recipientId === req.user.id ||
                !store.getUserById(recipientId) ||
                typeof clientMessageId !== 'string' ||
                !/^[a-f0-9-]{36}$/i.test(clientMessageId) ||
                typeof text !== 'string' ||
                !text.trim() ||
                text.length > 2000 ||
                typeof scheduledAt !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) ||
                !Number.isFinite(time) ||
                time < now + 60000 ||
                time > now + 90 * 24 * 60 * 60 * 1000
            ) {
                return res.status(400).json({
                    error: 'Invalid schedule',
                });
            }

            try {
                const result = store.scheduleMessage({
                    senderId: req.user.id,
                    recipientId,
                    clientMessageId,
                    text: text.trim(),
                    scheduledAt: time,
                });

                res.set('Cache-Control', 'no-store');

                return res.status(
                    result.created ? 201 : 200
                ).json({
                    ok: true,
                    id: result.id,
                    created: result.created,
                });
            } catch {
                return res.status(409).json({
                    error: 'Schedule conflict or limit',
                });
            }
        }
    );

    app.delete(
        '/api/scheduled-messages/:id',
        requireAuth,
        validateScheduledOrigin,
        (req, res) => {
            const id = Number(req.params.id);

            if (
                !Number.isSafeInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    error: 'Invalid schedule ID',
                });
            }

            const canceled =
                store.cancelScheduledMessage(req.user.id, id);

            return canceled
                ? res.sendStatus(204)
                : res.sendStatus(404);
        }
    );

    app.post('/api/contacts', requireAuth, (req, res) => {
        const origin = req.get('origin');

        if (
            origin &&
            !allowedOrigins.includes(origin) &&
            !nativeOrigins.has(origin)
        ) {
            return res.status(403).json({
                error: 'Forbidden origin',
            });
        }

        const peerId = req.body?.peerId;

        if (
            !Number.isSafeInteger(peerId) ||
            peerId <= 0 ||
            peerId === req.user.id
        ) {
            return res.status(400).json({
                error: 'Invalid contact',
            });
        }

        if (!store.addContact(req.user.id, peerId)) {
            return res.status(404).json({
                error: 'User not found',
            });
        }

        res.status(200).json({
            user: store.getUserById(peerId),
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
        const nativeToken = socket.handshake.auth?.token;

        const token = nativeToken === undefined
            ? readSessionToken(
                socket.request.headers.cookie
            )
            : nativeToken;

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

        const room = `user:${user.id}`;
        const alreadyOnline = Boolean(
            io.sockets.adapter.rooms.get(room)?.size
        );

        socket.join(room);

        const userIds = [
            ...new Set(
                [...io.sockets.sockets.values()]
                    .map(client => client.data.user.id)
            ),
        ];

        socket.emit('presence:snapshot', { userIds });

        if (!alreadyOnline) {
            io.emit('presence:update', {
                userId: user.id,
                online: true,
            });
        }

        socket.on('disconnect', () => {
            if (!io.sockets.adapter.rooms.has(room)) {
                io.emit('presence:update', {
                    userId: user.id,
                    online: false,
                });
            }
        });

        socket.emit('system:hello', {
            ready: true,
            protocolVersion: 1,
            userId: user.id,
        });

        socket.emit('chat:unread:snapshot', {
            items: store.getUnreadCounts(user.id),
        });

        socket.on('chat:read', (payload, acknowledgement) => {
            const reply =
                typeof acknowledgement === 'function'
                    ? acknowledgement
                    : () => {};

            if (!store.getSessionUser(
                socket.data.sessionToken
            )) {
                socket.disconnect(true);
                return reply({
                    ok: false,
                    error: 'Unauthorized',
                });
            }

            const peerId = payload?.peerId;
            const throughId = payload?.throughId;

            const result = store.markConversationRead(
                user.id, peerId, throughId
            );

            if (!result) {
                return reply({
                    ok: false,
                    error: 'Invalid read receipt',
                });
            }

            if (result.changed) {
                emitUnreadCount(user.id, peerId);

                io.to(`user:${peerId}`).emit(
                    'chat:read',
                    {
                        readerId: user.id,
                        throughId: result.throughId,
                        readAt: result.readAt,
                    }
                );
            }

            reply({
                ok: true,
                throughId: result.throughId,
            });
        });

        socket.on(
            'chat:reaction',
            (payload, acknowledgement) => {
                const reply =
                    typeof acknowledgement === 'function'
                        ? acknowledgement
                        : () => {};

                if (!store.getSessionUser(
                    socket.data.sessionToken
                )) {
                    socket.disconnect(true);
                    return reply({
                        ok: false,
                        error: 'Unauthorized',
                    });
                }

                const result = store.toggleReaction(
                    user.id,
                    payload?.messageId,
                    payload?.emoji
                );

                if (!result) {
                    return reply({
                        ok: false,
                        error: 'Invalid reaction',
                    });
                }

                io.to(`user:${result.senderId}`)
                    .to(`user:${result.recipientId}`)
                    .emit('chat:reaction', result);

                reply({ ok: true });
            }
        );

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
            const replyToMessageId =
                payload?.replyToMessageId ?? null;

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
                    replyToMessageId,
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

    return {
        app,
        httpServer,
        io,
        store,
        dispatchScheduledMessages,
    };
}
