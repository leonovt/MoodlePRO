import { MSG } from "../shared/messages.js";

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== MSG.DOWNLOAD_TRANSCRIPT) return;

  chrome.downloads.download({ url: message.txtUrl, filename: "transcript.txt" });
  chrome.downloads.download({ url: message.srtUrl, filename: "transcript.srt" });
});
