const VIDEO_TYPE_PATTERN = /viewvideo\.php|video_directory/i;

function classifyType(li) {
  if (li.classList.contains("modtype_assign")) return "assignment";

  const link = li.querySelector(".activityname a, a[href]");
  const href = link ? link.getAttribute("href") ?? "" : "";
  const isVideo = VIDEO_TYPE_PATTERN.test(href) || li.classList.contains("modtype_zoom");
  if (isVideo) return "lecture";

  if (li.classList.contains("modtype_resource")) return "slides";

  return "other";
}

function extractText(li) {
  const clone = li.cloneNode(true);
  clone.querySelectorAll("[data-moodlepro-ui]").forEach((el) => el.remove());
  return clone.textContent.trim().replace(/\s+/g, " ");
}

function findSectionName(li) {
  const section = li.closest("li.section");
  if (!section) return null;
  const heading = section.querySelector('[class*="sectionname"]');
  return heading ? heading.textContent.trim() : null;
}

export function scrapeCourseItems(doc) {
  const items = doc.querySelectorAll('li[data-for="cmitem"]');
  return Array.from(items).map((li) => {
    const titleEl = li.querySelector(".instancename");
    const title = titleEl ? titleEl.textContent.trim() : "";
    const link = li.querySelector(".activityname a, a[href]");
    return {
      id: li.getAttribute("data-id"),
      type: classifyType(li),
      title,
      text: extractText(li),
      href: link ? link.href : null,
      section: findSectionName(li),
    };
  });
}
