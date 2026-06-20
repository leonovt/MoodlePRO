import { describe, expect, it } from "vitest";
import { findBguVideoPlayer, findMoodleVideoId } from "../src/content/detect-player.js";

function makeDoc(html) {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

describe("findBguVideoPlayer", () => {
  it("detects the video.js MP4 player and its numeric video id", () => {
    const doc = makeDoc(`
      <html><body>
        <a href="/local/video_directory/thumb.php?id=439866">thumb</a>
        <video class="vjs-tech" src="https://d111.cloudfront.net/lec1.mp4"></video>
      </body></html>
    `);

    const result = findBguVideoPlayer(doc);
    expect(result).not.toBeNull();
    expect(result.mp4Url).toBe("https://d111.cloudfront.net/lec1.mp4");
    expect(result.moodleVideoId).toBe("439866");
  });

  it("returns null when there is no video.js player on the page", () => {
    const doc = makeDoc("<html><body><p>no video here</p></body></html>");
    expect(findBguVideoPlayer(doc)).toBeNull();
  });

  it("returns null when the vjs-tech element is not an MP4 source", () => {
    const doc = makeDoc(`<video class="vjs-tech" src="https://example.com/stream.m3u8"></video>`);
    expect(findBguVideoPlayer(doc)).toBeNull();
  });

  it("detects a real BGU video-js player before vjs-tech/src is set, via a nested <source>", () => {
    const doc = makeDoc(`
      <html><body>
        <video id="my-player" class="video-js vjs-fluid vjs-default-skin vjs-big-play-centered nomediaplugin"
               poster="https://moodle.bgu.ac.il/moodle/local/video_directory/thumb.php?id=439903">
          <source src="https://d111.cloudfront.net/lec1.mp4" type="video/mp4" />
        </video>
      </body></html>
    `);

    const result = findBguVideoPlayer(doc);
    expect(result).not.toBeNull();
    expect(result.mp4Url).toBe("https://d111.cloudfront.net/lec1.mp4");
    expect(result.moodleVideoId).toBe("439903");
  });
});

describe("findMoodleVideoId", () => {
  it("returns null when no id-bearing element is present", () => {
    const doc = makeDoc("<html><body></body></html>");
    expect(findMoodleVideoId(doc)).toBeNull();
  });
});
