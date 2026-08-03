import { addDays, differenceInCalendarDays, format, isAfter, isBefore, parseISO, subDays } from "date-fns";

export function overlapRange(first, second) {
  const start = isAfter(parseISO(first.start), parseISO(second.start)) ? first.start : second.start;
  const end = isBefore(parseISO(first.end), parseISO(second.end)) ? first.end : second.end;
  const days = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;

  return days > 0 ? { start, end, days } : null;
}

export function rangesOverlap(first, second) {
  return Boolean(overlapRange(first, second));
}

export function getAcceptedBookings(requests = []) {
  return requests
    .filter((request) => request.status === "accepted" && request.homeId && request.start && request.end)
    .map(bookingFromRequest)
    .sort((first, second) => first.start.localeCompare(second.start));
}

export function bookingFromRequest(request) {
  return {
    id: `booking-${request.id}`,
    requestId: request.id,
    homeId: request.homeId,
    start: request.start,
    end: request.end,
    fromUserId: request.fromUserId,
    toUserId: request.toUserId,
    guests: Number(request.guests ?? 0),
  };
}

export function getBookingsForHome(bookings = [], homeId) {
  return bookings
    .filter((booking) => booking.homeId === homeId)
    .sort((first, second) => first.start.localeCompare(second.start));
}

function toIsoDate(date) {
  return format(date, "yyyy-MM-dd");
}

function isValidRange(start, end) {
  return start && end && !isAfter(parseISO(start), parseISO(end));
}

export function subtractBookingsFromAvailability(availability, bookings = []) {
  if (!isValidRange(availability.start, availability.end)) {
    return [];
  }

  const overlappingBookings = getBookingsForHome(bookings, availability.homeId).filter((booking) =>
    rangesOverlap(availability, booking),
  );

  if (!overlappingBookings.length) {
    return [{ ...availability, originalAvailabilityId: availability.id }];
  }

  const segments = [];
  let cursor = availability.start;

  overlappingBookings.forEach((booking) => {
    if (!isValidRange(cursor, availability.end)) {
      return;
    }

    const remainingRange = { start: cursor, end: availability.end };
    const overlap = overlapRange(remainingRange, booking);

    if (!overlap) {
      return;
    }

    const beforeEnd = toIsoDate(subDays(parseISO(overlap.start), 1));
    if (isValidRange(cursor, beforeEnd)) {
      segments.push({
        ...availability,
        id: `${availability.id}-free-${segments.length + 1}`,
        start: cursor,
        end: beforeEnd,
        originalAvailabilityId: availability.id,
        bookingAdjusted: true,
      });
    }

    cursor = toIsoDate(addDays(parseISO(overlap.end), 1));
  });

  if (isValidRange(cursor, availability.end)) {
    segments.push({
      ...availability,
      id: `${availability.id}-free-${segments.length + 1}`,
      start: cursor,
      end: availability.end,
      originalAvailabilityId: availability.id,
      bookingAdjusted: true,
    });
  }

  return segments;
}

export function getBookableAvailabilities(availabilities = [], bookings = []) {
  return availabilities
    .flatMap((availability) => subtractBookingsFromAvailability(availability, bookings))
    .sort((first, second) => first.start.localeCompare(second.start));
}

export function getAvailabilityBookingState(availability, bookings = []) {
  const hasBooking = getBookingsForHome(bookings, availability.homeId).some((booking) =>
    rangesOverlap(availability, booking),
  );

  if (!hasBooking) {
    return "free";
  }

  return subtractBookingsFromAvailability(availability, bookings).length ? "partial" : "booked";
}

export function isRangeBookable(homeId, start, end, availabilities = [], bookings = []) {
  if (!homeId || !isValidRange(start, end)) {
    return false;
  }

  return getBookableAvailabilities(availabilities, bookings).some(
    (availability) =>
      availability.homeId === homeId &&
      !isBefore(parseISO(start), parseISO(availability.start)) &&
      !isAfter(parseISO(end), parseISO(availability.end)) &&
      !getBookingsForHome(bookings, homeId).some((booking) => rangesOverlap({ start, end }, booking)),
  );
}

export function findMatches(availabilities, homes, currentUserId, bookings = [], options = {}) {
  const bookableAvailabilities = getBookableAvailabilities(availabilities, bookings);
  const sourceHomeIds = options.sourceHomeIds ? new Set(options.sourceHomeIds) : null;
  const userAvailabilities = bookableAvailabilities.filter(
    (availability) => availability.ownerId === currentUserId && (!sourceHomeIds || sourceHomeIds.has(availability.homeId)),
  );
  const otherAvailabilities = bookableAvailabilities.filter((availability) => availability.ownerId !== currentUserId);

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
