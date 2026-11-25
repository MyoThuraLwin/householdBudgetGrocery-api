import { z } from "zod";

export const priceDateSchema = z
  .string()
  .trim()
  .transform((value) => {
    const nz = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    return nz
      ? `${nz[3]}-${nz[2].padStart(2, "0")}-${nz[1].padStart(2, "0")}`
      : value;
  })
  .pipe(
    z.iso.date({
      error: "Use a real price date, e.g. 2026-11-26 or 26/11/2026.",
    }),
  );

// Date-only prices are checked on a New Zealand calendar day. Use midnight
// at the start of that day; do not invent a check time or use the import time.
export function priceDateInstant(date: string) {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: "Pacific/Auckland",
    timeZoneName: "longOffset",
  });
  let instant = midnight;
  for (let attempt = 0; attempt < 3; attempt++) {
    const zone = formatter
      .formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")!.value;
    const offset = /GMT([+-])(\d{2}):(\d{2})/.exec(zone)!;
    const minutes =
      (Number(offset[2]) * 60 + Number(offset[3])) *
      (offset[1] === "+" ? 1 : -1);
    instant = midnight - minutes * 60000;
  }
  return new Date(instant).toISOString();
}
