import { describe, expect, it } from "vitest";
import { parseSrt } from "../src/content/srt-parser.js";

describe("parseSrt", () => {
  it("parses multiple timestamped blocks into segments", () => {
    const srt = [
      "1",
      "00:00:00,000 --> 00:00:02,500",
      "שלום וברוכים הבאים",
      "",
      "2",
      "00:00:02,500 --> 00:00:05,000",
      "היום נדבר על מערכות מבוזרות",
      "",
    ].join("\n");

    expect(parseSrt(srt)).toEqual([
      { start: 0, end: 2.5, text: "שלום וברוכים הבאים" },
      { start: 2.5, end: 5, text: "היום נדבר על מערכות מבוזרות" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseSrt("")).toEqual([]);
  });

  it("parses hour-scale timestamps", () => {
    const srt = ["1", "01:02:03,250 --> 01:02:05,000", "line"].join("\n");
    expect(parseSrt(srt)).toEqual([{ start: 3723.25, end: 3725, text: "line" }]);
  });
});
