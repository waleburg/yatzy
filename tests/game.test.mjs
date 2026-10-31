// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS, score, totals, blank, clean, rollDice, toggleHeld, enterScore,
  undoAllowed, undoEntry, newRound, beginGame, loveTeam, computeStats,
  boxOptions, markBox, mergeResults
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

test('the last entry of a game ends it, records history and can be undone', () => {
  const s = game({dice: [6, 6, 6, 6, 6], turn: 'p2'});
  fillAllBut(s.scores.p1);
  fillAllBut(s.scores.p2, 'yatzy');
  enterScore(s, 'p2', 'yatzy', '2026-10-30T20:00:00.000Z');
  assert.equal(s.status, 'over');
  assert.equal(s.history.length, 1);
  assert.deepEqual(s.history[0], {at: '2026-10-30T20:00:00.000Z', p1: 15, p2: 64, n1: 'Marcel', n2: 'Brokkoli', y1: 0, y2: 1});

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

test('a new game swaps who starts and keeps players and history', () => {
  const s = game();
  s.history = [{at: 'x', p1: 1, p2: 2, n1: '', n2: '', y1: 0, y2: 0}];
  newRound(s, false);
  assert.equal(s.status, 'setup');
  assert.equal(s.starter, 'p2');
  assert.deepEqual(s.scores, {p1: {}, p2: {}});
  assert.equal(s.history.length, 1);
  assert.equal(s.seats.p1.nick, 'Marcel');

  beginGame(s, {p1: 'Marcel', p2: 'Brokkoli'}, {p1: '💚', p2: '🥦'});
  assert.equal(s.status, 'playing');
  assert.equal(s.turn, 'p2');
  assert.equal(s.seats.p2.emoji, '🥦');
  assert.equal(s.seats.p1.id, 'a', 'the device that owns the seat stays the same');
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
  assert.deepEqual(s.history, [{at: '2026-10-31T20:00:00.000Z', p1: 15, p2: 64, n1: 'Marcel', n2: 'Brokkoli', y1: 0, y2: 1}]);

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
