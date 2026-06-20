import { describe, expect, it } from "vitest";
import { scrapeCourseItems } from "../src/content/course-scraper.js";

function makeDoc(html) {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

const COURSE_HTML = `
  <html><body>
    <ul class="section m-0 p-0 img-text d-block" data-for="cmlist">
      <li class="activity activity-wrapper forum modtype_forum   " id="module-3240974" data-for="cmitem" data-id="3240974">
        <div class="activity-item focus-control" data-region="activity-card">
          <div class="activity-name-area activity-instance d-flex flex-column me-2">
            <div class="activitytitle modtype_forum position-relative align-self-start">
              <div class="activityname">
                <a href="https://moodle.bgu.ac.il/moodle/mod/forum/view.php?id=3240974" class="aalink stretched-link">
                  <span class="instancename">לוח הודעות <span class="accesshide">פורום</span></span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </li>
      <li class="activity activity-wrapper zoom modtype_zoom   " id="module-3241090" data-for="cmitem" data-id="3241090">
        <div class="activity-item focus-control" data-region="activity-card">
          <div class="activity-name-area activity-instance d-flex flex-column me-2">
            <div class="activitytitle modtype_zoom position-relative align-self-start">
              <div class="activityname">
                <a href="https://moodle.bgu.ac.il/moodle/mod/zoom/view.php?id=3241090" class="aalink stretched-link">
                  <span class="instancename">כניסה לשיעורים מקוונים <span class="accesshide">מפגש זום</span></span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </li>
      <li class="activity activity-wrapper resource modtype_resource   " id="module-3242200" data-for="cmitem" data-id="3242200">
        <div class="activity-item focus-control" data-region="activity-card">
          <div class="activity-name-area activity-instance d-flex flex-column me-2">
            <div class="activitytitle modtype_resource position-relative align-self-start">
              <div class="activityname">
                <a href="https://moodle.bgu.ac.il/moodle/mod/resource/view.php?id=3242200" class="aalink stretched-link">
                  <span class="instancename">סילבוס הקורס</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </li>
      <li class="activity activity-wrapper assign modtype_assign   " id="module-3242999" data-for="cmitem" data-id="3242999">
        <div class="activity-item focus-control" data-region="activity-card">
          <div class="activity-name-area activity-instance d-flex flex-column me-2">
            <div class="activitytitle modtype_assign position-relative align-self-start">
              <div class="activityname">
                <a href="https://moodle.bgu.ac.il/moodle/mod/assign/view.php?id=3242999" class="aalink stretched-link">
                  <span class="instancename">מטלה 1</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </li>
      <li class="activity activity-wrapper resource modtype_resource   " id="module-3243500" data-for="cmitem" data-id="3243500">
        <div class="activity-item focus-control" data-region="activity-card">
          <div class="activity-name-area activity-instance d-flex flex-column me-2">
            <div class="activitytitle modtype_resource position-relative align-self-start">
              <div class="activityname">
                <a href="https://moodle.bgu.ac.il/moodle/local/video_directory/viewvideo.php?id=3243500" class="aalink stretched-link">
                  <span class="instancename">הרצאה 1</span>
                </a>
              </div>
            </div>
            <button data-moodlepro-ui="1">📝 Summary + Quiz</button>
          </div>
        </div>
      </li>
    </ul>
  </body></html>
`;

describe("scrapeCourseItems", () => {
  it("extracts id, type and title for forum, zoom, resource and assignment activities", () => {
    const doc = makeDoc(COURSE_HTML);
    const items = scrapeCourseItems(doc);

    expect(items).toHaveLength(5);

    const forum = items.find((i) => i.id === "3240974");
    expect(forum.type).toBe("other");
    expect(forum.title).toContain("לוח הודעות");

    const zoom = items.find((i) => i.id === "3241090");
    expect(zoom.type).toBe("lecture");
    expect(zoom.title).toContain("כניסה לשיעורים מקוונים");

    const resource = items.find((i) => i.id === "3242200");
    expect(resource.type).toBe("slides");
    expect(resource.title).toBe("סילבוס הקורס");

    const assignment = items.find((i) => i.id === "3242999");
    expect(assignment.type).toBe("assignment");
    expect(assignment.title).toBe("מטלה 1");
  });

  it("classifies a video_directory viewvideo.php link as a lecture", () => {
    const doc = makeDoc(COURSE_HTML);
    const items = scrapeCourseItems(doc);
    const lecture = items.find((i) => i.id === "3243500");
    expect(lecture.type).toBe("lecture");
  });

  it("excludes injected moodlepro UI elements from the extracted text", () => {
    const doc = makeDoc(COURSE_HTML);
    const items = scrapeCourseItems(doc);
    const lecture = items.find((i) => i.id === "3243500");
    expect(lecture.text).not.toContain("📝 Summary + Quiz");
    expect(lecture.text).toContain("הרצאה 1");
  });
});
