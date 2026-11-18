import { describe, expect, it } from "vitest";
import type { TransportDetails } from "../domain/types";
import { CommandError } from "./commands";
import { cleanTransportDriver, cleanTransportRequest, EMPTY_TRANSPORT, mergeTransport, STAGE_LIMITS } from "./stageRules";

const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : String(e);
  }
};

describe("mergeTransport", () => {
  const loaded: TransportDetails = { ...EMPTY_TRANSPORT, driver_name: "נהג/ת לדוגמה" };

  it("keeps an address the escort sent while the team's form was open", () => {
    const draft = { ...loaded, pickup_time: "אחרי השיעור", arranged: true };
    const current = { ...loaded, pickup_address: "כתובת מהמלווה" };
    expect(mergeTransport(loaded, draft, current)).toEqual({ ...EMPTY_TRANSPORT, pickup_address: "כתובת מהמלווה", pickup_time: "אחרי השיעור", driver_name: "נהג/ת לדוגמה", arranged: true });
  });

  it("writes what the form changed, an emptied field included", () => {
    const draft = { ...loaded, pickup_address: "כתובת מהצוות", driver_name: null };
    const current = { ...loaded, pickup_address: "כתובת מהמלווה" };
    expect(mergeTransport(loaded, draft, current)).toEqual({ ...EMPTY_TRANSPORT, pickup_address: "כתובת מהצוות" });
  });

  it("saves the draft as it is when the current details could not be read", () => {
    const draft = { ...loaded, arranged: true };
    expect(mergeTransport(loaded, draft, null)).toEqual(draft);
  });
});

describe("transport in two parts (v18): what each half takes", () => {
  it("the request: only the keys present come back, each cleaned — an empty text is null, undefined is an absent key", () => {
    expect(cleanTransportRequest({})).toEqual({});
    expect(cleanTransportRequest({ pickup_address: "  כתובת   לדוגמה ", pickup_time: " ", pickup_min: 435 })).toEqual({ pickup_address: "כתובת לדוגמה", pickup_time: null, pickup_min: 435 });
    expect(cleanTransportRequest({ pickup_min: null })).toEqual({ pickup_min: null });
    expect(cleanTransportRequest({ pickup_time: "07:15", pickup_address: undefined })).toEqual({ pickup_time: "07:15" });
    expect(Object.keys(cleanTransportRequest({ pickup_address: null }))).toEqual(["pickup_address"]);
    expect(cleanTransportRequest({ pickup_min: 0 })).toEqual({ pickup_min: 0 });
    expect(cleanTransportRequest({ pickup_min: STAGE_LIMITS.pickup_min_max })).toEqual({ pickup_min: 1830 });
  });

  it("the request refuses: not an object, another half's key, a text that is not one, a minute that is not whole or out of 0–1830, a text past its limit", () => {
    for (const v of [null, undefined, "כתובת", 7, [], [{ pickup_time: "07:15" }]]) expect(code(() => cleanTransportRequest(v))).toBe("bad_value");
    expect(code(() => cleanTransportRequest({ driver_name: "נהג/ת לדוגמה" }))).toBe("bad_value");
    expect(code(() => cleanTransportRequest({ pickup_time: "07:15", arranged: true }))).toBe("bad_value");
    expect(code(() => cleanTransportRequest({ pickup_address: 7 }))).toBe("bad_value");
    expect(code(() => cleanTransportRequest({ pickup_time: 715 }))).toBe("bad_value");
    expect(code(() => cleanTransportRequest({ pickup_time: ["07:15"] }))).toBe("bad_value");
    for (const m of [-1, 1831, 435.5, "435", true, Number.NaN]) expect(code(() => cleanTransportRequest({ pickup_min: m }))).toBe("bad_value");
    expect(code(() => cleanTransportRequest({ pickup_address: "א".repeat(200) }))).toBe("ok");
    expect(code(() => cleanTransportRequest({ pickup_address: "א".repeat(201) }))).toBe("bad_value");
    expect(code(() => cleanTransportRequest({ pickup_time: "א".repeat(61) }))).toBe("bad_value");
  });

  it("the driver: the keys present, cleaned; a phone of at least six digits; arranged a boolean", () => {
    expect(cleanTransportDriver({})).toEqual({});
    expect(cleanTransportDriver({ driver_name: " נהג/ת   לדוגמה ", driver_phone: " 555 0100 ", arranged: true })).toEqual({ driver_name: "נהג/ת לדוגמה", driver_phone: "555 0100", arranged: true });
    expect(cleanTransportDriver({ driver_phone: "", arranged: false })).toEqual({ driver_phone: null, arranged: false });
    expect(cleanTransportDriver({ driver_name: null, arranged: undefined })).toEqual({ driver_name: null });
  });

  it("the driver refuses: the shape first (bad_value), then the values — a long name before a short phone", () => {
    for (const v of [null, "נהג/ת", []]) expect(code(() => cleanTransportDriver(v))).toBe("bad_value");
    expect(code(() => cleanTransportDriver({ pickup_address: "כתובת לדוגמה" }))).toBe("bad_value");
    expect(code(() => cleanTransportDriver({ pickup_min: 435 }))).toBe("bad_value");
    expect(code(() => cleanTransportDriver({ driver_name: 7 }))).toBe("bad_value");
    for (const a of [null, "true", 1]) expect(code(() => cleanTransportDriver({ arranged: a }))).toBe("bad_value");
    expect(code(() => cleanTransportDriver({ driver_phone: "12-34" }))).toBe("bad_phone");
    expect(code(() => cleanTransportDriver({ driver_phone: "12-34", arranged: "yes" }))).toBe("bad_value"); // the shape is checked first
    expect(code(() => cleanTransportDriver({ driver_phone: "12-34", driver_name: "א".repeat(81) }))).toBe("bad_value"); // the name's limit before the phone's digits
    expect(code(() => cleanTransportDriver({ driver_phone: "5".repeat(41) }))).toBe("bad_value");
    expect(code(() => cleanTransportDriver({ driver_name: "א".repeat(80), driver_phone: "555 0100" }))).toBe("ok");
  });
});
