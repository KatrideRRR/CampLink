
import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connectClient } from 'socket.io-client';
import { createAppServer } from '../src/app.js';

test('CampLink API and Socket.IO connection', async (t) => {
    const { httpServer, io } = createAppServer();

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', resolve);
    });

    t.after(() => new Promise((resolve) => io.close(resolve)));

    const port = httpServer.address().port;
    const url = `http://127.0.0.1:${port}`;

    const response = await fetch(`${url}/api/health`);
    const health = await response.json();

    assert.equal(response.status, 200);
    assert.equal(health.ok, true);
    assert.equal(health.service, 'camplink-api');

    const client = connectClient(url, {
        autoConnect: false,
        transports: ['websocket'],
        reconnection: false,
        timeout: 2000,
    });

    t.after(() => client.disconnect());

    const hello = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Socket connection timed out'));
        }, 3000);

        client.once('system:hello', (data) => {
            clearTimeout(timeout);
            resolve(data);
        });

        client.once('connect_error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });

        client.connect();
    });

    assert.equal(hello.ready, true);
    assert.equal(hello.protocolVersion, 1);
});
