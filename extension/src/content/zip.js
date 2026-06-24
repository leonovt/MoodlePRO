/**
 * Minimal, dependency-free ZIP writer using the "store" method (no compression). The files
 * we bundle are either already compressed (PDF/PPTX/DOCX) or small text transcripts, so
 * compression would buy little while pulling in a dependency. Produces a standard ZIP with
 * local file headers, a central directory, and an end-of-central-directory record.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new TextEncoder().encode(String(data ?? ""));
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, true);
}

/**
 * @param {{ name: string, bytes: Uint8Array|ArrayBuffer|string }[]} entries
 * @returns {Uint8Array} the raw bytes of a ZIP archive
 */
export function buildZip(entries) {
  const encoder = new TextEncoder();
  const records = entries.map((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const data = toBytes(entry.bytes);
    return { nameBytes, data, crc: crc32(data), offset: 0 };
  });

  const LOCAL_HEADER = 30;
  const CENTRAL_HEADER = 46;
  const EOCD = 22;
  const UTF8_FLAG = 0x0800; // bit 11: filename is UTF-8 (needed for Hebrew names)

  let localSize = 0;
  for (const r of records) {
    r.offset = localSize;
    localSize += LOCAL_HEADER + r.nameBytes.length + r.data.length;
  }

  let centralSize = 0;
  for (const r of records) {
    centralSize += CENTRAL_HEADER + r.nameBytes.length;
  }

  const total = localSize + centralSize + EOCD;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  let pos = 0;
  for (const r of records) {
    writeUint32(view, pos, 0x04034b50); // local file header signature
    writeUint16(view, pos + 4, 20); // version needed
    writeUint16(view, pos + 6, UTF8_FLAG);
    writeUint16(view, pos + 8, 0); // method 0 = store
    writeUint16(view, pos + 10, 0); // mod time
    writeUint16(view, pos + 12, 0); // mod date
    writeUint32(view, pos + 14, r.crc);
    writeUint32(view, pos + 18, r.data.length); // compressed size
    writeUint32(view, pos + 22, r.data.length); // uncompressed size
    writeUint16(view, pos + 26, r.nameBytes.length);
    writeUint16(view, pos + 28, 0); // extra field length
    out.set(r.nameBytes, pos + LOCAL_HEADER);
    out.set(r.data, pos + LOCAL_HEADER + r.nameBytes.length);
    pos += LOCAL_HEADER + r.nameBytes.length + r.data.length;
  }

  const centralStart = pos;
  for (const r of records) {
    writeUint32(view, pos, 0x02014b50); // central directory header signature
    writeUint16(view, pos + 4, 20); // version made by
    writeUint16(view, pos + 6, 20); // version needed
    writeUint16(view, pos + 8, UTF8_FLAG);
    writeUint16(view, pos + 10, 0); // method
    writeUint16(view, pos + 12, 0); // mod time
    writeUint16(view, pos + 14, 0); // mod date
    writeUint32(view, pos + 16, r.crc);
    writeUint32(view, pos + 20, r.data.length);
    writeUint32(view, pos + 24, r.data.length);
    writeUint16(view, pos + 28, r.nameBytes.length);
    writeUint16(view, pos + 30, 0); // extra field length
    writeUint16(view, pos + 32, 0); // comment length
    writeUint16(view, pos + 34, 0); // disk number start
    writeUint16(view, pos + 36, 0); // internal attributes
    writeUint32(view, pos + 38, 0); // external attributes
    writeUint32(view, pos + 42, r.offset); // offset of local header
    out.set(r.nameBytes, pos + CENTRAL_HEADER);
    pos += CENTRAL_HEADER + r.nameBytes.length;
  }

  writeUint32(view, pos, 0x06054b50); // EOCD signature
  writeUint16(view, pos + 4, 0); // disk number
  writeUint16(view, pos + 6, 0); // disk with central directory
  writeUint16(view, pos + 8, records.length); // entries on this disk
  writeUint16(view, pos + 10, records.length); // total entries
  writeUint32(view, pos + 12, centralSize);
  writeUint32(view, pos + 16, centralStart);
  writeUint16(view, pos + 20, 0); // comment length

  return out;
}
