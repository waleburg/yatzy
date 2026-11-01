// Checks the running server with two "phones". Skipped unless SERVER_URL is set:
//   npm --prefix server run dev        (in one terminal)
//   SERVER_URL=http://localhost:8787 node --test tests/server-live.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blank } from '../game.js';

const URL_ = process.env.SERVER_URL;
const opts = {skip: !URL_ && 'SERVER_URL not set'};
const room = 'raum-live-' + Math.random().toString(36).slice(2, 8);

// A phone: a WebSocket that collects what the server sends.
function phone(){
  const ws = new WebSocket(URL_.replace(/^http/, 'ws') + '/tables/' + room);
  const got = [];
  const waiters = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); got.push(m); for (const w of waiters.splice(0)) w(); };
  const next = async pred => {
    for (;;){
      const i = got.findIndex(pred);
      if (i >= 0) return got.splice(i, 1)[0];
      await new Promise((ok, fail) => { waiters.push(ok); setTimeout(() => fail(new Error('timeout')), 3000); });
    }
  };
  return {ws, next, send: m => ws.send(JSON.stringify(m)), open: new Promise(ok => ws.onopen = ok)};
}

test('two phones see each other\'s moves', opts, async () => {
  const a = phone(), b = phone();
  await Promise.all([a.open, b.open]);
  assert.deepEqual(await a.next(m => m.t === 'state'), {t: 'state', rev: 0, data: null});
  await b.next(m => m.t === 'state');

  a.send({t: 'set', id: 'a1', base: 0, data: blank()});
  assert.equal((await a.next(m => m.t === 'ack')).rev, 1);
  assert.equal((await b.next(m => m.t === 'state' && m.rev === 1)).data.status, 'waiting');

  b.send({t: 'set', id: 'b1', base: 0, data: blank()});                   // b saw an old state
  assert.equal((await b.next(m => m.t === 'nack')).why, 'conflict');

  b.send({t: 'update', id: 'b2', patch: {'seats.p2': {id: 'b', nick: 'Brokkoli'}}});
  b.send({t: 'update', id: 'b2', patch: {'seats.p2': {id: 'b', nick: 'Brokkoli'}}});   // sent again after a lost connection
  assert.equal((await a.next(m => m.t === 'state' && m.rev === 2)).data.seats.p2.nick, 'Brokkoli');
  assert.equal((await b.next(m => m.t === 'ack')).rev, 2);
  assert.equal((await b.next(m => m.t === 'ack')).rev, 2);

  const res = await fetch(`${URL_}/tables/${room}`).then(r => r.json());
  assert.equal(res.rev, 2);
  a.ws.close(); b.ws.close();
});

test('paper results and personal codes', opts, async () => {
  const post = (path, body) => fetch(URL_ + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(r => r.json());
  const r = {at: '2026-10-31T20:00:00.000Z', p1: 180, p2: 210, n1: 'Marcel', n2: 'Brokkoli', y1: 0, y2: 0};
  assert.deepEqual(await post(`/tables/${room}/results`, {results: [r]}), {changed: 1});
  assert.deepEqual(await post(`/tables/${room}/results`, {results: [r]}), {changed: 0});
  assert.deepEqual(await post('/tables/raum-nichtda-000/results', {results: [r]}), {changed: -1});

  const code = 'live-' + Math.random().toString(36).slice(2, 8);
  await post('/codes/' + code, {rooms: [{id: room, at: 1}]});
  const {rooms} = await post('/codes/' + code, {rooms: [{id: 'raum-zweiter-1', at: 2}]});
  assert.deepEqual(rooms.map(x => x.id), ['raum-zweiter-1', room]);
});

test('other websites and bad addresses are turned away', opts, async () => {
  assert.equal((await fetch(`${URL_}/tables/${room}`, {headers: {Origin: 'https://evil.example'}})).status, 403);
  const ok = await fetch(`${URL_}/tables/${room}`, {headers: {Origin: 'https://waleburg.github.io'}});
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://waleburg.github.io');
  assert.equal((await fetch(`${URL_}/tables/AB`)).status, 404);
  assert.equal((await fetch(`${URL_}/anything`)).status, 404);
});
