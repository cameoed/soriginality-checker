const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');
const apiKeyInput = document.getElementById('apiKey');
const exactMatchInput = document.getElementById('exactMatch');
const statusDiv = document.getElementById('status');
const tableBody = document.getElementById('tableBody');

let collectedResults = [];
let detectedUsername = "scan_results";
let isPaused = false; // Track state to prevent status overwrites

// 1. Load Settings
chrome.storage.local.get(['apiKey', 'strictMode'], (data) => {
  if (data.apiKey) apiKeyInput.value = data.apiKey;
  if (data.strictMode) exactMatchInput.checked = data.strictMode;
});

function updateStatus(msg) { statusDiv.textContent = msg; }

// --- UI RESET FUNCTION ---
function setStoppedState() {
  isPaused = true; // Block queue updates from overwriting status
  startBtn.style.display = 'block';
  startBtn.innerText = "Resume"; // Change button text
  stopBtn.style.display = 'none';
  
  if (collectedResults.length > 0) exportBtn.style.display = 'block';
  
  updateStatus("Stopped. Ready to save or resume.");
}

// 2. Start / Resume Listener
startBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  const strictMode = exactMatchInput.checked;
  const isResuming = startBtn.innerText === "Resume";

  if (!apiKey) return alert("API Key is required.");

  chrome.storage.local.set({ apiKey, strictMode });
  chrome.runtime.sendMessage({ action: 'START', apiKey, strictMode });

  // Only clear data and REFRESH if this is a fresh Start, not a Resume
  if (!isResuming) {
      collectedResults = [];
      tableBody.innerHTML = '';

      // Force Refresh to trigger the network request so the interceptor catches it
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
              chrome.tabs.reload(tabs[0].id);
          }
      });
  }

  isPaused = false; // Allow status updates again
  startBtn.style.display = 'none';
  stopBtn.style.display = 'block';
  exportBtn.style.display = 'none'; 
  
  updateStatus(strictMode ? "Finding exact matches..." : "Scanning feed...");
});

// 3. Stop Listener
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'STOP' });
  setStoppedState();
});

// 4. Export Listener
exportBtn.addEventListener('click', () => {
  if (collectedResults.length === 0) return alert("No results to save yet.");

  // Calculate max columns
  let maxMatches = 0;
  collectedResults.forEach(item => {
    const total = [
        ...(item.exact_matches || []),
        ...(item.visual_matches || []),
        ...(item.products || [])
    ].length;
    if (total > maxMatches) maxMatches = total;
  });

  let csvContent = "data:text/csv;charset=utf-8,";
  
  // Headers
  let header = ["Original Post Link", "Original Image URL", "Original Username", "Exact Match?", "Total Matches"];
  for (let k = 1; k <= maxMatches; k++) {
    header.push(`Match ${k} Source`, `Match ${k} URL`);
  }
  csvContent += header.join(",") + "\n";

  // Rows
  collectedResults.forEach(item => {
    const matches = [
        ...(item.exact_matches || []),
        ...(item.visual_matches || []),
        ...(item.products || [])
    ];

    const isExact = (item.exact_matches && item.exact_matches.length > 0) ? "Yes" : "";
    
    let row = [
      `"${item.original_post_link || ''}"`,
      `"${item.original_image_url || ''}"`,
      `"${item.original_username || ''}"`,
      `"${isExact}"`,
      `"${matches.length}"`
    ];

    for (let i = 0; i < maxMatches; i++) {
      if (matches[i]) {
        const source = (matches[i].source || 'Unknown').replace(/"/g, '""');
        const link = (matches[i].link || '').replace(/"/g, '""');
        row.push(`"${source}"`, `"${link}"`);
      } else {
        row.push('""', '""'); 
      }
    }
    csvContent += row.join(",") + "\n";
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  const safeUsername = detectedUsername.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filename = `${safeUsername}_soriginality_report.csv`;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// 5. Message Listener
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'URL_QUEUED') {
    // Only update queue text if we are NOT paused/stopped
    if (!isPaused) {
        const count = msg.queueLength;
        const noun = count === 1 ? 'video' : 'videos'; // Grammar fix
        
        updateStatus(`Queue: ${count} ${noun} remaining...`);

        // Auto-stop logic: If queue hits 0, finish up
        if (count === 0) {
            stopBtn.click();
        }
    }
  } 
  else if (msg.action === 'RESULT') {
    const data = msg.data;
    if (data.original_username && data.original_username !== 'Unknown_User') {
        detectedUsername = data.original_username;
    }
    
    // Update existing or push new
    const existingIndex = collectedResults.findIndex(i => i.original_image_url === data.original_image_url);
    if (existingIndex > -1) {
        collectedResults[existingIndex] = data; 
    } else {
        collectedResults.push(data);
    }
    
    addResultRow(data);
    
    // Always show export button if we have data, even if running
    if (isPaused) exportBtn.style.display = 'block'; 
  }
  else if (msg.action === 'STOP_COMPLETE') {
      setStoppedState();
  }
});

// 6. Render Row Function
function addResultRow(data) {
  const postUrl = data.original_post_link || '#';
  const imgUrl = data.original_image_url || '';
  
  const matches = [
      ...(data.exact_matches || []),
      ...(data.visual_matches || []),
      ...(data.products || [])
  ];

  const isStrictSearch = data.search_parameters?.type === "exact_matches";
  const exacts = data.exact_matches || [];
  const hasExactMatches = exacts.length > 0;
  
  const rowId = 'row-' + btoa(imgUrl).replace(/[^a-zA-Z0-9]/g, ''); 
  
  let tr = document.getElementById(rowId);
  if (!tr) {
      tr = document.createElement('tr');
      tr.id = rowId;
      tableBody.prepend(tr);
  } else {
      tr.innerHTML = '';
  }

  // --- Badge Logic ---
  let badge = '';
  if (hasExactMatches) {
      const socialDomains = ['youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com'];
      const isOnlySocial = exacts.every(m => {
          try {
              const hostname = new URL(m.link).hostname.toLowerCase();
              return socialDomains.some(d => hostname.includes(d));
          } catch(e) { return false; }
      });

      if (isOnlySocial) {
          badge = `<div class="badge-warning" title="Double check post dates">Exact Match</div>`;
      } else {
          badge = `<div class="badge-exact">Exact Match</div>`;
      }
  }
  
  // --- Column 1 ---
  const tdOrig = document.createElement('td');
  tdOrig.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; flex-direction:column; gap:6px;">
      <a href="${postUrl}" target="_blank" title="View Original Post">
        <img src="${imgUrl}" class="thumb-orig" style="border: 2px solid #8b5cf6; width:45px; height:45px; object-fit:cover; border-radius:4px;">
      </a>
      ${badge}
      <a href="${postUrl}" target="_blank" style="font-size:10px; color:#8b5cf6; text-decoration:none; font-weight:600;">Open ↗</a>
    </div>`;
  tr.appendChild(tdOrig);

  // --- Columns 2-6 ---
  if (isStrictSearch && matches.length === 0) {
      const td = document.createElement('td');
      td.colSpan = 5; 
      td.style.textAlign = 'center';
      td.style.verticalAlign = 'middle';
      
      const btn = document.createElement('button');
      btn.className = 'btn-broader';
      btn.innerHTML = "No exact matches found. <b>Search Broader?</b>";
      
      btn.onclick = () => {
          btn.textContent = "Searching...";
          btn.disabled = true;
          chrome.runtime.sendMessage({
             action: 'RETRY_BROAD',
             item: {
                 postLink: postUrl,
                 imageUrl: imgUrl,
                 username: data.original_username
             }
          });
      };
      
      td.appendChild(btn);
      tr.appendChild(td);
  } 
  else {
      for (let i = 0; i < 5; i++) {
        const td = document.createElement('td');
        const match = matches[i];
        if (match && match.link) {
          let sourceName = match.source || new URL(match.link).hostname.replace('www.','');
          if(sourceName.length > 15) sourceName = sourceName.substring(0, 12) + '...';

          const thumbHTML = match.thumbnail 
            ? `<img src="${match.thumbnail}" style="width:28px; height:28px; border-radius:3px; object-fit:cover; margin-right:8px; border:1px solid #334155;">` 
            : '';

          td.innerHTML = `
            <div style="display:flex; align-items:center;">
              ${thumbHTML}
              <div style="overflow:hidden;">
                <a href="${match.link}" target="_blank" class="result-link" title="${match.title}" style="display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${sourceName} ↗
                </a>
                <div class="result-domain" style="opacity:0.6; font-size:9px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${match.title ? match.title : 'View'}
                </div>
              </div>
            </div>
          `;
        } else {
          td.innerHTML = `<span class="empty-cell" style="opacity:0.3; font-size:10px;">-</span>`;
        }
        tr.appendChild(td);
      }
  }
}