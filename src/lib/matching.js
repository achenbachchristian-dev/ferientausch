import { differenceInCalendarDays, isAfter, isBefore, parseISO } from "date-fns";

export function overlapRange(first, second) {
  const start = isAfter(parseISO(first.start), parseISO(second.start)) ? first.start : second.start;
  const end = isBefore(parseISO(first.end), parseISO(second.end)) ? first.end : second.end;
  const days = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;

  return days > 0 ? { start, end, days } : null;
}

export function findMatches(availabilities, homes, currentUserId) {
  const userAvailabilities = availabilities.filter((availability) => availability.ownerId === currentUserId);
  const otherAvailabilities = availabilities.filter((availability) => availability.ownerId !== currentUserId);

  return userAvailabilities
    .flatMap((mine) =>
      otherAvailabilities
        .map((theirs) => {
          const overlap = overlapRange(mine, theirs);
          const myHome = homes.find((home) => home.id === mine.homeId);
          const targetHome = homes.find((home) => home.id === theirs.homeId);

          if (!overlap || overlap.days < 3 || !myHome || !targetHome) {
            return null;
          }

          return {
            id: `${mine.id}-${theirs.id}`,
            myAvailability: mine,
            targetAvailability: theirs,
            myHome,
            targetHome,
            overlap,
          };
        })
        .filter(Boolean),
    )
    .sort((a, b) => b.overlap.days - a.overlap.days);
}

export function formatDateRange(start, end) {
  return `${new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(parseISO(start))} - ${new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parseISO(end))}`;
}
