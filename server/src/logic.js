// Yatzy zu zweit: what the server does with a table, without any Cloudflare code, so
// tests/server.test.mjs can check it with `node --test`. The rules come from the same
// game.js the page uses, and every stored state goes through clean(), like a phone reading it.

import { clean, mergeResults, mergeRooms, applyPatch, FIELDS, ROOM_RE } from '../../game.js';

export { ROOM_RE };
export const MAX_BYTES = 64000;
// Ids of the last moves, so a move a phone sends again after a lost connection counts once.
export const SEEN_MAX = 100;

// A table as stored: {rev, data, seen}. rev counts every change, data is null until created.
export const emptyTable = () => ({rev: 0, data: null, seen: []});

// One message from a phone: {t:'update', id, patch} or {t:'set', id, base, data}.
export function parseMessage(text){
  if (typeof text !== 'string' || text.length > MAX_BYTES) return null;
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id || m.id.length > 60) return null;
  if (m.t === 'update' && m.patch && typeof m.patch === 'object' && !Array.isArray(m.patch)) return m;
  if (m.t === 'set' && Number.isInteger(m.base) && m.data && typeof m.data === 'object') return m;
  return null;
}

// Applies a message to a table. Returns {table, reply}: table is the new table (or null
// if nothing changed), reply goes back to the phone that sent it.
//   update: changes single fields; a key like 'seats.p1.notes' changes a nested field.
//           Like Firestore, it fails on a table that doesn't exist yet.
//   set:    replaces the whole state, but only if nobody changed it since the phone saw
//           revision `base`. Otherwise the phone gets the current state and tries again.
export function applyMessage(table, m){
  if (table.seen.includes(m.id)) return {table: null, reply: {t: 'ack', id: m.id, rev: table.rev}};
  let next;
  if (m.t === 'update'){
    if (!table.data) return {table: null, reply: {t: 'nack', id: m.id, why: 'not-found'}};
    next = structuredClone(table.data);
    if (!applyPatch(next, m.patch)) return {table: null, reply: {t: 'nack', id: m.id, why: 'bad-field'}};
  } else {
    if (m.base !== table.rev) return {table: null, reply: {t: 'nack', id: m.id, why: 'conflict', rev: table.rev, data: table.data}};
    if (m.data.v !== 1 || Object.keys(m.data).some(k => !FIELDS.includes(k))) return {table: null, reply: {t: 'nack', id: m.id, why: 'bad-field'}};
    next = m.data;
  }
  const out = {rev: table.rev + 1, data: clean(next), seen: [...table.seen, m.id].slice(-SEEN_MAX)};
  return {table: out, reply: {t: 'ack', id: m.id, rev: out.rev}};
}

// Finished paper games join the table's history (see syncPaper in index.html).
// Returns {table, changed}; table is null when the table doesn't exist or nothing changed.
export function addResults(table, results){
  if (!table.data || !Array.isArray(results)) return {table: null, changed: table.data ? 0 : -1};
  const safe = clean({history: results}).history;
  const merged = mergeResults(table.data, safe);
  if (!merged.changed) return {table: null, changed: 0};
  const data = {...table.data, history: merged.history, updatedAt: new Date().toISOString()};
  return {table: {...table, rev: table.rev + 1, data}, changed: merged.changed};
}

// «Meine Tische» under a personal code: the stored list merged with the one a phone sends.
export const mergeCode = (stored, sent) => mergeRooms(stored, sent);
