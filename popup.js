const pointsEl = document.getElementById("points");
const offsetsEl = document.getElementById("offsets");
const statusEl = document.getElementById("status");
const buildingSelectEl = document.getElementById("buildingSelect");
const newBuildingBtn = document.getElementById("newBuildingBtn");

let activeBuildingId = null;

const TEAM_STORAGE_KEY = "bteTeamName";
const DEBUG_STORAGE_KEY = "bteDebugMode";
const TEAM_TARGETS = {
  "Local Server": {
    uploadUrl: "http://localhost:18765/btemark/upload",
    token: "BTETR_9fA2kLm7Qp4vN8xR1cY6uD3sT0hJ5wZ"
  },
  "BTE Turkey": {
    uploadUrl: "http://htz1.buildtheearth.net:25520/btemark/upload",
    token: "BTETR_9fA2kLm7Qp4vN8xR1cY6uD3sT0hJ5wZ"
  }
};

const TEAM_DISPLAY_LABELS = {
  "Local Server": "Local Development (127.0.0.1)",
  "BTE Turkey": "BTE Turkey"
};

function getAvailableTeams() {
  return Object.keys(TEAM_TARGETS);
}

async function getStoredTeam() {
  const data = await chrome.storage.local.get([TEAM_STORAGE_KEY]);
  return data[TEAM_STORAGE_KEY] || null;
}

async function setStoredTeam(teamName) {
  await chrome.storage.local.set({ [TEAM_STORAGE_KEY]: teamName });
}

async function ensureTeamSetup(force) {
  const current = await getStoredTeam();
  if (current && TEAM_TARGETS[current] && !force) {
    document.getElementById("main-view").style.display = "block";
    document.getElementById("team-selection").style.display = "none";
    return current;
  }

  const container = document.getElementById("team-buttons-container");
  container.innerHTML = "";

  document.getElementById("team-selection").style.display = "block";
  document.getElementById("main-view").style.display = "none";

  return new Promise((resolve) => {
    Object.keys(TEAM_TARGETS).forEach(teamName => {
      const btn = document.createElement("button");
      btn.textContent = TEAM_DISPLAY_LABELS[teamName] || teamName;
      if (teamName === "Local Server") btn.className = "accent";
      btn.onclick = async () => {
        await setStoredTeam(teamName);
        document.getElementById("team-selection").style.display = "none";
        document.getElementById("main-view").style.display = "block";
        window.location.reload(); // Reload to refresh everything with new team
        resolve(teamName);
      };
      container.appendChild(btn);
    });

    // Add placeholders for other teams
    ["BTE Germany", "BTE Poland"].forEach(name => {
      if (!TEAM_TARGETS[name]) {
        const btn = document.createElement("button");
        btn.textContent = name + " (Coming Soon)";
        btn.disabled = true;
        btn.style.opacity = "0.6";
        container.appendChild(btn);
      }
    });
  });
}

document.getElementById("switchTeamBtn").addEventListener("click", () => {
  ensureTeamSetup(true);
});

async function getDebugMode() {
  const data = await chrome.storage.local.get([DEBUG_STORAGE_KEY]);
  return Boolean(data[DEBUG_STORAGE_KEY]);
}

async function setDebugMode(enabled) {
  await chrome.storage.local.set({ [DEBUG_STORAGE_KEY]: Boolean(enabled) });
}

async function getApiTargetForCurrentTeam() {
  const teamName = await ensureTeamSetup();
  const target = TEAM_TARGETS[teamName];
  if (!target || !target.uploadUrl || target.uploadUrl.includes("YOUR_SERVER_IP")) {
    throw new Error("Upload URL not configured for " + teamName);
  }
  if (!target.token || target.token.startsWith("REPLACE_WITH_")) {
    throw new Error("Upload token not configured for " + teamName);
  }
  return { teamName, uploadUrl: target.uploadUrl, token: target.token };
}

function setStatus(text, isError) {
  statusEl.textContent = text || "";
  statusEl.style.color = isError ? "#8b0000" : "#1b5e20";
}

function parseCoordinateFromText(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const atPattern = text.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (atPattern) {
    const lat = Number.parseFloat(atPattern[1]);
    const lon = Number.parseFloat(atPattern[2]);
    if (isValid(lat, lon)) return { lat, lon };
  }

  const dPattern = text.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (dPattern) {
    const lat = Number.parseFloat(dPattern[1]);
    const lon = Number.parseFloat(dPattern[2]);
    if (isValid(lat, lon)) return { lat, lon };
  }

  const qPattern = text.match(/[?&]q=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (qPattern) {
    const lat = Number.parseFloat(qPattern[1]);
    const lon = Number.parseFloat(qPattern[2]);
    if (isValid(lat, lon)) return { lat, lon };
  }

  const direct = text.match(/(^|[^\d-])(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)(?!\d)/);
  if (direct) {
    const lat = Number.parseFloat(direct[2]);
    const lon = Number.parseFloat(direct[3]);
    if (isValid(lat, lon)) return { lat, lon };
  }

  return null;
}

function isValid(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

async function getPoints() {
  const response = await sendMessage({ type: "GET_POINTS", buildingId: activeBuildingId });
  if (!response || !response.ok) return [];
  return response.points || [];
}

async function getOffsets() {
  const response = await sendMessage({ type: "GET_OFFSETS", buildingId: activeBuildingId });
  if (!response || !response.ok) return {};
  return response.offsets || {};
}

async function getBuildings() {
  const response = await sendMessage({ type: "GET_BUILDINGS" });
  if (!response || !response.ok) {
    return { activeBuildingId: null, buildings: [] };
  }
  return {
    activeBuildingId: response.activeBuildingId || null,
    buildings: Array.isArray(response.buildings) ? response.buildings : []
  };
}

async function setActiveBuilding(buildingId) {
  const response = await sendMessage({ type: "SET_ACTIVE_BUILDING", buildingId });
  if (!response || !response.ok) {
    return false;
  }
  activeBuildingId = buildingId;
  return true;
}

function sanitizeFilePart(name) {
  return String(name || "building")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "building";
}

async function getExportPoints() {
  const points = await getPoints();
  const offsets = await getOffsets();

  return points.map((point, index) => {
    const corner = String(index + 1);
    const offset = offsets[corner];
    const entry = { ...point };

    if (offset && Number.isFinite(Number(offset.lat)) && Number.isFinite(Number(offset.lon))) {
      entry.offsetLat = Number(Number(offset.lat).toFixed(12));
      entry.offsetLon = Number(Number(offset.lon).toFixed(12));
    }

    return entry;
  });
}

async function getGroupedExportPayload() {
  const list = await getBuildings();
  const buildings = [];

  for (const building of list.buildings) {
    if (building.id.startsWith("_draft_")) continue;
    const dataRes = await sendMessage({ type: "GET_BUILDING_DATA", buildingId: building.id });
    if (!dataRes || !dataRes.ok || !dataRes.building) continue;

    const points = Array.isArray(dataRes.building.points) ? dataRes.building.points : [];
    const offsets = dataRes.building.offsets || {};
    const mergedPoints = points.map((point, index) => {
      const corner = String(index + 1);
      const offset = offsets[corner];
      const entry = { ...point };
      if (offset && Number.isFinite(Number(offset.lat)) && Number.isFinite(Number(offset.lon))) {
        entry.offsetLat = Number(Number(offset.lat).toFixed(12));
        entry.offsetLon = Number(Number(offset.lon).toFixed(12));
      }
      return entry;
    });

    buildings.push({
      id: dataRes.building.id,
      name: dataRes.building.name,
      points: mergedPoints
    });
  }

  return {
    format: "btemarker-clusters-v1",
    exportedAt: new Date().toISOString(),
    activeBuildingId: list.activeBuildingId,
    buildings
  };
}

async function renderBuildingSelector() {
  const list = await getBuildings();
  buildingSelectEl.innerHTML = "";

  if (!list.buildings.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No buildings";
    buildingSelectEl.appendChild(option);
    activeBuildingId = null;
    return;
  }

  activeBuildingId = list.activeBuildingId || list.buildings[0].id;

  for (const building of list.buildings) {
    if (building.id.startsWith("_draft_")) continue;
    const option = document.createElement("option");
    option.value = building.id;
    option.textContent = building.name + " (" + (building.pointCount || 0) + ")";
    if (building.id === activeBuildingId) {
      option.selected = true;
    }
    buildingSelectEl.appendChild(option);
  }
}

async function renderPoints() {
  const points = await getPoints();
  pointsEl.innerHTML = "";

  if (points.length === 0) {
    pointsEl.innerHTML = "<div class='point-meta'>No points yet.</div>";
    return;
  }

  points.forEach((point, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "point";

    const title = document.createElement("div");
    title.className = "point-title";
    title.textContent = point.label || ("corner-" + (index + 1));

    const meta = document.createElement("div");
    meta.className = "point-meta";
    meta.textContent = point.lat + ", " + point.lon;

    const del = document.createElement("button");
    del.textContent = "Remove";
    del.addEventListener("click", async () => {
      const res = await sendMessage({ type: "REMOVE_POINT", index, buildingId: activeBuildingId });
      if (!res || !res.ok) {
        setStatus(res && res.error ? res.error : "Remove failed.", true);
        return;
      }
      await renderPoints();
      await renderBuildingSelector();
      setStatus("Point removed.", false);
    });

    wrapper.appendChild(title);
    wrapper.appendChild(meta);
    wrapper.appendChild(del);
    pointsEl.appendChild(wrapper);
  });
}

async function renderOffsets() {
  const points = await getPoints();
  const offsets = await getOffsets();
  offsetsEl.innerHTML = "";

  const cornerNums = Array.from({ length: points.length }, (_, idx) => String(idx + 1));

  if (cornerNums.length === 0) {
    offsetsEl.innerHTML = "<div class='point-meta'>No corners yet.</div>";
    return;
  }

  for (const corner of cornerNums) {
    const offset = offsets[corner] || null;
    const wrapper = document.createElement("div");
    wrapper.className = "point";

    const title = document.createElement("div");
    title.className = "point-title";
    title.textContent = "Corner " + corner;

    const meta = document.createElement("div");
    meta.className = "point-meta";
    if (offset && Number.isFinite(Number(offset.lat)) && Number.isFinite(Number(offset.lon))) {
      meta.textContent = Number(offset.lat).toFixed(12) + ", " + Number(offset.lon).toFixed(12);
    } else {
      meta.textContent = "No offset set.";
    }

    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", async () => {
      const currentLat = offset && Number.isFinite(Number(offset.lat)) ? String(offset.lat) : "";
      const currentLon = offset && Number.isFinite(Number(offset.lon)) ? String(offset.lon) : "";

      const newLat = prompt("Offset latitude for corner " + corner + ":", currentLat);
      if (newLat === null) return;

      const newLon = prompt("Offset longitude for corner " + corner + ":", currentLon);
      if (newLon === null) return;

      const lat = Number.parseFloat(newLat);
      const lon = Number.parseFloat(newLon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        setStatus("Invalid coordinate values.", true);
        return;
      }

      const res = await sendMessage({
        type: "SET_CORNER_OFFSET",
        corner: parseInt(corner, 10),
        offsetLat: lat,
        offsetLon: lon
      });

      if (!res || !res.ok) {
        setStatus("Failed to save offset.", true);
        return;
      }

      await renderOffsets();
      setStatus("Offset updated for corner " + corner, false);
    });

    wrapper.appendChild(title);
    wrapper.appendChild(meta);
    wrapper.appendChild(editBtn);
    offsetsEl.appendChild(wrapper);
  }
}

document.getElementById("addFromTabBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    setStatus("No active tab found.", true);
    return;
  }

  const coord = parseCoordinateFromText(tab.url);
  if (!coord) {
    setStatus("No coordinate parsed from current tab URL.", true);
    return;
  }

  const res = await sendMessage({ type: "ADD_COORD_TEXT", text: tab.url, source: "popup-tab-url" });
  if (!res || !res.ok) {
    setStatus(res && res.error ? res.error : "Add failed.", true);
    return;
  }

  await renderPoints();
  setStatus("Point added from tab URL.", false);
});

document.getElementById("copyJsonBtn").addEventListener("click", async () => {
  const payload = await getGroupedExportPayload();
  const json = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    setStatus("JSON copied.", false);
  } catch (err) {
    setStatus("Clipboard copy failed.", true);
  }
});

document.getElementById("downloadJsonBtn").addEventListener("click", async () => {
  const payload = await getGroupedExportPayload();
  const activeName = buildingSelectEl.selectedOptions[0] ? buildingSelectEl.selectedOptions[0].textContent : "points";
  const safeBase = sanitizeFilePart(activeName);
  const json = JSON.stringify(payload, null, 2);
  const url = "data:application/json;charset=utf-8," + encodeURIComponent(json);
  await chrome.downloads.download({
    url,
    filename: "btemarker/" + safeBase + "-groups.json",
    saveAs: false
  });
  setStatus("Download started in Downloads/btemarker.", false);
});

async function signPayload(secret, timestamp, body) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const data = enc.encode(timestamp + "." + body);
  const signature = await crypto.subtle.sign("HMAC", keyMaterial, data);
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

document.getElementById("uploadDiscordBtn").addEventListener("click", async () => {
  try {
    const { teamName, uploadUrl, token } = await getApiTargetForCurrentTeam();
    const payload = await getGroupedExportPayload();
    const json = JSON.stringify(payload, null, 2);

    const activeBuildingLabel = buildingSelectEl.selectedOptions[0]
      ? buildingSelectEl.selectedOptions[0].textContent.split(" (")[0]
      : "";
    const endpoint = activeBuildingLabel
      ? (uploadUrl + "?building=" + encodeURIComponent(activeBuildingLabel))
      : uploadUrl;

    const timestamp = Date.now().toString();
    const signature = await signPayload(token, timestamp, json);

    const uploadResponse = await sendMessage({
      type: "UPLOAD_DATA",
      endpoint: endpoint,
      headers: {
        "Content-Type": "application/json",
        "X-Bte-Timestamp": timestamp,
        "X-Bte-Signature": signature
      },
      body: json
    });

    if (uploadResponse && uploadResponse.ok) {
      alert("Successfully uploaded to " + teamName + "!");
      setStatus("Uploaded to " + teamName, false);
    } else {
      const errorText = uploadResponse ? uploadResponse.error : "Upload failed";
      alert("Upload failed!\n" + errorText);
      setStatus(errorText, true);
    }
  } catch (err) {
    const msg = "Upload failed: " + (err && err.message ? err.message : "unknown error");
    alert(msg);
    setStatus(msg, true);
  }
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  const res = await sendMessage({ type: "CLEAR_POINTS", buildingId: activeBuildingId });
  if (!res || !res.ok) {
    setStatus("Clear failed.", true);
    return;
  }
  await renderBuildingSelector();
  await renderPoints();
  await renderOffsets();
  setStatus("Active building points cleared.", false);
});

const debugToggleEl = document.getElementById("toggleDebugMode");
if (debugToggleEl) {
  debugToggleEl.addEventListener("change", async (event) => {
    await setDebugMode(event.target.checked);
    setStatus(event.target.checked ? "Debug mode enabled." : "Debug mode disabled.", false);
  });

  getDebugMode().then((enabled) => {
    debugToggleEl.checked = enabled;
  });
}

buildingSelectEl.addEventListener("change", async () => {
  const selected = buildingSelectEl.value;
  if (!selected) return;
  const ok = await setActiveBuilding(selected);
  if (!ok) {
    setStatus("Could not switch building.", true);
    return;
  }
  await updateVisibilityCheckbox();
  await renderPoints();
  await renderOffsets();
  setStatus("Active building changed.", false);
});

async function updateVisibilityCheckbox() {
  const selected = buildingSelectEl.value;
  if (!selected) return;
  const data = await chrome.storage.local.get(["hiddenBuildings"]);
  const hidden = data.hiddenBuildings || [];
  document.getElementById("toggleVisibility").checked = !hidden.includes(selected);
}

document.getElementById("toggleVisibility").addEventListener("change", async (e) => {
  const selected = buildingSelectEl.value;
  if (!selected) return;
  
  const data = await chrome.storage.local.get(["hiddenBuildings"]);
  let hidden = data.hiddenBuildings || [];
  
  if (e.target.checked) {
    hidden = hidden.filter(id => id !== selected);
  } else {
    if (!hidden.includes(selected)) hidden.push(selected);
  }
  
  await chrome.storage.local.set({ hiddenBuildings: hidden });
  
  // Notify content script to re-render
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "REFRESH_OVERLAY" });
    }
  });
});

newBuildingBtn.addEventListener("click", async () => {
  const name = prompt("New building name:", "building");
  if (name === null) return;
  const response = await sendMessage({ type: "CREATE_BUILDING", name });
  if (!response || !response.ok) {
    setStatus("Building create failed.", true);
    return;
  }
  activeBuildingId = response.activeBuildingId;
  await renderBuildingSelector();
  await renderPoints();
  await renderOffsets();
  setStatus("Building created.", false);
});

document.getElementById("renameBuildingBtn").addEventListener("click", async () => {
  if (!activeBuildingId) return;
  const currentName = buildingSelectEl.options[buildingSelectEl.selectedIndex]?.text.split(" (")[0] || "building";
  const newName = prompt("Rename building to:", currentName);
  if (!newName) return;
  const response = await sendMessage({ type: "RENAME_BUILDING", buildingId: activeBuildingId, newName });
  if (!response || !response.ok) {
    setStatus("Rename failed: " + (response ? response.error : "unknown"), true);
    return;
  }
  await renderBuildingSelector();
  setStatus("Building renamed.", false);
});

document.getElementById("deleteBuildingBtn").addEventListener("click", async () => {
  if (!activeBuildingId) return;
  const currentName = buildingSelectEl.options[buildingSelectEl.selectedIndex]?.text.split(" (")[0] || "building";
  if (!confirm("Are you sure you want to permanently delete '" + currentName + "' and all its points?")) return;
  
  const response = await sendMessage({ type: "DELETE_BUILDING", buildingId: activeBuildingId });
  if (!response || !response.ok) {
    alert("Delete failed: " + (response ? response.error : "unknown"));
    setStatus("Delete failed: " + (response ? response.error : "unknown"), true);
    return;
  }
  activeBuildingId = response.activeBuildingId;
  await renderBuildingSelector();
  await renderPoints();
  await renderOffsets();
  setStatus("Building deleted.", false);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local") {
    if (changes.points || changes.buildings || changes.activeBuildingId) {
      renderBuildingSelector();
      renderPoints();
    }
    if (changes.offsets || changes.buildings || changes.activeBuildingId) {
      renderOffsets();
    }
  }
});

(async () => {
  try {
    const teamName = await ensureTeamSetup();
    setStatus("Active team: " + teamName, false);
  } catch (err) {
    setStatus(err && err.message ? err.message : "Team setup required.", true);
  }
  await renderBuildingSelector();
  await renderPoints();
  await renderOffsets();
})();
