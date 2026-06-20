import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAllCourseMediaVideos,
  findCourseMediaLink,
  findMaxPageNumber,
  parseVideoListRows,
} from "../src/content/course-media.js";

const ROW_HTML = `
  <tr id="videoslist_table_r1">
    <td class="cell c0"><a href="https://moodle.bgu.ac.il/moodle/blocks/video/viewvideo.php?id=439844&courseid=65444&type=2">
      <div class="video-thumbnail"><img src="thumb.php?id=439844"></div>
    </a></td>
    <td class="cell c1">אבטחת מחשבים ורשתות תקשורת - תרגיל (17-06-2026)</td>
    <td class="cell c2">11</td>
    <td class="cell c3">0:41:20</td>
    <td class="cell c4">אורי איינס</td>
    <td class="cell c5">17-06-2026 11:21:27</td>
  </tr>
`;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("findCourseMediaLink", () => {
  it("finds the course-media-link anchor on the course page", () => {
    document.body.innerHTML = `<a class="course-media-link" href="https://moodle.bgu.ac.il/moodle/blocks/video/videoslist.php?courseid=64340">קורס מדיה</a>`;
    expect(findCourseMediaLink(document)).toBe(
      "https://moodle.bgu.ac.il/moodle/blocks/video/videoslist.php?courseid=64340"
    );
  });

  it("returns null when there is no course media link", () => {
    expect(findCourseMediaLink(document)).toBeNull();
  });
});

describe("parseVideoListRows", () => {
  it("extracts id, title, href, and owner (as section) from a video row", () => {
    document.body.innerHTML = `<table><tbody>${ROW_HTML}</tbody></table>`;
    const rows = parseVideoListRows(document);
    expect(rows).toEqual([
      {
        id: "439844",
        type: "lecture",
        href: "https://moodle.bgu.ac.il/moodle/blocks/video/viewvideo.php?id=439844&courseid=65444&type=2",
        title: "אבטחת מחשבים ורשתות תקשורת - תרגיל (17-06-2026)",
        section: "אורי איינס",
      },
    ]);
  });

  it("returns an empty array when there are no video rows", () => {
    expect(parseVideoListRows(document)).toEqual([]);
  });
});

describe("findMaxPageNumber", () => {
  it("reads the highest data-page-number from the pagination", () => {
    document.body.innerHTML = `
      <ul class="pagination">
        <li data-page-number="1"></li>
        <li data-page-number="2"></li>
        <li data-page-number="3"></li>
      </ul>
    `;
    expect(findMaxPageNumber(document)).toBe(3);
  });

  it("defaults to 1 when there is no pagination", () => {
    expect(findMaxPageNumber(document)).toBe(1);
  });
});

describe("fetchAllCourseMediaVideos", () => {
  it("fetches every page and concatenates the video rows", async () => {
    const page1 = `<table><tbody>${ROW_HTML}</tbody></table><ul class="pagination"><li data-page-number="1"></li><li data-page-number="2"></li></ul>`;
    const page2 = `<table><tbody><tr id="videoslist_table_r1"><td class="cell c0"><a href="https://moodle.bgu.ac.il/moodle/blocks/video/viewvideo.php?id=2">x</a></td><td class="cell c1">Lecture 2</td><td class="cell c4">Someone</td></tr></tbody></table>`;

    global.fetch = vi.fn((url) => {
      const isPage2 = typeof url === "string" && url.includes("page=2");
      return Promise.resolve({ text: async () => (isPage2 ? page2 : page1) });
    });

    const videos = await fetchAllCourseMediaVideos(
      "https://moodle.bgu.ac.il/moodle/blocks/video/videoslist.php?courseid=64340"
    );

    expect(videos).toHaveLength(2);
    expect(videos[0].id).toBe("439844");
    expect(videos[1].title).toBe("Lecture 2");
  });
});
