chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

let isRunning = false;
let isProcessing = false;
let apiKey = "";
let useStrictMode = false;
let processingQueue = []; 
let processedCache = new Set(); 

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'START') {
    isRunning = true;
    apiKey = msg.apiKey;
    useStrictMode = msg.strictMode || false;
    processQueue();
  } 
  else if (msg.action === 'STOP') {
    isRunning = false;
    isProcessing = false;
    chrome.runtime.sendMessage({ action: 'STOP_COMPLETE' }).catch(() => {});
  }
  else if (msg.action === 'BATCH_ADD') {
    if (!isRunning) return;
    let addedCount = 0;
    msg.items.forEach(item => {
      if (!processedCache.has(item.imageUrl)) {
        processedCache.add(item.imageUrl);
        processingQueue.push(item);
        addedCount++;
      }
    });
    if (addedCount > 0) {
       chrome.runtime.sendMessage({ action: 'URL_QUEUED', queueLength: processingQueue.length }).catch(() => {});
       processQueue();
    }
  }
  // --- NEW RETRY HANDLER ---
  else if (msg.action === 'RETRY_BROAD') {
      // We process this immediately, bypassing queue logic for simplicity
      // since it's a manual user action.
      analyzeImage(msg.item, true); // True = Force Broad Mode
  }
});

async function processQueue() {
  if (!isRunning || isProcessing) return;
  if (processingQueue.length === 0) {
      isProcessing = false; 
      return;
  }
  isProcessing = true;
  const item = processingQueue.shift(); 
  try {
    await analyzeImage(item);
  } catch (err) {
    console.error("Queue Error:", err);
  } finally {
    isProcessing = false;
    processQueue();
  }
}

// Added forceBroad parameter
async function analyzeImage(item, forceBroad = false) {
  try {
    const searchParams = {
      api_key: apiKey,
      engine: "google_lens",
      url: item.imageUrl
    };

    // Only apply strict mode if global setting is ON AND we aren't forcing broad
    if (useStrictMode && !forceBroad) {
        searchParams.type = "exact_matches";
    }

    const params = new URLSearchParams(searchParams);
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    const data = await res.json();

    data.original_post_link = item.postLink;
    data.original_image_url = item.imageUrl;
    data.original_username = item.username; 

    chrome.runtime.sendMessage({ action: 'RESULT', data: data }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'URL_QUEUED', queueLength: processingQueue.length }).catch(() => {});

  } catch (err) {
    console.error("SerpAPI Failed:", err);
  }
}