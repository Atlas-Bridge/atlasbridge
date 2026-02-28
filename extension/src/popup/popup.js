// Popup script — vanilla JS (no build step needed for popup)

const statusDot = document.getElementById("status-dot");
const dashboardUrlInput = document.getElementById("dashboard-url");
const saveBtn = document.getElementById("save-btn");
const enabledToggle = document.getElementById("enabled-toggle");
const sessionList = document.getElementById("session-list");

async function loadSettings() {
  const result = await chrome.storage.sync.get({
    dashboardUrl: "http://localhost:5000",
    enabled: true,
  });
  dashboardUrlInput.value = result.dashboardUrl;
  enabledToggle.checked = result.enabled;
}

async function checkConnection() {
  const url = dashboardUrlInput.value.replace(/\/$/, "");
  try {
    const res = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(3000) });
    statusDot.className = res.ok ? "status connected" : "status disconnected";
  } catch {
    statusDot.className = "status disconnected";
  }
}

async function loadSessions() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
      if (!response || !response.sessions || response.sessions.length === 0) {
        sessionList.innerHTML = '<li class="empty">No monitored tabs</li>';
        resolve();
        return;
      }

      sessionList.innerHTML = response.sessions
        .map((s) => {
          const cls = `vendor-${s.vendor}`;
          return `<li class="session-item">
            <span class="vendor-badge ${cls}">${s.vendor}</span>
            <span>${s.conversationId.slice(0, 12)}...</span>
          </li>`;
        })
        .join("");
      resolve();
    });
  });
}

saveBtn.addEventListener("click", async () => {
  await chrome.storage.sync.set({ dashboardUrl: dashboardUrlInput.value });
  await checkConnection();
});

enabledToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: enabledToggle.checked });
});

// Initialize
loadSettings().then(() => {
  checkConnection();
  loadSessions();
});
