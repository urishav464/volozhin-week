import { describe, expect, it } from "vitest";
import type { TransportDetails } from "../domain/types";
import { EMPTY_TRANSPORT, mergeTransport } from "./stageRules";

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
