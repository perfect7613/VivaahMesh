import type { Lang } from "./i18n";

export function formatVenueTime(minutes: number, lang: Lang) {
  return new Intl.DateTimeFormat(`${lang}-IN`, {
    hour: "numeric", minute: "2-digit", timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, 0, 1, 0, minutes)));
}
