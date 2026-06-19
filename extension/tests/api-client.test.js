import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/shared/api-client.js";

describe("createApiClient", () => {
  let api;

  beforeEach(() => {
    api = createApiClient("http://localhost:8000");
    global.fetch = vi.fn();
  });

  it("posts a job with the video url and moodle video id", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "job-1", status: "queued" }) });

    const job = await api.createJob({ videoUrl: "https://x.mp4", moodleVideoId: "42" });

    expect(job).toEqual({ id: "job-1", status: "queued" });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/jobs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ video_url: "https://x.mp4", moodle_video_id: "42" }),
      })
    );
  });

  it("throws when job creation fails", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(api.createJob({ videoUrl: "https://x.mp4" })).rejects.toThrow("createJob failed: 500");
  });

  it("builds txt/srt/ws urls relative to the configured server", () => {
    expect(api.txtUrl("job-1")).toBe("http://localhost:8000/jobs/job-1/txt");
    expect(api.srtUrl("job-1")).toBe("http://localhost:8000/jobs/job-1/srt");
    expect(api.wsUrl("job-1")).toBe("ws://localhost:8000/ws/jobs/job-1");
  });
});
