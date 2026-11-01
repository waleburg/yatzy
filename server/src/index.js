// Yatzy zu zweit: the server on Cloudflare Workers. Each table is a Durable Object that
// keeps the game state and sends every change to all phones at that table over a WebSocket.
// Each personal code («Meine Tische») is a second, smaller Durable Object.
//
//   GET  /tables/<room>          WebSocket (live) or the current state as JSON
//   POST /tables/<room>/results  finished paper games {results: [...]}
//   POST /tables/<room>/import   a table copied from Firebase {data} (only while moving)
//   POST /tables/<room>/push     notifications for a seat {seat, id, sub|null, test}
//   GET  /codes/<code>           the tables saved under a code
//   POST /codes/<code>           merge a phone's list {rooms: [...]} into it
//
// What the server does with the data is in logic.js, the push sending in push.js.

import { DurableObject } from 'cloudflare:workers';
import { ROOM_RE, MAX_BYTES, emptyTable, parseMessage, applyMessage, addResults, importTable, mergeCode, pushMessages, testMessage } from './logic.js';
import { subscription, sendPush } from './push.js';

// A phone counts as "looking at the table" while its app is in front and it pinged lately.
const AWAY_AFTER = 45000;

export default {
  async fetch(request, env){
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    const origin = request.headers.get('Origin');
    if (origin && !allowed(env).includes(origin)) return new Response('Forbidden', {status: 403});
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return new Response('Too large', {status: 413, headers: cors});

    const {pathname} = new URL(request.url);
    const t = pathname.match(/^\/tables\/([^/]+)(\/results|\/import|\/push)?$/);
    const c = pathname.match(/^\/codes\/([^/]+)$/);
    const name = (t || c || [])[1];
    if (!name || !ROOM_RE.test(name)) return new Response('Not found', {status: 404, headers: cors});
    const ns = t ? env.TABLES : env.CODES;
    const stub = ns.get(ns.idFromName(name));
    const res = await stub.fetch(request);
    if (res.status === 101) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};

export class Table extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    // Phones send 'ping' to keep the connection open; answered without waking the table.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.table = (await ctx.storage.get('table')) || emptyTable();
      this.push = (await ctx.storage.get('push')) || {};   // seat → push address, never in the game data
      this.name = (await ctx.storage.get('name')) || '';   // the room, for the link in a notification
    });
  }
  async fetch(request){
    if (!this.name){
      this.name = new URL(request.url).pathname.split('/')[2] || '';
      await this.ctx.storage.put('name', this.name);
    }
    if (request.headers.get('Upgrade') === 'websocket'){
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      const id = (new URL(request.url).searchParams.get('id') || '').slice(0, 200);
      server.serializeAttachment({id, visible: true, at: Date.now()});
      server.send(JSON.stringify(this.stateMessage()));
      return new Response(null, {status: 101, webSocket: client});
    }
    if (request.method === 'GET') return json({rev: this.table.rev, data: this.table.data});
    if (request.method === 'POST' && request.url.endsWith('/results')){
      const body = await request.json().catch(() => null);
      const {table, changed} = addResults(this.table, body && body.results);
      if (changed < 0) return json({changed}, 404);
      if (table) await this.save(table);
      return json({changed});
    }
    if (request.method === 'POST' && request.url.endsWith('/push')) return json(await this.setPush(await request.json().catch(() => null)));
    if (request.method === 'POST' && request.url.endsWith('/import')){
      const body = await request.json().catch(() => null);
      const table = importTable(this.table, body && body.data);
      if (table) await this.save(table);
      return json({imported: !!table});
    }
    return new Response('Not found', {status: 404});
  }
  async webSocketMessage(ws, text){
    // The app says when it goes to the background and comes back.
    if (text === 'visible' || text === 'hidden'){
      ws.serializeAttachment({...ws.deserializeAttachment(), visible: text === 'visible', at: Date.now()});
      return;
    }
    const m = parseMessage(typeof text === 'string' ? text : '');
    if (!m) return ws.send(JSON.stringify({t: 'nack', why: 'bad-message'}));
    const before = this.table.data;
    const {table, reply} = applyMessage(this.table, m);
    if (table) await this.save(table);
    ws.send(JSON.stringify(reply));
    if (table) await this.notify(before, table.data);
  }

  // ---------- push notifications ----------
  // Only the phone sitting on a seat may switch its notifications on or off.
  async setPush(body){
    const {seat, id, sub, test} = body || {};
    const v = this.table.data && this.table.data.seats[seat];
    if (!v || typeof id !== 'string' || v.id !== id) return {ok: false, why: 'not-your-seat'};
    if (sub === null){
      delete this.push[seat];
      await this.ctx.storage.put('push', this.push);
      return {ok: true};
    }
    const s = subscription(sub);
    if (!s) return {ok: false, why: 'bad-subscription'};
    this.push[seat] = s;
    await this.ctx.storage.put('push', this.push);
    if (!test) return {ok: true};
    const res = await this.send(seat, testMessage(this.room(), this.env.APP_URL));
    return {ok: !!res && res.ok, status: res && res.status};
  }
  looking(seat){
    const id = this.table.data && this.table.data.seats[seat] && this.table.data.seats[seat].id;
    const now = Date.now();
    return this.ctx.getWebSockets().some(ws => {
      const a = ws.deserializeAttachment() || {};
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      return a.id === id && a.visible && now - Math.max(a.at || 0, pinged ? pinged.getTime() : 0) < AWAY_AFTER;
    });
  }
  async notify(before, after){
    for (const {seat, message} of pushMessages(before, after, this.room(), this.env.APP_URL))
      if (!this.looking(seat)) await this.send(seat, message);
  }
  async send(seat, message){
    const sub = this.push[seat];
    if (!sub || !this.env.VAPID_PRIVATE_JWK) return null;
    try {
      const res = await sendPush(this.env, sub, message);
      // the phone dropped this address (app deleted, notifications switched off)
      if (res.status === 404 || res.status === 410){ delete this.push[seat]; await this.ctx.storage.put('push', this.push); }
      return res;
    } catch { return null; }
  }
  room(){ return this.name; }
  webSocketClose(ws, code){ try { ws.close(code); } catch {} }
  stateMessage(){ return {t: 'state', rev: this.table.rev, data: this.table.data}; }
  async save(table){
    this.table = table;
    await this.ctx.storage.put('table', table);
    const msg = JSON.stringify(this.stateMessage());
    for (const ws of this.ctx.getWebSockets()) try { ws.send(msg); } catch {}
  }
}

export class Codes extends DurableObject {
  async fetch(request){
    let rooms = (await this.ctx.storage.get('rooms')) || [];
    if (request.method === 'POST'){
      const body = await request.json().catch(() => null);
      rooms = mergeCode(rooms, body && body.rooms);
      await this.ctx.storage.put('rooms', rooms);
    }
    return json({rooms});
  }
}

function json(body, status = 200){
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}
const allowed = env => (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
function corsHeaders(request, env){
  const origin = request.headers.get('Origin');
  const h = {'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Vary': 'Origin'};
  if (origin && allowed(env).includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
