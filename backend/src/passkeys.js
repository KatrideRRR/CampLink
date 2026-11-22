import { randomUUID } from 'node:crypto';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const RP_ID =
    process.env.CAMPLINK_WEBAUTHN_RP_ID ||
    'chat.camplink.ru';

const origins = (
    process.env.CAMPLINK_WEBAUTHN_ORIGINS ||
    `https://${RP_ID}`
).split(',').map(value => value.trim()).filter(Boolean);

export function mountPasskeyRoutes({
    app,
    store,
    requireAuth,
    nativeOrigins,
    sessionAge,
    cookieName,
    cookieOptions,
}) {
    const attempts = new Map();

    function checkOrigin(req, res, next) {
        const origin = req.get('origin');

        if (
            origin &&
            !origins.includes(origin) &&
            !nativeOrigins.has(origin)
        ) {
            return res.status(403).json({
                error: 'Forbidden origin',
            });
        }

        next();
    }

    function limitStarts(req, res, next) {
        const key = req.ip ?? 'unknown';
        const now = Date.now();
        const previous = attempts.get(key);
        const current =
            !previous || now - previous.started >= 60000
                ? { started: now, count: 0 }
                : previous;

        current.count += 1;
        attempts.set(key, current);

        if (current.count > 20) {
            return res.status(429).json({
                error: 'Too many passkey requests',
            });
        }

        next();
    }

    app.post(
        '/api/passkeys/register/options',
        checkOrigin,
        requireAuth,
        limitStarts,
        async (req, res) => {
            try {
                const current = store.listPasskeys(req.user.id);

                if (current.length >= 10) {
                    return res.status(409).json({
                        error: 'Passkey limit reached',
                    });
                }

                const options = await generateRegistrationOptions({
                    rpName: 'CampLink',
                    rpID: RP_ID,
                    userName: `CampLink ID ${req.user.id}`,
                    userDisplayName:
                        req.user.displayName ?? req.user.username,
                    userID: new Uint8Array(
                        Buffer.from(String(req.user.id))
                    ),
                    attestationType: 'none',
                    supportedAlgorithmIDs: [-7, -257],
                    authenticatorSelection: {
                        residentKey: 'required',
                        userVerification: 'required',
                    },
                    excludeCredentials: current.map(item => ({
                        id: item.id,
                        transports: item.transports,
                    })),
                });

                const requestId = randomUUID();

                store.savePasskeyChallenge({
                    id: requestId,
                    kind: 'register',
                    userId: req.user.id,
                    challenge: options.challenge,
                });

                res.set('Cache-Control', 'no-store');
                return res.json({ requestId, options });
            } catch {
                return res.status(500).json({
                    error: 'Passkey registration unavailable',
                });
            }
        }
    );

    app.post(
        '/api/passkeys/register/verify',
        checkOrigin,
        requireAuth,
        async (req, res) => {
            const { requestId, credential } = req.body ?? {};

            const pending = store.takePasskeyChallenge(
                requestId,
                'register'
            );

            if (
                !pending ||
                pending.userId !== req.user.id ||
                !credential ||
                typeof credential !== 'object'
            ) {
                return res.status(400).json({
                    error: 'Invalid or expired challenge',
                });
            }

            try {
                const result = await verifyRegistrationResponse({
                    response: {
                        ...credential,
                        clientExtensionResults:
                            credential.clientExtensionResults ?? {},
                    },
                    expectedChallenge: pending.challenge,
                    expectedOrigin: origins,
                    expectedRPID: RP_ID,
                    requireUserVerification: true,
                });

                if (!result.verified || !result.registrationInfo) {
                    return res.status(401).json({
                        error: 'Passkey verification failed',
                    });
                }

                store.addPasskey(
                    req.user.id,
                    result.registrationInfo.credential
                );

                res.set('Cache-Control', 'no-store');
                return res.status(201).json({ ok: true });
            } catch {
                return res.status(400).json({
                    error: 'Passkey could not be registered',
                });
            }
        }
    );

    app.get(
        '/api/passkeys',
        checkOrigin,
        requireAuth,
        (req, res) => {
            const keys = store.listPasskeys(req.user.id)
                .map(item => ({
                    id: item.id,
                    createdAt: item.createdAt,
                }));

            res.set('Cache-Control', 'no-store');
            res.json({ keys });
        }
    );

    app.post(
        '/api/passkeys/login/options',
        checkOrigin,
        limitStarts,
        async (_req, res) => {
            try {
                const options = await generateAuthenticationOptions({
                    rpID: RP_ID,
                    userVerification: 'required',
                });

                const requestId = randomUUID();

                store.savePasskeyChallenge({
                    id: requestId,
                    kind: 'login',
                    challenge: options.challenge,
                });

                res.set('Cache-Control', 'no-store');
                return res.json({ requestId, options });
            } catch {
                return res.status(500).json({
                    error: 'Passkey login unavailable',
                });
            }
        }
    );

    app.post(
        [
            '/api/passkeys/login/verify',
            '/api/passkeys/login/native-verify',
        ],
        checkOrigin,
        async (req, res) => {
            const { requestId, credential } = req.body ?? {};

            const pending = store.takePasskeyChallenge(
                requestId,
                'login'
            );

            if (!pending || typeof credential?.id !== 'string') {
                return res.status(401).json({
                    error: 'Invalid or expired challenge',
                });
            }

            const stored = store.getPasskey(credential.id);

            if (!stored) {
                return res.status(401).json({
                    error: 'Invalid passkey',
                });
            }

            const handle = credential.response?.userHandle;
            const expectedHandle = Buffer.from(
                String(stored.userId)
            ).toString('base64url');

            if (handle != null && handle !== expectedHandle) {
                return res.status(401).json({
                    error: 'Passkey account mismatch',
                });
            }

            try {
                const result = await verifyAuthenticationResponse({
                    response: {
                        ...credential,
                        clientExtensionResults:
                            credential.clientExtensionResults ?? {},
                    },
                    expectedChallenge: pending.challenge,
                    expectedOrigin: origins,
                    expectedRPID: RP_ID,
                    credential: {
                        id: stored.id,
                        publicKey: stored.publicKey,
                        counter: stored.counter,
                        transports: stored.transports,
                    },
                    requireUserVerification: true,
                });

                if (!result.verified) {
                    return res.status(401).json({
                        error: 'Passkey verification failed',
                    });
                }

                const user = store.getUserById(stored.userId);

                if (!user) {
                    return res.status(401).json({
                        error: 'Account unavailable',
                    });
                }

                store.updatePasskeyCounter(
                    stored.id,
                    result.authenticationInfo.newCounter
                );

                const token = store.createSession(user.id);

                res.set('Cache-Control', 'no-store');

                if (req.path.endsWith('/native-verify')) {
                    return res.json({
                        user,
                        token,
                        expiresInSeconds:
                            Math.floor(sessionAge / 1000),
                    });
                }

                res.cookie(cookieName, token, {
                    ...cookieOptions,
                    maxAge: sessionAge,
                });

                return res.json({ user });
            } catch {
                return res.status(401).json({
                    error: 'Invalid passkey signature',
                });
            }
        }
    );
}
