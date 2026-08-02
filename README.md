# FerienTausch

Private React-App fuer Ferien- und Haustausch im Familien- und Freundeskreis.

## Funktionen

- Inserate mit Standort, Adresse, Gaestezahl, Schlafzimmern, Baedern, Ausstattung und Bildergalerie
- Verwaltung eigener Unterkuenfte unter `Mein Haus`
- Freie Reisezeitraeume mit Start- und Enddatum
- Suche nach Ort, Mindest-Gaesteanzahl und Reisedaten
- Smart Matcher fuer Zeitraum-Ueberschneidungen ab 3 Tagen
- Tauschanfragen mit Status und Nachrichtenverlauf
- Profile, Login/Registrierung und optionaler Gastzugang
- Admin-Zentrale fuer Mitglieder, Unterkuenfte, Dritt-Haeuser und Rechte

## Lokaler Start

```bash
npm install
npm run dev
```

Ohne Firebase-Konfiguration startet die App im Demo-Modus mit lokalen Beispieldaten im Browser-Storage.

## Firebase einrichten

1. Firebase-Projekt erstellen.
2. Authentication aktivieren: E-Mail/Passwort und optional Anonym.
3. Firestore Database erstellen.
4. Firestore-Regeln aus `firestore.rules` in der Firebase Console veroeffentlichen.
5. `.env.example` nach `.env.local` kopieren und Werte eintragen.

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Die App nutzt diese Collections:

- `profiles`
- `homes`
- `availabilities`
- `exchangeRequests`

Collections muessen nicht manuell angelegt werden. Firestore erstellt sie beim ersten Speichern automatisch.

### Ersten Admin setzen

Aus Sicherheitsgruenden vergibt die Web-App in Firebase keine Admin-Rechte automatisch. Vorgehen:

1. In der veroeffentlichten App ein erstes Konto registrieren.
2. Firebase Console oeffnen: Firestore Database -> Data -> `profiles`.
3. Das Profil-Dokument des ersten Nutzers oeffnen.
4. Feld `isAdmin` von `false` auf `true` setzen.
5. App neu laden.

Danach erscheint in der App die Admin-Zentrale.

## Vercel Deployment

Auf Vercel importieren, die gleichen Firebase-Variablen als Environment Variables setzen und mit dem Standard-Build deployen:

```bash
npm run build
```

## Hinweis zu Bildern

Die Galerie akzeptiert Bild-URLs und lokale Uploads als Browser-Daten-URL. Fuer produktive Nutzung mit sehr vielen Fotos empfiehlt sich Firebase Storage.
