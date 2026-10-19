// The speaker sheet's buttons — call, WhatsApp, e-mail — from the contacts as
// someone typed them. A phone gets a link only with at least 6 digits (the
// database's own rule, written in public.set_speaker_contacts; cleanPhone in
// src/data/speakerRules.ts is its browser twin); a placeholder or a half-typed
// number stays plain text. Nothing here is stored: the links are built on screen.

/** The digits of a phone as typed («050 …», «+972-…», «(02) …»). */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/[^0-9]/g, "");
}

/** tel: with the digits (a leading + kept). */
export function telHref(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone);
  if (d.length < 6) return null;
  return `tel:${(phone ?? "").trim().startsWith("+") ? "+" : ""}${d}`;
}

/**
 * wa.me wants the international number, digits only. The speakers are in
 * Israel, so a local number (one leading 0) becomes 972…; 00… drops the 00;
 * anything else (already international) is sent as is.
 */
export function waHref(phone: string | null | undefined): string | null {
  let d = phoneDigits(phone);
  if (d.length < 6) return null;
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `972${d.slice(1)}`;
  return `https://wa.me/${d}`;
}

/** mailto: for an address with @ and a dot after it (the database's rule too). */
export function mailHref(email: string | null | undefined): string | null {
  const e = (email ?? "").trim();
  return /^[^ @]+@[^ @]+\.[^ @]+$/.test(e) ? `mailto:${e}` : null;
}
