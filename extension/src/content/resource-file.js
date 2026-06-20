/**
 * BGU "resource" (slides/file) activities link to mod/resource/view.php?id=X, not the
 * actual file — Moodle's per-resource "display" setting decides whether that page redirects
 * straight to the file (fetch follows it transparently) or renders an HTML page embedding the
 * file in an iframe/object/link. Handle both so summarization/quiz can use the real PDF bytes.
 */
function isFileContentType(contentType) {
  return !!contentType && !contentType.includes("text/html");
}

function findEmbeddedFileUrl(doc, baseUrl) {
  const candidate = doc.querySelector(
    'iframe[src*="pluginfile.php"], object[data*="pluginfile.php"], a[href*="pluginfile.php"]'
  );
  if (!candidate) return null;
  const raw = candidate.getAttribute("src") || candidate.getAttribute("data") || candidate.getAttribute("href");
  return raw ? new URL(raw, baseUrl).href : null;
}

export async function resolveResourceFile(href) {
  const res = await fetch(href, { credentials: "same-origin" });
  const contentType = res.headers.get("content-type") || "";

  if (isFileContentType(contentType)) {
    return { buffer: await res.arrayBuffer(), mimeType: contentType.split(";")[0].trim() };
  }

  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const fileUrl = findEmbeddedFileUrl(doc, res.url);
  if (!fileUrl) return null;

  const fileRes = await fetch(fileUrl, { credentials: "same-origin" });
  const fileContentType = fileRes.headers.get("content-type") || "application/octet-stream";
  return { buffer: await fileRes.arrayBuffer(), mimeType: fileContentType.split(";")[0].trim() };
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
