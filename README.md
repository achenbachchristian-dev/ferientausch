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
4. Firebase Storage aktivieren.
5. Firestore-Regeln aus `firestore.rules` in der Firebase Console veroeffentlichen.
6. Storage-Regeln aus `storage.rules` in der Firebase Console veroeffentlichen.
7. `.env.example` nach `.env.local` kopieren und Werte eintragen.

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIRESTORE_DATABASE_ID=ferientausch
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

### Mailbenachrichtigungen mit Resend

Die App enthaelt eine Vercel Function unter `api/send-mail.js`. Sie verschickt E-Mails ueber Resend und prueft vorher das Firebase-ID-Token des angemeldeten Nutzers.

In Vercel muessen zusaetzlich gesetzt werden:

```bash
RESEND_API_KEY=...
MAIL_FROM="FerienTausch <noreply@deine-domain.de>"
FIREBASE_SERVICE_ACCOUNT_KEY=...
FIRESTORE_DATABASE_ID=ferientausch
```

`FIREBASE_SERVICE_ACCOUNT_KEY` ist der JSON-Inhalt eines Firebase-Service-Accounts. Alternativ kann der JSON-Inhalt base64-kodiert eingetragen werden.

Ausgeloest werden E-Mails bei:

- neuer Registrierung an Admins
- neuer Tauschanfrage an den Hauseigentuemer
- angenommener oder abgelehnter Anfrage an die anfragende Familie
- neuer Nachricht im Anfrageverlauf an die Gegenseite
- Profilfreigabe an den neuen Nutzer

## Hinweis zu Bildern

Die Galerie akzeptiert Bild-URLs. In Firebase werden lokale Uploads in Firebase Storage gespeichert und als Download-URL am Haus hinterlegt. Im Demo-Modus ohne Firebase nutzt die App weiterhin lokale Browser-Daten-URLs.
