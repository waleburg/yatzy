// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { blank } from '../game.js';
import { subscription, vapidJwt, encrypt, b64u } from '../server/src/push.js';
import { pushMessages, stillDue, turnKey, daytime, reminderMessage } from '../server/src/logic.js';

const APP = 'https://waleburg.github.io/yatzy/';
function game(over = {}){
  const s = blank();
  s.seats.p1 = {id: 'a', nick: 'Marcel', emoji: '💚', react: null, notes: [], yz: 0};
  s.seats.p2 = {id: 'b', nick: 'Brokkoli', emoji: '🥦', react: null, notes: [], yz: 0};
  return Object.assign(s, {status: 'playing', turn: 'p2'}, over);
}

test('the person whose turn it now is hears what the other entered', () => {
  const next = game({turn: 'p1', last: {seat: 'p2', cat: 'house', pts: 25}});
  const out = pushMessages(game(), next, 'raum-test1234', APP);
  assert.deepEqual(out, [{seat: 'p1', kind: 'turn', message: {tag: 'yatzy-raum-test1234', url: APP + '#raum-test1234', title: 'Du bist dran 🎲', body: '🥦 Brokkoli hat 25 bei Full House eingetragen.'}}]);
});

test('a roll or a reaction tells nobody anything', () => {
  assert.deepEqual(pushMessages(game(), game({rollId: 4}), 'raum-test1234', APP), []);
});

test('when the partner sits down, the starter hears it', () => {
  const prev = game({status: 'waiting', turn: 'p1'});
  prev.seats.p2 = null;
  const out = pushMessages(prev, game({turn: 'p1'}), 'raum-test1234', APP);
  assert.equal(out.length, 1);
  assert.equal(out[0].message.body, '🥦 Brokkoli ist am Tisch. Das Spiel beginnt mit dir.');
});

test('game over goes to both and names the winner, bonus included', () => {
  const next = game({status: 'over', scores: {p1: {ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18}, p2: {chance: 30}}});
  const out = pushMessages(game(), next, 'raum-test1234', APP);
  assert.deepEqual(out.map(x => x.seat), ['p1', 'p2']);
  assert.equal(out[0].message.body, '💚 Marcel gewinnt 113 zu 30.');
  assert.deepEqual(pushMessages(next, next, 'raum-test1234', APP), [], 'only once');
});

test('a Revanche reaches the other person, whoever begins', () => {
  const over = game({status: 'over'});
  const out = pushMessages(over, game({turn: 'p1', scores: {p1: {}, p2: {}}}), 'raum-test1234', APP);
  assert.deepEqual(out.map(x => [x.seat, x.message.title, x.message.body]), [
    ['p1', 'Revanche! 🎲', '🥦 Brokkoli will eine Revanche. Du beginnst.'],
    ['p2', 'Revanche! 🎲', '💚 Marcel will eine Revanche und beginnt.']
  ]);
});

test('a reaction reaches the other person as a message from the sender', () => {
  const next = game();
  next.seats.p1.react = {e: '😘', n: 1000};
  const out = pushMessages(game(), next, 'raum-test1234', APP);
  assert.deepEqual(out, [{seat: 'p2', kind: 'react', message: {tag: 'yatzy-react-raum-test1234', url: APP + '#raum-test1234', title: '💚 Marcel', body: '😘 Kuss'}}]);
  assert.deepEqual(pushMessages(next, next, 'raum-test1234', APP), [], 'the same reaction only once');
});

test('a held-back notification is only sent later if it still fits', () => {
  assert.equal(stillDue('turn', 'p1', game({turn: 'p1'})), true);
  assert.equal(stillDue('turn', 'p1', game({turn: 'p2'})), false, 'already played meanwhile');
  assert.equal(stillDue('over', 'p2', game({status: 'over'})), true);
  assert.equal(stillDue('over', 'p2', game()), false, 'a new game started meanwhile');
  assert.equal(stillDue('turn', 'p1', null), false);
});

test('a quick reply reaches the other person as a message from the sender', () => {
  const next = game();
  next.seats.p2.say = {k: 'later', n: 2000};
  const out = pushMessages(game(), next, 'raum-test1234', APP);
  assert.deepEqual(out, [{seat: 'p1', kind: 'say', message: {tag: 'yatzy-say-raum-test1234', url: APP + '#raum-test1234', title: '🥦 Brokkoli', body: 'Spöter hüt 🌙'}}]);
  assert.deepEqual(pushMessages(next, next, 'raum-test1234', APP), [], 'the same reply only once');
});

test('pushes only go to real push services over https', () => {
  const sub = endpoint => ({endpoint, keys: {p256dh: 'x', auth: 'y'}});
  assert.ok(subscription(sub('https://web.push.apple.com/abc')));
  assert.ok(subscription(sub('https://fcm.googleapis.com/fcm/send/abc')));
  assert.equal(subscription(sub('https://evil.example/web.push.apple.com')), null);
  assert.equal(subscription(sub('https://push.apple.com.evil.example/x')), null);
  assert.equal(subscription(sub('http://web.push.apple.com/abc')), null);
  assert.equal(subscription(null), null);
});

test('the VAPID token is a valid ES256 signature with a short expiry', async () => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const jwt = await vapidJwt({VAPID_PRIVATE_JWK: JSON.stringify(privateKey.export({format: 'jwk'})), VAPID_SUBJECT: APP}, 'https://web.push.apple.com', 1000);
  const [h, p, s] = jwt.split('.');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), {key: publicKey, dsaEncoding: 'ieee-p1363'}, Buffer.from(s, 'base64url')));
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), {aud: 'https://web.push.apple.com', exp: 4600, sub: APP});
});

test('the encrypted body decrypts back to the message (RFC 8291)', async () => {
  // receiver side, written with Node's crypto independently of the server's WebCrypto code
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = {endpoint: 'https://web.push.apple.com/x', p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url')};
  const body = Buffer.from(await encrypt(sub, new TextEncoder().encode('Hallo 🥦')));
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const ecdh = ua.computeSecret(asPublic);
  const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
  const ikm = hkdf(auth, ecdh, Buffer.concat([Buffer.from('WebPush: info\0'), b64u(sub.p256dh), asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const dec = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  dec.setAuthTag(cipher.subarray(-16));
  const plain = Buffer.concat([dec.update(cipher.subarray(0, -16)), dec.final()]);
  assert.equal(plain.at(-1), 2, 'last-record delimiter');
  assert.equal(plain.subarray(0, -1).toString('utf8'), 'Hallo 🥦');
});

test('a turn stays the same while rolling and changes with every entry', () => {
  const a = game({turn: 'p1'});
  assert.equal(turnKey(a), turnKey({...a, dice: [1, 2, 3, 4, 5], rollsLeft: 2}));
  assert.notEqual(turnKey(a), turnKey(game({turn: 'p2', scores: {p1: {chance: 20}, p2: {}}})));
  assert.equal(turnKey(game({status: 'over'})), '', 'no reminder for a finished game');
});

test('reminders wait for the morning in Switzerland', () => {
  const zurich = t => new Intl.DateTimeFormat('de-CH', {timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(t);
  const afternoon = Date.parse('2026-11-02T13:00:00Z');                 // 14:00 in Zürich
  assert.equal(daytime(afternoon), afternoon);
  const night = daytime(Date.parse('2026-11-02T21:30:00Z'));            // 22:30 in Zürich
  assert.equal(zurich(night), '08:00');
  assert.ok(night - Date.parse('2026-11-02T21:30:00Z') < 10 * 3600000);
});

test('the reminder says who waits and how long', () => {
  const m = reminderMessage(game({turn: 'p1'}), 'p1', 0, 3 * 3600000, 'raum-test1234', APP);
  assert.equal(m.title, 'Du bist noch dran 🎲');
  assert.equal(m.body, '🥦 Brokkoli wartet seit 3 Stunden auf deinen Zug.');
  assert.equal(m.url, APP + '#raum-test1234');
});

