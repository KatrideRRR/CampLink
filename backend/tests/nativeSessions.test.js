import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connectClient } from 'socket.io-client';
import { createAppServer } from '../src/app.js';

test('native session and websocket authentication', {
    timeout: 10000,
}, async (t) => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    store.createUser('akim', 'test-password-123');

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    const url =
        `http://127.0.0.1:${httpServer.address().port}`;

    const clients = [];

    t.after(async () => {
        clients.forEach(client => client.disconnect());
        await new Promise(resolve => io.close(resolve));
        store.close();
    });

    const origin = 'capacitor://localhost';

    const preflight = await fetch(
        `${url}/api/auth/native-login`,
        {
            method: 'OPTIONS',
            headers: {
                Origin: origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers':
                    'authorization, content-type',
            },
        }
    );

    assert.equal(preflight.status, 204);
    assert.equal(
        preflight.headers.get(
            'access-control-allow-origin'
        ),
        origin
    );

    const login = await fetch(
        `${url}/api/auth/native-login`,
        {
            method: 'POST',
            headers: {
                Origin: origin,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: 'akim',
                password: 'test-password-123',
            }),
        }
    );

    assert.equal(login.status, 200);
    assert.equal(login.headers.get('set-cookie'), null);

    const data = await login.json();

    assert.match(data.token, /^[a-f0-9]{64}$/);
    assert.equal(data.user.username, 'akim');

    const headers = {
        Origin: origin,
        Authorization: `Bearer ${data.token}`,
    };

    const me = await fetch(`${url}/api/auth/me`, {
        headers,
    });

    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, data.user.id);

    const invalid = await fetch(
        `${url}/api/auth/me`,
        {
            headers: {
                ...headers,
                Authorization: 'Bearer invalid',
            },
        }
    );

    assert.equal(invalid.status, 401);

    const forbidden = await fetch(
        `${url}/api/auth/me`,
        {
            headers: {
                ...headers,
                Origin: 'https://untrusted.example',
            },
        }
    );

    assert.equal(forbidden.status, 403);

    const client = connectClient(url, {
        autoConnect: false,
        transports: ['websocket'],
        reconnection: false,
        timeout: 3000,
        auth: { token: data.token },
        extraHeaders: { Origin: origin },
    });

    clients.push(client);

    await new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
        client.connect();
    });

    assert.equal(client.connected, true);

    const logout = await fetch(
        `${url}/api/auth/logout`,
        {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: '{}',
        }
    );

    assert.equal(logout.status, 200);

    const expired = await fetch(
        `${url}/api/auth/me`,
        { headers }
    );

    assert.equal(expired.status, 401);
});
