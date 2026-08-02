import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { Resend } from "resend";

const databaseId = process.env.FIRESTORE_DATABASE_ID || process.env.VITE_FIRESTORE_DATABASE_ID || "ferientausch";
const mailFrom = process.env.MAIL_FROM || "FerienTausch <noreply@ferientausch.app>";

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    }
  }

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

function getAdminServices() {
  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) {
    throw new Error("Firebase Admin credentials are missing.");
  }

  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId || process.env.VITE_FIREBASE_PROJECT_ID,
    });

  return {
    auth: getAuth(app),
    db: getFirestore(app, databaseId),
  };
}

async function readJsonBody(req) {
  if (req.body) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function formatRange(start, end) {
  return `${start || ""} bis ${end || ""}`;
}

function profileName(profile) {
  return [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || profile?.familyName || profile?.email || "Eine Familie";
}

async function getProfile(db, id) {
  if (!id) {
    return null;
  }

  const snapshot = await db.collection("profiles").doc(id).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function getHome(db, id) {
  if (!id) {
    return null;
  }

  const snapshot = await db.collection("homes").doc(id).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function getRequest(db, id) {
  if (!id) {
    return null;
  }

  const snapshot = await db.collection("exchangeRequests").doc(id).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function getAdminRecipients(db) {
  const snapshot = await db.collection("profiles").where("isAdmin", "==", true).get();
  const admins = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).filter((profile) => profile.email);
  const optedIn = admins.filter((profile) => profile.notifyOnNewRegistrations);
  return (optedIn.length ? optedIn : admins).map((profile) => profile.email);
}

function uniqueEmails(emails) {
  return Array.from(new Set((emails || []).filter(Boolean).map((email) => String(email).trim().toLowerCase())));
}

async function isAdmin(db, uid) {
  const profile = await getProfile(db, uid);
  return Boolean(profile?.isAdmin);
}

async function buildMail({ db, uid, payload }) {
  if (payload.type === "new-registration") {
    if (payload.profileId !== uid) {
      throw new Error("Registration notification profile mismatch.");
    }

    const profile = await getProfile(db, payload.profileId);
    return {
      to: await getAdminRecipients(db),
      subject: "Neue Registrierung bei FerienTausch",
      text: `${profileName(profile)} (${profile?.email || "ohne E-Mail"}) wartet auf Freigabe.`,
    };
  }

  if (payload.type === "profile-approved") {
    if (!(await isAdmin(db, uid))) {
      throw new Error("Only admins can send approval notifications.");
    }

    const profile = await getProfile(db, payload.profileId);
    return {
      to: [profile?.email],
      subject: "Dein FerienTausch-Profil wurde freigegeben",
      text: `Hallo ${profileName(profile)},\n\nDein Profil wurde freigegeben. Du kannst FerienTausch jetzt vollständig nutzen.`,
    };
  }

  const request = await getRequest(db, payload.requestId);
  if (!request) {
    throw new Error("Request not found.");
  }

  const actorIsParticipant = request.fromUserId === uid || request.toUserId === uid;
  const actorIsAdmin = await isAdmin(db, uid);
  if (!actorIsParticipant && !actorIsAdmin) {
    throw new Error("Not allowed for this request.");
  }

  const home = await getHome(db, request.homeId);
  const fromProfile = await getProfile(db, request.fromUserId);
  const toProfile = await getProfile(db, request.toUserId);

  if (payload.type === "exchange-request-created") {
    if (request.fromUserId !== uid) {
      throw new Error("Only the sender can send this notification.");
    }

    return {
      to: [toProfile?.email],
      subject: `Neue Tauschanfrage: ${home?.title || "FerienTausch"}`,
      text: `${profileName(fromProfile)} fragt ${home?.title || "deine Unterkunft"} für ${formatRange(request.start, request.end)} mit ${request.guests || 0} Personen an.`,
    };
  }

  if (payload.type === "request-status-changed") {
    const statusLabel = request.status === "accepted" ? "angenommen" : request.status === "declined" ? "abgelehnt" : "aktualisiert";
    return {
      to: [fromProfile?.email],
      subject: `Tauschanfrage ${statusLabel}`,
      text: `Deine Anfrage für ${home?.title || "eine Unterkunft"} (${formatRange(request.start, request.end)}) wurde ${statusLabel}.`,
    };
  }

  if (payload.type === "request-message-created") {
    const recipient = request.fromUserId === uid ? toProfile : fromProfile;
    return {
      to: [recipient?.email],
      subject: `Neue Nachricht zu ${home?.title || "deiner Tauschanfrage"}`,
      text: `Es gibt eine neue Nachricht zu ${home?.title || "einer Tauschanfrage"} (${formatRange(request.start, request.end)}).\n\n${String(payload.message || "").slice(0, 500)}`,
    };
  }

  throw new Error("Unknown notification type.");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ error: "RESEND_API_KEY is not configured." });
    }

    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) {
      return res.status(401).json({ error: "Missing Firebase token." });
    }

    const { auth, db } = getAdminServices();
    const decodedToken = await auth.verifyIdToken(token);
    const payload = await readJsonBody(req);
    const mail = await buildMail({ db, uid: decodedToken.uid, payload });
    const to = uniqueEmails(mail.to);

    if (!to.length) {
      return res.status(200).json({ skipped: true, reason: "No recipient email found." });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: mailFrom,
      to,
      subject: mail.subject,
      text: mail.text,
    });

    return res.status(200).json({ ok: true, id: result.data?.id });
  } catch (error) {
    console.error("send-mail failed", error);
    return res.status(400).json({ error: error.message || "Could not send email." });
  }
}
