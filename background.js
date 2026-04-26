function parseCoordinateFromText(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const direct = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (direct) {
    const lat = Number.parseFloat(direct[1]);
    const lon = Number.parseFloat(direct[2]);
    if (isValid(lat, lon)) return { lat, lon };
  }

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

  return null;
}

function isValid(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

const STORAGE_KEYS = ["buildings", "activeBuildingId", "points", "offsets"];

function normalizeId(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureBuildingShape(building, fallbackName) {
  const name = String((building && building.name) || fallbackName || "building").trim() || "building";
  const points = Array.isArray(building && building.points) ? building.points : [];
  const offsets = building && typeof building.offsets === "object" && building.offsets ? building.offsets : {};
  let id = String((building && building.id) || normalizeId(name) || "building");
  if (!id) id = "building";
  return { id, name, points, offsets };
}

function dedupeBuildingIds(buildings) {
  const used = new Set();
  return buildings.map((building, index) => {
    let id = normalizeId(building.id || building.name || ("building-" + (index + 1)));
    if (!id) id = "building-" + (index + 1);
    const base = id;
    let suffix = 2;
    while (used.has(id)) {
      id = base + "-" + suffix;
      suffix += 1;
    }
    used.add(id);
    return { ...building, id };
  });
}

function relabelCorners(points) {
  return points.map((point, index) => ({
    ...point,
    label: "corner-" + (index + 1)
  }));
}

async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEYS);
  let buildings = Array.isArray(data.buildings) ? data.buildings.map((b, i) => ensureBuildingShape(b, "building-" + (i + 1))) : null;
  let activeBuildingId = data.activeBuildingId;

  if (!buildings || buildings.length === 0) {
    const legacyPoints = Array.isArray(data.points) ? data.points : [];
    const legacyOffsets = data && data.offsets && typeof data.offsets === "object" ? data.offsets : {};
    const initialName = legacyPoints.length > 0 ? "building-1" : "default";
    buildings = [{
      id: normalizeId(initialName),
      name: initialName,
      points: legacyPoints,
      offsets: legacyOffsets
    }];
    activeBuildingId = buildings[0].id;
    await chrome.storage.local.set({ buildings, activeBuildingId });
  }

  buildings = dedupeBuildingIds(buildings);
  if (!activeBuildingId || !buildings.some((b) => b.id === activeBuildingId)) {
    activeBuildingId = buildings[0].id;
  }

  return { buildings, activeBuildingId };
}

async function saveState(state) {
  await chrome.storage.local.set({
    buildings: state.buildings,
    activeBuildingId: state.activeBuildingId
  });
}

function resolveTargetBuilding(state, requestedId) {
  const targetId = requestedId || state.activeBuildingId;
  let index = state.buildings.findIndex((building) => building.id === targetId);
  if (index >= 0) {
    return { index, building: state.buildings[index] };
  }
  if (targetId === "_draft_corners" || targetId === "_draft_offsets") {
    const draftBuilding = { id: targetId, name: targetId, points: [], offsets: {} };
    state.buildings.push(draftBuilding);
    return { index: state.buildings.length - 1, building: draftBuilding };
  }
  return { index: 0, building: state.buildings[0] };
}

async function addPointToBuilding(coord, source, buildingId, screenX, screenY, exactLat, exactLon) {
  const state = await getState();
  const target = resolveTargetBuilding(state, buildingId);
  const points = Array.isArray(target.building.points) ? [...target.building.points] : [];

  const nextPoint = {
    lat: coord.lat,
    lon: coord.lon,
    label: "corner-" + (points.length + 1),
    source: source || "maps"
  };
  if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
    nextPoint.screenX = screenX;
    nextPoint.screenY = screenY;
  }
  if (Number.isFinite(exactLat) && Number.isFinite(exactLon)) {
    nextPoint.exactLat = exactLat;
    nextPoint.exactLon = exactLon;
  }

  points.push(nextPoint);
  const updatedBuilding = {
    ...target.building,
    points: relabelCorners(points),
    offsets: {}
  };

  state.buildings[target.index] = updatedBuilding;
  state.activeBuildingId = updatedBuilding.id;
  await saveState(state);

  return {
    added: true,
    count: updatedBuilding.points.length,
    point: updatedBuilding.points[updatedBuilding.points.length - 1],
    activeBuildingId: updatedBuilding.id,
    activeBuildingName: updatedBuilding.name
  };
}

function createBuildingObject(name, existingBuildings) {
  let defaultName = "building-1";
  if (existingBuildings.length > 0) {
    let maxN = 0;
    existingBuildings.forEach(b => {
      const match = String(b.name || "").match(/^building-(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxN) maxN = n;
      }
    });
    defaultName = "building-" + (maxN + 1);
  }

  const cleanName = String(name || "").trim() || defaultName;
  const baseId = normalizeId(cleanName) || defaultName;
  const used = new Set(existingBuildings.map((b) => b.id));
  let id = baseId;
  let i = 2;
  while (used.has(id)) {
    id = baseId + "-" + i;
    i += 1;
  }
  return {
    id,
    name: cleanName,
    points: [],
    offsets: {}
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: "Invalid message." });
      return;
    }

    if (message.type === "ADD_COORD_TEXT") {
      const coord = parseCoordinateFromText(message.text || "");
      if (!coord) {
        sendResponse({ ok: false, error: "No coordinate found." });
        return;
      }
      const result = await addPointToBuilding(
        coord,
        message.source || "manual",
        message.buildingId,
        Number(message.screenX),
        Number(message.screenY),
        Number(message.exactLat),
        Number(message.exactLon)
      );
      sendResponse({ ok: true, result });
      return;
    }

    if (message.type === "GET_POINTS") {
      const state = await getState();
      const target = resolveTargetBuilding(state, message.buildingId);
      const points = Array.isArray(target.building.points) ? target.building.points : [];
      sendResponse({ ok: true, points });
      return;
    }

    if (message.type === "GET_OFFSETS") {
      const state = await getState();
      const target = resolveTargetBuilding(state, message.buildingId);
      const offsets = target.building.offsets || {};
      sendResponse({ ok: true, offsets });
      return;
    }

    if (message.type === "GET_BUILDINGS") {
      const state = await getState();
      sendResponse({
        ok: true,
        activeBuildingId: state.activeBuildingId,
        buildings: state.buildings.map((building) => ({
          id: building.id,
          name: building.name,
          pointCount: Array.isArray(building.points) ? building.points.length : 0
        }))
      });
      return;
    }
    if (message.type === "GET_ALL_POINTS") {
      const state = await getState();
      const allPoints = [];
      state.buildings.forEach(b => {
        const pts = Array.isArray(b.points) ? b.points : [];
        pts.forEach((p, idx) => {
          allPoints.push({ ...p, buildingId: b.id, buildingName: b.name, cornerIndex: idx + 1 });
        });
      });
      sendResponse({ ok: true, points: allPoints });
      return;
    }

    if (message.type === "GET_ALL_OFFSETS") {
      const state = await getState();
      const allOffsets = {};
      state.buildings.forEach(b => {
        if (b.offsets && typeof b.offsets === "object") {
          Object.keys(b.offsets).forEach(cornerKey => {
            allOffsets[cornerKey] = { ...b.offsets[cornerKey], buildingId: b.id };
          });
        }
      });
      sendResponse({ ok: true, offsets: allOffsets });
      return;
    }

    if (message.type === "GET_BUILDING_DATA") {
      const state = await getState();
      const target = resolveTargetBuilding(state, message.buildingId);
      sendResponse({
        ok: true,
        building: {
          id: target.building.id,
          name: target.building.name,
          points: Array.isArray(target.building.points) ? target.building.points : [],
          offsets: target.building.offsets || {}
        }
      });
      return;
    }

    if (message.type === "CREATE_BUILDING") {
      const state = await getState();
      const created = createBuildingObject(message.name, state.buildings);
      state.buildings.push(created);
      state.activeBuildingId = created.id;
      await saveState(state);
      sendResponse({ ok: true, building: created, activeBuildingId: created.id });
      return;
    }

    if (message.type === "SET_ACTIVE_BUILDING") {
      const state = await getState();
      const found = state.buildings.find((building) => building.id === message.buildingId);
      if (!found) {
        sendResponse({ ok: false, error: "Building not found." });
        return;
      }
      state.activeBuildingId = found.id;
      await saveState(state);
      sendResponse({ ok: true, activeBuildingId: found.id });
      return;
    }

    if (message.type === "SET_CORNER_OFFSET") {
      const corner = String(message.corner || "");
      const cornerNumber = Number.parseInt(corner, 10);
      if (!Number.isInteger(cornerNumber) || cornerNumber < 1) {
        sendResponse({ ok: false, error: "Invalid corner." });
        return;
      }
      const offsetLat = Number(message.offsetLat);
      const offsetLon = Number(message.offsetLon);
      if (!Number.isFinite(offsetLat) || !Number.isFinite(offsetLon)) {
        sendResponse({ ok: false, error: "Invalid offset coordinate." });
        return;
      }

      const state = await getState();
      const target = resolveTargetBuilding(state, message.buildingId);
      const offsets = {
        ...(target.building.offsets || {})
      };
      const entry = {
        lat: Number(offsetLat.toFixed(12)),
        lon: Number(offsetLon.toFixed(12))
      };
      if (Number.isFinite(message.screenX) && Number.isFinite(message.screenY)) {
        entry.screenX = message.screenX;
        entry.screenY = message.screenY;
      }
      offsets[String(cornerNumber)] = entry;
      state.buildings[target.index] = {
        ...target.building,
        offsets
      };
      state.activeBuildingId = state.buildings[target.index].id;
      await saveState(state);
      sendResponse({ ok: true, offsets });
      return;
    }

    if (message.type === "CLEAR_POINTS") {
      const state = await getState();
      const target = resolveTargetBuilding(state, message.buildingId);
      state.buildings[target.index] = {
        ...target.building,
        points: [],
        offsets: {}
      };
      await saveState(state);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "REMOVE_POINT") {
      const state = await getState();
      const target = resolveTargetBuilding(state, message.buildingId);
      const points = Array.isArray(target.building.points) ? [...target.building.points] : [];
      const index = Number(message.index);
      if (!Number.isInteger(index) || index < 0 || index >= points.length) {
        sendResponse({ ok: false, error: "Invalid index." });
        return;
      }
      points.splice(index, 1);
      state.buildings[target.index] = {
        ...target.building,
        points: relabelCorners(points),
        offsets: {}
      };
      await saveState(state);
      sendResponse({ ok: true, points });
      return;
    }

    if (message.type === "MERGE_DRAFT_POINTS") {
      const state = await getState();
      const draftTarget = resolveTargetBuilding(state, "_draft_corners");
      const target = resolveTargetBuilding(state, message.targetBuildingId);

      const draftPoints = Array.isArray(draftTarget.building.points) ? draftTarget.building.points : [];
      if (draftPoints.length > 0) {
        const existingPoints = Array.isArray(target.building.points) ? target.building.points : [];
        const mergedPoints = [...existingPoints, ...draftPoints];
        
        state.buildings[target.index] = {
          ...target.building,
          points: relabelCorners(mergedPoints)
        };
        
        // Clear draft
        state.buildings[draftTarget.index] = {
          ...draftTarget.building,
          points: [],
          offsets: {}
        };
        
        state.activeBuildingId = target.building.id;
        await saveState(state);
      }
      sendResponse({ ok: true, activeBuildingId: target.building.id });
      return;
    }

    if (message.type === "DELETE_BUILDING") {
      const state = await getState();
      if (state.buildings.length <= 1) {
        sendResponse({ ok: false, error: "Cannot delete the only building." });
        return;
      }
      const targetIndex = state.buildings.findIndex((b) => b.id === message.buildingId);
      if (targetIndex < 0) {
        sendResponse({ ok: false, error: "Building not found." });
        return;
      }
      state.buildings.splice(targetIndex, 1);
      if (state.activeBuildingId === message.buildingId) {
        state.activeBuildingId = state.buildings[0].id;
      }
      await saveState(state);
      sendResponse({ ok: true, activeBuildingId: state.activeBuildingId });
      return;
    }

    if (message.type === "RENAME_BUILDING") {
      const state = await getState();
      const targetIndex = state.buildings.findIndex((b) => b.id === message.buildingId);
      if (targetIndex < 0) {
        sendResponse({ ok: false, error: "Building not found." });
        return;
      }
      const newName = String(message.newName).trim();
      if (!newName) {
         sendResponse({ ok: false, error: "Name cannot be empty." });
         return;
      }
      state.buildings[targetIndex].name = newName;
      await saveState(state);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "UPLOAD_DATA") {
      try {
        const response = await fetch(message.endpoint, {
          method: "POST",
          headers: message.headers,
          body: message.body
        });
        if (response.ok) {
          sendResponse({ ok: true });
        } else {
          let errorText = "HTTP " + response.status;
          try {
            const data = await response.json();
            if (data && data.error) errorText = data.error;
          } catch (e) {}
          sendResponse({ ok: false, error: errorText });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message || "Failed to fetch" });
      }
      return;
    }

    sendResponse({ ok: false, error: "Unknown action." });
  })();

  return true;
});
