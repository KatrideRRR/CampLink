
import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connectClient } from 'socket.io-client';
import { createAppServer } from '../src/app.js';

test('API health and unauthorized access', async (t) => {
    const { httpServer, io, store } = createAppServer({
        databasePath: ':memory:',
    });

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    t.after(async () => {
        await new Promise((resolve) => io.close(resolve));
        store.close();
    });

    const port = httpServer.address().port;
    const url = `http://127.0.0.1:${port}`;

    const response = await fetch(`${url}/api/health`);
    const health = await response.json();

    assert.equal(response.status, 200);
    assert.equal(health.ok, true);
    assert.equal(health.service, 'camplink-api');

    const usersResponse = await fetch(`${url}/api/users`);
    assert.equal(usersResponse.status, 401);

    const client = connectClient(url, {
        autoConnect: false,
        transports: ['websocket'],
        reconnection: false,
        timeout: 2000,
    });

    t.after(() => client.disconnect());

    const error = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Unauthorized test timed out'));
        }, 3000);

        client.once('connect_error', (err) => {
            clearTimeout(timeout);
            resolve(err);
        });

        client.once('connect', () => {
            clearTimeout(timeout);
            reject(new Error('Unauthorized connection accepted'));
        });

        client.connect();
    });

    assert.match(error.message, /Unauthorized/);
});
