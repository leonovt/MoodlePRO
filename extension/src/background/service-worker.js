import { MSG } from "../shared/messages.js";

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== MSG.DOWNLOAD_TRANSCRIPT) return;

  const base = message.filenameBase ?? "transcript";
  chrome.downloads.download({ url: message.txtUrl, filename: `${base}.txt` });
  chrome.downloads.download({ url: message.srtUrl, filename: `${base}.srt` });
});
