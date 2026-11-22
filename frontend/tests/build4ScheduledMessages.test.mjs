import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(
    new URL(path, import.meta.url),
    'utf8'
);

const app = read('../src/App.tsx');
const service = read('../src/services/scheduled-messages.ts');
const dialog = read('../src/components/ScheduledSendDialog.tsx');
const css = read('../src/App.css');

test('scheduling uses server API', () => {
    assert.match(service, /api\/scheduled-messages/);
    assert.match(service, /method: 'POST'/);
    assert.match(service, /method: 'DELETE'/);
    assert.match(service, /cache: 'no-store'/);
});

test('composer can schedule without replacing normal send', () => {
    assert.match(app, /handleScheduleMessage/);
    assert.match(app, /className="composer-schedule"/);
    assert.match(app, /<ScheduledSendDialog/);
    assert.match(app, /onSubmit=\{handleSend\}/);
    assert.match(app, /enqueueOutboxMessage/);
});

test('scheduled messages can be listed and cancelled', () => {
    assert.match(app, /scheduledMessages/);
    assert.match(app, /handleCancelScheduled/);
    assert.match(app, /cancelScheduledMessage\(id\)/);
    assert.match(app, /Запланированные сообщения/);
});

test('date selection uses an absolute timestamp', () => {
    assert.match(dialog, /type="datetime-local"/);
    assert.match(dialog, /date\.toISOString\(\)/);
    assert.match(dialog, /Сегодня, через час/);
    assert.match(dialog, /Завтра в 09:00/);
    assert.match(dialog, /90 \* 86400000/);
});

test('scheduled send UI supports mobile devices', () => {
    assert.match(css, /\.scheduled-overlay/);
    assert.match(css, /\.scheduled-dialog/);
    assert.match(css, /\.scheduled-confirm/);
    assert.match(css, /\.composer button\.composer-schedule/);
});
