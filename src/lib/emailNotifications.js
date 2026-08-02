import { auth, firebaseEnabled } from "./firebase";

export async function sendEmailNotification(payload) {
  if (!firebaseEnabled || !auth?.currentUser) {
    return;
  }

  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch("/api/send-mail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      console.warn("FerienTausch email notification skipped", result.error || response.statusText);
    }
  } catch (error) {
    console.warn("FerienTausch email notification failed", error);
  }
}
