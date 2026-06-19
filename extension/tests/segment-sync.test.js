import { describe, expect, it } from "vitest";
import { findActiveSegmentIndex } from "../src/content/segment-sync.js";

describe("findActiveSegmentIndex", () => {
  const segments = [
    { start: 0, end: 2 },
    { start: 2, end: 5 },
    { start: 5, end: 9 },
  ];

  it("returns -1 before the first segment starts", () => {
    expect(findActiveSegmentIndex(segments, -1)).toBe(-1);
  });

  it("finds the segment containing the current time", () => {
    expect(findActiveSegmentIndex(segments, 0)).toBe(0);
    expect(findActiveSegmentIndex(segments, 1.9)).toBe(0);
    expect(findActiveSegmentIndex(segments, 3)).toBe(1);
    expect(findActiveSegmentIndex(segments, 8.9)).toBe(2);
  });

  it("returns the last segment once playback is past the final segment's start", () => {
    expect(findActiveSegmentIndex(segments, 100)).toBe(2);
  });

  it("returns -1 for an empty segment list", () => {
    expect(findActiveSegmentIndex([], 5)).toBe(-1);
  });
});
