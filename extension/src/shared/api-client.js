export function createApiClient(baseUrl) {
  const httpBase = baseUrl.replace(/\/$/, "");
  const wsBase = httpBase.replace(/^http/, "ws");

  return {
    async createJob({ videoUrl, moodleVideoId, userId }) {
      const res = await fetch(`${httpBase}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: videoUrl,
          moodle_video_id: moodleVideoId ?? null,
          user_id: userId ?? null,
        }),
      });
      if (!res.ok) {
        const error = new Error(`createJob failed: ${res.status}`);
        error.status = res.status; // 403 == lecture quota reached
        throw error;
      }
      return res.json();
    },

    async getUsage(userId) {
      const res = await fetch(`${httpBase}/users/${encodeURIComponent(userId)}/usage`);
      if (!res.ok) throw new Error(`getUsage failed: ${res.status}`);
      return res.json();
    },

    async claimReview(userId, { username, referredBy } = {}) {
      const res = await fetch(`${httpBase}/users/${encodeURIComponent(userId)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username || null, referred_by: referredBy || null }),
      });
      if (!res.ok) throw new Error(`claimReview failed: ${res.status}`);
      return res.json();
    },

    async purgeCache(userId, moodleVideoIds) {
      const res = await fetch(`${httpBase}/cache/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, moodle_video_ids: moodleVideoIds }),
      });
      if (!res.ok) {
        const error = new Error(`purgeCache failed: ${res.status}`);
        error.status = res.status;
        throw error;
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
