// content.js (Runs in ISOLATED world)

// Listen for messages from interceptor.js
window.addEventListener("message", (event) => {
  // Security check: ensure message is from the same window
  if (event.source !== window) return;

  if (event.data.type && event.data.type === "SORIGINAL_FOUND") {
    // Relay to Background Script
    chrome.runtime.sendMessage({
      action: 'BATCH_ADD',
      items: event.data.data
    }).catch(err => {
      // Background script might be sleeping or context invalidated
      // This is expected behavior when extension reloads
    });
  }
});