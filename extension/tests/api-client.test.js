import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/shared/api-client.js";

describe("createApiClient", () => {
  let api;

  beforeEach(() => {
    api = createApiClient("http://localhost:8000");
    global.fetch = vi.fn();
  });

  it("posts a job with the video url, moodle video id and user id", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "job-1", status: "queued" }) });

    const job = await api.createJob({ videoUrl: "https://x.mp4", moodleVideoId: "42", userId: "moodle:7" });

    expect(job).toEqual({ id: "job-1", status: "queued" });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/jobs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ video_url: "https://x.mp4", moodle_video_id: "42", user_id: "moodle:7" }),
      })
    );
  });

  it("throws with a .status when job creation fails (e.g. 403 quota)", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(api.createJob({ videoUrl: "https://x.mp4" })).rejects.toMatchObject({ status: 403 });
  });

  it("purges the cache for a set of video ids", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ deleted_transcripts: 2, deleted_mappings: 2, requested_ids: 3 }),
    });

    const result = await api.purgeCache("moodle:7", ["a", "b", "c"]);

    expect(result.deleted_transcripts).toBe(2);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/cache/purge",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ user_id: "moodle:7", moodle_video_ids: ["a", "b", "c"] }),
      })
    );
  });

  it("throws with a .status when purge is not authorized (403)", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(api.purgeCache("moodle:7", ["a"])).rejects.toMatchObject({ status: 403 });
  });

  it("gets usage and claims the review bonus", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ used: 5, limit: 10, reviewed: true }) });

    expect(await api.getUsage("moodle:7")).toEqual({ used: 5, limit: 10, reviewed: true });
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:8000/users/moodle%3A7/usage");

    await api.claimReview("moodle:7");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/users/moodle%3A7/review",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("builds txt/srt/ws urls relative to the configured server", () => {
    expect(api.txtUrl("job-1")).toBe("http://localhost:8000/jobs/job-1/txt");
    expect(api.srtUrl("job-1")).toBe("http://localhost:8000/jobs/job-1/srt");
    expect(api.wsUrl("job-1")).toBe("ws://localhost:8000/ws/jobs/job-1");
  });
});
