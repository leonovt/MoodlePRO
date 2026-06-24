import { describe, expect, it } from "vitest";
import { buildZip, crc32 } from "../src/content/zip.js";

const LOCAL_SIG = [0x50, 0x4b, 0x03, 0x04];
const EOCD_SIG = 0x06054b50;

describe("crc32", () => {
  it("matches the standard check vector for '123456789'", () => {
    const bytes = new TextEncoder().encode("123456789");
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("buildZip", () => {
  it("starts with the local file header signature", () => {
    const zip = buildZip([{ name: "a.txt", bytes: "hello" }]);
    expect(Array.from(zip.slice(0, 4))).toEqual(LOCAL_SIG);
  });

  it("embeds each entry's filename and stored content", () => {
    const zip = buildZip([{ name: "notes.txt", bytes: "transcript body" }]);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("notes.txt");
    expect(text).toContain("transcript body");
  });

  it("records the entry count in the end-of-central-directory record", () => {
    const zip = buildZip([
      { name: "one.txt", bytes: "1" },
      { name: "two.txt", bytes: "22" },
      { name: "three.txt", bytes: "333" },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const eocdOffset = zip.byteLength - 22;
    expect(view.getUint32(eocdOffset, true)).toBe(EOCD_SIG);
    expect(view.getUint16(eocdOffset + 10, true)).toBe(3); // total entries
  });

  it("UTF-8 encodes non-ASCII (Hebrew) filenames", () => {
    const zip = buildZip([{ name: "הרצאה.txt", bytes: "x" }]);
    const expected = new TextEncoder().encode("הרצאה.txt");
    // The name bytes follow the 30-byte local header.
    const slice = zip.slice(30, 30 + expected.length);
    expect(Array.from(slice)).toEqual(Array.from(expected));
  });

  it("accepts Uint8Array and ArrayBuffer payloads", () => {
    const u8 = new Uint8Array([1, 2, 3]);
    expect(() => buildZip([{ name: "b.bin", bytes: u8 }])).not.toThrow();
    expect(() => buildZip([{ name: "c.bin", bytes: u8.buffer }])).not.toThrow();
  });
});
