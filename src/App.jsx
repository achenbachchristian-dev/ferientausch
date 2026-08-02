import { Component, useEffect, useMemo, useRef, useState } from "react";
import {
  Bath,
  BedDouble,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Filter,
  Home,
  ImagePlus,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Plus,
  ClipboardCheck,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import {
  auth,
  createUserWithEmailAndPassword,
  firebaseEnabled,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "./lib/firebase";
import { amenityOptions } from "./lib/demoData";
import {
  bookingFromRequest,
  findMatches,
  formatDateRange,
  getAcceptedBookings,
  getAvailabilityBookingState,
  getBookableAvailabilities,
  isRangeBookable,
  rangesOverlap,
} from "./lib/matching";
import {
  createId,
  loadLocalState,
  patchRecord,
  removeRecord,
  removeStorageFile,
  saveLocalState,
  saveRecord,
  subscribeCollection,
  subscribeRecord,
  subscribeRequestsForUser,
  uploadHomePhoto,
  uploadProfilePhoto,
} from "./lib/store";

const tabs = [
  { id: "dashboard", label: "Start", icon: LayoutDashboard },
  { id: "discover", label: "Entdecken", icon: Search },
  { id: "my-home", label: "Mein Haus", icon: Home },
  { id: "calendar", label: "Kalender", icon: CalendarDays },
  { id: "matcher", label: "Smart Matcher", icon: Sparkles },
  { id: "requests", label: "Anfragen", icon: Mail },
  { id: "profile", label: "Profil", icon: Users },
];

const blankHouse = {
  title: "",
  city: "",
  region: "",
  address: "",
  maxGuests: 4,
  bedrooms: 2,
  bathrooms: 1,
  description: "",
  amenities: ["WLAN", "Kinderfreundlich"],
  photos: [],
  isExternal: false,
};

const blankAvailability = {
  title: "",
  homeId: "",
  start: "",
  end: "",
};

const statusLabels = {
  pending: "Offen",
  accepted: "Angenommen",
  declined: "Abgelehnt",
};

const DEFAULT_INVITE_CODE = import.meta.env.VITE_INVITE_CODE || "ferien2026";
const discoverFilterAmenities = ["WLAN", "Garten", "Pool", "Sauna", "Haustiere erlaubt", "Kinderfreundlich", "Strandnähe", "ÖPNV in der Nähe"];
const profilePhotoFallback =
  "https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?auto=format&fit=crop&w=500&q=80";

const emptyState = {
  profiles: [],
  homes: [],
  availabilities: [],
  requests: [],
  bookings: [],
  auditLogs: [],
};

function getProfileName(profile) {
  if (!profile) {
    return "Unbekannt";
  }

  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  return fullName || profile.familyName || profile.email || "Unbekannt";
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function isProfileApproved(profile) {
  return Boolean(profile?.isAdmin || profile?.approved !== false);
}

function getProfilePhoto(profile) {
  return profile?.photoUrl || profilePhotoFallback;
}

function getPhone(profile) {
  return profile?.phone || "Nicht hinterlegt";
}

function mergeBookings(bookings = []) {
  const merged = new Map();
  bookings.forEach((booking) => {
    if (!booking?.homeId || !booking.start || !booking.end) {
      return;
    }
    merged.set(booking.requestId ?? booking.id, booking);
  });
  return Array.from(merged.values()).sort((first, second) => first.start.localeCompare(second.start));
}

function getHomeBookingStatus(bookableAvailabilities = [], bookings = []) {
  if (!bookings.length) {
    return null;
  }

  return bookableAvailabilities.length ? "partial" : "booked";
}

function getHomeAvailabilityMode(homeId, bookableAvailabilities = [], bookings = []) {
  const homeBookings = bookings.filter((booking) => booking.homeId === homeId);
  const homeBookable = bookableAvailabilities.filter((availability) => availability.homeId === homeId);
  const bookingStatus = getHomeBookingStatus(homeBookable, homeBookings);

  if (bookingStatus === "booked") {
    return "booked";
  }

  if (bookingStatus === "partial") {
    return "partial";
  }

  return homeBookable.length ? "free" : "none";
}

function getMonthDays(year, monthIndex) {
  const firstDate = new Date(year, monthIndex, 1);
  const startOffset = (firstDate.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      iso: date.toISOString().slice(0, 10),
      label: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
    };
  });
}

function getCalendarDayStatus(homeId, isoDate, availabilities = [], bookings = []) {
  const dayRange = { start: isoDate, end: isoDate };
  const available = availabilities.some((availability) => availability.homeId === homeId && rangesOverlap(availability, dayRange));
  const booked = bookings.some((booking) => booking.homeId === homeId && rangesOverlap(booking, dayRange));

  if (booked) {
    return "booked";
  }

  return available ? "free" : "none";
}

function isValidDateRange(start, end) {
  return Boolean(start && end && start <= end);
}

function overlapsExistingRange(range, ranges = []) {
  return ranges.some((entry) => entry.id !== range.id && entry.homeId === range.homeId && rangesOverlap(entry, range));
}

function getHomeQualityIssues(home) {
  const issues = [];
  if (!home.title) issues.push("Titel fehlt");
  if (!home.city) issues.push("Ort fehlt");
  if (!home.region) issues.push("Region fehlt");
  if (!home.address) issues.push("Adresse fehlt");
  if (!home.description || home.description.length < 40) issues.push("Beschreibung zu kurz");
  if (!getHomePhotos(home).length) issues.push("Keine Bilder");
  if ((home.amenities ?? []).length < 5) issues.push("Wenig Ausstattung");
  if (!Number(home.maxGuests) || !Number(home.bedrooms) || !Number(home.bathrooms)) issues.push("Basisdaten unvollständig");
  return issues;
}

function getProfileQualityIssues(profile) {
  const issues = [];
  if (!profile.firstName) issues.push("Vorname fehlt");
  if (!profile.lastName) issues.push("Nachname fehlt");
  if (!profile.city) issues.push("Wohnort fehlt");
  if (!profile.email) issues.push("E-Mail fehlt");
  if (!profile.description || profile.description.length < 25) issues.push("Beschreibung zu kurz");
  if (!profile.photoUrl) issues.push("Profilbild fehlt");
  return issues;
}

function getCompletionScore(issues, totalChecks) {
  return Math.max(0, Math.round(((totalChecks - issues.length) / totalChecks) * 100));
}

function mailtoLink(to, subject, body) {
  return `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function requestEmailDraft(request, home, from, to) {
  const recipient = to?.email || from?.email || "";
  const subject = `FerienTausch: Anfrage für ${home?.title ?? "eine Unterkunft"}`;
  const body = [
    `Hallo ${to ? getProfileName(to) : "zusammen"},`,
    "",
    `${getProfileName(from)} hat eine Tauschanfrage für ${home?.title ?? "deine Unterkunft"} gestellt.`,
    `Zeitraum: ${formatDateRange(request.start, request.end)}`,
    `Personen: ${request.guests}`,
    "",
    "Bitte prüfe die Anfrage in FerienTausch.",
  ].join("\n");
  return mailtoLink(recipient, subject, body);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toIcalDate(date) {
  return date.replaceAll("-", "");
}

function addOneDayIso(date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

function downloadIcal(home, availabilities = [], bookings = []) {
  if (!home) {
    return;
  }

  const events = [
    ...availabilities
      .filter((availability) => availability.homeId === home.id)
      .map((availability) => ({
        id: availability.id,
        title: `Frei: ${home.title}`,
        start: availability.start,
        end: availability.end,
      })),
    ...bookings
      .filter((booking) => booking.homeId === home.id)
      .map((booking) => ({
        id: booking.id,
        title: `Gebucht: ${home.title}`,
        start: booking.start,
        end: booking.end,
      })),
  ];

  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FerienTausch//DE",
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${event.id}@ferientausch`,
      `SUMMARY:${event.title}`,
      `DTSTART;VALUE=DATE:${toIcalDate(event.start)}`,
      `DTEND;VALUE=DATE:${toIcalDate(addOneDayIso(event.end))}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ical], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${home.title || "ferientausch"}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function getHomePhotos(home) {
  return Array.isArray(home?.photos) ? home.photos.filter(Boolean) : [];
}

function getHomeCoverPhoto(home) {
  const photos = getHomePhotos(home);
  if (!photos.length) {
    return "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1200&q=80";
  }

  const coverIndex = Number.isFinite(Number(home.coverPhotoIndex)) ? Number(home.coverPhotoIndex) : 0;
  return photos[Math.min(Math.max(coverIndex, 0), photos.length - 1)] ?? photos[0];
}

function getPhotoCaptions(home) {
  const photos = getHomePhotos(home);
  const captions = Array.isArray(home?.photoCaptions) ? home.photoCaptions : [];
  return photos.map((_, index) => captions[index] ?? "");
}

function getPhotoCaption(home, index) {
  return getPhotoCaptions(home)[index] ?? "";
}

function moveArrayItem(items, fromIndex, toIndex) {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function App() {
  const [state, setState] = useState(() => (firebaseEnabled ? emptyState : loadLocalState()));
  const [currentUserId, setCurrentUserId] = useState(() =>
    firebaseEnabled ? null : window.localStorage.getItem("ferientausch-current-user"),
  );
  const [authChecked, setAuthChecked] = useState(!firebaseEnabled);
  const [firebaseError, setFirebaseError] = useState("");
  const [appNotice, setAppNotice] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [authMode, setAuthMode] = useState("login");
  const [requestDraft, setRequestDraft] = useState(null);
  const [selectedHomeId, setSelectedHomeId] = useState(null);
  const [query, setQuery] = useState("");
  const [minGuests, setMinGuests] = useState("");
  const [minBedrooms, setMinBedrooms] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [holidayFilter, setHolidayFilter] = useState("");
  const [quickFilters, setQuickFilters] = useState([]);
  const [travelStart, setTravelStart] = useState("");
  const [travelEnd, setTravelEnd] = useState("");
  const [selectedAmenities, setSelectedAmenities] = useState([]);
  const [availabilityMode, setAvailabilityMode] = useState("all");
  const [adminSection, setAdminSection] = useState("overview");
  const [inviteCode, setInviteCode] = useState(
    () => window.localStorage.getItem("ferientausch-invite-code") || DEFAULT_INVITE_CODE,
  );
  const knownProfileIdsRef = useRef(new Set());

  useEffect(() => {
    if (!firebaseEnabled) {
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setCurrentUserId(firebaseUser?.uid ?? null);
      setAuthChecked(true);
      if (firebaseUser?.uid) {
        window.localStorage.setItem("ferientausch-current-user", firebaseUser.uid);
      } else {
        window.localStorage.removeItem("ferientausch-current-user");
      }
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!firebaseEnabled) {
      return;
    }

    return subscribeRecord(
      "settings",
      "public",
      (settings) => {
        const nextCode = String(settings?.inviteCode || DEFAULT_INVITE_CODE).trim() || DEFAULT_INVITE_CODE;
        setInviteCode(nextCode);
        window.localStorage.setItem("ferientausch-invite-code", nextCode);
      },
      () => {
        setInviteCode(window.localStorage.getItem("ferientausch-invite-code") || DEFAULT_INVITE_CODE);
      },
    );
  }, []);

  const currentProfile = useMemo(
    () => state.profiles.find((profile) => profile.id === currentUserId),
    [currentUserId, state.profiles],
  );

  useEffect(() => {
    if (!currentProfile?.isAdmin) {
      knownProfileIdsRef.current = new Set(state.profiles.map((profile) => profile.id));
      return;
    }

    if (!knownProfileIdsRef.current.size) {
      knownProfileIdsRef.current = new Set(state.profiles.map((profile) => profile.id));
      return;
    }

    const newProfiles = state.profiles.filter((profile) => !knownProfileIdsRef.current.has(profile.id));
    knownProfileIdsRef.current = new Set(state.profiles.map((profile) => profile.id));

    if (!currentProfile.notifyOnNewRegistrations || !newProfiles.length) {
      return;
    }

    const names = newProfiles.map(getProfileName).join(", ");
    const message = newProfiles.length === 1 ? `Neue Registrierung: ${names}` : `Neue Registrierungen: ${names}`;
    setAppNotice(message);

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("FerienTausch", { body: message });
    }
  }, [currentProfile, state.profiles]);

  useEffect(() => {
    if (!firebaseEnabled || !currentUserId) {
      return;
    }

    const handleError = (error) => setFirebaseError(formatFirebaseError(error));
    const unsubscribers = [
      subscribeCollection("profiles", (profiles) => setState((current) => ({ ...current, profiles })), handleError),
      subscribeCollection("homes", (homes) => setState((current) => ({ ...current, homes })), handleError),
      subscribeCollection(
        "availabilities",
        (availabilities) => setState((current) => ({ ...current, availabilities })),
        handleError,
      ),
      subscribeCollection("bookings", (bookings) => setState((current) => ({ ...current, bookings })), handleError),
    ];

    if (currentProfile?.isAdmin) {
      unsubscribers.push(
        subscribeCollection(
          "auditLogs",
          (auditLogs) => setState((current) => ({ ...current, auditLogs })),
          handleError,
        ),
      );
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [currentProfile?.isAdmin, currentUserId]);

  useEffect(() => {
    if (!firebaseEnabled || !currentUserId) {
      return;
    }

    return subscribeRequestsForUser(
      currentUserId,
      Boolean(currentProfile?.isAdmin),
      (requests) => setState((current) => ({ ...current, requests })),
      (error) => setFirebaseError(formatFirebaseError(error)),
    );
  }, [currentProfile?.isAdmin, currentUserId]);

  useEffect(() => {
    if (!firebaseEnabled || !currentUserId || currentProfile || !auth?.currentUser) {
      return;
    }

    const repairTimer = window.setTimeout(async () => {
      try {
        setFirebaseError("");
        const email = auth.currentUser.email ?? "";
        const fallbackName = email ? email.split("@")[0] : "Neue Familie";
        await saveRecord("profiles", {
          id: currentUserId,
          firstName: auth.currentUser.displayName || fallbackName,
          lastName: "",
          familyName: auth.currentUser.displayName || fallbackName,
          city: "",
          email,
          description: "Neu im FerienTausch.",
          isAdmin: false,
        });
      } catch (error) {
        setFirebaseError(formatFirebaseError(error));
      }
    }, 2500);

    return () => window.clearTimeout(repairTimer);
  }, [currentProfile, currentUserId]);

  const ownedHomes = useMemo(() => {
    if (!currentProfile) {
      return [];
    }

    return state.homes.filter((home) => home.ownerId === currentProfile.id || home.managedBy === currentProfile.id);
  }, [currentProfile, state.homes]);

  const acceptedBookings = useMemo(
    () => mergeBookings([...(state.bookings ?? []), ...getAcceptedBookings(state.requests)]),
    [state.bookings, state.requests],
  );

  const bookableAvailabilities = useMemo(
    () => getBookableAvailabilities(state.availabilities, acceptedBookings),
    [acceptedBookings, state.availabilities],
  );

  const matches = useMemo(() => {
    if (!currentProfile) {
      return [];
    }

    return findMatches(state.availabilities, state.homes, currentProfile.id, acceptedBookings);
  }, [acceptedBookings, currentProfile, state.availabilities, state.homes]);

  const visibleRequests = useMemo(() => {
    if (!currentProfile) {
      return [];
    }

    return state.requests.filter(
      (request) =>
        request.fromUserId === currentProfile.id ||
        request.toUserId === currentProfile.id ||
        currentProfile.isAdmin,
    );
  }, [currentProfile, state.requests]);

  const openRequests = useMemo(
    () => visibleRequests.filter((request) => request.status === "pending"),
    [visibleRequests],
  );

  const filteredHomes = useMemo(() => {
    return state.homes.filter((home) => {
      const textMatch = `${home.title} ${home.city} ${home.region ?? ""} ${home.address} ${home.description} ${(home.amenities ?? []).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase());
      const guestMatch = !minGuests || Number(home.maxGuests) >= Number(minGuests);
      const bedroomMatch = !minBedrooms || Number(home.bedrooms) >= Number(minBedrooms);
      const regionMatch =
        !regionFilter ||
        `${home.region ?? ""} ${home.city} ${home.address}`.toLowerCase().includes(regionFilter.toLowerCase());
      const amenitiesMatch = selectedAmenities.every((amenity) => (home.amenities ?? []).includes(amenity));
      const quickMatch = quickFilters.every((filter) => (home.amenities ?? []).includes(filter));
      const holidayMatch =
        !holidayFilter ||
        state.availabilities
          .filter((availability) => availability.homeId === home.id)
          .some((availability) =>
            `${availability.title} ${availability.start} ${availability.end}`
              .toLowerCase()
              .includes(holidayFilter.toLowerCase()),
          );
      const dateMatch =
        !travelStart ||
        !travelEnd ||
        isRangeBookable(home.id, travelStart, travelEnd, state.availabilities, acceptedBookings);
      const mode = getHomeAvailabilityMode(home.id, bookableAvailabilities, acceptedBookings);
      const availabilityMatch =
        availabilityMode === "all" ||
        (availabilityMode === "available" && (mode === "free" || mode === "partial")) ||
        availabilityMode === mode;

      return (
        textMatch &&
        guestMatch &&
        bedroomMatch &&
        regionMatch &&
        amenitiesMatch &&
        quickMatch &&
        holidayMatch &&
        dateMatch &&
        availabilityMatch
      );
    });
  }, [
    acceptedBookings,
    availabilityMode,
    bookableAvailabilities,
    holidayFilter,
    minBedrooms,
    minGuests,
    query,
    quickFilters,
    regionFilter,
    selectedAmenities,
    state.availabilities,
    state.homes,
    travelEnd,
    travelStart,
  ]);

  function updateState(updater) {
    setState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (!firebaseEnabled) {
        saveLocalState(next);
      }
      return next;
    });
  }

  async function logAudit(action, targetType, targetId, details = "") {
    if (!currentProfile) {
      return;
    }

    const entry = {
      id: createId("audit"),
      actorId: currentProfile.id,
      action,
      targetType,
      targetId,
      details,
      createdAt: new Date().toISOString(),
    };

    try {
      await saveRecord("auditLogs", entry);
      updateState((current) => ({
        ...current,
        auditLogs: [entry, ...(current.auditLogs ?? [])].slice(0, 100),
      }));
    } catch {
      // Audit logs should never block the user's actual action.
    }
  }

  async function saveInviteCode(nextCode) {
    const normalizedCode = String(nextCode ?? "").trim();
    if (normalizedCode.length < 4) {
      setFirebaseError("Der Einladungscode sollte mindestens 4 Zeichen lang sein.");
      return;
    }

    try {
      setFirebaseError("");
      setInviteCode(normalizedCode);
      window.localStorage.setItem("ferientausch-invite-code", normalizedCode);

      if (firebaseEnabled) {
        await saveRecord("settings", {
          id: "public",
          inviteCode: normalizedCode,
          updatedAt: new Date().toISOString(),
          updatedBy: currentProfile?.id ?? "",
        });
      }

      setAppNotice("Einladungscode gespeichert.");
      await logAudit("Einladungscode geändert", "settings", "public");
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function handleAuthSubmit(event, form) {
    event.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();
    const submittedInviteCode = String(formData.get("inviteCode") ?? "").trim();
    const familyName = [firstName, lastName].filter(Boolean).join(" ");

    if (authMode === "register" && submittedInviteCode !== inviteCode) {
      setFirebaseError("Der Einladungscode ist nicht korrekt.");
      return;
    }

    if (firebaseEnabled) {
      try {
        setFirebaseError("");
        if (authMode === "register") {
          const credentials = await createUserWithEmailAndPassword(auth, email, password);
          const profile = {
            id: credentials.user.uid,
            firstName,
            lastName,
            familyName,
            city,
            email,
            description: "Neu im FerienTausch.",
            isAdmin: false,
            approved: false,
          };
          await saveRecord("profiles", profile);
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
      } catch (error) {
        setFirebaseError(formatFirebaseError(error));
      }
      return;
    }

    if (authMode === "register") {
      const profile = {
        id: createId("family"),
        firstName,
        lastName,
        familyName,
        city,
        email,
        description: "Neu im FerienTausch.",
        isAdmin: state.profiles.length === 0,
        approved: state.profiles.length === 0,
      };
      updateState((current) => ({ ...current, profiles: [...current.profiles, profile] }));
      setCurrentUserId(profile.id);
      window.localStorage.setItem("ferientausch-current-user", profile.id);
      return;
    }

    const profile = state.profiles.find((entry) => entry.email.toLowerCase() === email) ?? state.profiles[0];
    setCurrentUserId(profile.id);
    window.localStorage.setItem("ferientausch-current-user", profile.id);
  }

  async function handleAnonymousLogin() {
    if (firebaseEnabled) {
      try {
        setFirebaseError("");
        const credentials = await signInAnonymously(auth);
        const guestProfile = {
          id: credentials.user.uid,
          firstName: "Gast",
          lastName: "",
          familyName: "Gastfamilie",
          city: "",
          email: "",
          description: "Anonymer Gastzugang.",
          isAdmin: false,
          approved: true,
        };
        await saveRecord("profiles", guestProfile);
      } catch (error) {
        setFirebaseError(formatFirebaseError(error));
      }
      return;
    }

    const profile = state.profiles[0];
    setCurrentUserId(profile.id);
    window.localStorage.setItem("ferientausch-current-user", profile.id);
  }

  async function handleLogout() {
    if (firebaseEnabled) {
      await signOut(auth);
    }
    setCurrentUserId(null);
    window.localStorage.removeItem("ferientausch-current-user");
  }

  async function upsertHome(home) {
    try {
      setFirebaseError("");
      const previousHome = state.homes.find((entry) => entry.id === home.id);
      const previousPhotos = getHomePhotos(previousHome);
      const photos = getHomePhotos(home);
      const photoCaptions = getPhotoCaptions(home).slice(0, photos.length);
      const normalized = {
        ...home,
        maxGuests: Number(home.maxGuests),
        bedrooms: Number(home.bedrooms),
        bathrooms: Number(home.bathrooms),
        managedBy: home.managedBy ?? currentProfile.id,
        ownerId: home.ownerId ?? currentProfile.id,
        photos,
        photoCaptions,
        coverPhotoIndex: Math.min(
          Math.max(Number(home.coverPhotoIndex ?? 0), 0),
          Math.max(photos.length - 1, 0),
        ),
      };

      await saveRecord("homes", normalized);
      await Promise.all(
        previousPhotos
          .filter((photo) => !photos.includes(photo))
          .map((photo) => removeStorageFile(photo).catch(() => null)),
      );
      updateState((current) => {
        const exists = current.homes.some((entry) => entry.id === normalized.id);
        return {
          ...current,
          homes: exists
            ? current.homes.map((entry) => (entry.id === normalized.id ? normalized : entry))
            : [...current.homes, normalized],
        };
      });
      await logAudit(previousHome ? "Unterkunft geändert" : "Unterkunft erstellt", "home", normalized.id, normalized.title);
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function saveAvailability(availability) {
    try {
      setFirebaseError("");
      if (!isValidDateRange(availability.start, availability.end)) {
        setFirebaseError("Bitte wähle einen gültigen Zeitraum aus.");
        return;
      }

      const home = state.homes.find((entry) => entry.id === availability.homeId);
      if (!home) {
        setFirebaseError("Bitte wähle eine Unterkunft aus.");
        return;
      }

      const normalized = {
        ...availability,
        ownerId: home?.ownerId ?? currentProfile.id,
      };

      if (overlapsExistingRange(normalized, state.availabilities)) {
        setFirebaseError("Dieser freie Zeitraum überschneidet sich mit einem bestehenden Zeitraum.");
        return;
      }

      await saveRecord("availabilities", normalized);
      updateState((current) => {
        const exists = current.availabilities.some((entry) => entry.id === normalized.id);
        return {
          ...current,
          availabilities: exists
            ? current.availabilities.map((entry) => (entry.id === normalized.id ? normalized : entry))
            : [...current.availabilities, normalized],
        };
      });
      await logAudit("Freier Zeitraum gespeichert", "availability", normalized.id, normalized.title);
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function deleteAvailability(id) {
    try {
      setFirebaseError("");
      await removeRecord("availabilities", id);
      updateState((current) => ({
        ...current,
        availabilities: current.availabilities.filter((availability) => availability.id !== id),
      }));
      await logAudit("Freier Zeitraum gelöscht", "availability", id);
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function createRequest(draft) {
    try {
      setFirebaseError("");
      const targetHome = state.homes.find((home) => home.id === draft.homeId);
      if (!targetHome) {
        setFirebaseError("Diese Unterkunft wurde nicht gefunden.");
        return;
      }

      if (!isValidDateRange(draft.start, draft.end)) {
        setFirebaseError("Bitte wähle einen gültigen Reisezeitraum aus.");
        return;
      }

      const guests = Number(draft.guests);
      if (!Number.isFinite(guests) || guests < 1 || guests > Number(targetHome.maxGuests)) {
        setFirebaseError(`Bitte wähle eine Personenanzahl zwischen 1 und ${targetHome.maxGuests}.`);
        return;
      }

      if (!isRangeBookable(draft.homeId, draft.start, draft.end, state.availabilities, acceptedBookings)) {
        setFirebaseError("Dieser Zeitraum ist nicht mehr verfügbar. Bitte wähle freie Tage aus.");
        return;
      }

      const hasDuplicatePendingRequest = state.requests.some(
        (request) =>
          request.fromUserId === currentProfile.id &&
          request.homeId === draft.homeId &&
          request.status === "pending" &&
          rangesOverlap(request, draft),
      );

      if (hasDuplicatePendingRequest) {
        setFirebaseError("Für diesen Zeitraum gibt es bereits eine offene Anfrage von dir.");
        return;
      }

      const request = {
        id: createId("request"),
        fromUserId: currentProfile.id,
        toUserId: targetHome.ownerId,
        homeId: draft.homeId,
        start: draft.start,
        end: draft.end,
        guests,
        status: "pending",
        messages: [
          {
            authorId: currentProfile.id,
            text: draft.message || "Wir würden diesen Zeitraum gern tauschen.",
            createdAt: new Date().toISOString(),
          },
        ],
      };

      await saveRecord("exchangeRequests", request);
      updateState((current) => ({ ...current, requests: [...current.requests, request] }));
      await logAudit("Tauschanfrage erstellt", "request", request.id, targetHome.title);
      setRequestDraft(null);
      setActiveTab("requests");
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function declineConflictingPendingRequests(acceptedRequest) {
    const conflicts = state.requests.filter(
      (request) =>
        request.id !== acceptedRequest.id &&
        request.homeId === acceptedRequest.homeId &&
        request.status === "pending" &&
        rangesOverlap(request, acceptedRequest),
    );

    await Promise.all(
      conflicts.map((request) =>
        patchRecord("exchangeRequests", request.id, {
          status: "declined",
          conflictReason: `Automatisch abgelehnt, weil ${formatDateRange(acceptedRequest.start, acceptedRequest.end)} gebucht wurde.`,
        }),
      ),
    );

    return conflicts.map((request) => request.id);
  }

  async function updateRequestStatus(id, status) {
    try {
      setFirebaseError("");
      const existing = state.requests.find((request) => request.id === id);
      if (!existing) {
        setFirebaseError("Diese Anfrage wurde nicht gefunden.");
        return;
      }

      if (
        status === "accepted" &&
        !isRangeBookable(
          existing.homeId,
          existing.start,
          existing.end,
          state.availabilities,
          acceptedBookings.filter((booking) => booking.requestId !== id),
        )
      ) {
        setFirebaseError("Dieser Zeitraum ist inzwischen gebucht oder nicht mehr frei.");
        return;
      }

      const nextRequest = { ...existing, status };
      await patchRecord("exchangeRequests", id, { status });
      const declinedConflictIds = status === "accepted" ? await declineConflictingPendingRequests(nextRequest) : [];
      if (status === "accepted") {
        await saveRecord("bookings", bookingFromRequest(nextRequest));
      } else {
        await removeRecord("bookings", `booking-${id}`);
      }
      updateState((current) => ({
        ...current,
        requests: current.requests.map((request) => {
          if (request.id === id) {
            return { ...request, status };
          }
          if (declinedConflictIds.includes(request.id)) {
            return { ...request, status: "declined", conflictReason: "Automatisch wegen überschneidender Buchung abgelehnt." };
          }
          return request;
        }),
        bookings:
          status === "accepted"
            ? mergeBookings([...(current.bookings ?? []).filter((booking) => booking.requestId !== id), bookingFromRequest(nextRequest)])
            : (current.bookings ?? []).filter((booking) => booking.requestId !== id),
      }));
      await logAudit(`Tauschanfrage ${statusLabels[status] ?? status}`, "request", id);
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function saveRequestDetails(id, updates) {
    try {
      setFirebaseError("");
      const normalized = {
        ...updates,
        guests: Number(updates.guests),
      };
      const existing = state.requests.find((request) => request.id === id);
      if (!existing) {
        setFirebaseError("Diese Anfrage wurde nicht gefunden.");
        return;
      }

      const nextRequest = { ...existing, ...normalized };
      const targetHome = state.homes.find((home) => home.id === nextRequest.homeId);
      if (!targetHome) {
        setFirebaseError("Diese Unterkunft wurde nicht gefunden.");
        return;
      }

      if (!isValidDateRange(nextRequest.start, nextRequest.end)) {
        setFirebaseError("Bitte wähle einen gültigen Reisezeitraum aus.");
        return;
      }

      if (
        !Number.isFinite(nextRequest.guests) ||
        nextRequest.guests < 1 ||
        nextRequest.guests > Number(targetHome.maxGuests)
      ) {
        setFirebaseError(`Bitte wähle eine Personenanzahl zwischen 1 und ${targetHome.maxGuests}.`);
        return;
      }

      if (
        nextRequest.status === "accepted" &&
        !isRangeBookable(
          nextRequest.homeId,
          nextRequest.start,
          nextRequest.end,
          state.availabilities,
          acceptedBookings.filter((booking) => booking.requestId !== id),
        )
      ) {
        setFirebaseError("Dieser Zeitraum ist inzwischen gebucht oder nicht mehr frei.");
        return;
      }

      await patchRecord("exchangeRequests", id, normalized);
      const declinedConflictIds =
        nextRequest.status === "accepted" ? await declineConflictingPendingRequests(nextRequest) : [];
      if (nextRequest.status === "accepted") {
        await saveRecord("bookings", bookingFromRequest(nextRequest));
      } else {
        await removeRecord("bookings", `booking-${id}`);
      }
      updateState((current) => ({
        ...current,
        requests: current.requests.map((request) => {
          if (request.id === id) {
            return { ...request, ...normalized };
          }
          if (declinedConflictIds.includes(request.id)) {
            return { ...request, status: "declined", conflictReason: "Automatisch wegen überschneidender Buchung abgelehnt." };
          }
          return request;
        }),
        bookings:
          nextRequest.status === "accepted"
            ? mergeBookings([...(current.bookings ?? []).filter((booking) => booking.requestId !== id), bookingFromRequest(nextRequest)])
            : (current.bookings ?? []).filter((booking) => booking.requestId !== id),
      }));
      await logAudit("Tauschanfrage bearbeitet", "request", id);
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function deleteRequest(id) {
    try {
      setFirebaseError("");
      const existing = state.requests.find((request) => request.id === id);
      await removeRecord("exchangeRequests", id);
      const shouldDeleteBooking = currentProfile.isAdmin && existing?.status === "accepted";
      if (shouldDeleteBooking) {
        await removeRecord("bookings", `booking-${id}`);
      }
      updateState((current) => ({
        ...current,
        requests: current.requests.filter((request) => request.id !== id),
        bookings: shouldDeleteBooking
          ? (current.bookings ?? []).filter((booking) => booking.requestId !== id)
          : current.bookings ?? [],
      }));
      await logAudit("Tauschanfrage gelöscht", "request", id);
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function addRequestMessage(id, text) {
    try {
      setFirebaseError("");
      const request = state.requests.find((entry) => entry.id === id);
      const messages = [
        ...request.messages,
        {
          authorId: currentProfile.id,
          text,
          createdAt: new Date().toISOString(),
        },
      ];
      await patchRecord("exchangeRequests", id, { messages });
      updateState((current) => ({
        ...current,
        requests: current.requests.map((entry) => (entry.id === id ? { ...entry, messages } : entry)),
      }));
      await logAudit("Nachricht geschrieben", "request", id);
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function saveProfile(profile) {
    try {
      setFirebaseError("");
      const previousProfile = state.profiles.find((entry) => entry.id === profile.id);
      await saveRecord("profiles", profile);
      if (previousProfile?.photoUrl && previousProfile.photoUrl !== profile.photoUrl) {
        await removeStorageFile(previousProfile.photoUrl).catch(() => null);
      }
      updateState((current) => ({
        ...current,
        profiles: current.profiles.map((entry) => (entry.id === profile.id ? profile : entry)),
      }));
      await logAudit("Profil gespeichert", "profile", profile.id, getProfileName(profile));
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function toggleAdmin(profileId) {
    const profile = state.profiles.find((entry) => entry.id === profileId);
    const next = { ...profile, isAdmin: !profile.isAdmin };
    await saveProfile(next);
  }

  async function toggleProfileApproval(profileId) {
    const profile = state.profiles.find((entry) => entry.id === profileId);
    const approving = !isProfileApproved(profile);
    const next = {
      ...profile,
      approved: approving,
      approvedAt: approving ? new Date().toISOString() : "",
      approvedBy: approving ? currentProfile.id : "",
    };
    await saveProfile(next);
  }

  async function deleteHome(id) {
    try {
      setFirebaseError("");
      const existingHome = state.homes.find((home) => home.id === id);
      await removeRecord("homes", id);
      await Promise.all(
        state.availabilities
          .filter((availability) => availability.homeId === id)
          .map((availability) => removeRecord("availabilities", availability.id).catch(() => null)),
      );
      await Promise.all(getHomePhotos(existingHome).map((photo) => removeStorageFile(photo).catch(() => null)));
      updateState((current) => ({
        ...current,
        homes: current.homes.filter((home) => home.id !== id),
        availabilities: current.availabilities.filter((availability) => availability.homeId !== id),
      }));
      await logAudit("Unterkunft gelöscht", "home", id, existingHome?.title ?? "");
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function deleteProfile(id) {
    try {
      setFirebaseError("");
      const ownedProfileHomes = state.homes.filter((home) => home.ownerId === id);
      await removeRecord("profiles", id);
      await Promise.all(ownedProfileHomes.map((home) => removeRecord("homes", home.id).catch(() => null)));
      await Promise.all(
        state.availabilities
          .filter((availability) => ownedProfileHomes.some((home) => home.id === availability.homeId))
          .map((availability) => removeRecord("availabilities", availability.id).catch(() => null)),
      );
      await Promise.all(
        ownedProfileHomes
          .flatMap((home) => getHomePhotos(home))
          .map((photo) => removeStorageFile(photo).catch(() => null)),
      );
      updateState((current) => ({
        ...current,
        profiles: current.profiles.filter((profile) => profile.id !== id),
        homes: current.homes.filter((home) => home.ownerId !== id),
        availabilities: current.availabilities.filter(
          (availability) => !ownedProfileHomes.some((home) => home.id === availability.homeId),
        ),
      }));
      await logAudit("Profil gelöscht", "profile", id);
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }
  }

  async function handleHomePhotoUpload(homeId, file) {
    try {
      setFirebaseError("");
      const uploadedUrl = await uploadHomePhoto(homeId, file);
      if (uploadedUrl) {
        return uploadedUrl;
      }
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }

    return fileToDataUrl(file);
  }

  async function handleProfilePhotoUpload(profileId, file) {
    try {
      setFirebaseError("");
      const uploadedUrl = await uploadProfilePhoto(profileId, file);
      if (uploadedUrl) {
        return uploadedUrl;
      }
    } catch (error) {
      setFirebaseError(formatFirebaseError(error));
    }

    return fileToDataUrl(file);
  }

  if (firebaseEnabled && !authChecked) {
    return <LoadingScreen title="Firebase wird verbunden" text="Einen Moment, die Anmeldung wird geprüft." />;
  }

  if (!currentProfile) {
    if (firebaseEnabled && currentUserId) {
      return (
        <LoadingScreen
          title="Profil wird geladen"
          text="Falls diese Ansicht bleibt, prüfe die Firestore-Regeln und ob dein Profil-Dokument existiert."
          error={firebaseError}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <AuthScreen
        authMode={authMode}
        error={firebaseError}
        onAuthModeChange={setAuthMode}
        onSubmit={handleAuthSubmit}
        onAnonymous={handleAnonymousLogin}
      />
    );
  }

  if (!isProfileApproved(currentProfile)) {
    return <ApprovalPendingScreen profile={currentProfile} onLogout={handleLogout} />;
  }

  return (
    <div className="min-h-screen bg-[#f5f3ee] pb-20 text-[#24313a] md:pb-0">
      <header className="sticky top-0 z-20 border-b border-[#ded8cb] bg-white/95 shadow-[0_10px_30px_rgba(36,49,58,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-white px-3 py-2">
              <img className="h-12 w-auto max-w-[240px] object-contain" src="/logo-wordmark.png" alt="FerienTausch" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg bg-[#f8faf5] px-3 py-2">
              <img className="h-9 w-9 rounded-lg object-cover" src={getProfilePhoto(currentProfile)} alt="" />
              <div className="text-right">
                <p className="text-sm font-bold text-[#24313a]">{getProfileName(currentProfile)}</p>
                <p className="text-xs text-[#66756d]">{currentProfile.city || "Freundeskreis"}</p>
              </div>
            </div>
            <IconButton label="Abmelden" onClick={handleLogout}>
              <LogOut size={18} />
            </IconButton>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
          {[...tabs, ...(currentProfile.isAdmin ? [{ id: "admin", label: "Admin", icon: ShieldCheck }] : [])].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${
                  active ? "bg-[#24313a] text-white shadow-soft" : "bg-[#f8faf5] text-[#4f5d55] hover:bg-[#edf1e8]"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={17} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {appNotice && <AppNoticeBanner message={appNotice} onDismiss={() => setAppNotice("")} />}
        {firebaseError && <FirebaseErrorBanner message={firebaseError} onDismiss={() => setFirebaseError("")} />}
        <ViewErrorBoundary resetKey={activeTab}>
        {activeTab === "dashboard" && (
          <DashboardView
            currentProfile={currentProfile}
            ownedHomes={ownedHomes}
            homes={state.homes}
            availabilities={bookableAvailabilities}
            requests={visibleRequests}
            openRequests={openRequests}
            matches={matches}
            profiles={state.profiles}
            onNavigate={setActiveTab}
            onDetails={setSelectedHomeId}
            onRequest={setRequestDraft}
          />
        )}
        {activeTab === "discover" && (
          <DiscoverView
            homes={filteredHomes}
            allAvailabilities={state.availabilities}
            bookableAvailabilities={bookableAvailabilities}
            bookings={acceptedBookings}
            currentProfile={currentProfile}
            query={query}
            setQuery={setQuery}
            minGuests={minGuests}
            setMinGuests={setMinGuests}
            minBedrooms={minBedrooms}
            setMinBedrooms={setMinBedrooms}
            regionFilter={regionFilter}
            setRegionFilter={setRegionFilter}
            holidayFilter={holidayFilter}
            setHolidayFilter={setHolidayFilter}
            quickFilters={quickFilters}
            setQuickFilters={setQuickFilters}
            selectedAmenities={selectedAmenities}
            setSelectedAmenities={setSelectedAmenities}
            availabilityMode={availabilityMode}
            setAvailabilityMode={setAvailabilityMode}
            travelStart={travelStart}
            setTravelStart={setTravelStart}
            travelEnd={travelEnd}
            setTravelEnd={setTravelEnd}
            onRequest={setRequestDraft}
            onDetails={setSelectedHomeId}
          />
        )}
        {activeTab === "my-home" && (
          <MyHomeView homes={ownedHomes} currentProfile={currentProfile} onSave={upsertHome} onDelete={deleteHome} onUploadPhoto={handleHomePhotoUpload} />
        )}
        {activeTab === "calendar" && (
          <CalendarView
            homes={ownedHomes}
            availabilities={state.availabilities.filter((entry) => ownedHomes.some((home) => home.id === entry.homeId))}
            bookings={acceptedBookings.filter((booking) => ownedHomes.some((home) => home.id === booking.homeId))}
            onSave={saveAvailability}
            onDelete={deleteAvailability}
          />
        )}
        {activeTab === "matcher" && (
          <MatcherView matches={matches} currentProfile={currentProfile} onRequest={setRequestDraft} />
        )}
        {activeTab === "requests" && (
          <RequestsView
            requests={state.requests}
            homes={state.homes}
            profiles={state.profiles}
            currentProfile={currentProfile}
            onStatus={updateRequestStatus}
            onMessage={addRequestMessage}
            onSave={saveRequestDetails}
            onDelete={deleteRequest}
          />
        )}
        {activeTab === "profile" && <ProfileView profile={currentProfile} onSave={saveProfile} onUploadPhoto={handleProfilePhotoUpload} />}
        {activeTab === "admin" && currentProfile.isAdmin && (
          <AdminView
            state={state}
            currentProfile={currentProfile}
            onSaveHome={upsertHome}
            onDeleteHome={deleteHome}
            onUploadPhoto={handleHomePhotoUpload}
            onSaveProfile={saveProfile}
            onToggleAdmin={toggleAdmin}
            onToggleApproval={toggleProfileApproval}
            onDeleteProfile={deleteProfile}
            onStatus={updateRequestStatus}
            onMessage={addRequestMessage}
            onSaveRequest={saveRequestDetails}
            onDeleteRequest={deleteRequest}
            adminSection={adminSection}
            setAdminSection={setAdminSection}
            inviteCode={inviteCode}
            onSaveInviteCode={saveInviteCode}
          />
        )}
        </ViewErrorBoundary>
      </main>
      <footer className="px-4 pb-5 text-center sm:px-6">
        <span className="inline-flex rounded-lg bg-white/55 px-3 py-1 text-xs font-semibold text-[#8a948d]">
          {firebaseEnabled ? "Firebase aktiv" : "Demo-Modus"}
        </span>
      </footer>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[#ded8cb] bg-white/96 px-2 py-2 shadow-[0_-10px_30px_rgba(36,49,58,0.08)] backdrop-blur md:hidden">
        {tabs
          .filter((tab) => ["dashboard", "discover", "calendar", "requests", "profile"].includes(tab.id))
          .map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`grid min-h-12 place-items-center rounded-lg px-1 text-[11px] font-bold ${
                  active ? "bg-[#24313a] text-white" : "text-[#4f5d55]"
                }`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <Icon size={18} />
                <span className="mt-1 truncate">{tab.label}</span>
              </button>
            );
          })}
      </nav>

      {requestDraft && (
        <RequestPanel
          draft={requestDraft}
          home={state.homes.find((home) => home.id === requestDraft.homeId)}
          availabilities={state.availabilities}
          bookings={acceptedBookings}
          onClose={() => setRequestDraft(null)}
          onSubmit={createRequest}
        />
      )}
      {selectedHomeId && (
        <HomeDetailPanel
          home={state.homes.find((home) => home.id === selectedHomeId)}
          owner={state.profiles.find((profile) => profile.id === state.homes.find((home) => home.id === selectedHomeId)?.ownerId)}
          availabilities={state.availabilities.filter((availability) => availability.homeId === selectedHomeId)}
          bookings={acceptedBookings.filter((booking) => booking.homeId === selectedHomeId)}
          disabled={state.homes.find((home) => home.id === selectedHomeId)?.ownerId === currentProfile.id}
          onClose={() => setSelectedHomeId(null)}
          onRequest={(draft) => {
            setRequestDraft(draft);
            setSelectedHomeId(null);
          }}
        />
      )}
    </div>
  );
}

function AuthScreen({ authMode, error, onAuthModeChange, onSubmit, onAnonymous }) {
  return (
    <main className="min-h-screen bg-[#f5f3ee]">
      <section className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
        <img
          className="absolute inset-0 h-full w-full object-cover"
          src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80"
          alt=""
        />
        <div className="absolute inset-0 bg-[#203036]/65" />
        <div className="relative grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div className="pb-4 text-white">
            <p className="mb-3 inline-flex rounded-lg bg-white/15 px-3 py-1 text-sm font-semibold backdrop-blur">Ferien im Haus von Freunden</p>
            <h1 className="max-w-2xl text-5xl font-bold tracking-normal sm:text-6xl">FerienTausch</h1>
            <p className="mt-4 max-w-xl text-lg leading-8 text-white/88">
              Häuser, freie Zeiträume, Smart Matches und Tauschanfragen für euren privaten Familienkreis.
            </p>
          </div>
          <form
            className="rounded-lg bg-white p-5 shadow-soft"
            onSubmit={(event) => onSubmit(event, event.currentTarget)}
          >
            <img className="mb-5 h-auto w-full max-w-sm" src="/logo-wordmark.png" alt="FerienTausch" />
            <div className="mb-5 flex rounded-lg bg-[#edf1e8] p-1">
              <button
                type="button"
                className={`h-10 flex-1 rounded-lg text-sm font-semibold ${authMode === "login" ? "bg-white shadow" : ""}`}
                onClick={() => onAuthModeChange("login")}
              >
                Login
              </button>
              <button
                type="button"
                className={`h-10 flex-1 rounded-lg text-sm font-semibold ${authMode === "register" ? "bg-white shadow" : ""}`}
                onClick={() => onAuthModeChange("register")}
              >
                Registrieren
              </button>
            </div>
            {authMode === "register" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field name="firstName" label="Vorname" required />
                <Field name="lastName" label="Nachname" required />
                <Field name="city" label="Wohnort" required />
                <Field name="inviteCode" label="Einladungscode" required />
              </div>
            )}
            <Field name="email" label="E-Mail" type="email" defaultValue="mayer@example.com" required />
            <Field name="password" label="Passwort" type="password" defaultValue="ferien123" required />
            <button className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#2d6a62] px-4 font-semibold text-white">
              <UserPlus size={18} /> {authMode === "register" ? "Konto erstellen" : "Einloggen"}
            </button>
            <button
              type="button"
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#cfd7cd] bg-white px-4 font-semibold"
              onClick={onAnonymous}
            >
              <ChevronRight size={18} /> Demo betreten
            </button>
            {error && <p className="mt-3 rounded-lg bg-[#f4d3cd] p-3 text-sm font-semibold text-[#8a332b]">{error}</p>}
          </form>
        </div>
      </section>
    </main>
  );
}

function LoadingScreen({ title, text, error, onLogout }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f3ee] px-4">
      <section className="w-full max-w-md rounded-lg bg-white p-5 text-center shadow-soft">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-[#dcedd8] text-[#255c37]">
          <Sparkles size={22} />
        </div>
        <h1 className="mt-4 text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#66756d]">{text}</p>
        {error && <p className="mt-4 rounded-lg bg-[#f4d3cd] p-3 text-sm font-semibold text-[#8a332b]">{error}</p>}
        {onLogout && (
          <button className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" onClick={onLogout}>
            <LogOut size={17} /> Abmelden
          </button>
        )}
      </section>
    </main>
  );
}

function ApprovalPendingScreen({ profile, onLogout }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f3ee] px-4">
      <section className="w-full max-w-md rounded-lg bg-white p-5 text-center shadow-soft">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-[#fff5df] text-[#75511a]">
          <UserCheck size={22} />
        </div>
        <h1 className="mt-4 text-xl font-bold">Freigabe ausstehend</h1>
        <p className="mt-2 text-sm leading-6 text-[#66756d]">
          Dein Konto für {getProfileName(profile)} wurde angelegt. Ein Admin muss es noch freigeben.
        </p>
        <button className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" onClick={onLogout}>
          <LogOut size={17} /> Abmelden
        </button>
      </section>
    </main>
  );
}

function FirebaseErrorBanner({ message, onDismiss }) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[#d8b3aa] bg-[#fbe8e4] p-3 text-sm text-[#74342c] sm:flex-row sm:items-center sm:justify-between">
      <strong>{message}</strong>
      {onDismiss && (
        <button className="inline-flex h-9 items-center justify-center rounded-lg bg-white px-3 font-semibold" onClick={onDismiss}>
          Schliessen
        </button>
      )}
    </div>
  );
}

function AppNoticeBanner({ message, onDismiss }) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[#b8d8b1] bg-[#e8f6e5] p-3 text-sm text-[#255c37] sm:flex-row sm:items-center sm:justify-between">
      <strong>{message}</strong>
      <button className="inline-flex h-9 items-center justify-center rounded-lg bg-white px-3 font-semibold" onClick={onDismiss}>
        Schliessen
      </button>
    </div>
  );
}

class ViewErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("FerienTausch view error", error);
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <EmptyState
          title="Ansicht konnte nicht geladen werden"
          text="Bitte wechsle kurz den Tab oder lade die Seite neu. Die restliche App bleibt nutzbar."
        />
      );
    }

    return this.props.children;
  }
}

function DashboardView({
  currentProfile,
  ownedHomes,
  homes,
  availabilities,
  requests,
  openRequests,
  matches,
  profiles,
  onNavigate,
  onDetails,
  onRequest,
}) {
  const ownedHomeIds = new Set(ownedHomes.map((home) => home.id));
  const nextAvailabilities = availabilities
    .filter((availability) => ownedHomeIds.has(availability.homeId))
    .sort((first, second) => first.start.localeCompare(second.start))
    .slice(0, 3);
  const featuredHomes = homes.filter((home) => home.ownerId !== currentProfile.id).slice(0, 3);
  const firstOwnedHome = ownedHomes[0];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg bg-[#24313a] text-white shadow-soft">
        <div className="grid gap-5 p-5 md:grid-cols-[1.2fr_0.8fr] md:p-6">
          <div>
            <p className="text-sm font-semibold text-[#c7d5c4]">Willkommen zurück, {getProfileName(currentProfile)}</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-normal">
              Alles für euren nächsten Haustausch an einem Ort.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/78">
              Behalte freie Zeiträume, passende Matches und offene Anfragen im Blick.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <DashboardAction icon={Home} label={firstOwnedHome ? "Mein Haus bearbeiten" : "Haus anlegen"} onClick={() => onNavigate("my-home")} />
              <DashboardAction icon={CalendarDays} label="Zeitraum eintragen" onClick={() => onNavigate("calendar")} />
              <DashboardAction icon={Sparkles} label="Matches ansehen" onClick={() => onNavigate("matcher")} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-white/8 p-3">
            <DashboardMetric label="Häuser" value={ownedHomes.length} />
            <DashboardMetric label="Offen" value={openRequests.length} />
            <DashboardMetric label="Matches" value={matches.length} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Aktuelle Matches</h2>
              <p className="mt-1 text-sm text-[#66756d]">Zeiträume mit mindestens drei passenden Tagen.</p>
            </div>
            <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" onClick={() => onNavigate("matcher")}>
              Alle <ChevronRight size={17} />
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {matches.slice(0, 2).map((match) => (
              <div key={match.id} className="flex flex-col gap-3 rounded-lg border border-[#edf0ea] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Pill tone="green">{match.overlap.days} Tage</Pill>
                  <h3 className="mt-2 font-bold">{match.targetHome.title}</h3>
                  <p className="text-sm text-[#66756d]">{match.targetHome.city} · {formatDateRange(match.overlap.start, match.overlap.end)}</p>
                </div>
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#e05f4f] px-3 text-sm font-semibold text-white"
                  onClick={() =>
                    onRequest({
                      homeId: match.targetHome.id,
                      start: match.overlap.start,
                      end: match.overlap.end,
                      guests: Math.min(4, match.targetHome.maxGuests),
                      message: `Unser Zeitraum passt ${match.overlap.days} Tage zu eurem Angebot.`,
                    })
                  }
                >
                  <Send size={17} /> Anfrage
                </button>
              </div>
            ))}
            {!matches.length && <EmptyState title="Noch keine Matches" text="Trage freie Zeiträume ein, dann prüft der Smart Matcher automatisch passende Überschneidungen." />}
          </div>
        </div>

        <div className="rounded-lg bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Offene Anfragen</h2>
              <p className="mt-1 text-sm text-[#66756d]">Alles, was noch entschieden werden muss.</p>
            </div>
            <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" onClick={() => onNavigate("requests")}>
              Öffnen <ChevronRight size={17} />
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {openRequests.slice(0, 3).map((request) => {
              const requestHome = homes.find((home) => home.id === request.homeId);
              const from = profiles.find((profile) => profile.id === request.fromUserId);
              return (
                <div key={request.id} className="rounded-lg border border-[#edf0ea] p-3">
                  <strong>{requestHome?.title ?? "Unterkunft"}</strong>
                  <p className="mt-1 text-sm text-[#66756d]">{formatDateRange(request.start, request.end)} · {request.guests} Personen · {getProfileName(from)}</p>
                </div>
              );
            })}
            {!openRequests.length && <EmptyState title="Nichts offen" text="Neue Tauschanfragen erscheinen automatisch hier." />}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg bg-white p-4 shadow-soft">
          <h2 className="text-xl font-bold">Nächste freie Zeiträume</h2>
          <div className="mt-4 space-y-3">
            {nextAvailabilities.map((availability) => (
              <DateRow
                key={availability.id}
                title={availability.title}
                subtitle={ownedHomes.find((home) => home.id === availability.homeId)?.title ?? "Unterkunft"}
                start={availability.start}
                end={availability.end}
              />
            ))}
            {!nextAvailabilities.length && <EmptyState title="Noch keine Zeiträume" text="Lege deinen ersten freien Zeitraum an." />}
          </div>
        </div>
        <div className="rounded-lg bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Zum Entdecken</h2>
            <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" onClick={() => onNavigate("discover")}>
              Entdecken <ChevronRight size={17} />
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {featuredHomes.map((home) => (
              <button key={home.id} className="overflow-hidden rounded-lg border border-[#edf0ea] bg-white text-left" onClick={() => onDetails(home.id)}>
                <div className="aspect-[4/3] bg-[#edf1e8]">
                  <img className="h-full w-full object-cover" src={getHomeCoverPhoto(home)} alt="" />
                </div>
                <div className="p-3">
                  <strong className="line-clamp-2 text-sm">{home.title}</strong>
                  <p className="mt-1 text-xs text-[#66756d]">{home.region || home.city} · {home.city} · bis {home.maxGuests}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function DashboardAction({ icon: Icon, label, onClick }) {
  return (
    <button className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold text-[#24313a]" onClick={onClick}>
      <Icon size={17} /> {label}
    </button>
  );
}

function DashboardMetric({ label, value }) {
  return (
    <div className="rounded-lg bg-white/10 p-3 text-center">
      <strong className="block text-2xl">{value}</strong>
      <span className="text-xs font-semibold uppercase text-white/70">{label}</span>
    </div>
  );
}

function DateRow({ title, subtitle, start, end, status }) {
  const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" }).format(new Date(start));

  return (
    <div className="flex gap-3 rounded-lg border border-[#edf0ea] p-3">
      <div className="grid h-14 w-16 shrink-0 place-items-center rounded-lg bg-[#edf1e8] text-center text-sm font-bold text-[#2d6a62]">
        {date}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <strong>{title}</strong>
          {status && <AvailabilityStatePill status={status} />}
        </div>
        <p className="mt-1 text-sm text-[#66756d]">{subtitle} · {formatDateRange(start, end)}</p>
      </div>
    </div>
  );
}

function AvailabilityStatePill({ status }) {
  const labels = {
    free: "Frei",
    partial: "Teilweise gebucht",
    booked: "Gebucht",
  };
  const tones = {
    free: "green",
    partial: "amber",
    booked: "red",
  };

  return <Pill tone={tones[status] ?? "neutral"}>{labels[status] ?? status}</Pill>;
}

function DiscoverView({
  homes,
  allAvailabilities,
  bookableAvailabilities,
  bookings,
  currentProfile,
  query,
  setQuery,
  minGuests,
  setMinGuests,
  minBedrooms,
  setMinBedrooms,
  regionFilter,
  setRegionFilter,
  holidayFilter,
  setHolidayFilter,
  quickFilters,
  setQuickFilters,
  selectedAmenities,
  setSelectedAmenities,
  availabilityMode,
  setAvailabilityMode,
  travelStart,
  setTravelStart,
  travelEnd,
  setTravelEnd,
  onRequest,
  onDetails,
}) {
  function toggleAmenity(amenity) {
    setSelectedAmenities((current) =>
      current.includes(amenity) ? current.filter((entry) => entry !== amenity) : [...current, amenity],
    );
  }

  function toggleQuickFilter(filter) {
    setQuickFilters((current) =>
      current.includes(filter) ? current.filter((entry) => entry !== filter) : [...current, filter],
    );
  }

  return (
    <div className="space-y-5">
      <Toolbar>
        <SearchField value={query} onChange={setQuery} placeholder="Ort, Adresse oder Haus suchen" />
        <FieldCompact label="Mind. Gäste" type="number" value={minGuests} onChange={setMinGuests} />
        <FieldCompact label="Schlafzimmer" type="number" value={minBedrooms} onChange={setMinBedrooms} />
        <FieldCompact label="Region" value={regionFilter} onChange={setRegionFilter} />
        <FieldCompact label="Ferien/Zeitraum" value={holidayFilter} onChange={setHolidayFilter} />
        <FieldCompact label="Von" type="date" value={travelStart} onChange={setTravelStart} />
        <FieldCompact label="Bis" type="date" value={travelEnd} onChange={setTravelEnd} />
      </Toolbar>
      <div className="rounded-lg bg-white p-3 shadow-soft">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-xs font-bold uppercase text-[#66756d]">
              <Filter size={15} /> Ausstattung
            </div>
            <div className="flex flex-wrap gap-2">
              {["Haustiere erlaubt", "Barrierearm", "Kinderfreundlich", "Parkplatz"].map((filter) => {
                const selected = quickFilters.includes(filter);
                return (
                  <button
                    key={filter}
                    type="button"
                    className={`h-9 rounded-lg px-3 text-sm font-semibold ${
                      selected ? "bg-[#24313a] text-white" : "bg-white text-[#4f5d55] ring-1 ring-[#dce3d8]"
                    }`}
                    onClick={() => toggleQuickFilter(filter)}
                  >
                    {filter}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {discoverFilterAmenities.map((amenity) => {
                const selected = selectedAmenities.includes(amenity);
                return (
                  <button
                    key={amenity}
                    type="button"
                    className={`h-9 rounded-lg px-3 text-sm font-semibold ${
                      selected ? "bg-[#2d6a62] text-white" : "bg-[#edf1e8] text-[#4f5d55]"
                    }`}
                    onClick={() => toggleAmenity(amenity)}
                  >
                    {amenity}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="min-w-56 text-xs font-bold uppercase text-[#66756d]">
            Verfügbarkeit
            <select
              className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] bg-white px-3 text-sm font-medium normal-case text-[#24313a]"
              value={availabilityMode}
              onChange={(event) => setAvailabilityMode(event.target.value)}
            >
              <option value="all">Alle anzeigen</option>
              <option value="available">Anfragbar</option>
              <option value="free">Nur komplett frei</option>
              <option value="partial">Teilweise gebucht</option>
              <option value="booked">Vollständig gebucht</option>
            </select>
          </label>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {homes.map((home) => {
          const homeBookableAvailabilities = bookableAvailabilities.filter(
            (availability) => availability.homeId === home.id,
          );
          const fallbackAvailability = homeBookableAvailabilities[0];

          return (
            <HomeCard
              key={home.id}
              home={home}
              availabilities={allAvailabilities.filter((availability) => availability.homeId === home.id)}
              bookableAvailabilities={homeBookableAvailabilities}
              bookings={bookings.filter((booking) => booking.homeId === home.id)}
              disabled={home.ownerId === currentProfile.id}
              onDetails={() => onDetails(home.id)}
              onRequest={() =>
                onRequest({
                  homeId: home.id,
                  start: travelStart || fallbackAvailability?.start || "",
                  end: travelEnd || fallbackAvailability?.end || "",
                  guests: Math.min(4, home.maxGuests),
                  message: "",
                })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function MyHomeView({ homes, currentProfile, onSave, onDelete, onUploadPhoto }) {
  const [editing, setEditing] = useState(homes[0] ?? { ...blankHouse, id: createId("home"), ownerId: currentProfile.id, managedBy: currentProfile.id });

  useEffect(() => {
    if (homes.length && !homes.some((home) => home.id === editing.id)) {
      setEditing(homes[0]);
    }
  }, [editing.id, homes]);

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Meine Unterkünfte</h2>
          <IconButton
            label="Neue Unterkunft"
            onClick={() => setEditing({ ...blankHouse, id: createId("home"), ownerId: currentProfile.id, managedBy: currentProfile.id })}
          >
            <Plus size={18} />
          </IconButton>
        </div>
        {homes.map((home) => (
          <button
            key={home.id}
            className={`w-full rounded-lg border p-3 text-left ${editing.id === home.id ? "border-[#2d6a62] bg-white" : "border-[#ded8cb] bg-white/70"}`}
            onClick={() => setEditing(home)}
          >
            <strong>{home.title || "Neue Unterkunft"}</strong>
            <p className="mt-1 text-sm text-[#66756d]">{home.region || home.city} · {home.city} · bis {home.maxGuests} Gäste</p>
          </button>
        ))}
      </section>
      <HouseEditor value={editing} onChange={setEditing} onSave={onSave} onDelete={onDelete} onUploadPhoto={onUploadPhoto} />
    </div>
  );
}

function CalendarView({ homes, availabilities, bookings, onSave, onDelete }) {
  const [form, setForm] = useState({ ...blankAvailability, id: createId("avail"), homeId: homes[0]?.id ?? "" });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const sortedBookings = [...bookings].sort((first, second) => first.start.localeCompare(second.start));
  const [calendarYear, calendarMonthNumber] = calendarMonth.split("-").map(Number);
  const calendarMonthIndex = calendarMonthNumber - 1;
  const calendarDays = getMonthDays(calendarYear, calendarMonthIndex);
  const selectedCalendarHomeId = form.homeId || homes[0]?.id || "";
  const selectedCalendarHome = homes.find((home) => home.id === selectedCalendarHomeId);

  function shiftMonth(offset) {
    const next = new Date(calendarYear, calendarMonthIndex + offset, 1);
    setCalendarMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  }

  function selectCalendarDay(day, status) {
    if (!selectedCalendarHomeId || !day.inMonth) {
      return;
    }

    setForm({
      ...form,
      homeId: selectedCalendarHomeId,
      start: day.iso,
      end: day.iso,
      title: status === "booked" ? "Gebuchter Tag" : "Freier Tag",
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="rounded-lg bg-white p-4 shadow-soft">
        <h2 className="text-xl font-bold">Freien Zeitraum eintragen</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold">
            Unterkunft
            <select className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] px-3" value={form.homeId} onChange={(event) => setForm({ ...form, homeId: event.target.value })}>
              {homes.map((home) => (
                <option key={home.id} value={home.id}>{home.title}</option>
              ))}
            </select>
          </label>
          <FieldControlled label="Titel" value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="Sommerferien Bayern" />
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldControlled label="Start" type="date" value={form.start} onChange={(start) => setForm({ ...form, start })} />
            <FieldControlled label="Ende" type="date" value={form.end} onChange={(end) => setForm({ ...form, end })} />
          </div>
          <button
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#2d6a62] px-4 font-semibold text-white disabled:opacity-50"
            disabled={!form.homeId || !isValidDateRange(form.start, form.end)}
            onClick={() => {
              onSave(form);
              setForm({ ...blankAvailability, id: createId("avail"), homeId: homes[0]?.id ?? "" });
            }}
          >
            <CalendarDays size={18} /> Zeitraum speichern
          </button>
        </div>
        <div className="mt-5 rounded-lg border border-[#edf0ea] bg-[#f8faf5] p-3">
          <div className="flex items-center justify-between gap-3">
            <button className="grid h-9 w-9 place-items-center rounded-lg border border-[#cfd7cd] bg-white" onClick={() => shiftMonth(-1)} type="button">
              <ArrowLeft size={16} />
            </button>
            <div className="text-center">
              <p className="text-sm font-bold">
                {new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(calendarYear, calendarMonthIndex, 1))}
              </p>
              <p className="text-xs text-[#66756d]">{selectedCalendarHome?.title ?? "Unterkunft"}</p>
            </div>
            <button className="grid h-9 w-9 place-items-center rounded-lg border border-[#cfd7cd] bg-white" onClick={() => shiftMonth(1)} type="button">
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-bold uppercase text-[#66756d]">
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const status = getCalendarDayStatus(selectedCalendarHomeId, day.iso, availabilities, bookings);
              const className =
                status === "booked"
                  ? "bg-[#f4d3cd] text-[#8a332b]"
                  : status === "free"
                    ? "bg-[#dcedd8] text-[#255c37]"
                    : "bg-white text-[#9aa39d]";
              return (
                <button
                  key={day.iso}
                  className={`grid aspect-square place-items-center rounded-lg text-xs font-bold transition hover:ring-2 hover:ring-[#2d6a62]/30 ${className} ${day.inMonth ? "cursor-pointer" : "cursor-default opacity-45"}`}
                  title={status === "booked" ? "Gebucht" : status === "free" ? "Frei" : "Nicht freigegeben"}
                  type="button"
                  onClick={() => selectCalendarDay(day, status)}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[#66756d]">
            <span className="rounded-lg bg-[#dcedd8] px-2 py-1 text-[#255c37]">Frei</span>
            <span className="rounded-lg bg-[#f4d3cd] px-2 py-1 text-[#8a332b]">Gebucht</span>
            <span className="rounded-lg bg-white px-2 py-1">Nicht freigegeben</span>
          </div>
          <button
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#cfd7cd] bg-white px-3 text-sm font-semibold"
            type="button"
            onClick={() => downloadIcal(selectedCalendarHome ?? homes[0], availabilities, bookings)}
          >
            <Download size={17} /> Kalender exportieren
          </button>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-bold">Eingetragene Zeiträume</h2>
        <div className="grid gap-3">
          {availabilities.map((availability) => (
            <div key={availability.id} className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{availability.title}</strong>
                  <AvailabilityStatePill status={getAvailabilityBookingState(availability, bookings)} />
                </div>
                <p className="text-sm text-[#66756d]">{homes.find((home) => home.id === availability.homeId)?.title} · {formatDateRange(availability.start, availability.end)}</p>
              </div>
              <IconButton label="Zeitraum löschen" onClick={() => onDelete(availability.id)}>
                <Trash2 size={18} />
              </IconButton>
            </div>
          ))}
        </div>
        <h2 className="mb-3 mt-6 text-xl font-bold">Gebuchte Zeiträume</h2>
        <div className="grid gap-3">
          {sortedBookings.map((booking) => (
            <DateRow
              key={booking.id}
              title="Gebucht"
              subtitle={homes.find((home) => home.id === booking.homeId)?.title ?? "Unterkunft"}
              start={booking.start}
              end={booking.end}
              status="booked"
            />
          ))}
          {!sortedBookings.length && <EmptyState title="Noch keine Buchungen" text="Angenommene Anfragen erscheinen hier automatisch." />}
        </div>
      </section>
    </div>
  );
}

function MatcherView({ matches, onRequest }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-2xl font-bold">Smart Matcher</h2>
          <p className="mt-1 text-[#66756d]">Direkte Vorschläge ab drei Tagen Überschneidung.</p>
        </div>
        <Pill tone="green">{matches.length} Matches</Pill>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {matches.map((match) => (
          <article key={match.id} className="rounded-lg bg-white p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Pill tone="green">{match.overlap.days} Tage</Pill>
                <h3 className="mt-3 text-xl font-bold">{match.targetHome.title}</h3>
                <p className="mt-1 text-sm text-[#66756d]">{match.targetHome.city} · {formatDateRange(match.overlap.start, match.overlap.end)}</p>
              </div>
              <Sparkles className="text-[#d97706]" size={28} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[#4f5d55]">
              Eure Verfügbarkeit "{match.myAvailability.title}" überschneidet sich mit "{match.targetAvailability.title}".
            </p>
            <button
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#e05f4f] px-4 text-sm font-semibold text-white"
              onClick={() =>
                onRequest({
                  homeId: match.targetHome.id,
                  start: match.overlap.start,
                  end: match.overlap.end,
                  guests: Math.min(4, match.targetHome.maxGuests),
                  message: `Unser Zeitraum passt ${match.overlap.days} Tage zu eurem Angebot.`,
                })
              }
            >
              <Send size={17} /> Tausch anfragen
            </button>
          </article>
        ))}
      </div>
      {!matches.length && <EmptyState title="Noch keine Überschneidung" text="Sobald mindestens drei gemeinsame Tage gefunden werden, erscheint hier ein Vorschlag." />}
    </div>
  );
}

function RequestsView({ requests, homes, profiles, currentProfile, onStatus, onMessage, onSave, onDelete }) {
  const visibleRequests = requests.filter((request) => request.fromUserId === currentProfile.id || request.toUserId === currentProfile.id || currentProfile.isAdmin);

  return (
    <div className="grid gap-4">
      {visibleRequests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          home={homes.find((home) => home.id === request.homeId)}
          from={profiles.find((profile) => profile.id === request.fromUserId)}
          to={profiles.find((profile) => profile.id === request.toUserId)}
          homes={homes}
          profiles={profiles}
          currentProfile={currentProfile}
          onStatus={onStatus}
          onMessage={onMessage}
          onSave={onSave}
          onDelete={onDelete}
        />
      ))}
      {!visibleRequests.length && <EmptyState title="Keine Anfragen" text="Neue Tauschanfragen erscheinen hier mit Status und Nachrichtenverlauf." />}
    </div>
  );
}

function ProfileView({ profile, onSave, onUploadPhoto }) {
  const [form, setForm] = useState(profile);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const profileIssues = getProfileQualityIssues(form);
  const profileScore = getCompletionScore(profileIssues, 6);

  useEffect(() => {
    setForm(profile);
  }, [profile]);

  async function handlePhotoFile(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploadingPhoto(true);
    setUploadNote("Profilbild wird vorbereitet...");
    const preparedFile = await compressImageFile(file);
    setUploadNote(
      preparedFile.size < file.size
        ? `Komprimiert von ${formatFileSize(file.size)} auf ${formatFileSize(preparedFile.size)}.`
        : `Dateigröße: ${formatFileSize(file.size)}.`,
    );
    const photoUrl = onUploadPhoto ? await onUploadPhoto(form.id, preparedFile) : await fileToDataUrl(preparedFile);
    const nextForm = { ...form, photoUrl };
    setForm(nextForm);
    await onSave(nextForm);
    setUploadingPhoto(false);
    event.target.value = "";
  }

  return (
    <section className="max-w-2xl rounded-lg bg-white p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <img className="h-16 w-16 rounded-lg object-cover" src={getProfilePhoto(form)} alt="" />
        <div>
          <h2 className="text-xl font-bold">Profil verwalten</h2>
          <p className="mt-1 text-sm text-[#66756d]">{getProfileName(form)}</p>
        </div>
      </div>
      <QualityMeter score={profileScore} issues={profileIssues} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FieldControlled label="Vorname" value={form.firstName ?? ""} onChange={(firstName) => setForm({ ...form, firstName, familyName: [firstName, form.lastName].filter(Boolean).join(" ") })} />
        <FieldControlled label="Nachname" value={form.lastName ?? ""} onChange={(lastName) => setForm({ ...form, lastName, familyName: [form.firstName, lastName].filter(Boolean).join(" ") })} />
        <FieldControlled label="Wohnort" value={form.city} onChange={(city) => setForm({ ...form, city })} />
        <FieldControlled label="Telefonnummer" value={form.phone ?? ""} onChange={(phone) => setForm({ ...form, phone })} />
      </div>
      <FieldControlled label="E-Mail" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
      <FieldControlled label="Profilbild-URL" value={form.photoUrl ?? ""} onChange={(photoUrl) => setForm({ ...form, photoUrl })} placeholder="https://..." />
      <label className="mt-3 inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#24313a] px-4 font-semibold text-white">
        <ImagePlus size={18} /> {uploadingPhoto ? "Lädt..." : "Profilbild hochladen"}
        <input className="sr-only" type="file" accept="image/*" onChange={handlePhotoFile} />
      </label>
      {uploadNote && <p className="mt-2 text-xs font-semibold text-[#66756d]">{uploadNote}</p>}
      <label className="mt-3 inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[#cfd7cd] bg-[#f8faf5] px-3 py-2 text-sm font-semibold">
        <input
          className="h-5 w-5 accent-[#2d6a62]"
          type="checkbox"
          checked={form.visibility !== "private"}
          onChange={(event) => setForm({ ...form, visibility: event.target.checked ? "friends" : "private" })}
        />
        Für den Freundeskreis sichtbar
      </label>
      <label className="mt-3 block text-sm font-semibold">
        Beschreibung
        <textarea className="mt-1 min-h-28 w-full rounded-lg border border-[#cfd7cd] p-3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      </label>
      <button className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-[#2d6a62] px-4 font-semibold text-white" onClick={() => onSave(form)}>
        <Check size={18} /> Profil speichern
      </button>
    </section>
  );
}

function AdminView({
  state,
  currentProfile,
  onSaveHome,
  onDeleteHome,
  onUploadPhoto,
  onSaveProfile,
  onToggleAdmin,
  onToggleApproval,
  onDeleteProfile,
  onStatus,
  onMessage,
  onSaveRequest,
  onDeleteRequest,
  adminSection,
  setAdminSection,
  inviteCode,
  onSaveInviteCode,
}) {
  const [externalHome, setExternalHome] = useState({
    ...blankHouse,
    id: createId("home"),
    ownerId: createId("external"),
    managedBy: currentProfile.id,
    isExternal: true,
  });
  const [adminHomeDraft, setAdminHomeDraft] = useState(null);
  const [showExternalHomeEditor, setShowExternalHomeEditor] = useState(false);
  const [inviteDraft, setInviteDraft] = useState(inviteCode);
  const adminTabs = [
    { id: "overview", label: "Übersicht" },
    { id: "tasks", label: "Aufgaben" },
    { id: "members", label: "Mitglieder" },
    { id: "homes", label: "Häuser" },
    { id: "requests", label: "Anfragen" },
    { id: "bookings", label: "Buchungen" },
    { id: "audit", label: "Audit" },
    { id: "export", label: "Export" },
  ];
  const bookings = mergeBookings([...(state.bookings ?? []), ...getAcceptedBookings(state.requests)]);
  const bookingOffers = getBookableAvailabilities(state.availabilities, bookings);
  const pendingProfiles = state.profiles.filter((profile) => !isProfileApproved(profile));
  const openRequests = state.requests.filter((request) => request.status === "pending");
  const incompleteHomes = state.homes
    .map((home) => ({ home, issues: getHomeQualityIssues(home) }))
    .filter((entry) => entry.issues.length);
  function openAdminHome(home) {
    setAdminHomeDraft(home);
    setAdminSection("homes");
  }

  const adminTasks = [
    ...pendingProfiles.map((profile) => ({
      id: `profile-${profile.id}`,
      title: `${getProfileName(profile)} freigeben`,
      text: profile.email || "Neue Registrierung wartet auf Prüfung.",
      action: "Mitglieder öffnen",
      onClick: () => setAdminSection("members"),
    })),
    ...openRequests.map((request) => ({
      id: `request-${request.id}`,
      title: "Offene Tauschanfrage prüfen",
      text: `${state.homes.find((home) => home.id === request.homeId)?.title ?? "Unterkunft"} · ${formatDateRange(request.start, request.end)}`,
      action: "Anfragen öffnen",
      onClick: () => setAdminSection("requests"),
    })),
    ...incompleteHomes.slice(0, 6).map(({ home, issues }) => ({
      id: `quality-home-${home.id}`,
      title: `${home.title || "Unterkunft"} vervollständigen`,
      text: issues.join(", "),
      action: "Häuser öffnen",
      onClick: () => openAdminHome(home),
    })),
  ];

  useEffect(() => {
    setInviteDraft(inviteCode);
  }, [inviteCode]);

  useEffect(() => {
    if (adminHomeDraft && !state.homes.some((home) => home.id === adminHomeDraft.id)) {
      setAdminHomeDraft(null);
    }
  }, [adminHomeDraft, state.homes]);

  async function updateRegistrationNotificationPreference(enabled) {
    if (enabled) {
      await requestBrowserNotificationPermission();
    }

    onSaveProfile({ ...currentProfile, notifyOnNewRegistrations: enabled });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Unterkünfte" value={state.homes.length} />
        <Metric label="Mitglieder" value={state.profiles.length} />
        <Metric label="Offene Aufgaben" value={adminTasks.length} />
      </div>
      <div className="flex gap-2 overflow-x-auto rounded-lg bg-white p-2 shadow-soft">
        {adminTabs.map((tab) => (
          <button
            key={tab.id}
            className={`h-10 shrink-0 rounded-lg px-3 text-sm font-semibold ${
              adminSection === tab.id ? "bg-[#24313a] text-white" : "bg-[#f8faf5] text-[#4f5d55]"
            }`}
            onClick={() => setAdminSection(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {adminSection === "overview" && <AdminTaskPanel tasks={adminTasks.slice(0, 6)} compact onOpenAll={() => setAdminSection("tasks")} />}
      {adminSection === "tasks" && <AdminTaskPanel tasks={adminTasks} />}
      {adminSection === "overview" && (
      <section className="rounded-lg bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#dcedd8] text-[#255c37]">
              <Bell size={18} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Admin-Benachrichtigungen</h2>
              <p className="mt-1 text-sm text-[#66756d]">
                Informiert dich in der App und per Browser-Hinweis, wenn sich jemand neu registriert.
              </p>
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[#cfd7cd] bg-[#f8faf5] px-3 py-2 text-sm font-semibold">
            <input
              className="h-5 w-5 accent-[#2d6a62]"
              type="checkbox"
              checked={Boolean(currentProfile.notifyOnNewRegistrations)}
              onChange={(event) => updateRegistrationNotificationPreference(event.target.checked)}
            />
            Neue Registrierungen
          </label>
        </div>
      </section>
      )}
      {adminSection === "members" && (
      <section className="rounded-lg bg-white p-4 shadow-soft">
        <h2 className="text-xl font-bold">Mitglieder & Rechte</h2>
        <div className="mt-3 divide-y divide-[#edf0ea]">
          {state.profiles.map((profile) => (
            <div key={profile.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong>{getProfileName(profile)}</strong>
                <p className="text-sm text-[#66756d]">{profile.email} · {profile.city}</p>
                {profile.approvedAt && (
                  <p className="mt-1 text-xs font-semibold text-[#66756d]">
                    Freigegeben am {formatDateTime(profile.approvedAt)}
                    {profile.approvedBy
                      ? ` durch ${getProfileName(state.profiles.find((entry) => entry.id === profile.approvedBy))}`
                      : ""}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" onClick={() => onToggleApproval(profile.id)}>
                  <UserCheck size={17} /> {isProfileApproved(profile) ? "Sperren" : "Freigeben"}
                </button>
                <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" onClick={() => onToggleAdmin(profile.id)}>
                  <ShieldCheck size={17} /> {profile.isAdmin ? "Admin entfernen" : "Admin vergeben"}
                </button>
                {profile.id !== currentProfile.id && (
                  <IconButton label="Profil löschen" onClick={() => onDeleteProfile(profile.id)}>
                    <Trash2 size={18} />
                  </IconButton>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      )}
      {adminSection === "homes" && (
      <section className="grid gap-5 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-lg bg-white p-4 shadow-soft lg:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">Häuser verwalten</h2>
              <p className="mt-1 text-sm text-[#66756d]">Bestehende Häuser links auswählen und rechts direkt bearbeiten.</p>
            </div>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#cfd7cd] bg-white px-3 text-sm font-semibold"
              onClick={() => setShowExternalHomeEditor((current) => !current)}
              type="button"
            >
              <Plus size={17} /> Haus für Dritte
            </button>
          </div>
          {showExternalHomeEditor && (
            <div className="mt-4 border-t border-[#edf0ea] pt-4">
              <HouseEditor
                compact
                value={externalHome}
                onChange={setExternalHome}
                onUploadPhoto={onUploadPhoto}
                onSave={(home) => {
                  onSaveHome({ ...home, isExternal: true, managedBy: currentProfile.id });
                  setExternalHome({ ...blankHouse, id: createId("home"), ownerId: createId("external"), managedBy: currentProfile.id, isExternal: true });
                  setShowExternalHomeEditor(false);
                }}
              />
            </div>
          )}
        </div>
        <div>
          <h2 className="mb-3 text-xl font-bold">Alle Unterkünfte</h2>
          <div className="grid gap-3">
            {state.homes.map((home) => (
              <div
                key={home.id}
                className={`flex items-center justify-between gap-3 rounded-lg bg-white p-3 shadow-soft ${
                  adminHomeDraft?.id === home.id ? "ring-2 ring-[#2d6a62]/30" : ""
                }`}
              >
                <div>
                  <strong>{home.title}</strong>
                  <p className="text-sm text-[#66756d]">{home.region || home.city} · {home.city} {home.isExternal ? "· extern gepflegt" : ""}</p>
                </div>
                <div className="flex gap-2">
                  <IconButton label="Unterkunft bearbeiten" onClick={() => setAdminHomeDraft(home)}>
                    <Pencil size={18} />
                  </IconButton>
                  <IconButton label="Unterkunft löschen" onClick={() => onDeleteHome(home.id)}>
                    <Trash2 size={18} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        </div>
        {adminHomeDraft && (
          <div className="rounded-lg bg-white p-4 shadow-soft lg:sticky lg:top-32 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold">Unterkunft als Admin bearbeiten</h2>
                <p className="mt-1 text-sm text-[#66756d]">{adminHomeDraft.title || "Ausgewählte Unterkunft"}</p>
              </div>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#cfd7cd] bg-white px-3 text-sm font-semibold"
                onClick={() => setAdminHomeDraft(null)}
                type="button"
              >
                <X size={17} /> Schliessen
              </button>
            </div>
            <HouseEditor
              value={adminHomeDraft}
              onChange={setAdminHomeDraft}
              onUploadPhoto={onUploadPhoto}
              onSave={(home) => {
                onSaveHome({ ...home, managedBy: home.managedBy ?? currentProfile.id });
                setAdminHomeDraft(home);
              }}
              onDelete={(homeId) => {
                onDeleteHome(homeId);
                setAdminHomeDraft(null);
              }}
            />
          </div>
        )}
        {!adminHomeDraft && (
          <div className="rounded-lg bg-white p-4 shadow-soft">
            <EmptyState title="Kein Haus ausgewählt" text="Wähle links ein Haus aus oder öffne ein Haus direkt aus den Admin-Aufgaben." />
          </div>
        )}
      </section>
      )}
      {adminSection === "overview" && pendingProfiles.length > 0 && (
        <section className="rounded-lg bg-white p-4 shadow-soft">
          <h2 className="text-xl font-bold">Neue Profile freigeben</h2>
          <div className="mt-3 grid gap-3">
            {pendingProfiles.map((profile) => (
              <div key={profile.id} className="flex flex-col gap-3 rounded-lg border border-[#edf0ea] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <img className="h-12 w-12 rounded-lg object-cover" src={getProfilePhoto(profile)} alt="" />
                  <div>
                    <strong>{getProfileName(profile)}</strong>
                    <p className="text-sm text-[#66756d]">{profile.email} · {profile.city}</p>
                  </div>
                </div>
                <button className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2d6a62] px-3 text-sm font-semibold text-white" onClick={() => onToggleApproval(profile.id)}>
                  <CheckCircle2 size={17} /> Freigeben
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {adminSection === "overview" && (
        <section className="rounded-lg bg-white p-4 shadow-soft">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#edf1e8] text-[#255c37]">
                <KeyRound size={18} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Einladungscode</h2>
                <p className="mt-1 text-sm text-[#66756d]">
                  Neue Registrierungen nutzen diesen Code sofort. Die Admin-Freigabe bleibt zusätzlich aktiv.
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:max-w-sm">
              <label className="text-sm font-semibold">
                Aktueller Code
                <input
                  className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] px-3"
                  value={inviteDraft}
                  onChange={(event) => setInviteDraft(event.target.value)}
                />
              </label>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#2d6a62] px-3 text-sm font-semibold text-white"
                onClick={() => onSaveInviteCode(inviteDraft)}
                type="button"
              >
                <Check size={17} /> Code speichern
              </button>
            </div>
          </div>
        </section>
      )}
      {adminSection === "overview" && (
        <section className="rounded-lg bg-white p-4 shadow-soft">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#edf1e8] text-[#255c37]">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Sicherheit & E-Mail</h2>
              <p className="mt-1 text-sm leading-6 text-[#66756d]">
                App Check sollte in der Firebase Console aktiviert werden. E-Mail-Buttons erzeugen sofort Entwürfe;
                echte automatische E-Mails benötigen später Cloud Functions oder einen Maildienst.
              </p>
            </div>
          </div>
        </section>
      )}
      {adminSection === "requests" && (
        <section className="grid gap-4">
          {state.requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              home={state.homes.find((home) => home.id === request.homeId)}
              from={state.profiles.find((profile) => profile.id === request.fromUserId)}
              to={state.profiles.find((profile) => profile.id === request.toUserId)}
              homes={state.homes}
              profiles={state.profiles}
              currentProfile={currentProfile}
              onStatus={onStatus}
              onMessage={onMessage}
              onSave={onSaveRequest}
              onDelete={onDeleteRequest}
            />
          ))}
          {!state.requests.length && <EmptyState title="Keine Anfragen" text="Es liegen noch keine Tauschanfragen vor." />}
        </section>
      )}
      {adminSection === "bookings" && (
        <section className="rounded-lg bg-white p-4 shadow-soft">
          <h2 className="text-xl font-bold">Buchungen & Angebote</h2>
          <AdminBookingCalendar homes={state.homes} offers={bookingOffers} bookings={bookings} />
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold">Tatsächliche Buchungen</h3>
                <Pill tone="red">{bookings.length}</Pill>
              </div>
              <div className="grid gap-3">
                {bookings.map((booking) => (
                  <DateRow
                    key={booking.id}
                    title={state.homes.find((home) => home.id === booking.homeId)?.title ?? "Unterkunft"}
                    subtitle={`${booking.guests || 0} Personen · angenommen`}
                    start={booking.start}
                    end={booking.end}
                    status="booked"
                  />
                ))}
                {!bookings.length && <EmptyState title="Keine tatsächlichen Buchungen" text="Angenommene Tauschanfragen erscheinen hier." />}
              </div>
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold">Buchungsangebote</h3>
                <Pill tone="green">{bookingOffers.length}</Pill>
              </div>
              <div className="grid gap-3">
                {bookingOffers.map((offer) => (
                  <DateRow
                    key={offer.id}
                    title={state.homes.find((home) => home.id === offer.homeId)?.title ?? "Unterkunft"}
                    subtitle={`${offer.title || "Freier Zeitraum"} · noch anfragbar`}
                    start={offer.start}
                    end={offer.end}
                    status="free"
                  />
                ))}
                {!bookingOffers.length && <EmptyState title="Keine Buchungsangebote" text="Freie, noch buchbare Zeiträume erscheinen hier." />}
              </div>
            </div>
          </div>
        </section>
      )}
      {adminSection === "audit" && (
        <section className="rounded-lg bg-white p-4 shadow-soft">
          <h2 className="text-xl font-bold">Audit-Log</h2>
          <div className="mt-3 grid gap-2">
            {[...(state.auditLogs ?? [])]
              .sort((first, second) => String(second.createdAt).localeCompare(String(first.createdAt)))
              .slice(0, 80)
              .map((entry) => (
                <div key={entry.id} className="rounded-lg border border-[#edf0ea] bg-[#f8faf5] p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{entry.action}</strong>
                    <span className="text-xs font-semibold text-[#66756d]">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[#66756d]">
                    {getProfileName(state.profiles.find((profile) => profile.id === entry.actorId))} · {entry.targetType} · {entry.details || entry.targetId}
                  </p>
                </div>
              ))}
            {!(state.auditLogs ?? []).length && <EmptyState title="Noch kein Audit-Log" text="Neue Änderungen werden hier für Admins protokolliert." />}
          </div>
        </section>
      )}
      {adminSection === "export" && (
        <section className="rounded-lg bg-white p-4 shadow-soft">
          <h2 className="text-xl font-bold">Daten exportieren</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold"
              onClick={() =>
                downloadCsv("mitglieder.csv", [
                  ["Name", "E-Mail", "Wohnort", "Telefon", "Admin", "Freigegeben"],
                  ...state.profiles.map((profile) => [
                    getProfileName(profile),
                    profile.email,
                    profile.city,
                    profile.phone,
                    profile.isAdmin ? "Ja" : "Nein",
                    isProfileApproved(profile) ? "Ja" : "Nein",
                  ]),
                ])
              }
            >
              <Download size={17} /> Mitglieder CSV
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold"
              onClick={() =>
                downloadCsv("haeuser.csv", [
                  ["Titel", "Region", "Stadt", "Adresse", "Gäste", "Ausstattung"],
                  ...state.homes.map((home) => [home.title, home.region, home.city, home.address, home.maxGuests, (home.amenities ?? []).join("; ")]),
                ])
              }
            >
              <Download size={17} /> Häuser CSV
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold"
              onClick={() =>
                downloadCsv("buchungen.csv", [
                  ["Haus", "Start", "Ende", "Personen"],
                  ...bookings.map((booking) => [
                    state.homes.find((home) => home.id === booking.homeId)?.title ?? "Unterkunft",
                    booking.start,
                    booking.end,
                    booking.guests,
                  ]),
                ])
              }
            >
              <Download size={17} /> Buchungen CSV
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function HomeCard({ home, availabilities, bookableAvailabilities, bookings, disabled, onDetails, onRequest }) {
  const [showMap, setShowMap] = useState(false);
  const requestDisabled = disabled || !bookableAvailabilities.length;
  const homeBookingStatus = getHomeBookingStatus(bookableAvailabilities, bookings);

  return (
    <article className="group overflow-hidden rounded-lg border border-white bg-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(32,45,54,0.16)]">
      <div className="relative aspect-[4/3] bg-[#dfe5dc]">
        <img className="h-full w-full object-cover" src={getHomeCoverPhoto(home)} alt="" />
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/55 to-transparent" />
        <div className="absolute left-3 top-3 flex gap-2">
          {home.isExternal && <Pill tone="amber">Extern</Pill>}
          {homeBookingStatus && <AvailabilityStatePill status={homeBookingStatus} />}
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3 text-white">
          <div>
            <h3 className="text-lg font-bold">{home.title}</h3>
            <p className="mt-1 inline-flex items-center gap-1 text-sm text-white/86"><MapPin size={15} /> {home.region || home.city}</p>
          </div>
          <span className="rounded-lg bg-white/92 px-2 py-1 text-xs font-bold text-[#255c37]">bis {home.maxGuests}</span>
        </div>
      </div>
      <div className="p-4">
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-[#4f5d55]">{home.description}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <Fact icon={Users} label={`${home.maxGuests} Gäste`} />
          <Fact icon={BedDouble} label={`${home.bedrooms} Schlafz.`} />
          <Fact icon={Bath} label={`${home.bathrooms} Bad`} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {home.amenities.slice(0, 8).map((amenity) => <Pill key={amenity}>{amenity}</Pill>)}
          {home.amenities.length > 8 && <Pill>+{home.amenities.length - 8}</Pill>}
        </div>
        <div className="mt-4 space-y-2">
          {availabilities.slice(0, 2).map((availability) => (
            <div key={availability.id} className="rounded-lg border border-[#dfe8dc] bg-[#f6f8f3] px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{availability.title}</strong>
                <AvailabilityStatePill status={getAvailabilityBookingState(availability, bookings)} />
              </div>
              <span className="ml-2 text-[#66756d]">{formatDateRange(availability.start, availability.end)}</span>
            </div>
          ))}
          {bookableAvailabilities.length > 0 && bookings.length > 0 && (
            <div className="rounded-lg border border-[#dfe8dc] bg-white px-3 py-2 text-sm text-[#4f5d55]">
              Noch frei: {formatDateRange(bookableAvailabilities[0].start, bookableAvailabilities[0].end)}
            </div>
          )}
          {!availabilities.length && (
            <div className="rounded-lg border border-dashed border-[#d9dfd5] px-3 py-2 text-sm text-[#66756d]">
              Noch keine freien Zeiträume
            </div>
          )}
        </div>
        <button
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#cfd7cd] bg-white px-4 text-sm font-semibold text-[#24313a] hover:bg-[#edf1e8]"
          onClick={onDetails}
          type="button"
        >
          <Search size={17} /> Details ansehen
        </button>
        <button
          className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#cfd7cd] bg-white px-4 text-sm font-semibold text-[#24313a] hover:bg-[#edf1e8]"
          onClick={() => setShowMap((current) => !current)}
          type="button"
        >
          <MapPin size={17} /> {showMap ? "Karte ausblenden" : "Karte anzeigen"}
        </button>
        {showMap && <MapPreview home={home} />}
        <button
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#e05f4f] px-4 text-sm font-semibold text-white disabled:bg-[#b7bdb8]"
          disabled={requestDisabled}
          onClick={onRequest}
        >
          <Send size={17} /> {disabled ? "Eigenes Haus" : bookableAvailabilities.length ? "Tausch anfragen" : "Nicht verfügbar"}
        </button>
      </div>
    </article>
  );
}

function HomeDetailPanel({ home, owner, availabilities, bookings, disabled, onClose, onRequest }) {
  const photos = getHomePhotos(home);
  const initialIndex = Math.min(Math.max(Number(home?.coverPhotoIndex ?? 0), 0), Math.max(photos.length - 1, 0));
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(initialIndex);

  if (!home) {
    return null;
  }

  const selectedPhoto = photos[selectedPhotoIndex] ?? getHomeCoverPhoto(home);
  const selectedCaption = getPhotoCaption(home, selectedPhotoIndex);
  const bookableAvailabilities = getBookableAvailabilities(availabilities, bookings);
  const requestDisabled = disabled || !bookableAvailabilities.length;
  const homeBookingStatus = getHomeBookingStatus(bookableAvailabilities, bookings);

  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/45 p-3 sm:place-items-center">
      <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-soft scrollbar-thin">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#edf0ea] bg-white px-4 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{home.title}</h2>
              {homeBookingStatus && <AvailabilityStatePill status={homeBookingStatus} />}
            </div>
            <p className="text-sm text-[#66756d]">{home.region || home.city} · {home.city} · {owner ? getProfileName(owner) : "Privates Angebot"}</p>
          </div>
          <IconButton label="Schliessen" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="grid gap-5 p-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[#edf1e8]">
              <img className="h-full w-full object-cover" src={selectedPhoto} alt="" />
              {selectedCaption && (
                <div className="absolute inset-x-0 bottom-0 bg-black/58 px-4 py-3 text-sm font-semibold text-white">
                  {selectedCaption}
                </div>
              )}
              {photos.length > 1 && (
                <div className="absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
                  <IconButton label="Vorheriges Bild" onClick={() => setSelectedPhotoIndex((current) => (current === 0 ? photos.length - 1 : current - 1))}>
                    <ArrowLeft size={18} />
                  </IconButton>
                  <IconButton label="Nächstes Bild" onClick={() => setSelectedPhotoIndex((current) => (current + 1) % photos.length)}>
                    <ArrowRight size={18} />
                  </IconButton>
                </div>
              )}
            </div>
            {photos.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {photos.map((photo, index) => (
                  <button
                    key={`${photo}-${index}`}
                    className={`relative aspect-[4/3] overflow-hidden rounded-lg border ${selectedPhotoIndex === index ? "border-[#2d6a62]" : "border-[#edf0ea]"}`}
                    onClick={() => setSelectedPhotoIndex(index)}
                  >
                    <img className="h-full w-full object-cover" src={photo} alt="" />
                    {getPhotoCaption(home, index) && (
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/58 px-2 py-1 text-xs font-semibold text-white">
                        {getPhotoCaption(home, index)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-5">
              <h3 className="text-lg font-bold">Beschreibung</h3>
              <p className="mt-2 text-sm leading-6 text-[#4f5d55]">{home.description}</p>
            </div>
            <div className="mt-5">
              <h3 className="text-lg font-bold">Ausstattung</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {home.amenities.map((amenity) => <Pill key={amenity}>{amenity}</Pill>)}
              </div>
            </div>
          </div>
          <aside className="space-y-4">
            <div className="rounded-lg border border-[#edf0ea] p-4">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <Fact icon={Users} label={`${home.maxGuests} Gäste`} />
                <Fact icon={BedDouble} label={`${home.bedrooms} Schlafz.`} />
                <Fact icon={Bath} label={`${home.bathrooms} Bad`} />
              </div>
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-[#66756d]">
                <MapPin size={16} /> {[home.address, home.city, home.region].filter(Boolean).join(", ")}
              </p>
              {owner && owner.visibility !== "private" && (
                <div className="mt-4 flex items-center gap-3 rounded-lg bg-[#f8faf5] p-3">
                  <img className="h-12 w-12 rounded-lg object-cover" src={getProfilePhoto(owner)} alt="" />
                  <div>
                    <p className="text-sm font-bold">{getProfileName(owner)}</p>
                    <p className="text-xs text-[#66756d]">{owner.email || "E-Mail nicht hinterlegt"} · {getPhone(owner)}</p>
                  </div>
                </div>
              )}
              <button
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#e05f4f] px-4 font-semibold text-white disabled:bg-[#b7bdb8]"
                disabled={requestDisabled}
                onClick={() =>
                  onRequest({
                    homeId: home.id,
                    start: bookableAvailabilities[0]?.start ?? "",
                    end: bookableAvailabilities[0]?.end ?? "",
                    guests: Math.min(4, home.maxGuests),
                    message: "",
                  })
                }
              >
                <Send size={18} /> {disabled ? "Eigenes Haus" : bookableAvailabilities.length ? "Tausch anfragen" : "Nicht verfügbar"}
              </button>
            </div>
            <div className="rounded-lg border border-[#edf0ea] p-4">
              <h3 className="text-lg font-bold">Freie Zeiträume</h3>
              <div className="mt-3 space-y-2">
                {bookableAvailabilities.map((availability) => (
                  <div key={availability.id} className="rounded-lg border border-[#dfe8dc] bg-[#f8faf5] p-3">
                    <DateRow
                      title={availability.title}
                      subtitle={home.title}
                      start={availability.start}
                      end={availability.end}
                      status="free"
                    />
                    {!disabled && (
                      <button
                        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#e05f4f] px-3 text-sm font-semibold text-white"
                        onClick={() =>
                          onRequest({
                            homeId: home.id,
                            start: availability.start,
                            end: availability.end,
                            guests: Math.min(4, home.maxGuests),
                            message: "",
                          })
                        }
                        type="button"
                      >
                        <Send size={16} /> Diesen Zeitraum anfragen
                      </button>
                    )}
                  </div>
                ))}
                {!bookableAvailabilities.length && <EmptyState title="Nicht verfügbar" text="Für dieses Haus sind aktuell keine freien Tage übrig." />}
              </div>
            </div>
            <div className="rounded-lg border border-[#edf0ea] p-4">
              <h3 className="text-lg font-bold">Gebuchte Zeiträume</h3>
              <div className="mt-3 space-y-2">
                {bookings.map((booking) => (
                  <DateRow
                    key={booking.id}
                    title="Gebucht"
                    subtitle={home.title}
                    start={booking.start}
                    end={booking.end}
                    status="booked"
                  />
                ))}
                {!bookings.length && <EmptyState title="Keine Buchungen" text="Angenommene Anfragen blockieren hier automatisch die Tage." />}
              </div>
            </div>
            <MapPreview home={home} />
          </aside>
        </div>
      </section>
    </div>
  );
}

function MapPreview({ home }) {
  const query = [home.address, home.city, home.region].filter(Boolean).join(", ");

  if (!query) {
    return (
      <div className="mt-2 rounded-lg border border-dashed border-[#d9dfd5] bg-[#f8faf5] p-4 text-sm text-[#66756d]">
        Kartenansicht erscheint, sobald Adresse, Stadt oder Region eingetragen ist.
      </div>
    );
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-[#dce3d8] bg-[#edf1e8]">
      <div className="flex items-center justify-between gap-3 border-b border-[#dce3d8] bg-white px-3 py-2 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold text-[#24313a]">
          <MapPin size={16} /> {query}
        </span>
        <a
          className="font-semibold text-[#2d6a62]"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
          target="_blank"
          rel="noreferrer"
        >
          In Maps öffnen
        </a>
      </div>
      <iframe
        className="h-56 w-full border-0"
        title={`Google Maps: ${query}`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`}
      />
    </div>
  );
}

function HouseEditor({ value, onChange, onSave, onDelete, onUploadPhoto, compact = false }) {
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadNote, setUploadNote] = useState("");

  function updateField(field, nextValue) {
    onChange({ ...value, [field]: nextValue });
  }

  function updatePhotos(nextPhotos, nextCoverIndex = value.coverPhotoIndex ?? 0, nextCaptions = getPhotoCaptions(value)) {
    const coverPhotoIndex = nextPhotos.length
      ? Math.min(Math.max(Number(nextCoverIndex), 0), nextPhotos.length - 1)
      : 0;
    const photoCaptions = nextPhotos.map((_, index) => nextCaptions[index] ?? "");
    onChange({ ...value, photos: nextPhotos, photoCaptions, coverPhotoIndex });
  }

  function updatePhotoCaption(index, caption) {
    const captions = getPhotoCaptions(value);
    captions[index] = caption;
    onChange({ ...value, photoCaptions: captions });
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploadingPhoto(true);
    setUploadNote("Bild wird vorbereitet...");
    const preparedFile = await compressImageFile(file);
    setUploadNote(
      preparedFile.size < file.size
        ? `Komprimiert von ${formatFileSize(file.size)} auf ${formatFileSize(preparedFile.size)}.`
        : `Dateigröße: ${formatFileSize(file.size)}.`,
    );
    const photoUrl = onUploadPhoto ? await onUploadPhoto(value.id, preparedFile) : await fileToDataUrl(preparedFile);
    updatePhotos([...getHomePhotos(value), photoUrl], value.coverPhotoIndex ?? 0, [...getPhotoCaptions(value), ""]);
    setUploadingPhoto(false);
    event.target.value = "";
  }

  const photos = getHomePhotos(value);
  const coverPhotoIndex = photos.length
    ? Math.min(Math.max(Number(value.coverPhotoIndex ?? 0), 0), photos.length - 1)
    : 0;
  const coverPhoto = photos[coverPhotoIndex];
  const coverCaption = getPhotoCaption(value, coverPhotoIndex);
  const homeIssues = getHomeQualityIssues(value);
  const homeScore = getCompletionScore(homeIssues, 8);

  return (
    <section className={compact ? "" : "rounded-lg bg-white p-5 shadow-soft"}>
      {!compact && <h2 className="mb-4 text-xl font-bold">Unterkunft bearbeiten</h2>}
      <QualityMeter score={homeScore} issues={homeIssues} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldControlled label="Titel" value={value.title} onChange={(title) => updateField("title", title)} />
        <FieldControlled label="Standort/Stadt" value={value.city} onChange={(city) => updateField("city", city)} />
      </div>
      <FieldControlled label="Region" value={value.region ?? ""} onChange={(region) => updateField("region", region)} placeholder="z. B. Schwarzwald, Ostsee, Bayern" />
      <FieldControlled label="Adresse" value={value.address} onChange={(address) => updateField("address", address)} />
      <div className="grid gap-3 sm:grid-cols-3">
        <FieldControlled label="Max. Gäste" type="number" value={value.maxGuests} onChange={(maxGuests) => updateField("maxGuests", maxGuests)} />
        <FieldControlled label="Schlafzimmer" type="number" value={value.bedrooms} onChange={(bedrooms) => updateField("bedrooms", bedrooms)} />
        <FieldControlled label="Bäder" type="number" value={value.bathrooms} onChange={(bathrooms) => updateField("bathrooms", bathrooms)} />
      </div>
      <label className="mt-3 block text-sm font-semibold">
        Beschreibung
        <textarea className="mt-1 min-h-24 w-full rounded-lg border border-[#cfd7cd] p-3" value={value.description} onChange={(event) => updateField("description", event.target.value)} />
      </label>
      <div className="mt-3">
        <span className="text-sm font-semibold">Ausstattung</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {amenityOptions.map((amenity) => {
            const selected = value.amenities.includes(amenity);
            return (
              <button
                key={amenity}
                type="button"
                className={`h-9 rounded-lg px-3 text-sm font-semibold ${selected ? "bg-[#2d6a62] text-white" : "bg-[#edf1e8] text-[#4f5d55]"}`}
                onClick={() =>
                  updateField(
                    "amenities",
                    selected ? value.amenities.filter((entry) => entry !== amenity) : [...value.amenities, amenity],
                  )
                }
              >
                {amenity}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4">
        <span className="text-sm font-semibold">Bildergalerie</span>
        <div className="mt-2 rounded-lg border border-[#dce3d8] bg-[#f8faf5] p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-[#edf1e8] sm:w-44">
              {coverPhoto ? (
                <img className="h-full w-full object-cover" src={coverPhoto} alt="" />
              ) : (
                <div className="grid h-full place-items-center px-3 text-center text-sm text-[#66756d]">
                  Noch kein Titelbild
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-[#24313a]">Aktuelles Titelbild</p>
              <p className="mt-1 text-sm text-[#66756d]">
                {coverPhoto ? coverCaption || `Bild ${coverPhotoIndex + 1}` : "Wähle ein Bild aus der Galerie als Titelbild aus."}
              </p>
              <p className="mt-2 text-xs font-semibold uppercase text-[#6e7a72]">
                Dieses Bild erscheint auf Hauskarten, Dashboard und als erstes Bild in der Detailansicht.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <div key={`${photo}-${index}`} className={`rounded-lg border bg-white p-2 ${coverPhotoIndex === index ? "border-[#2d6a62] shadow-[0_0_0_2px_rgba(45,106,98,0.12)]" : "border-[#edf0ea]"}`}>
              <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[#edf1e8]">
                <img className="h-full w-full object-cover" src={photo} alt="" />
                {coverPhotoIndex === index && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-lg bg-white/92 px-2 py-1 text-xs font-bold text-[#255c37]">
                    <Check size={13} /> Titelbild
                  </span>
                )}
                <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-lg bg-white/92 disabled:opacity-45"
                    disabled={index === 0}
                    onClick={() => {
                      const nextPhotos = moveArrayItem(getHomePhotos(value), index, index - 1);
                      const nextCaptions = moveArrayItem(getPhotoCaptions(value), index, index - 1);
                      const currentCover = Number(value.coverPhotoIndex ?? 0);
                      const nextCover = currentCover === index ? index - 1 : currentCover === index - 1 ? index : currentCover;
                      updatePhotos(nextPhotos, nextCover, nextCaptions);
                    }}
                    aria-label="Bild nach links"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-lg bg-white/92 disabled:opacity-45"
                    disabled={index === getHomePhotos(value).length - 1}
                    onClick={() => {
                      const nextPhotos = moveArrayItem(getHomePhotos(value), index, index + 1);
                      const nextCaptions = moveArrayItem(getPhotoCaptions(value), index, index + 1);
                      const currentCover = Number(value.coverPhotoIndex ?? 0);
                      const nextCover = currentCover === index ? index + 1 : currentCover === index + 1 ? index : currentCover;
                      updatePhotos(nextPhotos, nextCover, nextCaptions);
                    }}
                    aria-label="Bild nach rechts"
                  >
                    <ArrowRight size={14} />
                  </button>
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-lg bg-white/92 text-[#9f3f34]"
                    onClick={() => {
                      const nextPhotos = getHomePhotos(value).filter((_, photoIndex) => photoIndex !== index);
                      const nextCaptions = getPhotoCaptions(value).filter((_, captionIndex) => captionIndex !== index);
                      const currentCover = Number(value.coverPhotoIndex ?? 0);
                      const nextCover = currentCover === index ? 0 : currentCover > index ? currentCover - 1 : currentCover;
                      updatePhotos(nextPhotos, nextCover, nextCaptions);
                    }}
                    aria-label="Bild entfernen"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <input
                className="mt-2 h-10 w-full rounded-lg border border-[#cfd7cd] px-3 text-sm"
                value={getPhotoCaption(value, index)}
                onChange={(event) => updatePhotoCaption(index, event.target.value)}
                placeholder="Bildname, z. B. Wohnzimmer"
              />
              <button
                type="button"
                className={`mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                  coverPhotoIndex === index
                    ? "bg-[#dcedd8] text-[#255c37]"
                    : "border border-[#cfd7cd] bg-white text-[#24313a] hover:bg-[#edf1e8]"
                }`}
                onClick={() => updatePhotos(photos, index)}
              >
                <Check size={16} /> {coverPhotoIndex === index ? "Ist Titelbild" : "Als Titelbild verwenden"}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input className="h-11 rounded-lg border border-[#cfd7cd] px-3" value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="Bild-URL" />
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#cfd7cd] bg-white px-3 font-semibold"
            onClick={() => {
              if (photoUrl) {
                updatePhotos([...getHomePhotos(value), photoUrl], value.coverPhotoIndex ?? 0, [...getPhotoCaptions(value), ""]);
                setPhotoUrl("");
              }
            }}
          >
            <Plus size={18} /> URL
          </button>
          <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#24313a] px-3 font-semibold text-white">
            <ImagePlus size={18} /> {uploadingPhoto ? "Lädt..." : "Upload"}
            <input className="sr-only" type="file" accept="image/*" onChange={handleFile} />
          </label>
        </div>
      </div>
      <div className="mt-4">
        <span className="text-sm font-semibold">Kartenansicht</span>
        <MapPreview home={value} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#2d6a62] px-4 font-semibold text-white" onClick={() => onSave(value)}>
          <Check size={18} /> Speichern
        </button>
        {onDelete && (
          <button className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#d8c4bd] bg-white px-4 font-semibold text-[#9f3f34]" onClick={() => onDelete(value.id)}>
            <Trash2 size={18} /> Löschen
          </button>
        )}
      </div>
    </section>
  );
}

function RequestPanel({ draft, home, availabilities, bookings, onClose, onSubmit }) {
  const [form, setForm] = useState(draft);
  const datesEntered = Boolean(form.homeId && form.start && form.end);
  const validDates = !datesEntered || isValidDateRange(form.start, form.end);
  const guests = Number(form.guests);
  const validGuests = Number.isFinite(guests) && guests >= 1 && guests <= Number(home?.maxGuests ?? guests);
  const bookable = !datesEntered || isRangeBookable(form.homeId, form.start, form.end, availabilities, bookings);
  const alternativeRanges = home
    ? getBookableAvailabilities(availabilities, bookings).filter((availability) => availability.homeId === home.id)
    : [];

  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/35 p-3 sm:place-items-center">
      <section className="w-full max-w-lg rounded-lg bg-white p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Tauschanfrage</h2>
            <p className="mt-1 text-sm text-[#66756d]">{home?.title}</p>
          </div>
          <IconButton label="Schliessen" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <FieldControlled label="Start" type="date" value={form.start} onChange={(start) => setForm({ ...form, start })} />
          <FieldControlled label="Ende" type="date" value={form.end} onChange={(end) => setForm({ ...form, end })} />
        </div>
        <FieldControlled label="Personenanzahl" type="number" value={form.guests} onChange={(guests) => setForm({ ...form, guests })} />
        <label className="mt-3 block text-sm font-semibold">
          Nachricht
          <textarea className="mt-1 min-h-24 w-full rounded-lg border border-[#cfd7cd] p-3" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} />
        </label>
        <button
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#e05f4f] px-4 font-semibold text-white disabled:opacity-50"
          disabled={!form.start || !form.end || !form.guests || !validDates || !validGuests || !bookable}
          onClick={() => onSubmit(form)}
        >
          <Send size={18} /> Anfrage senden
        </button>
        {!validDates && (
          <p className="mt-3 rounded-lg border border-[#f0d6a8] bg-[#fff5df] px-3 py-2 text-sm font-semibold text-[#75511a]">
            Das Enddatum muss am oder nach dem Startdatum liegen.
          </p>
        )}
        {!validGuests && (
          <p className="mt-3 rounded-lg border border-[#f0d6a8] bg-[#fff5df] px-3 py-2 text-sm font-semibold text-[#75511a]">
            Bitte wähle 1 bis {home?.maxGuests ?? 1} Personen.
          </p>
        )}
        {!bookable && (
          <div className="mt-3 rounded-lg border border-[#f0d6a8] bg-[#fff5df] px-3 py-2 text-sm font-semibold text-[#75511a]">
            <p>Dieser Zeitraum ist bereits gebucht oder nicht als frei eingetragen.</p>
            {alternativeRanges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {alternativeRanges.slice(0, 3).map((availability) => (
                  <button
                    key={availability.id}
                    className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-[#24313a]"
                    onClick={() => setForm({ ...form, start: availability.start, end: availability.end })}
                    type="button"
                  >
                    {formatDateRange(availability.start, availability.end)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function RequestCard({ request, home, from, to, homes, profiles, currentProfile, onStatus, onMessage, onSave, onDelete }) {
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    homeId: request.homeId,
    fromUserId: request.fromUserId,
    toUserId: request.toUserId,
    start: request.start,
    end: request.end,
    guests: request.guests,
    status: request.status,
  });
  const incoming = request.toUserId === currentProfile.id;
  const canAdminEdit = currentProfile.isAdmin;
  const canDelete = currentProfile.isAdmin || (request.fromUserId === currentProfile.id && request.status !== "pending");
  const emailHref = requestEmailDraft(request, home, from, to);

  useEffect(() => {
    if (!editing) {
      setForm({
        homeId: request.homeId,
        fromUserId: request.fromUserId,
        toUserId: request.toUserId,
        start: request.start,
        end: request.end,
        guests: request.guests,
        status: request.status,
      });
    }
  }, [editing, request]);

  function updateForm(field, value) {
    if (field === "homeId") {
      const selectedHome = homes.find((entry) => entry.id === value);
      setForm({ ...form, homeId: value, toUserId: selectedHome?.ownerId ?? form.toUserId });
      return;
    }

    setForm({ ...form, [field]: value });
  }

  return (
    <article className="rounded-lg bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Pill tone={request.status === "accepted" ? "green" : request.status === "declined" ? "red" : "amber"}>{statusLabels[request.status]}</Pill>
          <h3 className="mt-3 text-xl font-bold">{home?.title ?? "Unterkunft"}</h3>
          <p className="mt-1 text-sm text-[#66756d]">
            {formatDateRange(request.start, request.end)} · {request.guests} Personen · {getProfileName(from)} an {to ? getProfileName(to) : "extern"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" href={emailHref}>
            <Mail size={17} /> E-Mail
          </a>
          {canAdminEdit && (
            <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" onClick={() => setEditing((current) => !current)}>
              <Pencil size={17} /> {editing ? "Schliessen" : "Bearbeiten"}
            </button>
          )}
          {canDelete && (
            <button
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d8c4bd] px-3 text-sm font-semibold text-[#9f3f34]"
              onClick={() => {
                if (window.confirm("Diese Tauschanfrage wirklich komplett löschen?")) {
                  onDelete(request.id);
                }
              }}
            >
              <Trash2 size={17} /> Löschen
            </button>
          )}
          {incoming && request.status === "pending" && (
            <>
            <button className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2d6a62] px-3 text-sm font-semibold text-white" onClick={() => onStatus(request.id, "accepted")}>
              <Check size={17} /> Annehmen
            </button>
            <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d8c4bd] px-3 text-sm font-semibold text-[#9f3f34]" onClick={() => onStatus(request.id, "declined")}>
              <X size={17} /> Ablehnen
            </button>
            </>
          )}
        </div>
      </div>
      {editing && canAdminEdit && (
        <div className="mt-4 rounded-lg border border-[#dce3d8] bg-[#f8faf5] p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="block text-sm font-semibold">
              Unterkunft
              <select className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] bg-white px-3" value={form.homeId} onChange={(event) => updateForm("homeId", event.target.value)}>
                {homes.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.title}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Anfrage von
              <select className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] bg-white px-3" value={form.fromUserId} onChange={(event) => updateForm("fromUserId", event.target.value)}>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{getProfileName(profile)}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Anfrage an
              <select className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] bg-white px-3" value={form.toUserId} onChange={(event) => updateForm("toUserId", event.target.value)}>
                {!profiles.some((profile) => profile.id === form.toUserId) && (
                  <option value={form.toUserId}>{form.toUserId || "Extern"}</option>
                )}
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{getProfileName(profile)}</option>
                ))}
              </select>
            </label>
            <FieldControlled label="Start" type="date" value={form.start} onChange={(start) => updateForm("start", start)} />
            <FieldControlled label="Ende" type="date" value={form.end} onChange={(end) => updateForm("end", end)} />
            <FieldControlled label="Personenanzahl" type="number" value={form.guests} onChange={(guests) => updateForm("guests", guests)} />
            <label className="block text-sm font-semibold">
              Status
              <select className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] bg-white px-3" value={form.status} onChange={(event) => updateForm("status", event.target.value)}>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2d6a62] px-4 text-sm font-semibold text-white"
              onClick={() => {
                onSave(request.id, form);
                setEditing(false);
              }}
            >
              <Check size={17} /> Änderungen speichern
            </button>
            <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] bg-white px-4 text-sm font-semibold" onClick={() => setEditing(false)}>
              <X size={17} /> Abbrechen
            </button>
          </div>
        </div>
      )}
      <div className="mt-4 space-y-2">
        {request.messages.map((entry, index) => (
          <div key={`${entry.createdAt}-${index}`} className="rounded-lg bg-[#f6f8f3] p-3 text-sm">
            <strong>{entry.authorId === currentProfile.id ? "Du" : "Gegenüber"}</strong>
            <p className="mt-1 text-[#4f5d55]">{entry.text}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className="h-11 rounded-lg border border-[#cfd7cd] px-3" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Nachricht schreiben" />
        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#24313a] px-4 font-semibold text-white disabled:opacity-50"
          disabled={!message}
          onClick={() => {
            onMessage(request.id, message);
            setMessage("");
          }}
        >
          <Send size={18} /> Senden
        </button>
      </div>
    </article>
  );
}

function Field({ label, name, type = "text", defaultValue = "", required = false }) {
  return (
    <label className="mt-3 block text-sm font-semibold">
      {label}
      <input className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] px-3" name={name} type={type} defaultValue={defaultValue} required={required} />
    </label>
  );
}

function FieldControlled({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <label className="mt-3 block text-sm font-semibold">
      {label}
      <input className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] px-3" type={type} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function FieldCompact({ label, value, onChange, type = "text" }) {
  return (
    <label className="min-w-36 text-xs font-bold uppercase text-[#66756d]">
      {label}
      <input className="mt-1 h-11 w-full rounded-lg border border-[#cfd7cd] bg-white px-3 text-sm font-medium normal-case text-[#24313a]" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SearchField({ value, onChange, placeholder }) {
  return (
    <label className="relative min-w-64 flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#66756d]" size={18} />
      <input className="h-11 w-full rounded-lg border border-[#cfd7cd] bg-white pl-10 pr-3" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Toolbar({ children }) {
  return <div className="flex flex-col gap-3 rounded-lg bg-white p-3 shadow-soft lg:flex-row lg:flex-wrap lg:items-end">{children}</div>;
}

function IconButton({ label, children, onClick }) {
  return (
    <button
      className="grid h-10 min-w-10 place-items-center rounded-lg border border-[#cfd7cd] bg-white px-2 text-[#24313a] hover:bg-[#edf1e8]"
      aria-label={label}
      title={label}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Pill({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-[#edf1e8] text-[#4f5d55]",
    green: "bg-[#dcedd8] text-[#255c37]",
    amber: "bg-[#f8e7bd] text-[#75511a]",
    red: "bg-[#f4d3cd] text-[#8a332b]",
  };

  return <span className={`inline-flex h-7 items-center rounded-lg px-2 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}

function Fact({ icon: Icon, label }) {
  return (
    <div className="flex min-h-10 items-center justify-center gap-1 rounded-lg bg-[#f6f8f3] px-2 text-center">
      <Icon size={16} />
      <span>{label}</span>
    </div>
  );
}

function AdminTaskPanel({ tasks, compact = false, onOpenAll }) {
  return (
    <section className="rounded-lg bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Offene Aufgaben</h2>
          <p className="mt-1 text-sm text-[#66756d]">Neue Nutzer, offene Anfragen, fehlende Daten und abgelaufene Zeiträume.</p>
        </div>
        {compact && tasks.length > 0 && (
          <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cfd7cd] px-3 text-sm font-semibold" onClick={onOpenAll} type="button">
            <ClipboardCheck size={17} /> Alle anzeigen
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-2">
        {tasks.map((task) => (
          <div key={task.id} className="flex flex-col gap-3 rounded-lg border border-[#edf0ea] bg-[#f8faf5] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <strong>{task.title}</strong>
              <p className="mt-1 text-sm text-[#66756d]">{task.text}</p>
            </div>
            <button className="inline-flex h-9 items-center justify-center rounded-lg bg-white px-3 text-sm font-semibold text-[#24313a] ring-1 ring-[#dce3d8]" onClick={task.onClick} type="button">
              {task.action}
            </button>
          </div>
        ))}
        {!tasks.length && <EmptyState title="Alles erledigt" text="Aktuell gibt es keine automatisch erkannten Admin-Aufgaben." />}
      </div>
    </section>
  );
}

function AdminBookingCalendar({ homes, offers, bookings }) {
  const rows = homes.map((home) => {
    const homeOffers = offers.filter((offer) => offer.homeId === home.id && offer.end >= todayIso());
    const homeBookings = bookings.filter((booking) => booking.homeId === home.id);
    return { home, homeOffers, homeBookings };
  });

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {rows.map(({ home, homeOffers, homeBookings }) => (
        <div key={home.id} className="rounded-lg border border-[#edf0ea] bg-[#f8faf5] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{home.title}</strong>
            <Pill tone={homeBookings.length ? "red" : homeOffers.length ? "green" : "neutral"}>
              {homeBookings.length ? `${homeBookings.length} Buchung(en)` : homeOffers.length ? `${homeOffers.length} Angebot(e)` : "Keine Angebote"}
            </Pill>
          </div>
          <div className="mt-3 space-y-2">
            {homeBookings.slice(0, 3).map((booking) => (
              <DateRow key={booking.id} title="Gebucht" subtitle={home.title} start={booking.start} end={booking.end} status="booked" />
            ))}
            {!homeBookings.length &&
              homeOffers.slice(0, 2).map((offer) => (
                <DateRow key={offer.id} title="Buchungsangebot" subtitle={offer.title || home.title} start={offer.start} end={offer.end} status="free" />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function QualityMeter({ score, issues }) {
  const tone = score >= 80 ? "bg-[#2d6a62]" : score >= 55 ? "bg-[#d97706]" : "bg-[#9f3f34]";

  return (
    <div className="mt-4 rounded-lg border border-[#edf0ea] bg-[#f8faf5] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">Vollständigkeit</strong>
        <span className="text-sm font-bold text-[#4f5d55]">{score}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
        <div className={`h-full ${tone}`} style={{ width: `${score}%` }} />
      </div>
      {issues.length > 0 && (
        <p className="mt-2 text-xs font-semibold text-[#66756d]">
          Offen: {issues.join(", ")}
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-soft">
      <p className="text-sm font-semibold text-[#66756d]">{label}</p>
      <strong className="mt-2 block text-3xl">{value}</strong>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="rounded-lg border border-dashed border-[#c9cfc5] bg-white/70 p-8 text-center">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm text-[#66756d]">{text}</p>
    </div>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes) {
  if (!bytes) {
    return "0 KB";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function compressImageFile(file) {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  const imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = imageUrl;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });

  const maxSize = 1800;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(imageUrl);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
  if (!blob || blob.size >= file.size) {
    return file;
  }

  const safeName = file.name.replace(/\.[^.]+$/, ".jpg");
  return new File([blob], safeName, { type: "image/jpeg" });
}

async function requestBrowserNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") {
    return;
  }

  await Notification.requestPermission();
}

function formatFirebaseError(error) {
  const code = error?.code ?? "";
  const technicalDetail = code ? ` (${code})` : "";

  if (code.includes("permission-denied")) {
    return `Firebase blockiert den Zugriff. Prüfe Firestore-Regeln und ob du angemeldet bist.${technicalDetail}`;
  }

  if (code.includes("auth/unauthorized-domain")) {
    return `Diese Domain ist in Firebase Authentication noch nicht autorisiert.${technicalDetail}`;
  }

  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) {
    return `Login fehlgeschlagen. Bitte E-Mail und Passwort prüfen.${technicalDetail}`;
  }

  if (code.includes("auth/email-already-in-use")) {
    return `Diese E-Mail ist bereits registriert.${technicalDetail}`;
  }

  if (code.includes("auth/operation-not-allowed")) {
    return `Diese Login-Methode ist in Firebase Authentication noch nicht aktiviert.${technicalDetail}`;
  }

  return error?.message ? `${error.message}${technicalDetail}` : `Firebase-Fehler. Bitte Konfiguration und Regeln prüfen.${technicalDetail}`;
}

export default App;
