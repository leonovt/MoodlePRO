function parseTimestamp(ts) {
  const match = ts.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  const [, hours, minutes, seconds, millis] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
}

/** Parses standard .srt text into `{ start, end, text }` segments, in seconds. */
export function parseSrt(srtText) {
  if (!srtText) return [];

  return srtText
    .replace(/\r/g, "")
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split("\n").filter((line) => line.length > 0);
      const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeLineIndex === -1) return null;

      const [startStr, endStr] = lines[timeLineIndex].split("-->");
      const text = lines.slice(timeLineIndex + 1).join(" ").trim();
      if (!text) return null;

      return { start: parseTimestamp(startStr), end: parseTimestamp(endStr), text };
    })
    .filter((segment) => segment !== null);
}
