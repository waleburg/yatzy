# Yatzy zu zweit

Yatzy für zwei Personen auf zwei Handys, mit skandinavischen Regeln. Die Seite ist eine einzige HTML-Datei. Ein kleiner eigener Server bei Cloudflare synchronisiert die Züge live zwischen den Geräten und schickt die Benachrichtigungen. Gehostet wird über GitHub Pages, beides kostenlos.

## Dateien

| Datei | Wozu |
|---|---|
| `index.html` | Die Seite: Darstellung, Ton, Verbindung zum Server. Oben im Skript stehen `SERVER_URL` und `VERSION`. |
| `game.js` | Die Spielregeln: Punkte, Würfeln, Eintragen, Rückgängig, Statistik. |
| `sw.js` | Speichert die Seite auf dem Handy, damit sie auch ohne Internet startet. |
| `server/` | Der Server auf Cloudflare: ein Durable Object pro Tisch und eines pro persönlichem Code, dazu die Benachrichtigungen. |
| `tests/` | Tests für Spielregeln, Server und Benachrichtigungen. `server-live.test.mjs` läuft nur mit `SERVER_URL`. |
| `README.md` | Diese Anleitung. |
| `manifest.webmanifest`, `icon.svg`, `*.png` | Name und Icon für den Home-Bildschirm. |
| `fonts/` | Die beiden Schriften (Familjen Grotesk, Kalam) mit ihren Lizenzen, damit nichts von Google Fonts geladen wird. |

## 1. Server bei Cloudflare einrichten (etwa 10 Minuten)

Du brauchst ein kostenloses Konto bei <https://dash.cloudflare.com> und Node.js.

1. Öffne im Cloudflare-Dashboard einmal **Compute (Workers) › Workers & Pages**. Dabei bekommt dein Konto eine Adresse wie `<name>.workers.dev`.
2. Melde dich im Terminal an und lade den Server hoch:

   ```bash
   cd server
   npm install
   npx wrangler login
   npx wrangler deploy
   ```

   Am Schluss steht die Adresse des Servers, zum Beispiel `https://yatzy.<name>.workers.dev`. Trage sie in `index.html` bei `SERVER_URL` ein.
3. Für Benachrichtigungen braucht der Server ein Schlüsselpaar (VAPID). Der öffentliche Schlüssel steht in `server/wrangler.toml` und in `index.html` (`VAPID_PUBLIC`). Den privaten Schlüssel gibst du nur Cloudflare, er gehört nicht ins Repository:

   ```bash
   npx wrangler secret put VAPID_PRIVATE_JWK < vapid-private.jwk.json
   ```

4. Ändert sich etwas in `server/`, lädst du es mit `npm --prefix server run deploy` neu hoch.

Der Gratis-Tarif von Cloudflare reicht locker: 100'000 Anfragen pro Tag, ein Spiel braucht ein paar hundert.

## 2. Auf GitHub Pages veröffentlichen

1. Lade die Dateien in dein Repository auf den Branch `main`.
2. Öffne im Repository **Settings › Pages**.
   - Source: **Deploy from a branch**
   - Branch: `main`, Ordner `/ (root)`, dann **Save**
3. Nach etwa einer Minute ist das Spiel live unter `https://<dein-github-name>.github.io/<repo-name>/`.

Mit einem kostenlosen GitHub-Konto muss das Repository für Pages öffentlich sein. Euer Spielstand ist trotzdem nicht öffentlich, er liegt auf dem Server bei Cloudflare.

## 3. Spielen

1. Öffne die Seite auf deinem iPhone. Die Adresse bekommt automatisch einen Raum-Code, zum Beispiel `…/#raum-k3x9q2mf7a1b`. Das ist euer Tisch.
2. Gib deinen Namen ein und tippe auf **Platz nehmen**.
3. Tippe auf **Link senden** und schick den Link per iMessage oder WhatsApp.
4. Die zweite Person öffnet den Link und nimmt Platz. Damit startet das Spiel, wer den Tisch eröffnet hat, beginnt.

**Revanche** startet das nächste Spiel sofort, abwechselnd beginnt die andere Person. Deinen Namen änderst du jederzeit, indem du oben auf ihn tippst.

Die Liebesbotschaften gehen nur von 💚 an 🥦. Niemand bekommt 🥦 automatisch: Dein Handy merkt sich dein Symbol und nimmt es an neue Tische mit. An einem Tisch mit jemand anderem, zum Beispiel Emma, kommen deshalb keine Liebesbotschaften an.

**Tipp:** Füge die Seite in Safari über **Teilen › Zum Home-Bildschirm** hinzu. Dann öffnet sie sich wie eine App.

**Neues Handy oder Home-Bildschirm-App:** Die Seite erkennt dich am Gerät. Öffnest du den Raum-Link auf einem anderen Gerät, kannst du mit **Ich bin …** deinen Platz zurückholen. Das gilt auch für die App auf dem Home-Bildschirm, denn iOS gibt ihr einen eigenen Speicher.

## Gut zu wissen

- **Mit echten Würfeln:** Unten auf der Seite wechselst du mit «🎲 Mit echten Würfeln spielen» zum Spielblock. Ihr würfelt am Tisch, tippt auf ein Feld und wählt die Punkte. Angeboten werden nur Werte, die mit fünf Würfeln möglich sind. Eingetragenes kannst du antippen und ändern oder leeren. Der Block wird nur auf diesem Handy gespeichert, funktioniert ganz ohne Internet und hält den Bildschirm an. Die Adresse dafür ist `…/#papier`. Mit «Zurück zum Online-Spiel» kommst du wieder an euren Tisch.
- **Ergebnisse vom Spielblock:** Fertige Spiele kommen in die Statistik des Online-Tisches, den dieses Handy zuletzt geöffnet hat. Ohne Verbindung geschieht das automatisch, sobald das Handy wieder online ist. Die Spieler werden über die Namen zugeordnet, nennt euch also gleich wie am Online-Tisch. Korrigierst du ein fertiges Spiel nachträglich, wird der Eintrag in der Statistik ersetzt.
- **Meine Tische:** Kennt das Handy mehr als einen Tisch, erscheint oben «Tische». Die Liste zeigt alle Tische, die das Handy geöffnet hat, mit wer gegen wen spielt, Spielstand, Siegen und Datum. Antippen öffnet den Tisch. Mit einem persönlichen Code wird die Liste zusätzlich auf dem Server gesichert. Gibst du denselben Code auf einem anderen Handy ein, oder nachdem die App gelöscht wurde, sind alle Tische wieder da.
- **Benachrichtigungen:** Unten auf der Seite schaltest du sie einmal pro Handy ein, dann gelten sie für alle Tische. Danach steht dort nur noch eine zugeklappte Zeile «Benachrichtigungen: an» mit Test und Ausschalten. Du bekommst eine Nachricht, wenn du dran bist, wenn das Spiel fertig ist, wenn jemand eine Revanche will und wenn dir jemand ein Emoji oder eine kurze Antwort schickt, aber nicht, solange die App bei dir offen ist. Auf dem iPhone geht das nur in der App auf dem Home-Bildschirm (iOS 16.4 oder neuer).
- **Reaktionen:** Der runde 😊-Knopf neben dem Würfel-Knopf öffnet die Emojis und die kurzen Antworten «Gib mer e Minute ⏳», «Spöter hüt 🌙», «Morn ☀️» und «Bi grad da 🎲». Antippen schickt sofort und klappt wieder zu. Bei der anderen Person erscheint es in der App oder als Benachrichtigung.
- **Erinnerung:** Bist du seit drei Stunden dran, kommt eine einzige Erinnerung. Nachts zwischen 22 und 8 Uhr wartet sie bis zum Morgen.
- **Grüner Punkt:** Neben dem Namen der anderen Person leuchtet ein grüner Punkt, solange sie die App gerade offen hat.
- **Version:** Ganz unten steht die Version. So siehst du, ob beide Handys die neuste haben.
- **Ohne Internet starten:** Die Seite wird beim ersten Öffnen auf dem Handy gespeichert. Danach startet sie auch ohne Verbindung, am besten über das Icon auf dem Home-Bildschirm.
- **Rückgängig:** Hast du dich vertippt, kannst du deinen letzten Eintrag zurücknehmen, solange die andere Person noch nicht gewürfelt hat. Das gilt auch für den allerletzten Eintrag eines Spiels.
- **Offline:** Hat ein Handy keine Verbindung, erscheint oben ein rotes «Offline». Würfeln, Halten und Eintragen bleiben auf dem Handy gespeichert, auch wenn die App geschlossen wird, und werden gesendet, sobald die Verbindung zurück ist. «Neues Spiel», Plätze und «Rückgängig» gehen erst wieder online.
- **Statistik:** Unten auf der Seite findest du Siege, höchste, tiefste und durchschnittliche Punkte, Yatzys, die längste Siegesserie, den höchsten Sieg, Siege pro Monat und die letzten Spiele. Seit dem 1.11.2026 wird zu jedem Spiel auch das ganze Spielblatt gespeichert; daraus kommen «Bonus geschafft», «Gestrichen pro Spiel» und «Bestes Feld» (wo jemand im Schnitt am meisten vor der anderen Person liegt).
- **Gleichzeitige Aktionen:** «Neues Spiel», Namen, Plätze und «Rückgängig» werden als Transaktion gespeichert, damit kein Handy die Änderung des anderen überschreibt. Würfeln, Halten und Eintragen ändern nur die Felder des aktuellen Zugs und erscheinen sofort.
- **Ton:** Wenn du dran bist, spielt ein kurzer Gong. Auch wenn die zweite Person Platz nimmt und wenn das Spiel vorbei ist, hörst du einen Ton. Oben rechts schaltest du ihn mit «Ton an/aus» um. Damit der Gong zu hören ist, bleibt der Bildschirm während des Spiels an. Ist das iPhone gesperrt oder die Seite im Hintergrund, kommt kein Ton. Beim lautlosen iPhone (Schalter auf stumm) kann der Ton auch ausbleiben.
- **Wer den Raum-Link kennt, kann mitspielen.** Teilt ihn also nur untereinander. Einen neuen, leeren Tisch bekommst du, wenn du die Seite ohne `#raum-…` in einem privaten Safari-Fenster öffnest.
- **Ohne `SERVER_URL` läuft die Seite trotzdem**, dann aber nur auf einem Handy. Ihr gebt es nach jedem Zug weiter.

## Tests

Spielregeln, Server und Benachrichtigungen haben eigene Tests. Sie brauchen nur Node.js (ab Version 18), sonst nichts:

```bash
node --test
```

Die Live-Tests prüfen einen laufenden Server, zum Beispiel den lokalen aus `npm --prefix server run dev`:

```bash
SERVER_URL=http://localhost:8787 node --test tests/server-live.test.mjs
```
