// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blank } from '../game.js';
import { emptyTable, parseMessage, applyMessage, addResults, importTable, mergeCode, SEEN_MAX } from '../server/src/logic.js';

// A table both phones sit at, stored once.
function table(){
  const data = blank();
  data.seats.p1 = {id: 'a', nick: 'Marcel', emoji: '', react: null, notes: []};
  data.seats.p2 = {id: 'b', nick: 'Brokkoli', emoji: '', react: null, notes: []};
  data.status = 'playing';
  return {rev: 3, data, seen: []};
}
const send = (t, m) => applyMessage(t, parseMessage(JSON.stringify(m)));

test('only well-formed messages are read', () => {
  assert.equal(parseMessage('nonsense'), null);
  assert.equal(parseMessage(JSON.stringify({t: 'update', patch: {}})), null);            // no id
  assert.equal(parseMessage(JSON.stringify({t: 'set', id: 'x', data: {}})), null);       // no base
  assert.equal(parseMessage(JSON.stringify({t: 'drop', id: 'x'})), null);
  assert.equal(parseMessage('x'.repeat(70000)), null);
  assert.ok(parseMessage(JSON.stringify({t: 'update', id: 'x', patch: {turn: 'p2'}})));
});

test('an update changes single fields, also nested ones', () => {
  const {table: t, reply} = send(table(), {t: 'update', id: 'm1', patch: {turn: 'p2', 'seats.p1.notes': ['Kuss']}});
  assert.deepEqual(reply, {t: 'ack', id: 'm1', rev: 4});
  assert.equal(t.data.turn, 'p2');
  assert.deepEqual(t.data.seats.p1.notes, ['Kuss']);
  assert.equal(t.data.seats.p1.nick, 'Marcel');                           // the rest of the seat stays
});

test('stored data is cleaned like a phone would read it', () => {
  const {table: t} = send(table(), {t: 'update', id: 'm1', patch: {rollsLeft: 9, 'scores.p1.yatzy': 51, 'seats.p1.nick': 'x'.repeat(40)}});
  assert.equal(t.data.rollsLeft, 3);
  assert.equal(t.data.scores.p1.yatzy, undefined);
  assert.equal(t.data.seats.p1.nick.length, 16);
});

test('unknown fields are refused', () => {
  for (const patch of [{push: 1}, {'__proto__.x': 1}, {'seats..p1': 1}]){
    const {table: t, reply} = send(table(), {t: 'update', id: 'm1', patch});
    assert.equal(t, null);
    assert.equal(reply.why, 'bad-field');
  }
  assert.equal(send(table(), {t: 'set', id: 'm1', base: 3, data: {...blank(), push: 1}}).reply.why, 'bad-field');
});

test('an update needs an existing table', () => {
  const {table: t, reply} = send(emptyTable(), {t: 'update', id: 'm1', patch: {turn: 'p2'}});
  assert.equal(t, null);
  assert.equal(reply.why, 'not-found');
});

test('a set only wins on the state the phone saw', () => {
  const first = send(emptyTable(), {t: 'set', id: 'm1', base: 0, data: blank()});
  assert.equal(first.table.rev, 1);
  const late = send(first.table, {t: 'set', id: 'm2', base: 0, data: {...blank(), status: 'setup'}});
  assert.equal(late.table, null);
  assert.equal(late.reply.why, 'conflict');
  assert.equal(late.reply.rev, 1);                                        // the phone retries on this
  assert.equal(late.reply.data.status, 'waiting');
});

test('a move sent twice counts once', () => {
  const once = send(table(), {t: 'update', id: 'm1', patch: {rollId: 5}});
  const again = send(once.table, {t: 'update', id: 'm1', patch: {rollId: 6}});
  assert.equal(again.table, null);
  assert.deepEqual(again.reply, {t: 'ack', id: 'm1', rev: 4});
  let t = table();
  for (let i = 0; i < SEEN_MAX + 5; i++) t = send(t, {t: 'update', id: 'k' + i, patch: {rollId: i}}).table;
  assert.equal(t.seen.length, SEEN_MAX);
});

test('paper results join the history once', () => {
  const r = {at: '2026-10-31T20:00:00.000Z', p1: 180, p2: 210, n1: 'Brokkoli', n2: 'Marcel', y1: 0, y2: 1};
  const {table: t, changed} = addResults(table(), [r, {bad: true}]);
  assert.equal(changed, 1);
  assert.equal(t.rev, 4);
  assert.deepEqual(t.data.history[0], {at: r.at, p1: 210, p2: 180, n1: 'Marcel', n2: 'Brokkoli', y1: 1, y2: 0});   // seats matched by name
  assert.equal(addResults(t, [r]).changed, 0);
  assert.equal(addResults(emptyTable(), [r]).changed, -1);
});

test('a personal code keeps the newest of every list', () => {
  const a = [{id: 'raum-aaaa1111', at: 1}, {id: 'raum-bbbb2222', at: 5}];
  const b = [{id: 'raum-aaaa1111', at: 9}, {id: 'nope', at: 3}];
  assert.deepEqual(mergeCode(a, b), [{id: 'raum-aaaa1111', at: 9}, {id: 'raum-bbbb2222', at: 5}]);
  assert.deepEqual(mergeCode([], null), []);
});

test('a table from Firebase is copied until the first move here', () => {
  const fb = {...table().data, updatedAt: '2026-11-01T08:00:00.000Z'};
  const first = importTable(emptyTable(), fb);
  assert.equal(first.rev, 1);
  assert.equal(first.data.seats.p1.nick, 'Marcel');
  assert.equal(importTable(first, fb), null, 'the same copy again changes nothing');
  const newer = importTable(first, {...fb, turn: 'p2', updatedAt: '2026-11-01T09:00:00.000Z'});
  assert.equal(newer.data.turn, 'p2', 'the other phone still played on Firebase');

  const moved = send(newer, {t: 'update', id: 'm1', patch: {rollId: 7}}).table;
  assert.equal(importTable(moved, {...fb, updatedAt: '2026-11-02T00:00:00.000Z'}), null, 'after a move here nothing is overwritten');
  assert.equal(importTable(emptyTable(), {nonsense: true}), null);
});
