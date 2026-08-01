export const amenityOptions = [
  "WLAN",
  "Garten",
  "Pool",
  "Kamin",
  "Sauna",
  "Kinderfreundlich",
  "Haustiere erlaubt",
  "Meerblick",
  "Fahrräder",
  "Arbeitsplatz",
];

export const demoProfiles = [
  {
    id: "family-mayer",
    familyName: "Familie Mayer",
    city: "Muenchen",
    email: "mayer@example.com",
    description: "Vierkoepfige Familie, reist gern ans Wasser und tauscht am liebsten in den Schulferien.",
    isAdmin: true,
  },
  {
    id: "family-lenz",
    familyName: "Familie Lenz",
    city: "Hamburg",
    email: "lenz@example.com",
    description: "Patchwork-Familie mit Teenagern, offen fuer Stadt, Berge und Nordsee.",
    isAdmin: false,
  },
  {
    id: "family-sommer",
    familyName: "Familie Sommer",
    city: "Freiburg",
    email: "sommer@example.com",
    description: "Naturverliebt, kinderfreundlich, oft mit Grosseltern unterwegs.",
    isAdmin: false,
  },
];

export const demoHomes = [
  {
    id: "home-mayer",
    ownerId: "family-mayer",
    title: "Stadthaus mit Garten am Isarhochufer",
    city: "Muenchen",
    address: "Harlaching, Muenchen",
    maxGuests: 6,
    bedrooms: 3,
    bathrooms: 2,
    description: "Helles Reihenhaus mit ruhigem Garten, Spielzimmer und schneller Verbindung in die Innenstadt.",
    amenities: ["WLAN", "Garten", "Kinderfreundlich", "Fahrräder", "Arbeitsplatz"],
    photos: [
      "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80",
    ],
    managedBy: "family-mayer",
    isExternal: false,
  },
  {
    id: "home-lenz",
    ownerId: "family-lenz",
    title: "Altbauwohnung nahe der Alster",
    city: "Hamburg",
    address: "Winterhude, Hamburg",
    maxGuests: 5,
    bedrooms: 3,
    bathrooms: 1,
    description: "Grosszuegige Wohnung mit Balkon, Cafes vor der Tuer und U-Bahn in Laufweite.",
    amenities: ["WLAN", "Kinderfreundlich", "Haustiere erlaubt", "Fahrräder"],
    photos: [
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1560184897-ae75f418493e?auto=format&fit=crop&w=1200&q=80",
    ],
    managedBy: "family-lenz",
    isExternal: false,
  },
  {
    id: "home-sommer",
    ownerId: "family-sommer",
    title: "Ferienhaus am Waldrand",
    city: "Freiburg",
    address: "Kirchzarten, Schwarzwald",
    maxGuests: 8,
    bedrooms: 4,
    bathrooms: 2,
    description: "Holzhaus mit Sauna, Terrasse und Wanderwegen direkt hinter dem Garten.",
    amenities: ["WLAN", "Garten", "Kamin", "Sauna", "Kinderfreundlich"],
    photos: [
      "https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
    ],
    managedBy: "family-sommer",
    isExternal: false,
  },
  {
    id: "home-grandparents",
    ownerId: "external-grandparents",
    title: "Oma Ernas Ferienwohnung an der Ostsee",
    city: "Kuehlungsborn",
    address: "Strandnaehe, Kuehlungsborn",
    maxGuests: 4,
    bedrooms: 2,
    bathrooms: 1,
    description: "Vom Admin gepflegte Ferienwohnung fuer nicht registrierte Verwandte.",
    amenities: ["WLAN", "Meerblick", "Kinderfreundlich"],
    photos: [
      "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=1200&q=80",
    ],
    managedBy: "family-mayer",
    isExternal: true,
  },
];

export const demoAvailabilities = [
  {
    id: "avail-mayer-summer",
    homeId: "home-mayer",
    ownerId: "family-mayer",
    title: "Sommerferien Bayern",
    start: "2026-08-03",
    end: "2026-08-16",
  },
  {
    id: "avail-lenz-summer",
    homeId: "home-lenz",
    ownerId: "family-lenz",
    title: "Nordferien",
    start: "2026-08-08",
    end: "2026-08-22",
  },
  {
    id: "avail-sommer-autumn",
    homeId: "home-sommer",
    ownerId: "family-sommer",
    title: "Herbstferien Schwarzwald",
    start: "2026-10-05",
    end: "2026-10-18",
  },
  {
    id: "avail-grandparents",
    homeId: "home-grandparents",
    ownerId: "external-grandparents",
    title: "Freie Ostsee-Woche",
    start: "2026-08-10",
    end: "2026-08-19",
  },
];

export const demoRequests = [
  {
    id: "request-1",
    fromUserId: "family-lenz",
    toUserId: "family-mayer",
    homeId: "home-mayer",
    start: "2026-08-10",
    end: "2026-08-15",
    guests: 4,
    status: "pending",
    messages: [
      {
        authorId: "family-lenz",
        text: "Wuerde dieser Zeitraum bei euch passen? Wir waeren zu viert.",
        createdAt: "2026-07-18T09:00:00.000Z",
      },
    ],
  },
];

export const createSeedState = () => ({
  profiles: demoProfiles,
  homes: demoHomes,
  availabilities: demoAvailabilities,
  requests: demoRequests,
});
