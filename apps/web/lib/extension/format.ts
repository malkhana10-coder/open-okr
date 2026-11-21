/**
 * Numbers and dates on the planning screens.
 *
 * Western digits and the Gregorian calendar in every language (design
 * b0-vertical-slice.md §12.5, decision 5), with the reader's own separators
 * and month names. Arabic's defaults are Eastern Arabic digits and, in some
 * locales, another calendar, so both are named here rather than left to the
 * locale. A later setting can choose otherwise; this is where it would go.
 */
export function planningFormat(
  locale: string,
  timeZone: string,
): {
  readonly number: (value: number) => string;
  readonly date: (iso: string) => string;
} {
  const tag = `${locale}-u-nu-latn-ca-gregory`;
  const numbers = new Intl.NumberFormat(tag);
  // The month by name: a numeric date is read day-first in one language and
  // month-first in another.
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  let dates: Intl.DateTimeFormat;
  try {
    dates = new Intl.DateTimeFormat(tag, { ...options, timeZone });
  } catch {
    // A member's stored zone that the runtime does not know.
    dates = new Intl.DateTimeFormat(tag, { ...options, timeZone: "UTC" });
  }
  return {
    number: (value) => numbers.format(value),
    date: (iso) => dates.format(new Date(iso)),
  };
}
