// Yatzy zu zweit: what the server does with a table, without any Cloudflare code, so
// tests/server.test.mjs can check it with `node --test`. The rules come from the same
// game.js the page uses, and every stored state goes through clean(), like a phone reading it.

import { clean, mergeResults, mergeRooms, applyPatch, totals, filled, nameOf, other, CATS, SEATS, REACTIONS, SAYINGS, FIELDS, ROOM_RE } from '../../game.js';

export { ROOM_RE };
export const MAX_BYTES = 64000;
// Ids of the last moves, so a move a phone sends again after a lost connection counts once.
export const SEEN_MAX = 100;

// A table as stored: {rev, data, seen}. rev counts every change, data is null until created.
export const emptyTable = () => ({rev: 0, data: null, seen: []});

// One message from a phone: {t:'update', id, base, patch} or {t:'set', id, base, data}.
export function parseMessage(text){
  if (typeof text !== 'string' || text.length > MAX_BYTES) return null;
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id || m.id.length > 60) return null;
  if (m.t === 'update' && m.patch && typeof m.patch === 'object' && !Array.isArray(m.patch) && (m.base === undefined || Number.isInteger(m.base))) return m;
  if (m.t === 'set' && Number.isInteger(m.base) && m.data && typeof m.data === 'object') return m;
  return null;
}

// Applies a message to a table. Returns {table, reply}: table is the new table (or null
// if nothing changed), reply goes back to the phone that sent it.
//   update: changes single fields; a key like 'seats.p1.notes' changes a nested field.
//           It fails on a table that doesn't exist yet, and when it was made on a state
//           older than the last `set` (a move made offline before a Revanche, an undo or a
//           new game would otherwise bring the old scores back).
//   set:    replaces the whole state, but only if nobody changed it since the phone saw
//           revision `base`. Otherwise the phone gets the current state and tries again.
export function applyMessage(table, m){
  if (table.seen.includes(m.id)) return {table: null, reply: {t: 'ack', id: m.id, rev: table.rev}};
  let next;
  if (m.t === 'update'){
    if (!table.data) return {table: null, reply: {t: 'nack', id: m.id, why: 'not-found'}};
    if (m.base !== undefined && m.base < (table.setRev || 0)) return {table: null, reply: {t: 'nack', id: m.id, why: 'stale'}};
    next = structuredClone(table.data);
    if (!applyPatch(next, m.patch)) return {table: null, reply: {t: 'nack', id: m.id, why: 'bad-field'}};
  } else {
    if (m.base !== table.rev) return {table: null, reply: {t: 'nack', id: m.id, why: 'conflict', rev: table.rev, data: table.data}};
    if (m.data.v !== 1 || Object.keys(m.data).some(k => !FIELDS.includes(k))) return {table: null, reply: {t: 'nack', id: m.id, why: 'bad-field'}};
    next = m.data;
  }
  const out = {rev: table.rev + 1, data: clean(next), seen: [...table.seen, m.id].slice(-SEEN_MAX), setRev: table.setRev || 0};
  if (m.t === 'set') out.setRev = out.rev;
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

// ---------- push notifications ----------
// What to tell whom after a change: the person whose turn it now is, both when a game ends,
// both when someone asks for a Revanche (the one who asked has the app open, and the
// caller skips phones that are looking at the table), and the other person when someone
// sends a reaction or a quick reply.
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
      out.push({seat, kind: 'revanche', message: {...base, title: 'Revanche! 🎲', body}});
    } else if (next.status === 'playing' && next.turn === seat && !wasMine){
      const L = next.last, cat = L && CATS.find(c => c.k === L.cat);
      const body = L && L.seat === o && cat ? `${label(next, o)} hat ${L.pts} bei ${cat.n} eingetragen.`
        : prev && prev.status !== 'playing' ? `${label(next, o)} ist am Tisch. Das Spiel beginnt mit dir.`
        : `${label(next, o)} wartet auf dich.`;
      out.push({seat, kind: 'turn', message: {...base, title: 'Du bist dran 🎲', body}});
    }
    if (next.status === 'over' && (!prev || prev.status !== 'over')){
      const a = totals(next.scores.p1).total, b = totals(next.scores.p2).total;
      const body = a === b ? `Unentschieden, beide haben ${a} Punkte.`
        : `${label(next, a > b ? 'p1' : 'p2')} gewinnt ${Math.max(a, b)} zu ${Math.min(a, b)}.`;
      out.push({seat, kind: 'over', message: {...base, title: 'Spiel vorbei 🏆', body}});
    }
    const r = next.seats[o] && next.seats[o].react, was = prev && prev.seats[o] && prev.seats[o].react;
    if (r && (!was || was.n !== r.n)){
      const name = (REACTIONS.find(x => x[0] === r.e) || [])[1] || '';
      out.push({seat, kind: 'react', message: {...base, tag: 'yatzy-react-' + room, title: label(next, o), body: `${r.e} ${name}`.trim()}});
    }
    const q = next.seats[o] && next.seats[o].say, wasQ = prev && prev.seats[o] && prev.seats[o].say;
    const text = q && (SAYINGS.find(x => x[0] === q.k) || [])[1];
    if (text && (!wasQ || wasQ.n !== q.n))
      out.push({seat, kind: 'say', message: {...base, tag: 'yatzy-say-' + room, title: label(next, o), body: text}});
  }
  return out;
}
// Whether a notification held back earlier (the app seemed open) still fits the table now.
export function stillDue(kind, seat, st){
  if (!st || !st.seats[seat]) return false;
  if (kind === 'turn') return st.status === 'playing' && st.turn === seat;
  if (kind === 'revanche') return st.status === 'playing';
  if (kind === 'over') return st.status === 'over';
  return true;
}

// ---------- reminder ----------
// A turn is known by whose it is and how much is filled in: it stays the same turn while
// that person rolls, and changes with every entry, a Revanche or a new game.
export const turnKey = st => st && st.status === 'playing'
  ? `${st.turn}:${filled(st.scores.p1) + filled(st.scores.p2)}:${st.history.length}` : '';
// No reminders at night: a time between 22:00 and 08:00 in Switzerland moves to the morning.
const zurichHour = t => Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Zurich', hour: 'numeric', hourCycle: 'h23'}).format(t));
export function daytime(ms){
  let t = ms;
  while (zurichHour(t) >= 22 || zurichHour(t) < 8) t += 15 * 60000;
  return t;
}
export function reminderMessage(st, seat, since, now, room, appUrl){
  const h = Math.max(1, Math.round((now - since) / 3600000));
  return {tag: 'yatzy-' + room, url: appUrl + '#' + room, title: 'Du bist noch dran 🎲',
    body: `${label(st, other(seat))} wartet seit ${h} ${h === 1 ? 'Stunde' : 'Stunden'} auf deinen Zug.`};
}

export const testMessage = (room, appUrl) =>
  ({tag: 'yatzy-test-' + room, url: appUrl + '#' + room, title: 'Test 👍', body: 'So sehen deine Yatzy-Benachrichtigungen aus.'});
