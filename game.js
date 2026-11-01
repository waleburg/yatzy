// Yatzy zu zweit: the game rules, without any screen or server code.
// index.html imports this file, and tests/game.test.mjs checks it with `node --test`.

export const CATS = [
  {k:'ones',n:'Einer',up:1},{k:'twos',n:'Zweier',up:2},{k:'threes',n:'Dreier',up:3},
  {k:'fours',n:'Vierer',up:4},{k:'fives',n:'Fünfer',up:5},{k:'sixes',n:'Sechser',up:6},
  {k:'pair',n:'Ein Paar'},{k:'twopair',n:'Zwei Paare'},{k:'three',n:'Dreierpasch'},
  {k:'four',n:'Viererpasch'},{k:'small',n:'Kleine Strasse',hint:'15'},{k:'large',n:'Grosse Strasse',hint:'20'},
  {k:'house',n:'Full House'},{k:'chance',n:'Chance'},{k:'yatzy',n:'Yatzy',hint:'50'}
];
export const KEYS = CATS.map(c => c.k);
// The most each box can hold.
export const BOX_MAX = {ones:5,twos:10,threes:15,fours:20,fives:25,sixes:30,pair:12,twopair:22,three:18,four:24,small:15,large:20,house:28,chance:30,yatzy:50};
export const SEATS = ['p1','p2'];
export const EMOJIS = ['🥦','💚'];
export const REACTIONS = [['😂','Lachen'], ['😍','Verliebt'], ['😘','Kuss'], ['🙄','Genervt'], ['😡','Wütend'], ['😱','Schockiert'], ['👏','Applaus']];
export const REACT_SET = REACTIONS.map(r => r[0]);
export const HISTORY_MAX = 50;
export const other = s => s === 'p1' ? 'p2' : 'p1';

// ---------- scoring (Scandinavian rules) ----------
export function score(k, dice){
  const c = [0,0,0,0,0,0,0];
  dice.forEach(d => c[d]++);
  const sum = dice.reduce((a,b) => a+b, 0);
  const withAtLeast = n => [6,5,4,3,2,1].filter(v => c[v] >= n);
  switch(k){
    case 'ones': case 'twos': case 'threes': case 'fours': case 'fives': case 'sixes': {
      const v = CATS.find(x => x.k === k).up; return v * c[v];
    }
    case 'pair': { const p = withAtLeast(2); return p.length ? p[0]*2 : 0; }
    case 'twopair': { const p = withAtLeast(2); return p.length >= 2 ? p[0]*2 + p[1]*2 : 0; }
    case 'three': { const p = withAtLeast(3); return p.length ? p[0]*3 : 0; }
    case 'four': { const p = withAtLeast(4); return p.length ? p[0]*4 : 0; }
    case 'small': return [1,2,3,4,5].every(v => c[v] === 1) ? 15 : 0;
    case 'large': return [2,3,4,5,6].every(v => c[v] === 1) ? 20 : 0;
    case 'house': { const t = c.indexOf(3), p = c.indexOf(2); return t > 0 && p > 0 ? sum : 0; }
    case 'chance': return sum;
    case 'yatzy': return c.some(n => n === 5) ? 50 : 0;
  }
  return 0;
}
export function totals(sc){
  const upper = KEYS.slice(0,6).reduce((a,k) => a + (sc[k] ?? 0), 0);
  const bonus = upper >= 63 ? 50 : 0;
  const lower = KEYS.slice(6).reduce((a,k) => a + (sc[k] ?? 0), 0);
  return {upper, bonus, total: upper + bonus + lower};
}
export const filled = sc => KEYS.filter(k => sc[k] != null).length;

// ---------- state ----------
export function blank(){
  return {v:1, seats:{p1:null,p2:null}, status:'waiting', turn:'p1', starter:'p1',
    dice:null, held:[false,false,false,false,false], rollsLeft:3, rollId:0,
    scores:{p1:{},p2:{}}, last:null, history:[], updatedAt:''};
}
// Shared data is written by other devices: never trust its shape.
export function clean(raw){
  const s = blank();
  if (!raw || typeof raw !== 'object') return s;
  const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
  const str = (x, n) => typeof x === 'string' ? x.slice(0, n) : '';
  for (const seat of SEATS){
    const v = raw.seats && raw.seats[seat];
    if (v && typeof v.id === 'string' && v.id) s.seats[seat] = {
      id: v.id.slice(0,200),
      nick: str(v.nick, 16),
      emoji: EMOJIS.includes(v.emoji) ? v.emoji : '',
      react: v.react && REACT_SET.includes(v.react.e) && Number.isFinite(v.react.n) ? {e: v.react.e, n: v.react.n} : null,
      notes: Array.isArray(v.notes) ? v.notes.filter(t => typeof t === 'string' && t.trim()).slice(0,30).map(t => t.trim().slice(0,140)) : [],
      yz: int(v.yz, 0, 15) ? v.yz : 0
    };
    const sc = raw.scores && raw.scores[seat];
    if (sc && typeof sc === 'object') for (const k of KEYS) if (int(sc[k], 0, 50)) s.scores[seat][k] = sc[k];
  }
  if (['waiting','setup','playing','over'].includes(raw.status)) s.status = raw.status;
  if (SEATS.includes(raw.turn)) s.turn = raw.turn;
  if (SEATS.includes(raw.starter)) s.starter = raw.starter;
  if (Array.isArray(raw.dice) && raw.dice.length === 5 && raw.dice.every(d => int(d,1,6))) s.dice = raw.dice.slice();
  if (Array.isArray(raw.held) && raw.held.length === 5) s.held = raw.held.map(Boolean);
  if (int(raw.rollsLeft, 0, 3)) s.rollsLeft = raw.rollsLeft;
  if (Number.isFinite(raw.rollId)) s.rollId = raw.rollId;
  if (raw.last && SEATS.includes(raw.last.seat) && KEYS.includes(raw.last.cat) && int(raw.last.pts,0,50)){
    const u = raw.last;
    s.last = {seat: u.seat, cat: u.cat, pts: u.pts};
    // what the dice looked like before the entry, so it can be undone
    if (Array.isArray(u.dice) && u.dice.length === 5 && u.dice.every(d => int(d,1,6)) && Array.isArray(u.held) && u.held.length === 5 && int(u.rollsLeft,0,2))
      Object.assign(s.last, {dice: u.dice.slice(), held: u.held.map(Boolean), rollsLeft: u.rollsLeft, over: !!u.over});
  }
  // a score sheet: 15 boxes in KEYS order, each 0–50 or null (games from before 1.11.2026 have none)
  const sheet = a => Array.isArray(a) && a.length === KEYS.length && a.every(x => x === null || int(x,0,50)) ? a.slice() : null;
  if (Array.isArray(raw.history)) s.history = raw.history.filter(h => h && int(h.p1,0,500) && int(h.p2,0,500)).slice(-HISTORY_MAX)
    .map(h => {
      const e = {at: str(h.at, 40), p1: h.p1, p2: h.p2, n1: str(h.n1, 16), n2: str(h.n2, 16), y1: int(h.y1,0,15) ? h.y1 : 0, y2: int(h.y2,0,15) ? h.y2 : 0};
      const s1 = sheet(h.s1), s2 = sheet(h.s2);
      if (s1 && s2) Object.assign(e, {s1, s2});
      return e;
    });
  if (typeof raw.updatedAt === 'string') s.updatedAt = raw.updatedAt.slice(0,40);
  return s;
}
export function resetTurn(s){ s.dice = null; s.held = [false,false,false,false,false]; s.rollsLeft = 3; }
export function nameOf(seat, st){
  const v = st && st.seats[seat];
  return (v && v.nick) || (seat === 'p1' ? 'Spieler 1' : 'Spieler 2');
}

// ---------- moves ----------
// Each move changes the state in place and returns false when it isn't allowed,
// so the same function runs on screen and inside a transaction on the server's state.
export function rollDice(s, fresh){
  if (s.status !== 'playing' || s.rollsLeft <= 0) return false;
  if (!s.dice) s.held = [false,false,false,false,false];
  s.dice = [0,1,2,3,4].map(i => s.dice && s.held[i] ? s.dice[i] : fresh[i]);
  s.rollsLeft -= 1; s.rollId += 1;
}
export function toggleHeld(s, i){
  if (!s.dice) return false;
  s.held[i] = !s.held[i];
}
// Five equal dice count as a Yatzy for the statistics, whichever box they go into.
const fiveOfAKind = d => !!d && d.every(x => x === d[0]);
function countYatzy(s, seat, by){
  const v = s.seats[seat];
  if (v) v.yz = Math.max(0, (v.yz || 0) + by);
}
export function enterScore(s, seat, cat, at = new Date().toISOString()){
  if (!s.dice || s.scores[seat][cat] != null || s.turn !== seat) return false;
  const pts = score(cat, s.dice);
  s.scores[seat][cat] = pts;
  if (fiveOfAKind(s.dice)) countYatzy(s, seat, 1);
  s.last = {seat, cat, pts, dice: s.dice.slice(), held: s.held.slice(), rollsLeft: s.rollsLeft, over: false};
  if (finishIfFull(s, at)) s.last.over = true;
  else s.turn = other(seat);
  resetTurn(s);
}
// Once both columns are full the game is over and goes into the history, with every
// Yatzy of the game (on the paper sheet there are no dice, so only the 50 in its box counts).
function finishIfFull(s, at){
  if (filled(s.scores.p1) < 15 || filled(s.scores.p2) < 15) return false;
  const y = seat => Math.max(s.seats[seat] && s.seats[seat].yz || 0, s.scores[seat].yatzy === 50 ? 1 : 0);
  s.status = 'over';
  const sheet = seat => KEYS.map(k => s.scores[seat][k] ?? null);
  s.history = s.history.concat({
    at, p1: totals(s.scores.p1).total, p2: totals(s.scores.p2).total,
    n1: nameOf('p1', s), n2: nameOf('p2', s), y1: y('p1'), y2: y('p2'), s1: sheet('p1'), s2: sheet('p2')
  }).slice(-HISTORY_MAX);
  return true;
}
// The last entry can be taken back until the other person has rolled.
// `seat` is who asks; null means anyone (one phone passed around).
export function undoAllowed(st, seat){
  if (!st || !st.last || !st.last.dice) return false;
  const L = st.last;
  if (seat && seat !== L.seat) return false;
  if (st.status === 'over') return L.over;
  return st.status === 'playing' && st.turn === other(L.seat) && !st.dice && st.rollsLeft === 3;
}
export function undoEntry(s, seat){
  if (!undoAllowed(s, seat)) return false;
  const L = s.last;
  delete s.scores[L.seat][L.cat];
  if (fiveOfAKind(L.dice)) countYatzy(s, L.seat, -1);
  if (L.over) s.history = s.history.slice(0, -1);
  s.status = 'playing'; s.turn = L.seat;
  s.dice = L.dice; s.held = L.held; s.rollsLeft = L.rollsLeft;
  s.last = null;
}
// A rematch starts right away with the same players; only a table without both players
// goes back to waiting (online) or to the name form (one phone).
export function newRound(s, onePhone){
  s.scores = {p1:{},p2:{}}; s.last = null;
  for (const seat of SEATS) if (s.seats[seat]) s.seats[seat].yz = 0;
  s.starter = other(s.starter); s.turn = s.starter;
  s.status = s.seats.p1 && s.seats.p2 ? 'playing' : onePhone ? 'setup' : 'waiting';
  resetTurn(s);
}
// Online: sit down with your name (and symbol). When the second person sits down the game
// starts by itself, with the first person to begin. Returns the seat, 'full', or false when
// this device already has a seat.
export function takeSeat(s, id, nick, emoji = ''){
  if (SEATS.some(seat => s.seats[seat] && s.seats[seat].id === id)) return false;
  const seat = !s.seats.p1 ? 'p1' : !s.seats.p2 ? 'p2' : null;
  if (!seat) return 'full';
  s.seats[seat] = {id, nick: String(nick || '').slice(0, 16), emoji: '', react: null, notes: [], yz: 0};
  setEmoji(s, seat, EMOJIS.includes(emoji) ? emoji : null);
  if (s.seats.p1 && s.seats.p2 && s.status === 'waiting'){
    s.status = 'playing'; s.turn = s.starter;
    resetTurn(s);
  }
  return seat;
}
// Change your own name and symbol at any time.
export function editSeat(s, seat, nick, emoji){
  const v = s.seats[seat];
  if (!v) return false;
  const n = String(nick || '').trim().replace(/\s+/g, ' ').slice(0, 16);
  if (n) v.nick = n;
  setEmoji(s, seat, EMOJIS.includes(emoji) ? emoji : '');
}
// 🥦 and 💚 go together: picking one gives the other person the other one.
// null means "no choice made": then you get the one your partner left over, if any.
function setEmoji(s, seat, emoji){
  const v = s.seats[seat], o = s.seats[other(seat)];
  if (emoji === null){ v.emoji = o && o.emoji ? EMOJIS.find(x => x !== o.emoji) : ''; return; }
  v.emoji = emoji;
  if (o) o.emoji = emoji ? EMOJIS.find(x => x !== emoji) : '';
}
export function beginGame(s, names, emojis){
  if (s.status !== 'setup') return false;
  for (const seat of SEATS){
    const id = s.seats[seat] ? s.seats[seat].id : 'local-' + seat;
    s.seats[seat] = Object.assign({react: null, notes: []}, s.seats[seat], {id, nick: names[seat], emoji: emojis[seat] || '', yz: 0});
  }
  s.status = 'playing'; s.turn = s.starter;
  resetTurn(s);
}

// ---------- paper sheet (real dice on the table) ----------
// Every score a box can hold with five dice, 0 included (a box can always be scratched).
export function boxOptions(cat){
  const c = CATS.find(x => x.k === cat);
  if (!c) return [];
  const set = new Set([0]);
  if (c.up) for (let n = 1; n <= 5; n++) set.add(n * c.up);
  for (let a = 1; a <= 6; a++){
    if (cat === 'pair') set.add(2 * a);
    if (cat === 'three') set.add(3 * a);
    if (cat === 'four') set.add(4 * a);
    for (let b = 1; b <= 6; b++){
      if (cat === 'twopair' && b > a) set.add(2 * a + 2 * b);
      if (cat === 'house' && b !== a) set.add(3 * a + 2 * b);
    }
  }
  if (cat === 'small') set.add(15);
  if (cat === 'large') set.add(20);
  if (cat === 'yatzy') set.add(50);
  if (cat === 'chance') for (let v = 5; v <= 30; v++) set.add(v);
  return [...set].sort((x, y) => x - y);
}
// Like writing on paper: any box, in any order, and it can be changed later (pts null empties it).
// The turn is only a suggestion: whoever has fewer boxes filled, the starter on a tie.
export function markBox(s, seat, cat, pts, at = new Date().toISOString()){
  if (!['playing', 'over'].includes(s.status) || !SEATS.includes(seat) || !KEYS.includes(cat)) return false;
  if (pts !== null && !boxOptions(cat).includes(pts)) return false;
  if (s.status === 'over'){
    // A correction reopens the game. A changed value finishes it again at once and keeps its
    // time, which identifies the game when its result is synced to the online table.
    if (pts !== null) at = s.history[s.history.length - 1].at;
    s.status = 'playing'; s.history = s.history.slice(0, -1);
  }
  if (pts === null){ delete s.scores[seat][cat]; s.last = null; }
  else { s.scores[seat][cat] = pts; s.last = {seat, cat, pts}; }
  const a = filled(s.scores.p1), b = filled(s.scores.p2);
  s.turn = a === b ? s.starter : a < b ? 'p1' : 'p2';
  finishIfFull(s, at);
  resetTurn(s);
}
// Paper results that the online table doesn't have yet (or has with other values),
// merged into its history. Seats are matched by name, since either player may be "Spieler 1".
export function mergeResults(room, results){
  const norm = t => (t || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const nick = seat => norm(room.seats[seat] && room.seats[seat].nick);
  const history = room.history.slice();
  let changed = 0;
  for (const h of results){
    const swap = !!(norm(h.n1) && norm(h.n1) === nick('p2')) || !!(norm(h.n2) && norm(h.n2) === nick('p1'));
    const e = swap ? {at: h.at, p1: h.p2, p2: h.p1, n1: h.n2, n2: h.n1, y1: h.y2, y2: h.y1} : {...h};
    if (swap && h.s1 && h.s2) Object.assign(e, {s1: h.s2, s2: h.s1});
    const i = history.findIndex(x => x.at === e.at);
    if (i < 0){ history.push(e); changed++; }
    else if (JSON.stringify(history[i]) !== JSON.stringify(e)){ history[i] = e; changed++; }
  }
  history.sort((x, y) => x.at < y.at ? -1 : x.at > y.at ? 1 : 0);
  return {history: history.slice(-HISTORY_MAX), changed};
}

// ---------- the server ----------
// Top-level fields of a table that a phone may write.
export const FIELDS = ['v', 'seats', 'status', 'turn', 'starter', 'dice', 'held',
  'rollsLeft', 'rollId', 'scores', 'last', 'history', 'updatedAt'];
// Changes single fields of a stored table in place: a key such as
// 'seats.p1.notes' changes a nested field. Phone and server both use it. Returns false (and
// changes nothing) when a field isn't allowed.
export function applyPatch(data, patch){
  const paths = Object.keys(patch).map(k => k.split('.'));
  if (paths.some(path => !FIELDS.includes(path[0]) || path.some(p => !p || p === '__proto__' || p === 'constructor' || p === 'prototype'))) return false;
  for (const path of paths){
    let o = data;
    for (const p of path.slice(0, -1)){ if (!o[p] || typeof o[p] !== 'object') o[p] = {}; o = o[p]; }
    o[path[path.length - 1]] = patch[path.join('.')];
  }
  return true;
}

// ---------- my tables ----------
// The tables a phone has opened: [{id, at}], newest first. Lists from several phones
// (or from the backup under a personal code) merge into one.
export const ROOM_RE = /^[a-z0-9-]{8,40}$/;
export const ROOMS_MAX = 50;
export function mergeRooms(...lists){
  const best = new Map();
  for (const list of lists) for (const r of Array.isArray(list) ? list : []){
    if (!r || !ROOM_RE.test(r.id) || !Number.isFinite(r.at)) continue;
    if (!best.has(r.id) || best.get(r.id) < r.at) best.set(r.id, r.at);
  }
  return [...best].map(([id, at]) => ({id, at})).sort((a, b) => b.at - a.at).slice(0, ROOMS_MAX);
}
// A personal code as people type it ("Brokkoli 2207") turned into a safe address (brokkoli-2207).
export function normCode(t){
  const c = String(t || '').trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return ROOM_RE.test(c) ? c : null;
}

// ---------- extras ----------
// Love notes go from a 💚 player to a 🥦 partner (by symbol or in the name).
export function loveTeam(st, sender){
  const mine = st && st.seats[sender], theirs = st && st.seats[other(sender)];
  return !!mine && !!theirs && mine.emoji === '💚' && (theirs.emoji === '🥦' || (theirs.nick || '').includes('🥦'));
}
// Statistics over the finished games. The box figures (bonus, scratched boxes, best box)
// only count games that kept their score sheet.
export function computeStats(history){
  const fresh = () => ({wins: 0, best: 0, low: 0, sum: 0, y: 0, run: 0, longest: 0, margin: 0, bonus: 0, zeros: 0, box: KEYS.map(() => 0)});
  const per = {p1: fresh(), p2: fresh()};
  let draws = 0, streak = {seat: null, n: 0}, sheets = 0;
  const months = new Map();
  history.forEach((h, i) => {
    for (const seat of SEATS){
      const v = per[seat];
      v.best = Math.max(v.best, h[seat]); v.low = i ? Math.min(v.low, h[seat]) : h[seat]; v.sum += h[seat];
    }
    per.p1.y += h.y1; per.p2.y += h.y2;
    const w = h.p1 === h.p2 ? null : h.p1 > h.p2 ? 'p1' : 'p2';
    const d = new Date(h.at);
    if (!isNaN(d)){
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const m = months.get(key) || {month: key, p1: 0, p2: 0, draws: 0};
      m[w || 'draws']++;
      months.set(key, m);
    }
    if (h.s1 && h.s2){
      sheets++;
      for (const [seat, sh] of [['p1', h.s1], ['p2', h.s2]]){
        if (sh.slice(0, 6).reduce((a, x) => a + (x || 0), 0) >= 63) per[seat].bonus++;
        per[seat].zeros += sh.filter(x => x === 0).length;
        sh.forEach((x, k) => { per[seat].box[k] += x || 0; });
      }
    }
    if (!w){ draws++; streak = {seat: null, n: 0}; per.p1.run = per.p2.run = 0; return; }
    const v = per[w];
    v.wins++; v.run++; per[other(w)].run = 0;
    v.longest = Math.max(v.longest, v.run);
    v.margin = Math.max(v.margin, Math.abs(h.p1 - h.p2));
    streak = streak.seat === w ? {seat: w, n: streak.n + 1} : {seat: w, n: 1};
  });
  const avg = seat => history.length ? Math.round(per[seat].sum / history.length) : 0;
  // each one's best box: where they are furthest ahead of the other on average
  const bestBox = seat => {
    let best = null;
    KEYS.forEach((k, i) => {
      const lead = (per[seat].box[i] - per[other(seat)].box[i]) / (sheets || 1);
      if (lead > 0 && (!best || lead > best.lead)) best = {k, lead};
    });
    return best;
  };
  return {
    games: history.length, per, avg: {p1: avg('p1'), p2: avg('p2')}, draws, streak,
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),   // newest first
    sheets, bestBox: {p1: bestBox('p1'), p2: bestBox('p2')}
  };
}
