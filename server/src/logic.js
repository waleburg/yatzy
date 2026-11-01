// Yatzy zu zweit: what the server does with a table, without any Cloudflare code, so
// tests/server.test.mjs can check it with `node --test`. The rules come from the same
// game.js the page uses, and every stored state goes through clean(), like a phone reading it.

import { clean, mergeResults, mergeRooms, applyPatch, totals, nameOf, other, CATS, SEATS, FIELDS, ROOM_RE } from '../../game.js';

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
  const out = {rev: table.rev + 1, data: clean(next), seen: [...table.seen, m.id].slice(-SEEN_MAX)};   // no longer `imported`
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
  return {table: {...table, rev: table.rev + 1, data, imported: false}, changed: merged.changed};
}

// Moving from Firebase: a phone hands over a table it read there. It is taken if the table
// is still empty here, or if it was only copied so far and the copy is newer (the other
// phone may still have played on Firebase). The first real move here ends the copying.
export function importTable(table, data){
  if (!data || typeof data !== 'object' || data.v !== 1) return null;
  const next = clean(data);
  if (table.data && !(table.imported && next.updatedAt > table.data.updatedAt)) return null;
  return {rev: table.rev + 1, data: next, seen: table.seen, imported: true};
}

// «Meine Tische» under a personal code: the stored list merged with the one a phone sends.
export const mergeCode = (stored, sent) => mergeRooms(stored, sent);

// ---------- push notifications ----------
// What to tell whom after a change: the person whose turn it now is, both when a game ends,
// and both when someone asks for a Revanche (the one who asked has the app open, and the
// caller skips phones that are looking at the table).
const label = (st, seat) => (st.seats[seat] && st.seats[seat].emoji ? st.seats[seat].emoji + ' ' : '') + nameOf(seat, st);
export function pushMessages(prev, next, room, appUrl){
  if (!next) return [];
  const base = {tag: 'yatzy-' + room, url: appUrl + '#' + room};
  const out = [];
  for (const seat of SEATS){
    if (!next.seats[seat]) continue;
    const o = other(seat);
    const wasMine = prev && prev.status === 'playing' && prev.turn === seat;
    if (prev && prev.status === 'over' && next.status === 'playing'){
      const body = next.turn === seat ? `${label(next, o)} will eine Revanche. Du beginnst.` : `${label(next, o)} will eine Revanche und beginnt.`;
      out.push({seat, message: {...base, title: 'Revanche! 🎲', body}});
    } else if (next.status === 'playing' && next.turn === seat && !wasMine){
      const L = next.last, cat = L && CATS.find(c => c.k === L.cat);
      const body = L && L.seat === o && cat ? `${label(next, o)} hat ${L.pts} bei ${cat.n} eingetragen.`
        : prev && prev.status !== 'playing' ? `${label(next, o)} ist am Tisch. Das Spiel beginnt mit dir.`
        : `${label(next, o)} wartet auf dich.`;
      out.push({seat, message: {...base, title: 'Du bist dran 🎲', body}});
    }
    if (next.status === 'over' && (!prev || prev.status !== 'over')){
      const a = totals(next.scores.p1).total, b = totals(next.scores.p2).total;
      const body = a === b ? `Unentschieden, beide haben ${a} Punkte.`
        : `${label(next, a > b ? 'p1' : 'p2')} gewinnt ${Math.max(a, b)} zu ${Math.min(a, b)}.`;
      out.push({seat, message: {...base, title: 'Spiel vorbei 🏆', body}});
    }
  }
  return out;
}
export const testMessage = (room, appUrl) =>
  ({tag: 'yatzy-test-' + room, url: appUrl + '#' + room, title: 'Test 👍', body: 'So sehen deine Yatzy-Benachrichtigungen aus.'});
