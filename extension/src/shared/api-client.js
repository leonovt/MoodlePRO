export function createApiClient(baseUrl) {
  const httpBase = baseUrl.replace(/\/$/, "");
  const wsBase = httpBase.replace(/^http/, "ws");

  return {
    async createJob({ videoUrl, moodleVideoId }) {
      const res = await fetch(`${httpBase}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_url: videoUrl, moodle_video_id: moodleVideoId ?? null }),
      });
      if (!res.ok) {
        throw new Error(`createJob failed: ${res.status}`);
      }
      return res.json();
    },

    async getJob(jobId) {
      const res = await fetch(`${httpBase}/jobs/${jobId}`);
      if (!res.ok) {
        throw new Error(`getJob failed: ${res.status}`);
      }
      return res.json();
    },

    txtUrl(jobId) {
      return `${httpBase}/jobs/${jobId}/txt`;
    },

    srtUrl(jobId) {
      return `${httpBase}/jobs/${jobId}/srt`;
    },

    wsUrl(jobId) {
      return `${wsBase}/ws/jobs/${jobId}`;
    },
  };
}
