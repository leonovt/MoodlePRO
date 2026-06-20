/**
 * BGU Moodle videos play through a native video.js player (class `vjs-tech`)
 * with a direct, unencrypted MP4 `<source>` — no DRM, no captions.
 */
export function findMoodleVideoId(doc) {
  const el = doc.querySelector(
    'a[href*="thumb.php?id="], [data-video-id], video[poster*="thumb.php?id="]'
  );
  if (!el) return null;
  if (el.hasAttribute("data-video-id")) {
    return el.getAttribute("data-video-id");
  }
  const url = el.hasAttribute("poster") ? el.getAttribute("poster") : el.getAttribute("href");
  const match = url.match(/id=(\d+)/);
  return match ? match[1] : null;
}

function findMp4Src(video) {
  const directSrc = video.getAttribute("src");
  if (directSrc) return directSrc;
  const source = video.querySelector("source[src]");
  return source ? source.getAttribute("src") : null;
}

export function findBguVideoPlayer(doc) {
  // video.js sets `vjs-tech`/`src` directly on the <video> once it initializes;
  // before that (or if init is deferred) the mp4 lives on a nested <source> instead.
  const video = doc.querySelector('video.vjs-tech[src], video[class*="video-js"], video');
  if (!video) return null;

  const src = findMp4Src(video);
  if (!src || !src.toLowerCase().includes(".mp4")) return null;

  return {
    videoEl: video,
    mp4Url: src,
    moodleVideoId: findMoodleVideoId(doc),
  };
}
