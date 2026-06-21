/** Swaps the BGU Moodle header logo for the MoodlePRO logo. */
export function replaceBguLogo(doc, getUrl = (path) => chrome.runtime.getURL(path)) {
  const logo = doc.querySelector("img.bgulinklogo-image");
  if (!logo) return;
  logo.src = getUrl("icons/logo.png");
  logo.alt = "MoodlePRO";
}
