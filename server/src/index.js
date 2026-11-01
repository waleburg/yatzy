// Yatzy zu zweit: the server on Cloudflare Workers. Each table is a Durable Object that
// keeps the game state and sends every change to all phones at that table over a WebSocket.
// Each personal code («Meine Tische») is a second, smaller Durable Object.
//
//   GET  /tables/<room>          WebSocket (live) or the current state as JSON
//   POST /tables/<room>/results  finished paper games {results: [...]}
//   GET  /codes/<code>           the tables saved under a code
//   POST /codes/<code>           merge a phone's list {rooms: [...]} into it
//
// What the server does with the data is in logic.js.

import { DurableObject } from 'cloudflare:workers';
import { ROOM_RE, MAX_BYTES, emptyTable, parseMessage, applyMessage, addResults, mergeCode } from './logic.js';

export default {
  async fetch(request, env){
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    const origin = request.headers.get('Origin');
    if (origin && !allowed(env).includes(origin)) return new Response('Forbidden', {status: 403});
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return new Response('Too large', {status: 413, headers: cors});

    const {pathname} = new URL(request.url);
    const t = pathname.match(/^\/tables\/([^/]+)(\/results)?$/);
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
    ctx.blockConcurrencyWhile(async () => { this.table = (await ctx.storage.get('table')) || emptyTable(); });
  }
  async fetch(request){
    if (request.headers.get('Upgrade') === 'websocket'){
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
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
    return new Response('Not found', {status: 404});
  }
  async webSocketMessage(ws, text){
    const m = parseMessage(typeof text === 'string' ? text : '');
    if (!m) return ws.send(JSON.stringify({t: 'nack', why: 'bad-message'}));
    const {table, reply} = applyMessage(this.table, m);
    if (table) await this.save(table);
    ws.send(JSON.stringify(reply));
  }
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
