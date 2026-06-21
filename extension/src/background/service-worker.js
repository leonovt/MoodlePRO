import { MSG } from "../shared/messages.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.DOWNLOAD_TRANSCRIPT) {
    const base = message.filenameBase ?? "transcript";
    chrome.downloads.download({ url: message.txtUrl, filename: `${base}.txt` });
    chrome.downloads.download({ url: message.srtUrl, filename: `${base}.srt` });
    return;
  }

  if (message.type === "PROXY_FETCH_RAW") {
    fetch(message.url, message.options)
      .then(async (res) => {
        const contentType = res.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json");
        let data = null;
        let text = null;
        
        try {
          if (isJson) {
            data = await res.json();
          } else {
            text = await res.text();
          }
        } catch (e) {
          console.error("Failed to parse response", e);
        }

        const headers = {};
        res.headers.forEach((val, key) => { headers[key] = val; });

        sendResponse({ status: res.status, data, text, headers });
      })
      .catch((err) => {
        sendResponse({ error: err.message || "Network Error" });
      });
    return true; // Keep message channel open for async response
  }
});
