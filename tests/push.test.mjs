// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { blank } from '../game.js';
import { subscription, vapidJwt, encrypt, b64u } from '../server/src/push.js';
import { pushMessages } from '../server/src/logic.js';

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
  assert.deepEqual(out, [{seat: 'p1', message: {tag: 'yatzy-raum-test1234', url: APP + '#raum-test1234', title: 'Du bist dran 🎲', body: '🥦 Brokkoli hat 25 bei Full House eingetragen.'}}]);
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
