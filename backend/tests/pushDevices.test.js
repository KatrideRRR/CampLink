import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/app.js';

test('APNs devices: auth, validation, ownership and logout',
    async (t) => {
        const { httpServer, io, store } = createAppServer({
            databasePath: ':memory:',
        });

        t.after(async () => {
            await new Promise((resolve) => io.close(resolve));
            store.close();
        });

        const alice = store.registerUser({
                displayName: 'Alice',
                email: 'alice@example.com',
                phone: '+79123450004',
                password: 'test-password-123',
            });

        const bob = store.registerUser({
                displayName: 'Bob',
                email: 'bob@example.com',
                phone: '+79123450005',
                password: 'test-password-456',
            });

        await new Promise((resolve, reject) => {
            httpServer.once('error', reject);
            httpServer.listen(0, '127.0.0.1', resolve);
        });

        const url =
            `http://127.0.0.1:${httpServer.address().port}`;

        async function login(username, password) {
            const response = await fetch(
                `${url}/api/auth/login`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username,
                        password,
                    }),
                }
            );

            assert.equal(response.status, 200);

            return response.headers
                .get('set-cookie')
                .split(';')[0];
        }

        const aCookie = await login(
            'alice@example.com',
            'test-password-123'
        );

        const bCookie = await login(
            'bob@example.com',
            'test-password-456'
        );

        async function register(cookie, token, origin) {
            return fetch(`${url}/api/push/devices`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(cookie ? { Cookie: cookie } : {}),
                    ...(origin ? { Origin: origin } : {}),
                },
                body: JSON.stringify({
                    provider: 'apns',
                    token,
                }),
            });
        }

        const tokenA = 'a'.repeat(64);
        const tokenB = 'b'.repeat(64);

        assert.equal(
            (await register(null, tokenA)).status,
            401
        );

        assert.equal(
            (await register(aCookie, 'invalid')).status,
            400
        );

        assert.equal(
            (await register(
                aCookie,
                tokenA,
                'https://untrusted.invalid'
            )).status,
            403
        );

        assert.equal(
            (await register(aCookie, tokenA)).status,
            204
        );

        // Repeated registration must not create duplicates.
        assert.equal(
            (await register(aCookie, tokenA)).status,
            204
        );

        assert.deepEqual(
            store.getPushDevices(alice.id),
            [{ provider: 'apns', token: tokenA }]
        );

        assert.deepEqual(
            store.getPushDevices(bob.id),
            []
        );

        assert.equal(
            (await register(bCookie, tokenB)).status,
            204
        );

        // A token belongs to its current authenticated user.
        assert.equal(
            (await register(bCookie, tokenA)).status,
            204
        );

        assert.deepEqual(
            store.getPushDevices(alice.id),
            []
        );

        assert.equal(
            store.getPushDevices(bob.id).length,
            2
        );

        const logout = await fetch(
            `${url}/api/auth/logout`,
            {
                method: 'POST',
                headers: {
                    Cookie: bCookie,
                    'Content-Type': 'application/json',
                },
                body: '{}',
            }
        );

        assert.equal(logout.status, 200);

        // Session deletion must revoke its push devices.
        assert.deepEqual(
            store.getPushDevices(bob.id),
            []
        );

        assert.equal(
            (await register(bCookie, tokenB)).status,
            401
        );
    }
);
