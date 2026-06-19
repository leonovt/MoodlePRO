/**
 * BGU Moodle videos play through a native video.js player (class `vjs-tech`)
 * with a direct, unencrypted MP4 `<source>` — no DRM, no captions.
 */
export function findMoodleVideoId(doc) {
  const link = doc.querySelector('a[href*="thumb.php?id="], [data-video-id]');
  if (!link) return null;
  if (link.hasAttribute("data-video-id")) {
    return link.getAttribute("data-video-id");
  }
  const match = link.getAttribute("href").match(/id=(\d+)/);
  return match ? match[1] : null;
}

export function findBguVideoPlayer(doc) {
  const video = doc.querySelector("video.vjs-tech[src]");
  if (!video) return null;

  const src = video.getAttribute("src");
  if (!src || !src.toLowerCase().includes(".mp4")) return null;

  return {
    videoEl: video,
    mp4Url: src,
    moodleVideoId: findMoodleVideoId(doc),
  };
}
