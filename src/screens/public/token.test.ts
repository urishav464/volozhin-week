import { describe, expect, it } from "vitest";
import { publicScopeOf, tokenOf } from "./token";

describe("the public pages' addresses", () => {
  it("knows /e, /k and /s — and nothing else — as public pages", () => {
    expect(publicScopeOf("/e")).toBe("escort");
    expect(publicScopeOf("/k/")).toBe("kk_signup");
    expect(publicScopeOf("/s")).toBe("schedule");
    for (const p of ["/", "/settings/links", "/kk", "/e/x", "/escort", "/S"]) expect(publicScopeOf(p), p).toBeNull();
  });

  it("reads the token after #, and nothing when there is none", () => {
    expect(tokenOf("#AbC_d-123456789012345")).toBe("AbC_d-123456789012345");
    expect(tokenOf("AbC")).toBe("AbC");
    expect(tokenOf("#demo-e-1-2-dugma00000")).toBe("demo-e-1-2-dugma00000");
    expect(tokenOf("#a%2Db")).toBe("a-b");
    expect(tokenOf("#%E0%A4%A")).toBe("%E0%A4%A"); // malformed escapes: as typed (the server refuses it alike)
    expect(tokenOf("")).toBeNull();
    expect(tokenOf("#")).toBeNull();
    expect(tokenOf("#   ")).toBeNull();
  });
});
