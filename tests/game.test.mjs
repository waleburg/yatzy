// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS, score, totals, blank, clean, rollDice, toggleHeld, enterScore,
  undoAllowed, undoEntry, newRound, beginGame, loveTeam, computeStats,
  boxOptions, markBox, mergeResults, mergeRooms, normCode, takeSeat, editSeat
} from '../game.js';

// A game in progress: both seats taken, p1's turn, dice already rolled once.
function game({dice = [3, 3, 3, 5, 5], turn = 'p1', rollsLeft = 2} = {}){
  const s = blank();
  s.seats.p1 = {id: 'a', nick: 'Marcel', emoji: '', react: null, notes: []};
  s.seats.p2 = {id: 'b', nick: 'Brokkoli', emoji: '', react: null, notes: []};
  Object.assign(s, {status: 'playing', turn, dice, rollsLeft, rollId: 1});
  return s;
}
// Fill every box except the ones listed, so the next entry can end the game.
function fillAllBut(sc, ...open){ for (const k of KEYS) if (!open.includes(k)) sc[k] = 1; }

test('scoring follows the Scandinavian rules', () => {
  const cases = [
    [[1, 2, 3, 4, 5], 'small', 15], [[2, 3, 4, 5, 6], 'large', 20], [[1, 2, 3, 4, 6], 'small', 0],
    [[3, 3, 3, 2, 2], 'house', 13], [[3, 3, 3, 3, 3], 'house', 0],          // a Yatzy is no full house
    [[4, 4, 4, 4, 4], 'yatzy', 50], [[4, 4, 4, 4, 2], 'yatzy', 0],
    [[6, 6, 4, 4, 1], 'twopair', 20], [[6, 6, 6, 6, 1], 'twopair', 0],      // four of a kind is one pair only
    [[6, 6, 6, 6, 1], 'pair', 12], [[5, 5, 2, 2, 1], 'pair', 10],           // the highest pair counts
    [[5, 5, 5, 1, 2], 'three', 15], [[2, 2, 2, 2, 5], 'four', 8],
    [[4, 4, 1, 2, 3], 'fours', 8], [[1, 2, 3, 4, 6], 'sixes', 6], [[1, 2, 3, 4, 6], 'chance', 16]
  ];
  for (const [dice, k, want] of cases) assert.equal(score(k, dice), want, `${k} with ${dice}`);
});

test('the bonus needs 63 points in the upper section', () => {
  const exactly = {ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18};
  assert.deepEqual(totals(exactly), {upper: 63, bonus: 50, total: 113});
  assert.equal(totals({...exactly, ones: 2}).bonus, 0);
  assert.equal(totals({}).total, 0);
});

test('a roll keeps held dice and uses up one roll', () => {
  const s = game({dice: [1, 2, 3, 4, 5]});
  toggleHeld(s, 0); toggleHeld(s, 4);
  assert.deepEqual(s.held, [true, false, false, false, true]);
  rollDice(s, [6, 6, 6, 6, 6]);
  assert.deepEqual(s.dice, [1, 6, 6, 6, 5]);
  assert.equal(s.rollsLeft, 1);
  assert.equal(s.rollId, 2);
});

test('toggling a die twice releases it again', () => {
  const s = game();
  toggleHeld(s, 2); toggleHeld(s, 2);
  assert.deepEqual(s.held, [false, false, false, false, false]);
});

test('the first roll of a turn ignores leftover holds, and the fourth roll is refused', () => {
  const s = game({dice: null, rollsLeft: 3});
  s.held = [true, true, true, true, true];
  rollDice(s, [2, 2, 2, 2, 2]);
  assert.deepEqual(s.dice, [2, 2, 2, 2, 2]);
  assert.deepEqual(s.held, [false, false, false, false, false]);
  rollDice(s, [1, 1, 1, 1, 1]); rollDice(s, [1, 1, 1, 1, 1]);
  assert.equal(rollDice(s, [3, 3, 3, 3, 3]), false);
  assert.equal(s.rollsLeft, 0);
});

test('entering a score hands the turn over and remembers the dice for undo', () => {
  const s = game();
  enterScore(s, 'p1', 'house');
  assert.equal(s.scores.p1.house, 19);
  assert.equal(s.turn, 'p2');
  assert.equal(s.dice, null);
  assert.equal(s.rollsLeft, 3);
  assert.deepEqual(s.last, {seat: 'p1', cat: 'house', pts: 19, dice: [3, 3, 3, 5, 5], held: [false, false, false, false, false], rollsLeft: 2, over: false});
});

test('a box can only be filled once, and only on your own turn', () => {
  const s = game();
  s.scores.p1.house = 0;
  assert.equal(enterScore(s, 'p1', 'house'), false);
  assert.equal(enterScore(s, 'p2', 'chance'), false);
  assert.equal(s.turn, 'p1');
});

test('undo restores the entry until the other person rolls', () => {
  const s = game();
  enterScore(s, 'p1', 'chance');
  assert.equal(undoAllowed(s, 'p2'), false, 'the other player cannot take it back');
  assert.equal(undoAllowed(s, 'p1'), true);
  undoEntry(s, 'p1');
  assert.equal(s.scores.p1.chance, undefined);
  assert.equal(s.turn, 'p1');
  assert.deepEqual(s.dice, [3, 3, 3, 5, 5]);
  assert.equal(s.rollsLeft, 2);

  enterScore(s, 'p1', 'chance');
  rollDice(s, [1, 2, 3, 4, 5]);
  assert.equal(undoAllowed(s, 'p1'), false, 'too late once the other person has rolled');
});

test('every five of a kind counts as a Yatzy, whichever box it goes into', () => {
  const s = game({dice: [6, 6, 6, 6, 6]});
  enterScore(s, 'p1', 'sixes');                                   // a Yatzy written as 30 Sechser
  assert.equal(s.seats.p1.yz, 1);
  assert.equal(undoAllowed(s, 'p1'), true);
  undoEntry(s, 'p1');
  assert.equal(s.seats.p1.yz, 0, 'undo takes it back');
  enterScore(s, 'p1', 'yatzy');
  Object.assign(s, {dice: [2, 2, 2, 2, 2], turn: 'p1', rollsLeft: 1});
  enterScore(s, 'p1', 'twos');                                    // the second Yatzy of the game
  assert.equal(s.seats.p1.yz, 2);

  fillAllBut(s.scores.p1, 'chance');
  fillAllBut(s.scores.p2);
  Object.assign(s, {dice: [4, 4, 4, 4, 4], turn: 'p1'});
  enterScore(s, 'p1', 'chance', '2026-11-01T09:00:00.000Z');      // the third, ends the game
  assert.equal(s.history[0].y1, 3);
  assert.equal(s.history[0].y2, 0);
  assert.equal(clean(s).history[0].y1, 3, 'more than one per game survives the sync');

  newRound(s, false);
  assert.equal(s.seats.p1.yz, 0, 'a new game starts at zero');
});

test('on the paper sheet the 50 in the Yatzy box counts', () => {
  const s = game();
  s.scores.p1 = {}; fillAllBut(s.scores.p1, 'yatzy');
  fillAllBut(s.scores.p2);
  markBox(s, 'p1', 'yatzy', 50, '2026-11-01T09:00:00.000Z');
  assert.equal(s.history[0].y1, 1);
});

test('the last entry of a game ends it, records history and can be undone', () => {
  const s = game({dice: [6, 6, 6, 6, 6], turn: 'p2'});
  fillAllBut(s.scores.p1);
  fillAllBut(s.scores.p2, 'yatzy');
  enterScore(s, 'p2', 'yatzy', '2026-10-30T20:00:00.000Z');
  assert.equal(s.status, 'over');
  assert.equal(s.history.length, 1);
  assert.deepEqual(s.history[0], {at: '2026-10-30T20:00:00.000Z', p1: 15, p2: 64, n1: 'Marcel', n2: 'Brokkoli', y1: 0, y2: 1,
    s1: Array(15).fill(1), s2: [...Array(14).fill(1), 50]}, 'with both score sheets, box by box');

  assert.equal(undoAllowed(s, 'p2'), true);
  undoEntry(s, 'p2');
  assert.equal(s.status, 'playing');
  assert.equal(s.history.length, 0);
  assert.equal(s.scores.p2.yatzy, undefined);
});

test('history keeps at most 50 games', () => {
  const s = game({dice: [1, 1, 1, 1, 1], turn: 'p2'});
  s.history = Array.from({length: 50}, (_, i) => ({at: String(i), p1: 100, p2: 100, n1: '', n2: '', y1: 0, y2: 0}));
  fillAllBut(s.scores.p1);
  fillAllBut(s.scores.p2, 'ones');
  enterScore(s, 'p2', 'ones');
  assert.equal(s.history.length, 50);
  assert.equal(s.history[0].at, '1');
});

test('a rematch starts at once, swaps who starts and keeps players and history', () => {
  const s = game();
  s.history = [{at: 'x', p1: 1, p2: 2, n1: '', n2: '', y1: 0, y2: 0}];
  s.status = 'over';
  newRound(s, false);
  assert.equal(s.status, 'playing', 'no name form in between');
  assert.equal(s.starter, 'p2');
  assert.equal(s.turn, 'p2');
  assert.deepEqual(s.scores, {p1: {}, p2: {}});
  assert.equal(s.history.length, 1);
  assert.equal(s.seats.p1.nick, 'Marcel');
});

test('one phone: the first game starts with the name form', () => {
  const s = blank();
  s.status = 'setup';
  newRound(s, true);
  assert.equal(s.status, 'setup', 'nobody named yet');
  beginGame(s, {p1: 'Marcel', p2: 'Brokkoli'}, {p1: '💚', p2: '🥦'});
  assert.equal(s.status, 'playing');
  assert.equal(s.seats.p2.emoji, '🥦');
  assert.equal(s.seats.p1.id, 'local-p1');
});

test('the game starts by itself when the second person sits down', () => {
  const s = blank();
  assert.equal(takeSeat(s, 'a', 'Marcel', '💚'), 'p1');
  assert.equal(s.status, 'waiting');
  assert.equal(takeSeat(s, 'a', 'Marcel again'), false, 'one seat per device');
  assert.equal(takeSeat(s, 'b', 'Brokkoli', '🥦'), 'p2');
  assert.equal(s.status, 'playing');
  assert.equal(s.turn, 'p1', 'whoever opened the table begins');
  assert.equal(s.seats.p2.emoji, '🥦', 'the symbol her phone remembers');
  assert.equal(takeSeat(s, 'c', 'Anna'), 'full');

  const emma = blank();
  takeSeat(emma, 'e', 'Emma');
  takeSeat(emma, 'a', 'Marcel', '💚');
  assert.equal(emma.seats.p1.emoji, '', 'nobody gets 🥦 without choosing it');
  assert.equal(loveTeam(emma, 'p2'), false, 'so no love notes for Emma');
});

test('your own name and symbol can be changed at any time', () => {
  const s = game();
  s.seats.p1.emoji = '💚';
  editSeat(s, 'p2', '  Brokkoli   Queen ', '🥦');
  assert.equal(s.seats.p2.nick, 'Brokkoli Queen');
  assert.equal(s.seats.p2.emoji, '🥦');
  assert.equal(s.seats.p1.emoji, '💚', 'the partner keeps theirs');
  editSeat(s, 'p2', '', '');
  assert.equal(s.seats.p2.nick, 'Brokkoli Queen', 'an empty name keeps the old one');
  assert.equal(s.seats.p2.emoji, '');
  assert.equal(s.seats.p1.emoji, '💚', 'removing yours leaves the partner alone');
  editSeat(s, 'p2', 'Brokkoli', '💚');
  assert.equal(s.seats.p1.emoji, '', 'each symbol only once per table');
  assert.equal(editSeat(blank(), 'p1', 'x', ''), false);
});

test('clean() rejects broken or hostile data', () => {
  const s = clean({
    status: 'hacked', turn: 'p3', dice: [7, 1, 1, 1, 1], held: [1, 0],
    scores: {p1: {ones: 99, twos: 4, fake: 3}},
    seats: {p1: {id: 'a', nick: 'x'.repeat(40), emoji: '🐍', notes: ['  hi  ', '', 42]}, p2: {nick: 'no id'}},
    history: [{p1: 10, p2: 20}, {p1: 'x', p2: 1}],
    last: {seat: 'p1', cat: 'chance', pts: 12, dice: [1, 2], held: [], rollsLeft: 1}
  });
  assert.equal(s.status, 'waiting');
  assert.equal(s.turn, 'p1');
  assert.equal(s.dice, null);
  assert.deepEqual(s.scores.p1, {twos: 4});
  assert.equal(s.seats.p1.nick.length, 16);
  assert.equal(s.seats.p1.emoji, '');
  assert.deepEqual(s.seats.p1.notes, ['hi']);
  assert.equal(s.seats.p2, null);
  assert.deepEqual(s.history, [{at: '', p1: 10, p2: 20, n1: '', n2: '', y1: 0, y2: 0}]);
  assert.deepEqual(s.last, {seat: 'p1', cat: 'chance', pts: 12}, 'no undo data when the saved dice are broken');
  assert.deepEqual(clean(null), blank());
});

test('love notes only go from 💚 to a 🥦 partner', () => {
  const s = game();
  assert.equal(loveTeam(s, 'p1'), false, 'no symbols');
  s.seats.p1.emoji = '💚'; s.seats.p2.emoji = '🥦';
  assert.equal(loveTeam(s, 'p1'), true);
  assert.equal(loveTeam(s, 'p2'), false, 'never the other way round');
  s.seats.p2.emoji = ''; s.seats.p2.nick = 'Anna 🥦';
  assert.equal(loveTeam(s, 'p1'), true, 'a 🥦 in the name counts too');
  s.seats.p2.nick = 'Anna';
  assert.equal(loveTeam(s, 'p1'), false);
});

test('stats count wins, draws, Yatzys and the current streak', () => {
  const h = (p1, p2, y1 = 0, y2 = 0) => ({at: '', p1, p2, n1: '', n2: '', y1, y2});
  const st = computeStats([h(221, 133), h(207, 254, 0, 1), h(220, 250), h(200, 200)]);
  assert.equal(st.games, 4);
  assert.equal(st.per.p1.wins, 1);
  assert.equal(st.per.p2.wins, 2);
  assert.equal(st.draws, 1);
  assert.equal(st.per.p2.best, 254);
  assert.deepEqual(st.avg, {p1: 212, p2: 209});
  assert.equal(st.per.p2.y, 1);
  assert.deepEqual(st.streak, {seat: null, n: 0}, 'a draw ends the streak');
  assert.deepEqual(computeStats([h(1, 2), h(1, 3)]).streak, {seat: 'p2', n: 2});
  assert.deepEqual(computeStats([]).avg, {p1: 0, p2: 0});
});

test('more statistics: lowest score, longest streak, biggest win, wins per month', () => {
  const h = (at, p1, p2) => ({at, p1, p2, n1: '', n2: '', y1: 0, y2: 0});
  const st = computeStats([h('2026-10-05T18:00:00Z', 200, 150), h('2026-10-06T18:00:00Z', 210, 180),
    h('2026-10-07T18:00:00Z', 190, 250), h('2026-11-01T18:00:00Z', 230, 160)]);
  assert.equal(st.per.p1.low, 190);
  assert.equal(st.per.p2.low, 150);
  assert.equal(st.per.p1.longest, 2);
  assert.equal(st.per.p2.longest, 1);
  assert.equal(st.per.p1.margin, 70);
  assert.equal(st.per.p2.margin, 60);
  assert.deepEqual(st.months, [{month: '2026-11', p1: 1, p2: 0, draws: 0}, {month: '2026-10', p1: 2, p2: 1, draws: 0}]);
});

test('box statistics come from games that kept their score sheet', () => {
  const a = [3, 6, 9, 12, 15, 18, 12, 16, 15, 20, 15, 20, 25, 24, 0];   // upper 63: bonus, one box scratched
  const b = [2, 4, 6, 8, 10, 12, 10, 14, 12, 16, 0, 0, 19, 20, 50];     // upper 42, two scratched
  const g = {at: '2026-11-01T18:00:00Z', p1: 260, p2: 183, n1: 'Marcel', n2: 'Brokkoli', y1: 0, y2: 1, s1: a, s2: b};
  const old = {at: '2026-10-01T18:00:00Z', p1: 200, p2: 210, n1: '', n2: '', y1: 0, y2: 0};
  const st = computeStats([old, g]);
  assert.equal(st.sheets, 1);
  assert.equal(st.per.p1.bonus, 1);
  assert.equal(st.per.p2.bonus, 0);
  assert.equal(st.per.p1.zeros, 1);
  assert.equal(st.per.p2.zeros, 2);
  assert.equal(st.bestBox.p1.k, 'large', 'Marcel is 20 points ahead there');
  assert.equal(st.bestBox.p2.k, 'yatzy');
  assert.deepEqual(computeStats([old]).bestBox, {p1: null, p2: null});

  assert.deepEqual(clean({history: [g]}).history[0].s2, b, 'the sheets survive the sync');
  assert.equal(clean({history: [{...g, s1: [1, 2]}]}).history[0].s1, undefined, 'a broken sheet is dropped');
  const room = clean({seats: {p1: {id: 'a', nick: 'Marcel'}, p2: {id: 'b', nick: 'Brokkoli'}}});
  const merged = mergeResults(room, [{...g, n1: 'Brokkoli', n2: 'Marcel', s1: b, s2: a}]).history[0];
  assert.deepEqual([merged.s1, merged.s2], [a, b], 'a paper game with swapped seats swaps its sheets too');
});

// A paper-sheet game: same seats, but nobody rolls on screen.
function paperGame(){ const s = game({dice: null, rollsLeft: 3}); s.held = [false, false, false, false, false]; return s; }

test('the paper sheet only offers scores five dice can make', () => {
  assert.deepEqual(boxOptions('threes'), [0, 3, 6, 9, 12, 15]);
  assert.deepEqual(boxOptions('twopair'), [0, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  assert.deepEqual(boxOptions('small'), [0, 15]);
  assert.deepEqual(boxOptions('yatzy'), [0, 50]);
  const house = boxOptions('house');
  assert.equal(house[1], 7, '1-1-1-2-2');
  assert.equal(house[house.length - 1], 28, '6-6-6-5-5');
  assert.ok(!house.includes(5) && !house.includes(30), 'five of a kind is no full house');
  assert.equal(boxOptions('chance').length, 27);
  assert.deepEqual(boxOptions('nope'), []);
});

test('on the paper sheet any box can be written, changed and emptied', () => {
  const s = paperGame();
  markBox(s, 'p2', 'house', 19);
  assert.equal(s.scores.p2.house, 19);
  assert.equal(s.turn, 'p1', 'whoever has fewer boxes filled is next');
  assert.equal(markBox(s, 'p1', 'house', 6), false, 'a full house of 6 is impossible');
  markBox(s, 'p2', 'house', 0);
  assert.equal(s.scores.p2.house, 0);
  markBox(s, 'p2', 'house', null);
  assert.equal(s.scores.p2.house, undefined);
  assert.equal(s.last, null);
  assert.equal(s.turn, 'p1', 'a tie goes to the starter');
});

test('a full paper sheet ends the game, and a correction keeps its time', () => {
  const s = paperGame();
  fillAllBut(s.scores.p1);
  fillAllBut(s.scores.p2, 'yatzy');
  markBox(s, 'p2', 'yatzy', 50, '2026-10-31T20:00:00.000Z');
  assert.equal(s.status, 'over');
  assert.deepEqual(s.history, [{at: '2026-10-31T20:00:00.000Z', p1: 15, p2: 64, n1: 'Marcel', n2: 'Brokkoli', y1: 0, y2: 1,
    s1: Array(15).fill(1), s2: [...Array(14).fill(1), 50]}]);

  markBox(s, 'p1', 'chance', 20, '2026-10-31T21:00:00.000Z');
  assert.equal(s.status, 'over', 'changing a value finishes the game again');
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].at, '2026-10-31T20:00:00.000Z');
  assert.equal(s.history[0].p1, 34);

  markBox(s, 'p1', 'chance', null);
  assert.equal(s.status, 'playing', 'an emptied box reopens it');
  assert.equal(s.history.length, 0);
});

test('paper results merge into the online history by name and time', () => {
  const room = blank();
  room.seats.p1 = {id: 'a', nick: '💚 Marcel'};
  room.seats.p2 = {id: 'b', nick: 'Brokkoli'};
  room.history = [{at: '2026-10-30T10:00:00.000Z', p1: 200, p2: 210, n1: 'Marcel', n2: 'Brokkoli', y1: 0, y2: 0}];
  // on the paper sheet Brokkoli sat in the first column
  const paper = {at: '2026-10-31T20:00:00.000Z', p1: 250, p2: 190, n1: 'Brokkoli 🥦', n2: 'Marcel', y1: 1, y2: 0};
  const a = mergeResults(room, [paper]);
  assert.equal(a.changed, 1);
  assert.deepEqual(a.history[1], {at: paper.at, p1: 190, p2: 250, n1: 'Marcel', n2: 'Brokkoli 🥦', y1: 0, y2: 1});

  room.history = a.history;
  assert.equal(mergeResults(room, [paper]).changed, 0, 'sending the same game twice adds nothing');
  const fixed = mergeResults(room, [{...paper, p1: 260}]);
  assert.equal(fixed.changed, 1);
  assert.equal(fixed.history.length, 2, 'a corrected game replaces its entry');
  assert.equal(fixed.history[1].p2, 260);
});

test('table lists from several phones merge, newest first, without junk', () => {
  const phone = [{id: 'raum-aaaaaaaa', at: 100}, {id: 'raum-bbbbbbbb', at: 300}];
  const backup = [{id: 'raum-aaaaaaaa', at: 500}, {id: 'raum-cccccccc', at: 200}, {id: 'Bad Id!', at: 900}, {id: 'raum-dddddddd'}, null];
  assert.deepEqual(mergeRooms(phone, backup), [
    {id: 'raum-aaaaaaaa', at: 500}, {id: 'raum-bbbbbbbb', at: 300}, {id: 'raum-cccccccc', at: 200}
  ]);
  assert.deepEqual(mergeRooms(null, 'x'), []);
  const many = Array.from({length: 60}, (_, i) => ({id: 'raum-' + String(i).padStart(8, '0'), at: i}));
  assert.equal(mergeRooms(many).length, 50);
  assert.equal(mergeRooms(many)[0].at, 59, 'the oldest ones drop out');
});

test('a personal code is cleaned up and must be long enough', () => {
  assert.equal(normCode('  Brokkoli 2207 '), 'brokkoli-2207');
  assert.equal(normCode('Müesli&Gmüeterli'), 'mueesligmueeterli');
  assert.equal(normCode('kurz'), null);
  assert.equal(normCode(''), null);
  assert.equal(normCode('x'.repeat(41)), null);
});
