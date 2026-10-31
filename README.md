# Yatzy zu zweit

Yatzy für zwei Personen auf zwei Handys, mit skandinavischen Regeln. Die Seite ist eine einzige HTML-Datei. Firebase Firestore synchronisiert die Züge live zwischen den Geräten. Gehostet wird über GitHub Pages, beides kostenlos.

## Dateien

| Datei | Wozu |
|---|---|
| `index.html` | Die Seite: Darstellung, Ton, Firebase. Oben im Skript steht der Block `FIREBASE_CONFIG`. |
| `game.js` | Die Spielregeln: Punkte, Würfeln, Eintragen, Rückgängig, Statistik. |
| `sw.js` | Speichert die Seite auf dem Handy, damit sie auch ohne Internet startet. |
| `tests/game.test.mjs` | Tests für die Spielregeln. |
| `firestore.rules` | Die Zugriffsregeln, die du in Firebase einfügst. |
| `README.md` | Diese Anleitung. |
| `manifest.webmanifest`, `icon.svg`, `*.png` | Name und Icon für den Home-Bildschirm. |

## 1. Firebase einrichten (etwa 10 Minuten)

1. Öffne <https://console.firebase.google.com> und melde dich mit einem Google-Konto an.
2. **Projekt erstellen**, zum Beispiel mit dem Namen `yatzy-zu-zweit`. Google Analytics brauchst du nicht, du kannst es ausschalten.
3. Wähle links **Build › Firestore Database › Datenbank erstellen**.
   - Standort: `europe-west6 (Zürich)`, oder ein anderer Standort in Europa.
   - Wähle den **Produktionsmodus**.
4. Öffne in Firestore den Tab **Regeln**. Ersetze den ganzen Inhalt durch den Inhalt von `firestore.rules` und tippe auf **Veröffentlichen**.
   Ändert sich `firestore.rules` später, zum Beispiel für die Liste «Meine Tische», wiederholst du diesen Schritt.
5. Gehe zur **Projektübersicht**, wähle das Web-Symbol **`</>`** («App hinzufügen») und gib als Namen `Yatzy` ein. Firebase Hosting brauchst du nicht.
6. Firebase zeigt dir einen Block `const firebaseConfig = { … }`. Übertrage diese Werte in `index.html` in den Block `FIREBASE_CONFIG`:

   ```js
   const FIREBASE_CONFIG = {
     apiKey: "AIza…",
     authDomain: "yatzy-zu-zweit.firebaseapp.com",
     projectId: "yatzy-zu-zweit",
     storageBucket: "yatzy-zu-zweit.appspot.com",
     messagingSenderId: "…",
     appId: "1:…:web:…"
   };
   ```

   Diese Werte sind nicht geheim. Sie dürfen öffentlich auf GitHub stehen. Geschützt wird das Spiel durch die Regeln aus Schritt 4.

## 2. Auf GitHub Pages veröffentlichen

1. Lade `index.html`, `firestore.rules` und `README.md` in dein Repository auf den Branch `main`.
2. Öffne im Repository **Settings › Pages**.
   - Source: **Deploy from a branch**
   - Branch: `main`, Ordner `/ (root)`, dann **Save**
3. Nach etwa einer Minute ist das Spiel live unter `https://<dein-github-name>.github.io/<repo-name>/`.

Mit einem kostenlosen GitHub-Konto muss das Repository für Pages öffentlich sein. Euer Spielstand ist trotzdem nicht öffentlich, er liegt in Firebase.

## 3. Spielen

1. Öffne die Seite auf deinem iPhone. Die Adresse bekommt automatisch einen Raum-Code, zum Beispiel `…/#raum-k3x9q2mf7a1b`. Das ist euer Tisch.
2. Gib deinen Namen ein und tippe auf **Platz nehmen**.
3. Tippe auf **Link senden** und schick den Link per iMessage oder WhatsApp.
4. Die zweite Person öffnet den Link und nimmt Platz.
5. Tragt im Namensformular eure Namen ein und tippt auf **Spiel starten**.

Die Liebesbotschaften gehen an die Person, die nicht «Marcel» heisst. Dafür musst du dich im Formular «Marcel» nennen.

**Tipp:** Füge die Seite in Safari über **Teilen › Zum Home-Bildschirm** hinzu. Dann öffnet sie sich wie eine App.

**Neues Handy oder Home-Bildschirm-App:** Die Seite erkennt dich am Gerät. Öffnest du den Raum-Link auf einem anderen Gerät, kannst du mit **Ich bin …** deinen Platz zurückholen. Das gilt auch für die App auf dem Home-Bildschirm, denn iOS gibt ihr einen eigenen Speicher.

## Gut zu wissen

- **Mit echten Würfeln:** Unten auf der Seite wechselst du mit «🎲 Mit echten Würfeln spielen» zum Spielblock. Ihr würfelt am Tisch, tippt auf ein Feld und wählt die Punkte. Angeboten werden nur Werte, die mit fünf Würfeln möglich sind. Eingetragenes kannst du antippen und ändern oder leeren. Der Block wird nur auf diesem Handy gespeichert, funktioniert ganz ohne Internet und hält den Bildschirm an. Die Adresse dafür ist `…/#papier`. Mit «Zurück zum Online-Spiel» kommst du wieder an euren Tisch.
- **Ergebnisse vom Spielblock:** Fertige Spiele kommen in die Statistik des Online-Tisches, den dieses Handy zuletzt geöffnet hat. Ohne Verbindung geschieht das automatisch, sobald das Handy wieder online ist. Die Spieler werden über die Namen zugeordnet, nennt euch also gleich wie am Online-Tisch. Korrigierst du ein fertiges Spiel nachträglich, wird der Eintrag in der Statistik ersetzt.
- **Meine Tische:** Eine versteckte Liste zeigt alle Tische, die das Handy geöffnet hat, mit wer gegen wen spielt, Spielstand, Siegen und Datum. Antippen öffnet den Tisch. Mit einem persönlichen Code wird die Liste zusätzlich in Firebase gesichert. Gibst du denselben Code auf einem anderen Handy ein, oder nachdem die App gelöscht wurde, sind alle Tische wieder da.
- **Ohne Internet starten:** Die Seite wird beim ersten Öffnen auf dem Handy gespeichert. Danach startet sie auch ohne Verbindung, am besten über das Icon auf dem Home-Bildschirm.
- **Rückgängig:** Hast du dich vertippt, kannst du deinen letzten Eintrag zurücknehmen, solange die andere Person noch nicht gewürfelt hat. Das gilt auch für den allerletzten Eintrag eines Spiels.
- **Offline:** Hat ein Handy keine Verbindung, erscheint oben ein rotes «Offline». Würfeln, Halten und Eintragen werden gesendet, sobald die Verbindung zurück ist. «Neues Spiel», Plätze und «Rückgängig» gehen erst wieder online.
- **Statistik:** Unten auf der Seite findest du Siege, Höchst- und Durchschnittspunkte, Yatzys und die letzten Spiele.
- **Gleichzeitige Aktionen:** «Neues Spiel», Namen, Plätze und «Rückgängig» werden als Transaktion gespeichert, damit kein Handy die Änderung des anderen überschreibt. Würfeln, Halten und Eintragen ändern nur die Felder des aktuellen Zugs und erscheinen sofort.
- **Ton:** Wenn du dran bist, spielt ein kurzer Gong. Auch wenn die zweite Person Platz nimmt und wenn das Spiel vorbei ist, hörst du einen Ton. Oben rechts schaltest du ihn mit «Ton an/aus» um. Damit der Gong zu hören ist, bleibt der Bildschirm während des Spiels an. Ist das iPhone gesperrt oder die Seite im Hintergrund, kommt kein Ton. Beim lautlosen iPhone (Schalter auf stumm) kann der Ton auch ausbleiben.
- **Wer den Raum-Link kennt, kann mitspielen.** Teilt ihn also nur untereinander. Einen neuen, leeren Tisch bekommst du, wenn du die Seite ohne `#raum-…` in einem privaten Safari-Fenster öffnest.
- **Der Gratis-Tarif von Firebase («Spark») reicht locker.** Er erlaubt 50'000 Lese- und 20'000 Schreibvorgänge pro Tag. Ein Spiel braucht etwa 100 bis 200 Schreibvorgänge.
- **Ohne eingetragene Firebase-Werte läuft die Seite trotzdem**, dann aber nur auf einem Handy. Ihr gebt es nach jedem Zug weiter.

## Tests

Die Spielregeln in `game.js` haben eigene Tests. Sie brauchen nur Node.js (ab Version 18), sonst nichts:

```bash
node --test
```
