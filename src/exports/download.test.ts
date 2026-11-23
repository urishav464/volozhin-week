// A file's name for the person's computer (the review of the reset, phase 5): no control or bidi character survives —
// an RLO would show «…fdp.scr» as «…rcs.pdf» — and an uploaded file is named by the extension of what is STORED (its
// path's, which app.source_mime_ok ties to its type), never the one its display name gives itself.
import { describe, expect, it } from "vitest";
import { safeEntryName, storedFileName } from "./download";

describe("file names", () => {
  it("safeEntryName: separators and refused characters, and every control or format character, become «_»", () => {
    expect(safeEntryName('..\\a:b*?"<>|')).toBe("a_b______");
    expect(safeEntryName("שקפים‮fdp.scr")).toBe("שקפים_fdp.scr");
    for (const c of ["\u0000", "\u001f", "\u007f", "\u0085", "\u009f", "‎", "‏", "‪", "‮", "⁦", "⁩", "​", "﻿"]) {
      expect(safeEntryName(`a${c}b.pdf`), c.codePointAt(0)!.toString(16)).toBe("a_b.pdf");
    }
    // Hebrew, its punctuation and its points stay
    expect(safeEntryName("ד״ר מרצה 01 – מקורות לשיעור (לדוגמה).pdf")).toBe("ד״ר מרצה 01 – מקורות לשיעור (לדוגמה).pdf");
    expect(safeEntryName("‮")).toBe("file");
    expect([...safeEntryName("א".repeat(200) + ".pdf")]).toHaveLength(80);
    expect(safeEntryName("א".repeat(200) + ".pdf").endsWith(".pdf")).toBe(true);
  });

  it("storedFileName: the display name's stem and the stored extension", () => {
    expect(storedFileName("מצגת לדוגמה.pdf", "pdf")).toBe("מצגת לדוגמה.pdf");
    expect(storedFileName("x.pdf.exe", "pdf")).toBe("x.pdf.pdf");
    expect(storedFileName("1000012345", "pdf")).toBe("1000012345.pdf");
    expect(storedFileName("deck.pdf", "pptx")).toBe("deck.pptx");
    expect(storedFileName("שקפים.PPTX", "pptx")).toBe("שקפים.pptx");
    expect(storedFileName("שקפים‮fdp.scr", "pdf")).toBe("שקפים_fdp.pdf");
    expect(storedFileName(".pdf", "pdf")).toBe("file.pdf");
    const long = storedFileName("א".repeat(200) + ".exe", "docx");
    expect([...long]).toHaveLength(80);
    expect(long.endsWith("א.docx")).toBe(true);
    // no extension known (a path the rule does not read): the safe name as it is
    expect(storedFileName("a/b.pdf", undefined)).toBe("a_b.pdf");
    expect(storedFileName("a/b.pdf", null)).toBe("a_b.pdf");
  });
});
