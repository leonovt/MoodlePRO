/** Scrapes the BGU "Course media" listing (blocks/video/videoslist.php) — the real source of recorded lectures. */

export function findCourseMediaLink(doc) {
  const link = doc.querySelector("a.course-media-link[href]");
  return link ? link.getAttribute("href") : null;
}

export function parseVideoListRows(doc) {
  const rows = doc.querySelectorAll('tr[id^="videoslist_table_r"]');
  return Array.from(rows)
    .map((row) => {
      const link = row.querySelector('a[href*="viewvideo.php"]');
      if (!link) return null;

      const href = link.getAttribute("href");
      const idMatch = href.match(/[?&]id=(\d+)/);
      const titleCell = row.querySelector(".cell.c1");
      const ownerCell = row.querySelector(".cell.c4");

      return {
        id: idMatch ? idMatch[1] : href,
        type: "lecture",
        href,
        title: titleCell ? titleCell.textContent.trim() : "lecture",
        section: ownerCell ? ownerCell.textContent.trim() : "Untitled",
      };
    })
    .filter((item) => item !== null);
}

export function findMaxPageNumber(doc) {
  const pageItems = doc.querySelectorAll(".pagination li[data-page-number]");
  let max = 1;
  pageItems.forEach((li) => {
    const num = Number(li.getAttribute("data-page-number"));
    if (Number.isFinite(num) && num > max) max = num;
  });
  return max;
}

function pageUrl(baseUrl, page) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}sortcourse&page=${page}`;
}

export async function fetchAllCourseMediaVideos(courseMediaHref) {
  const firstRes = await fetch(courseMediaHref, { credentials: "same-origin" });
  const firstDoc = new DOMParser().parseFromString(await firstRes.text(), "text/html");

  const videos = [...parseVideoListRows(firstDoc)];
  const maxPage = findMaxPageNumber(firstDoc);

  for (let page = 2; page <= maxPage; page++) {
    const res = await fetch(pageUrl(courseMediaHref, page), { credentials: "same-origin" });
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    videos.push(...parseVideoListRows(doc));
  }

  return videos;
}
