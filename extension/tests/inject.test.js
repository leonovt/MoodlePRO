import { beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/content/inject.js";

class FakeWebSocket {
  constructor(url) {
    FakeWebSocket.instances.push(this);
    this.url = url;
    this.listeners = {};
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  emit(data) {
    this.listeners.message?.({ data: JSON.stringify(data) });
  }
}
FakeWebSocket.instances = [];

function setupDom() {
  document.body.innerHTML = `
    <a href="/local/video_directory/thumb.php?id=439866">thumb</a>
    <div id="player-container">
      <video class="vjs-tech" src="https://cdn.example.com/lec1.mp4"></video>
    </div>
  `;
}

beforeEach(() => {
  setupDom();
  FakeWebSocket.instances = [];
  global.WebSocket = FakeWebSocket;
  global.chrome = { runtime: { sendMessage: vi.fn() } };
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "job-1", status: "queued" }),
  });
});

describe("inject main()", () => {
  it("returns null when no BGU video player is present", async () => {
    document.body.innerHTML = "<p>no video</p>";
    const result = await main(document, "http://localhost:8000");
    expect(result).toBeNull();
  });

  it("does NOT transcribe automatically — it shows a start button instead", async () => {
    await main(document, "http://localhost:8000");

    expect(global.fetch).not.toHaveBeenCalled(); // no createJob until clicked
    expect(FakeWebSocket.instances).toHaveLength(0);
    const startButton = document.querySelector("#moodlepro-video-toolbar button");
    expect(startButton.textContent).toBe("הצג כתוביות");
  });

  it("wires up sidebar + caption overlay and streams segments once started", async () => {
    const result = await main(document, "http://localhost:8000");
    const ctx = await result.start();

    expect(ctx.job.id).toBe("job-1");
    expect(document.getElementById("moodlepro-sidebar")).not.toBeNull();
    expect(document.getElementById("moodlepro-caption-overlay")).not.toBeNull();

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("ws://localhost:8000/ws/jobs/job-1");

    socket.emit({ type: "segment", text: "שלום", start: 0, end: 2 });

    expect(ctx.sidebar.segments).toEqual([{ type: "segment", text: "שלום", start: 0, end: 2 }]);
    expect(ctx.overlay.segments).toEqual([{ type: "segment", text: "שלום", start: 0, end: 2 }]);
    // loading banner hidden once the first segment arrives
    expect(document.getElementById("moodlepro-status").style.display).toBe("none");
  });

  it("renders the cached transcript immediately when the job is already completed", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "job-2", status: "completed", text: "cached transcript" }),
    });

    const result = await main(document, "http://localhost:8000");
    const ctx = await result.start();

    expect(ctx.socket).toBeNull();
    expect(ctx.job.status).toBe("completed");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("shows an 'on the house' message for a cache hit", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "job-9", status: "completed", text: "cached", from_cache: true }),
    });

    const result = await main(document, "http://localhost:8000");
    await result.start();

    const status = document.getElementById("moodlepro-status");
    expect(status.style.display).not.toBe("none");
    expect(status.textContent).toContain("על חשבון הבית");
  });

  it("hides the loading banner when segments arrive via the HTTP fallback (no socket segment)", async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/srt")) return Promise.resolve({ ok: true, text: async () => "" });
      if (u.endsWith("/jobs")) {
        return Promise.resolve({ ok: true, json: async () => ({ id: "job-1", status: "queued" }) });
      }
      // getJob poll → completed, so the fallback backfills the transcript
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: "job-1", status: "completed", text: "שלום" }),
      });
    });

    const result = await main(document, "http://localhost:8000");
    await result.start();

    // No socket "segment" event is ever emitted — only the fallback poller fills segments.
    await vi.waitFor(() => {
      expect(document.getElementById("moodlepro-status").style.display).toBe("none");
    });
  });

  it("shows an error and re-enables the start button when starting fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await main(document, "http://localhost:8000");
    const startButton = document.querySelector("#moodlepro-video-toolbar button");

    await result.start().catch(() => {});

    const status = document.getElementById("moodlepro-status");
    expect(status.style.display).not.toBe("none");
    expect(status.textContent).toContain("שגיאה");
    expect(startButton.disabled).toBe(false);
  });

  it("shows the review prompt on a 403 quota, then claims the bonus and retries", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a href="https://moodle.bgu.ac.il/moodle/user/profile.php?id=7">profile</a>'
    );
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ ok: false, status: 403 }); // createJob blocked
      return Promise.resolve({ ok: true, json: async () => ({ id: "job-1", status: "queued" }) });
    });

    const result = await main(document, "http://localhost:8000");
    await result.start().catch(() => {});

    const prompt = document.getElementById("moodlepro-quota-backdrop");
    expect(prompt).not.toBeNull();

    const confirmButton = Array.from(prompt.querySelectorAll("button")).find(
      (b) => b.textContent === "כבר השארתי ביקורת"
    );
    confirmButton.click();

    // bonus claimed (POST /review) then job retried, prompt closes
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/users/moodle%3A7/review",
        expect.objectContaining({ method: "POST" })
      );
      expect(document.getElementById("moodlepro-quota-backdrop")).toBeNull();
    });
  });

  it("sends a DOWNLOAD_TRANSCRIPT message to the background worker on button click", async () => {
    const result = await main(document, "http://localhost:8000");
    await result.start();

    const downloadButton = Array.from(
      document.querySelectorAll("#moodlepro-video-toolbar button")
    ).find((b) => b.textContent === "Download");
    downloadButton.click();

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DOWNLOAD_TRANSCRIPT",
        txtUrl: "http://localhost:8000/jobs/job-1/txt",
        srtUrl: "http://localhost:8000/jobs/job-1/srt",
      })
    );
  });
});
