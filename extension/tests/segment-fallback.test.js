import { describe, expect, it, vi } from "vitest";
import { fallbackForMissedSegments } from "../src/content/segment-fallback.js";

function makeSidebarOverlay() {
  const sidebar = { segments: [], addSegment: vi.fn((s) => sidebar.segments.push(s)) };
  const overlay = { segments: [], addSegment: vi.fn((s) => overlay.segments.push(s)) };
  return { sidebar, overlay };
}

describe("fallbackForMissedSegments", () => {
  it("backfills the full transcript when the job already completed before any segment arrived", async () => {
    const api = { getJob: vi.fn().mockResolvedValue({ status: "completed", text: "full transcript" }) };
    const { sidebar, overlay } = makeSidebarOverlay();

    await fallbackForMissedSegments(api, "job-1", sidebar, overlay, 5, 0);

    expect(sidebar.addSegment).toHaveBeenCalledWith({ text: "full transcript", start: 0, end: Number.MAX_SAFE_INTEGER });
    expect(overlay.addSegment).toHaveBeenCalledWith({ text: "full transcript", start: 0, end: Number.MAX_SAFE_INTEGER });
  });

  it("does nothing if segments already arrived via the websocket", async () => {
    const api = { getJob: vi.fn().mockResolvedValue({ status: "completed", text: "full transcript" }) };
    const { sidebar, overlay } = makeSidebarOverlay();
    sidebar.segments.push({ text: "already here", start: 0, end: 2 });

    await fallbackForMissedSegments(api, "job-1", sidebar, overlay, 5, 0);

    expect(sidebar.addSegment).not.toHaveBeenCalled();
    expect(overlay.addSegment).not.toHaveBeenCalled();
  });

  it("gives up quietly when the job fails", async () => {
    const api = { getJob: vi.fn().mockResolvedValue({ status: "failed" }) };
    const { sidebar, overlay } = makeSidebarOverlay();

    await fallbackForMissedSegments(api, "job-1", sidebar, overlay, 5, 0);

    expect(api.getJob).toHaveBeenCalledTimes(1);
    expect(sidebar.addSegment).not.toHaveBeenCalled();
  });

  it("retries while the job is still processing, then backfills once it completes", async () => {
    const api = {
      getJob: vi
        .fn()
        .mockResolvedValueOnce({ status: "queued" })
        .mockResolvedValueOnce({ status: "transcribing" })
        .mockResolvedValueOnce({ status: "completed", text: "done" }),
    };
    const { sidebar, overlay } = makeSidebarOverlay();

    await fallbackForMissedSegments(api, "job-1", sidebar, overlay, 5, 0);

    expect(api.getJob).toHaveBeenCalledTimes(3);
    expect(sidebar.segments).toEqual([{ text: "done", start: 0, end: Number.MAX_SAFE_INTEGER }]);
  });

  it("stops after the max number of attempts if the job never completes", async () => {
    const api = { getJob: vi.fn().mockResolvedValue({ status: "transcribing" }) };
    const { sidebar, overlay } = makeSidebarOverlay();

    await fallbackForMissedSegments(api, "job-1", sidebar, overlay, 3, 0);

    expect(api.getJob).toHaveBeenCalledTimes(3);
    expect(sidebar.addSegment).not.toHaveBeenCalled();
  });
});
