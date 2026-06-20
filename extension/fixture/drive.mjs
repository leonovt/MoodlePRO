import { chromium } from "playwright";
import fs from "fs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

// --- 1. video page: toolbar + timestamped captions ---
await page.goto("http://localhost:5500/fixture/video-page.html");
await page.addScriptTag({ content: "window.chrome = { runtime: { sendMessage: (m) => console.log('sendMessage', JSON.stringify(m)) } };" });
await page.addScriptTag({ path: "dist/content.js" });

await page.waitForSelector("#moodlepro-video-toolbar", { timeout: 10000 });
await page.waitForSelector("#moodlepro-caption-overlay", { timeout: 10000 });
console.log("toolbar buttons:", await page.$$eval("#moodlepro-video-toolbar button", (els) => els.map((e) => e.textContent)));

await page.screenshot({ path: "fixture/out-1-toolbar.png" });

// wait for chapters button to appear (depends on /jobs/{id}/chapters succeeding)
try {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("#moodlepro-video-toolbar button")).some((b) => b.textContent === "Chapters"),
    { timeout: 8000 }
  );
  await page.click("#moodlepro-video-toolbar button:has-text('Chapters')");
  await page.screenshot({ path: "fixture/out-2-chapters-dropdown.png" });
} catch (e) {
  console.log("no chapters button appeared in time:", e.message);
}

// give the websocket/fallback time to backfill segments, then scrub the video and fire timeupdate
await page.waitForTimeout(3000);
const segCount = await page.evaluate(() => {
  const overlay = document.querySelector("#moodlepro-caption-overlay");
  return overlay ? overlay.textContent.length : -1;
});
console.log("overlay text length after wait:", segCount);

await page.evaluate(() => {
  const video = document.querySelector("video");
  video.currentTime = 3;
  video.dispatchEvent(new Event("timeupdate"));
});
await page.waitForTimeout(300);
const overlayText = await page.$eval("#moodlepro-caption-overlay", (el) => el.textContent);
console.log("caption overlay text at t=3s:", JSON.stringify(overlayText));
await page.screenshot({ path: "fixture/out-3-caption.png" });

const sidebarLines = await page.$$eval("#moodlepro-sidebar div", (els) => els.map((e) => e.textContent));
console.log("sidebar lines:", JSON.stringify(sidebarLines));

await page.close();

// --- 2. quiz modal text visibility on a dark host page ---
const page2 = await browser.newPage({ viewport: { width: 700, height: 500 } });
page2.on("console", (msg) => console.log("[modal console]", msg.type(), msg.text()));
await page2.goto("http://localhost:5500/fixture/modal-page.html");
await page2.evaluate(() => window.__showQuiz());
await page2.waitForSelector("#moodlepro-modal");
const colors = await page2.$eval("#moodlepro-modal", (el) => {
  const box = getComputedStyle(el);
  const q = el.querySelector("div");
  return { boxBg: box.backgroundColor, boxColor: box.color, qColor: q ? getComputedStyle(q).color : null };
});
console.log("modal computed colors:", JSON.stringify(colors));
await page2.screenshot({ path: "fixture/out-4-quiz-modal.png" });

// --- 3. course page: slides item -> real PDF -> Summary + Quiz via Gemini ---
const page3 = await browser.newPage({ viewport: { width: 900, height: 700 } });
page3.on("console", (msg) => console.log("[course console]", msg.type(), msg.text()));
page3.on("pageerror", (err) => console.log("[course pageerror]", err.message));

await page3.goto("http://localhost:5500/fixture/course-page.html");
await page3.addScriptTag({ content: "window.chrome = { runtime: { sendMessage: () => {} } };" });
await page3.addScriptTag({ path: "dist/content.js" });

await page3.waitForSelector('[data-moodlepro-ui="1"]', { timeout: 10000 });
await page3.click('[data-moodlepro-ui="1"]');

await page3.waitForSelector("#moodlepro-modal", { timeout: 5000 });
await page3.screenshot({ path: "fixture/out-5-slides-loading.png" });

await page3.waitForFunction(
  () => {
    const modal = document.querySelector("#moodlepro-modal");
    return modal && !modal.textContent.includes("Loading");
  },
  { timeout: 20000 }
);
const modalText = await page3.$eval("#moodlepro-modal", (el) => el.textContent);
console.log("slides summary+quiz modal text:", modalText.slice(0, 400));
await page3.screenshot({ path: "fixture/out-6-slides-result.png" });

await browser.close();
fs.writeFileSync("fixture/done.txt", "ok");
