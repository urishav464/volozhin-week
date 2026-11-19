import { describe, expect, it } from "vitest";
import { cleanTransportRequest } from "../../data/stageRules";
import type { Lesson, TransportDetails } from "../../domain/types";
import { NEED_AMOUNT, NEED_PICKUP, type RequestInput, requestPlan } from "./request";

type L = Pick<Lesson, "pay_amount" | "transport" | "approval" | "start_min">;
const fresh: L = { pay_amount: null, transport: "none", approval: "none", start_min: 600 };
const nothingRead: TransportDetails = { pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged: false };
const form = (f: Partial<RequestInput> = {}): RequestInput => ({ kind: "none", amount: "", transport: "none", address: null, time: null, ...f });

describe("requestPlan: nothing asked yet", () => {
  it("as it stands: nothing to send, the button under its usual name", () => {
    const p = requestPlan(fresh, form(), nothingRead);
    expect(p).toMatchObject({ asks: false, payChanged: false, nothing: true, label: "שליחה לאישור", problem: null, payment: null, pickup: null });
  });

  it("an amount alone: set_payment only", () => {
    const p = requestPlan(fresh, form({ kind: "paid", amount: "1,500 ₪" }), nothingRead);
    expect(p).toMatchObject({ value: 1500, label: "שליחה לאישור", payment: { amount: 1500, transport: "none" }, pickup: null, ok: "הבקשה נשלחה לאישור" });
  });

  it("a transport: both pickup fields are asked for, then both calls go — the pickup with its minute", () => {
    expect(requestPlan(fresh, form({ transport: "round_trip" }), nothingRead).problem).toBe(NEED_PICKUP);
    expect(requestPlan(fresh, form({ transport: "round_trip", address: "רחוב לדוגמה 1" }), nothingRead).problem).toBe(NEED_PICKUP);
    expect(requestPlan(fresh, form({ transport: "round_trip", address: "  ", time: "08:00" }), nothingRead).problem).toBe(NEED_PICKUP);
    const p = requestPlan(fresh, form({ transport: "round_trip", address: " רחוב לדוגמה 1 ", time: "08:00" }), nothingRead);
    expect(p.problem).toBeNull();
    expect(p.payment).toEqual({ amount: null, transport: "round_trip" });
    expect(p.pickup).toEqual({ pickup_address: "רחוב לדוגמה 1", pickup_time: "08:00", pickup_min: 480 });
    expect(cleanTransportRequest(p.pickup)).toEqual(p.pickup);
  });

  it("a night lesson: the pickup's minute is on the grid's clock", () => {
    const p = requestPlan({ ...fresh, start_min: 1470 }, form({ transport: "one_way", address: "כתובת לדוגמה", time: "00:05" }), nothingRead);
    expect(p.pickup?.pickup_min).toBe(1445);
  });

  it("an amount that is not one: said beside the form, nothing sent", () => {
    expect(requestPlan(fresh, form({ kind: "paid", amount: "" }), nothingRead)).toMatchObject({ problem: NEED_AMOUNT, payment: null, pickup: null });
    const bad = requestPlan(fresh, form({ kind: "paid", amount: "12.5" }), nothingRead);
    expect(bad.value).toBe("bad");
    expect(bad.payment).toBeNull();
    expect(bad.problem).not.toBeNull();
  });
});

describe("requestPlan: where the pickup may not be kept, or is still being read", () => {
  it("null (a practice or demo week): the transport is asked, the pickup never sent", () => {
    const p = requestPlan(fresh, form({ transport: "one_way" }), null);
    expect(p).toMatchObject({ pickupShown: false, problem: null, payment: { amount: null, transport: "one_way" }, pickup: null });
  });

  it("undefined (loading): no pickup on the form", () => {
    expect(requestPlan(fresh, form({ transport: "one_way" }), undefined).pickupShown).toBe(false);
  });
});

describe("requestPlan: a request already sent", () => {
  const pending: L = { pay_amount: 500, transport: "one_way", approval: "pending", start_min: 600 };
  const saved: TransportDetails = { ...nothingRead, pickup_address: "רחוב לדוגמה 1", pickup_time: "08:15" };
  const asSent = form({ kind: "paid", amount: "500", transport: "one_way" });

  it("opened again as it is: the saved pickup on the form, nothing to send", () => {
    const p = requestPlan(pending, asSent, saved);
    expect(p).toMatchObject({ address: "רחוב לדוגמה 1", time: "08:15", nothing: true, payChanged: false });
  });

  it("only the pickup changed: set_transport_request alone — the approval stays", () => {
    const p = requestPlan(pending, { ...asSent, time: "08:30" }, saved);
    expect(p).toMatchObject({ nothing: false, payment: null, label: "שמירת פרטי האיסוף", ok: "פרטי האיסוף נשמרו" });
    expect(p.pickup).toEqual({ pickup_address: "רחוב לדוגמה 1", pickup_time: "08:30", pickup_min: 510 });
  });

  it("a pickup an older screen wrote as words: the time input starts empty, and must be filled to send", () => {
    const words = { ...saved, pickup_time: "אחרי השיעור" };
    const p = requestPlan(pending, { ...asSent, amount: "600" }, words);
    expect(p.time).toBe("");
    expect(p.problem).toBe(NEED_PICKUP);
  });

  it("no transport any more: set_payment alone (it deletes the pickup)", () => {
    const p = requestPlan(pending, { ...asSent, transport: "none" }, saved);
    expect(p).toMatchObject({ pickupShown: false, payment: { amount: 500, transport: "none" }, pickup: null });
  });

  it("everything taken back: «בלי» is a save of its own", () => {
    const p = requestPlan(pending, form(), saved);
    expect(p).toMatchObject({ asks: false, label: "שמירה: בלי תשלום ובלי הסעה", payment: { amount: null, transport: "none" }, ok: "נשמר: בלי תשלום ובלי הסעה" });
  });

  it("a rejected request asked again as it was: «בקשה מחדש», set_payment re-opens it, the pickup again", () => {
    const p = requestPlan({ ...pending, approval: "rejected" }, asSent, saved);
    expect(p).toMatchObject({ label: "בקשה מחדש", nothing: false, payment: { amount: 500, transport: "one_way" } });
    expect(p.pickup).toEqual({ pickup_address: "רחוב לדוגמה 1", pickup_time: "08:15", pickup_min: 495 });
  });
});
