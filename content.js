(function () {
  if (window.__bteMarkerLoaded) {
    console.log("[BTEMarker] Already loaded, skipping.");
    return;
  }
  window.__bteMarkerLoaded = true;
  console.log("[BTEMarker] Content script initializing...");

  let lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let pickMode = false;
  let offsetPickMode = false;
  let contextMenuArmed = false;
  let pendingPick = null;
  let pendingOffsetCoord = null;
  let currentBuildingId = null;
  let pointsCache = [];
  let currentOffsets = {};
  let mapAnchor = null; // { lat, lon, x, y, zoom }
  let debugMode = false;
  let debugState = null;

  const SVG_NS = "http://www.w3.org/2000/svg";

  const fab = document.createElement("button");
  fab.id = "bte-marker-fab";
  fab.textContent = "Pick Corner";
  fab.title = "Arm pick mode, then click the target corner on map";

  const toast = document.createElement("div");
  toast.id = "bte-marker-toast";

  const offsetBtn = document.createElement("button");
  offsetBtn.id = "bte-marker-offset-btn";
  offsetBtn.textContent = "Pick Offset";
  offsetBtn.title = "Pick offset point, then assign it to a corner";

  const offsetModal = document.createElement("div");
  offsetModal.id = "bte-marker-offset-modal";
  offsetModal.innerHTML = `
    <div class="bte-offset-modal-content" style="width: 320px;">
      <h3>Assign Offset</h3>
      <div class="bte-offset-form">
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 5px;">Building:</label>
          <select id="bte-offset-building" style="width: 100%; padding: 6px; box-sizing: border-box;"></select>
        </div>
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 5px;">Corner:</label>
          <select id="bte-offset-corner" style="width: 100%; padding: 6px; box-sizing: border-box;"></select>
        </div>
        <div id="bte-offset-picked-point" style="margin-bottom: 10px; padding: 8px; background: #f0f0f0; border-radius: 4px; font-size: 11px; color: #333;">No point selected.</div>
        <div class="bte-offset-buttons" style="display: flex; gap: 10px; justify-content: flex-end;">
          <button id="bte-offset-cancel" style="padding: 6px 12px; cursor: pointer; border: 1px solid #ccc; border-radius: 4px; background: #eee; color: #333;">Cancel</button>
          <button id="bte-offset-save" style="padding: 6px 12px; cursor: pointer; background: #1b5e20; color: white; border: none; border-radius: 4px;">Save</button>
        </div>
      </div>
    </div>
  `;
  offsetModal.style.display = "none";

  const overlay = document.createElement("div");
  overlay.id = "bte-marker-overlay";
  const overlaySvg = document.createElementNS(SVG_NS, "svg");
  overlaySvg.setAttribute("width", "100%");
  overlaySvg.setAttribute("height", "100%");
  overlay.appendChild(overlaySvg);

  const debugPanel = document.createElement("div");
  debugPanel.id = "bte-marker-debug";
  debugPanel.style.display = "none";
  debugPanel.innerHTML = `
    <div class="bte-debug-title">BTEMarker Debug</div>
    <pre class="bte-debug-body"></pre>
  `;

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    window.setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function setDebugState(state) {
    debugState = state || null;
    if (!debugPanel) return;

    const body = debugPanel.querySelector(".bte-debug-body");
    if (!body) return;

    if (!debugMode) {
      debugPanel.style.display = "none";
      body.textContent = "";
      return;
    }

    debugPanel.style.display = "block";
    body.textContent = JSON.stringify(debugState || {}, null, 2);
  }

  async function loadDebugMode() {
    const data = await chrome.storage.local.get(["bteDebugMode"]);
    debugMode = Boolean(data.bteDebugMode);
    if (debugMode) {
      debugPanel.style.display = "block";
      setDebugState(debugState);
    } else {
      setDebugState(null);
    }
  }

  function debugLog(message, extra) {
    if (!debugMode) return;
    if (typeof extra === "undefined") {
      console.log("[BTEMarker][debug]", message);
      return;
    }
    console.log("[BTEMarker][debug]", message, extra);
  }

  function sendBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => resolve(response));
    });
  }

  function captureMapState() {
    return {
      rect: findMapRect(),
      center: parseCenterZoomFromUrl(location.href)
    };
  }

  mapAnchor = captureMapState();

  const buildingModal = document.createElement("div");
  buildingModal.id = "bte-marker-building-modal";
  buildingModal.innerHTML = `
    <div class="bte-offset-modal-content" style="width: 300px;">
      <h3 id="bte-building-modal-title">Save to Building</h3>
      <div class="bte-offset-form">
        <div style="margin-bottom: 15px; display: flex; gap: 10px;">
          <label><input type="radio" name="bte-bmode" value="existing" checked> Add to Existing</label>
          <label><input type="radio" name="bte-bmode" value="new"> Create New</label>
        </div>
        <div id="bte-bmode-existing">
          <label style="display: block; margin-bottom: 5px;">Select Building:</label>
          <select id="bte-bmode-select" style="width: 100%; padding: 6px; box-sizing: border-box;"></select>
        </div>
        <div id="bte-bmode-new" style="display: none;">
          <label style="display: block; margin-bottom: 5px;">Building Name:</label>
          <input type="text" id="bte-bmode-input" placeholder="building-1" style="width: 100%; padding: 6px; box-sizing: border-box;">
        </div>
        <div class="bte-offset-buttons" style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
          <button id="bte-bmode-cancel" style="padding: 6px 12px; cursor: pointer; border: 1px solid #ccc; border-radius: 4px; background: #eee; color: #333;">Cancel</button>
          <button id="bte-bmode-save" style="padding: 6px 12px; cursor: pointer; background: #1b5e20; color: white; border: none; border-radius: 4px;">Save</button>
        </div>
      </div>
    </div>
  `;
  buildingModal.style.display = "none";
  
  if (document.body) document.body.appendChild(buildingModal);
  else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(buildingModal));

  buildingModal.addEventListener("click", (event) => {
    if (event.target === buildingModal) {
      // do not auto-close
    }
  });

  const bmodeRadios = buildingModal.querySelectorAll('input[name="bte-bmode"]');
  const bmodeExisting = buildingModal.querySelector('#bte-bmode-existing');
  const bmodeNew = buildingModal.querySelector('#bte-bmode-new');
  bmodeRadios.forEach(r => r.addEventListener('change', () => {
    if (r.value === 'existing') {
      bmodeExisting.style.display = 'block';
      bmodeNew.style.display = 'none';
    } else {
      bmodeExisting.style.display = 'none';
      bmodeNew.style.display = 'block';
    }
  }));

  async function chooseBuildingForPick(actionLabel) {
    const listResponse = await sendBackground({ type: "GET_BUILDINGS" });
    if (!listResponse || !listResponse.ok) {
      showToast("Could not load building list.");
      return null;
    }

    const buildings = Array.isArray(listResponse.buildings) ? listResponse.buildings.filter(b => !b.id.startsWith("_draft_")) : [];
    const selectEl = buildingModal.querySelector('#bte-bmode-select');
    selectEl.innerHTML = '';
    
    const defaultName = "building-" + (buildings.length + 1);
    buildingModal.querySelector('#bte-bmode-input').value = defaultName;
    
    if (buildings.length === 0) {
      buildingModal.querySelector('input[value="new"]').checked = true;
      bmodeExisting.style.display = 'none';
      bmodeNew.style.display = 'block';
    } else {
      buildingModal.querySelector('input[value="existing"]').checked = true;
      bmodeExisting.style.display = 'block';
      bmodeNew.style.display = 'none';
      buildings.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name + " (" + (b.pointCount || 0) + " pts)";
        selectEl.appendChild(opt);
      });
    }

    buildingModal.querySelector('#bte-building-modal-title').textContent = actionLabel;
    buildingModal.style.display = 'flex';

    return new Promise((resolve) => {
      const btnSave = buildingModal.querySelector('#bte-bmode-save');
      const btnCancel = buildingModal.querySelector('#bte-bmode-cancel');
      
      const cleanup = () => {
        buildingModal.style.display = 'none';
        btnSave.removeEventListener('click', onSave);
        btnCancel.removeEventListener('click', onCancel);
      };

      const onSave = async () => {
        const mode = buildingModal.querySelector('input[name="bte-bmode"]:checked').value;
        if (mode === 'existing') {
          const selectedId = selectEl.value;
          if (!selectedId) {
            alert("No building selected.");
            return;
          }
          const selected = buildings.find(b => b.id === selectedId);
          cleanup();
          const setResult = await sendBackground({ type: "SET_ACTIVE_BUILDING", buildingId: selected.id });
          if (!setResult || !setResult.ok) {
            showToast("Could not set active building.");
            resolve(null);
            return;
          }
          currentBuildingId = selected.id;
          resolve(selected);
        } else {
          const inputName = buildingModal.querySelector('#bte-bmode-input').value.trim();
          if (!inputName) {
            alert("Please enter a building name.");
            return;
          }
          cleanup();
          const created = await sendBackground({ type: "CREATE_BUILDING", name: inputName });
          if (!created || !created.ok || !created.building) {
            showToast("Building create failed.");
            resolve(null);
            return;
          }
          currentBuildingId = created.building.id;
          resolve(created.building);
        }
      };

      const onCancel = () => {
        cleanup();
        resolve(null);
      };

      btnSave.addEventListener('click', onSave);
      btnCancel.addEventListener('click', onCancel);
    });
  }

  function isValidCoord(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function parseCoordinateText(text) {
    const source = String(text || "").replace(/\s+/g, " ").trim();
    if (!source) return null;

    const atPattern = source.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
    if (atPattern) {
      const lat = Number.parseFloat(atPattern[1]);
      const lon = Number.parseFloat(atPattern[2]);
      if (isValidCoord(lat, lon)) return { lat, lon };
    }

    const dPattern = source.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
    if (dPattern) {
      const lat = Number.parseFloat(dPattern[1]);
      const lon = Number.parseFloat(dPattern[2]);
      if (isValidCoord(lat, lon)) return { lat, lon };
    }

    const direct = source.match(/(^|[^\d-])(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)(?!\d)/);
    if (direct) {
      const lat = Number.parseFloat(direct[2]);
      const lon = Number.parseFloat(direct[3]);
      if (isValidCoord(lat, lon)) return { lat, lon };
    }

    return null;
  }

  function extractStrictMenuCoordinate(text) {
    const source = String(text || "");
    if (!source) return null;

    const lines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const strictPattern = /(-?\d{1,2}\.\d{5,})\s*,\s*(-?\d{1,3}\.\d{5,})/;
    for (const line of lines) {
      const match = line.match(strictPattern);
      if (!match) continue;
      const lat = Number.parseFloat(match[1]);
      const lon = Number.parseFloat(match[2]);
      if (isValidCoord(lat, lon)) return { lat, lon };
    }

    return null;
  }

  function setPickMode(enabled) {
    pickMode = enabled;
    if (pickMode) {
      offsetPickMode = false;
      offsetBtn.textContent = "Pick Offset";
      fab.textContent = "Finish Picking";
      fab.classList.add("active");
      showToast("Pick mode ON: click target point on map.");
      return;
    }
    fab.textContent = "Pick Corner";
    fab.classList.remove("active");
    pendingPick = null;
    contextMenuArmed = false;
  }

  function setOffsetPickMode(enabled) {
    offsetPickMode = enabled;
    if (offsetPickMode) {
      setPickMode(false);
      offsetBtn.textContent = "Finish Picking";
      offsetBtn.classList.add("active");
      showToast("Offset pick ON: right click and pick coordinate text.");
      return;
    }
    offsetBtn.textContent = "Pick Offset";
    offsetBtn.classList.remove("active");
    pendingPick = null;
    pendingOffsetCoord = null;
    contextMenuArmed = false;
  }

  function populateOffsetCornerOptions() {
    const select = document.getElementById("bte-offset-corner");
    if (!select) return;
    select.innerHTML = "";

    const cornerCount = Array.isArray(pointsCache) ? pointsCache.length : 0;
    for (let i = 1; i <= cornerCount; i++) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = "Corner " + i;
      select.appendChild(option);
    }
  }

  function updateOffsetPickedPointLabel(coord) {
    const label = document.getElementById("bte-offset-picked-point");
    if (!label) return;
    if (!coord) {
      label.textContent = "No offset point selected yet.";
      return;
    }

    const formatCoord = (value) => {
      if (!Number.isFinite(value)) return "0";
      const rounded = value.toFixed(8);
      return rounded.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    };

    label.textContent = "Picked: " + formatCoord(coord.lat) + ", " + formatCoord(coord.lon);
  }

  function openOffsetModalForPickedCoord(coord) {
    populateOffsetCornerOptions();
    updateOffsetPickedPointLabel(coord);
    offsetModal.style.display = "flex";
  }

  function clearOverlay() {
    while (overlaySvg.firstChild) {
      overlaySvg.removeChild(overlaySvg.firstChild);
    }
  }

  function getCenterWorld(center) {
    const scale = 256 * Math.pow(2, center.zoom);
    return {
      scale,
      x: lonToX(center.lon, scale),
      y: latToY(center.lat, scale)
    };
  }

  function worldToClient(lat, lon, center, rect) {
    const scale = 256.0 * Math.pow(2, center.zoom);
    const dx = lonToX(lon, scale) - lonToX(center.lon, scale);
    const dy = latToY(lat, scale) - latToY(center.lat, scale);

    return {
      x: rect.left + rect.width / 2 + dx,
      y: rect.top + rect.height / 2 + dy
    };
  }

  function drawLine(a, b, className) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", a.x.toFixed(2));
    line.setAttribute("y1", a.y.toFixed(2));
    line.setAttribute("x2", b.x.toFixed(2));
    line.setAttribute("y2", b.y.toFixed(2));
    line.setAttribute("class", className);
    overlaySvg.appendChild(line);
  }

  function drawPoint(point, pos, labelText, extraClass) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "bte-point" + (extraClass ? " " + extraClass : ""));

    const pin = document.createElementNS(SVG_NS, "path");
    const x = pos.x;
    const y = pos.y;
    const d = [
      "M", x, y,
      "L", (x - 6.6), (y - 11.2),
      "A", 10.4, 10.4, 0, 1, 1, (x + 6.6), (y - 11.2),
      "Z"
    ].join(" ");
    pin.setAttribute("d", d);
    pin.setAttribute("class", "bte-point-pin");

    const centerDot = document.createElementNS(SVG_NS, "circle");
    centerDot.setAttribute("cx", x.toFixed(2));
    centerDot.setAttribute("cy", (y - 11.2).toFixed(2));
    centerDot.setAttribute("r", "2.8");
    centerDot.setAttribute("class", "bte-point-center");

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", x.toFixed(2));
    text.setAttribute("y", (y - 17.5).toFixed(2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "bte-point-label");
    text.textContent = String(labelText);

    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = (point.label || ("corner-" + labelText)) + " | " + point.lat + ", " + point.lon;

    g.appendChild(pin);
    g.appendChild(centerDot);
    g.appendChild(text);
    g.appendChild(title);
    overlaySvg.appendChild(g);
  }

  function drawPreviewPoint(pos) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "bte-point bte-preview-point");

    const pin = document.createElementNS(SVG_NS, "path");
    const x = pos.x;
    const y = pos.y;
    const d = [
      "M", x, y,
      "L", (x - 6.6), (y - 11.2),
      "A", 10.4, 10.4, 0, 1, 1, (x + 6.6), (y - 11.2),
      "Z"
    ].join(" ");
    pin.setAttribute("d", d);
    pin.setAttribute("class", "bte-point-pin bte-preview-pin");

    const centerDot = document.createElementNS(SVG_NS, "circle");
    centerDot.setAttribute("cx", x.toFixed(2));
    centerDot.setAttribute("cy", (y - 11.2).toFixed(2));
    centerDot.setAttribute("r", "2.8");
    centerDot.setAttribute("class", "bte-point-center");

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", x.toFixed(2));
    text.setAttribute("y", (y - 17.5).toFixed(2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "bte-point-label");
    text.textContent = "?";

    g.appendChild(pin);
    g.appendChild(centerDot);
    g.appendChild(text);
    overlaySvg.appendChild(g);
  }

  function renderOverlay() {
    clearOverlay();

    if (!Array.isArray(pointsCache) || pointsCache.length === 0) {
      return;
    }

    const liveState = captureMapState();
    const anchorState = mapAnchor && mapAnchor.center && mapAnchor.rect ? mapAnchor : liveState;
    const center = anchorState.center;
    const rect = anchorState.rect;
    if (!center || !rect) return;

    const scale = 256.0 * Math.pow(2, center.zoom);
    const positions = [];

    for (let i = 0; i < pointsCache.length; i++) {
      const p = pointsCache[i];
      if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) continue;
      
      const dx = lonToX(Number(p.lon), scale) - lonToX(center.lon, scale);
      const dy = latToY(Number(p.lat), scale) - latToY(center.lat, scale);
      
      const pos = {
        x: rect.left + rect.width / 2 + dx,
        y: rect.top + rect.height / 2 + dy
      };
      
      positions.push({ point: p, pos, index: i });
    }

    for (let i = 0; i < positions.length - 1; i++) {
      drawLine(positions[i].pos, positions[i + 1].pos, "bte-line");
    }

    if (positions.length > 2) {
      drawLine(positions[positions.length - 1].pos, positions[0].pos, "bte-line bte-line-close");
    }

    for (const item of positions) {
      drawPoint(item.point, item.pos, item.index + 1, "");
    }

    const offsetCorners = Object.keys(currentOffsets || {});
    for (const cornerKey of offsetCorners) {
      const cornerIndex = Number.parseInt(cornerKey, 10) - 1;
      if (!Number.isInteger(cornerIndex) || cornerIndex < 0 || cornerIndex >= pointsCache.length) {
        continue;
      }

      const offsetData = currentOffsets[cornerKey] || {};
      let offsetLat = Number(offsetData.lat);
      let offsetLon = Number(offsetData.lon);

      // Backward compatibility for old dx/dy entries.
      if (!Number.isFinite(offsetLat) || !Number.isFinite(offsetLon)) {
        const basePoint = pointsCache[cornerIndex];
        const dx = Number(offsetData.dx);
        const dy = Number(offsetData.dy);
        if (Number.isFinite(dx) && Number.isFinite(dy)) {
          offsetLat = Number(basePoint.lat) + dy;
          offsetLon = Number(basePoint.lon) + dx;
        }
      }

      if (!Number.isFinite(offsetLat) || !Number.isFinite(offsetLon)) {
        continue;
      }

      const hasScreenPoint = Number.isFinite(Number(offsetData.screenX)) && Number.isFinite(Number(offsetData.screenY));
      const offsetPos = hasScreenPoint
        ? { x: Number(offsetData.screenX), y: Number(offsetData.screenY) }
        : worldToClient(offsetLat, offsetLon, center, rect);
      drawPoint(
        {
          label: "offset-corner-" + cornerKey,
          lat: offsetLat,
          lon: offsetLon
        },
        offsetPos,
        cornerKey,
        "bte-offset-point"
      );
    }
  }

  async function loadPointsToCache() {
    const [pointsRes, hiddenRes, offsetsRes] = await Promise.all([
      sendBackground({ type: "GET_ALL_POINTS" }),
      chrome.storage.local.get(["hiddenBuildings"]),
      sendBackground({ type: "GET_ALL_OFFSETS" })
    ]);

    const hidden = new Set(hiddenRes.hiddenBuildings || []);
    let points = (pointsRes && pointsRes.ok && Array.isArray(pointsRes.points)) ? pointsRes.points : [];

    // Filter hidden buildings
    pointsCache = points.filter(p => !hidden.has(p.buildingId));
    
    // Sync offsets
    if (offsetsRes && offsetsRes.ok && offsetsRes.offsets) {
      currentOffsets = offsetsRes.offsets;
    }

    renderOverlay();
  }

  function parseCenterZoomFromUrl(url) {
    const text = String(url || "");

    let lat = null;
    let lon = null;
    let zoom = null;

    const atFull = text.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),([\d.]+)z/);
    if (atFull) {
      lat = Number.parseFloat(atFull[1]);
      lon = Number.parseFloat(atFull[2]);
      zoom = Number.parseFloat(atFull[3]);
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const atNoZoom = text.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
      if (atNoZoom) {
        lat = Number.parseFloat(atNoZoom[1]);
        lon = Number.parseFloat(atNoZoom[2]);
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const dPattern = text.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
      if (dPattern) {
        lat = Number.parseFloat(dPattern[1]);
        lon = Number.parseFloat(dPattern[2]);
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const mapyPattern = text.match(/[?&]y=(-?\d+(?:\.\d+)?)[&]x=(-?\d+(?:\.\d+)?)/) || text.match(/[?&]x=(-?\d+(?:\.\d+)?)[&]y=(-?\d+(?:\.\d+)?)/);
      if (mapyPattern) {
        if (text.includes("y=" + mapyPattern[1])) {
          lat = Number.parseFloat(mapyPattern[1]);
          lon = Number.parseFloat(mapyPattern[2]);
        } else {
          lon = Number.parseFloat(mapyPattern[1]);
          lat = Number.parseFloat(mapyPattern[2]);
        }
      }
    }

    if (!Number.isFinite(zoom)) {
      const zAny = text.match(/,([\d.]+)z/) || text.match(/[?&]z=([\d.]+)/) || text.match(/!3d.*!4d.*!([\d.]+)z/);
      if (zAny) {
        zoom = Number.parseFloat(zAny[1]);
      }
    }

    // Handle Satellite/3D mode altitude (e.g. 51m or 100a)
    if (!Number.isFinite(zoom)) {
      const altMatch = text.match(/,([\d.]+)m/) || text.match(/,([\d.]+)a/);
      if (altMatch) {
        const altitude = parseFloat(altMatch[1]);
        // Empirical formula for Google Maps altitude to zoom conversion:
        // zoom = log2( (Tilesize * 2^21) / altitude ) - offset?
        // Actually, roughly: 18z is ~300m, 19z is ~150m, 20z is ~75m, 21z is ~37m
        // Zoom = 21 - log2(altitude / 37.5)
        zoom = Math.max(1, Math.min(21.5, 21 - Math.log2(altitude / 37.5)));
        console.log("[BTEMarker] Calculated zoom from altitude (" + altitude + "m):", zoom);
      }
    }

    if (!Number.isFinite(zoom)) {
      zoom = 18;
    }
    
    debugLog("Parsed Map State", { lat, lon, zoom });

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    let tilt = 0;
    const tMatch = text.match(/,(\d+)a/); // a is tilt in some URLs
    if (tMatch) tilt = parseFloat(tMatch[1]);

    return { lat, lon, zoom, tilt };
  }

  function lonToX(lon, scale) {
    return ((lon + 180) / 360) * scale;
  }

  function latToY(lat, scale) {
    const sin = Math.sin((lat * Math.PI) / 180);
    // Use the standard Mercator projection formula with high precision
    return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  }

  function xToLon(x, scale) {
    return (x / scale) * 360 - 180;
  }

  function yToLat(y, scale) {
    const n = Math.PI - (2 * Math.PI * y) / scale;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function findMapRect() {
    const selectors = [
      "canvas.widget-scene-canvas",
      ".widget-scene",
      "#map",
      ".smap",
      "div[role='main']"
    ];

    const candidates = [];
    const viewport = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    for (const sel of selectors) {
      const list = document.querySelectorAll(sel);
      for (const el of list) {
        const r = el.getBoundingClientRect();
        if (r.width > 200 && r.height > 200) {
          // If it's the canvas, give it a huge boost
          const weight = sel.includes("canvas") ? 10 : 1;
          candidates.push({ rect: r, area: r.width * r.height * weight, isCanvas: sel.includes("canvas") });
        }
      }
    }

    if (candidates.length > 0) {
      // Prioritize canvas first, then largest area
      candidates.sort((a, b) => {
        if (a.isCanvas !== b.isCanvas) return a.isCanvas ? -1 : 1;
        return b.area - a.area;
      });
      return candidates[0].rect;
    }

    return viewport;
  }

  function getCoordinateAt(clientX, clientY, anchorState) {
    const center = anchorState && anchorState.center ? anchorState.center : parseCenterZoomFromUrl(location.href);
    if (!center) return null;

    // Use captured rect if available to handle sidebar shifts during menu open.
    const rect = anchorState && anchorState.rect ? anchorState.rect : findMapRect();
    
    const centerX_px = rect.left + rect.width / 2;
    const centerY_px = rect.top + rect.height / 2;
    
    const dx = clientX - centerX_px;
    const dy = clientY - centerY_px;

    // Standard Google Maps Mercator scale
    const scale = 256.0 * Math.pow(2, center.zoom);
    const targetX = lonToX(center.lon, scale) + dx;
    const targetY = latToY(center.lat, scale) + dy;

    const lon = xToLon(targetX, scale);
    const lat = yToLat(targetY, scale);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }

  function addFromCursor(source) {
    const coord = getCoordinateAt(lastMouse.x, lastMouse.y);
    if (!coord) {
      showToast("Cursor coordinate not available. Move mouse over map.");
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "ADD_COORD_TEXT",
        text: coord.lat.toFixed(12) + ", " + coord.lon.toFixed(12),
        source: source || "maps-cursor",
        buildingId: currentBuildingId
      },
      (response) => {
        if (!response || !response.ok) {
          showToast("Could not add cursor coordinate.");
          return;
        }
        loadPointsToCache();
        showToast("Cursor point added (#" + response.result.count + ")");
      }
    );
  }

  function addFromTextCoordinate(text, source, forcedCoord) {
    const textCoord = parseCoordinateText(text);
    const coord = textCoord || forcedCoord || (pendingPick && pendingPick.exactCoord);
    if (!coord) return;

    debugLog("addFromTextCoordinate", {
      source,
      text,
      parsed: textCoord,
      fallback: forcedCoord,
      exactFromPick: pendingPick && pendingPick.exactCoord ? pendingPick.exactCoord : null,
      final: coord,
      pendingPick
    });
    setDebugState({
      mode: "menu-pick",
      source,
      text,
      parsed: textCoord,
      fallback: forcedCoord,
      exactFromPick: pendingPick && pendingPick.exactCoord ? pendingPick.exactCoord : null,
      final: coord,
      pendingPick
    });

    if (!coord) {
      showToast("No coordinate found.");
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "ADD_COORD_TEXT",
        text: textCoord ? (textCoord.lat.toFixed(12) + ", " + textCoord.lon.toFixed(12)) : (coord.lat.toFixed(12) + ", " + coord.lon.toFixed(12)),
        source: source || "maps-menu-coordinate",
        buildingId: currentBuildingId,
        screenX: pendingPick && Number.isFinite(pendingPick.x) ? pendingPick.x : null,
        screenY: pendingPick && Number.isFinite(pendingPick.y) ? pendingPick.y : null
      },
      (response) => {
        if (!response || !response.ok) {
          showToast("Could not add menu coordinate.");
          return;
        }
        
        loadPointsToCache();
        pendingPick = null;
        contextMenuArmed = false;
        showToast("Exact point added (#" + response.result.count + ")");
      }
    );
  }

  fab.addEventListener("click", async () => {
    if (pickMode) {
      setPickMode(false);
      const selected = await chooseBuildingForPick("Save corners to:");
      if (selected) {
        await sendBackground({ type: "MERGE_DRAFT_POINTS", targetBuildingId: selected.id });
        currentBuildingId = selected.id;
        await loadPointsToCache();
        showToast("Points saved to " + selected.name);
      }
      return;
    }

    currentBuildingId = "_draft_corners";
    await sendBackground({ type: "CLEAR_POINTS", buildingId: "_draft_corners" });
    await loadPointsToCache();
    setPickMode(true);
  });

  offsetBtn.addEventListener("click", async () => {
    if (offsetPickMode) {
      setOffsetPickMode(false);
      return;
    }

    setOffsetPickMode(true);
  });

  offsetModal.addEventListener("click", (event) => {
    if (event.target === offsetModal) {
      offsetModal.style.display = "none";
    }
  });

  window.addEventListener("mousemove", (event) => {
    lastMouse = { x: event.clientX, y: event.clientY };
  }, { passive: true });

  window.addEventListener("pointerup", (event) => {
    if (!pickMode && !offsetPickMode) return;
    if (event.button !== 2) return;
    if (event.target === fab || event.target === toast || event.target === offsetBtn || fab.contains(event.target) || toast.contains(event.target) || offsetBtn.contains(event.target)) {
      return;
    }
    const anchor = parseCenterZoomFromUrl(location.href);
    pendingPick = {
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now(),
      ...captureMapState()
    };
    pendingPick.exactCoord = getCoordinateAt(event.clientX, event.clientY, pendingPick);
    contextMenuArmed = true;
    debugLog("pick armed via pointerup", pendingPick);
    setDebugState({
      mode: "pick-armed",
      event: "pointerup",
      pendingPick
    });
    showToast("Right-click menu opened. Click the coordinate text to add it.");
  }, true);

  window.addEventListener("contextmenu", (event) => {
    if (!pickMode && !offsetPickMode) return;
    if (event.target === fab || event.target === toast || event.target === offsetBtn || fab.contains(event.target) || toast.contains(event.target) || offsetBtn.contains(event.target)) {
      return;
    }

    const anchor = parseCenterZoomFromUrl(location.href);
    pendingPick = {
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now(),
      ...captureMapState()
    };
    pendingPick.exactCoord = getCoordinateAt(event.clientX, event.clientY, pendingPick);
    contextMenuArmed = true;
    debugLog("pick armed via contextmenu", pendingPick);
    setDebugState({
      mode: "pick-armed",
      event: "contextmenu",
      pendingPick
    });
    showToast("Right-click menu opened. Click the coordinate text to add it.");
  }, true);

  async function openOffsetComboModal(coord) {
    const listResponse = await sendBackground({ type: "GET_BUILDINGS" });
    if (!listResponse || !listResponse.ok) {
      showToast("Could not load building list.");
      return;
    }

    const buildings = Array.isArray(listResponse.buildings) 
      ? listResponse.buildings.filter(b => !b.id.startsWith("_draft_") && b.pointCount > 0) 
      : [];
    
    if (buildings.length === 0) {
      showToast("No buildings with corners found. Please capture corners first.");
      setOffsetPickMode(false);
      return;
    }

    const bSelect = offsetModal.querySelector("#bte-offset-building");
    const cSelect = offsetModal.querySelector("#bte-offset-corner");
    const pointLabel = offsetModal.querySelector("#bte-offset-picked-point");
    
    bSelect.innerHTML = "";
    buildings.forEach(b => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name + " (" + b.pointCount + " pts)";
      bSelect.appendChild(opt);
    });

    const updateCorners = async (buildingId) => {
      const res = await sendBackground({ type: "GET_POINTS", buildingId });
      cSelect.innerHTML = "";
      if (res && res.ok && Array.isArray(res.points)) {
        res.points.forEach((p, idx) => {
          const opt = document.createElement("option");
          opt.value = idx + 1;
          opt.textContent = "Corner " + (idx + 1);
          cSelect.appendChild(opt);
        });
      }
    };

    bSelect.onchange = () => updateCorners(bSelect.value);
    await updateCorners(bSelect.value);

    pointLabel.textContent = "Picked: " + coord.lat.toFixed(6) + ", " + coord.lon.toFixed(6);
    offsetModal.style.display = "flex";

    return new Promise((resolve) => {
      const btnSave = offsetModal.querySelector("#bte-offset-save");
      const btnCancel = offsetModal.querySelector("#bte-offset-cancel");

      const cleanup = () => {
        offsetModal.style.display = "none";
        btnSave.removeEventListener("click", onSave);
        btnCancel.removeEventListener("click", onCancel);
        setOffsetPickMode(false);
      };

      const onSave = async () => {
        const buildingId = bSelect.value;
        const corner = Number.parseInt(cSelect.value, 10);
        if (!buildingId || !corner) return;

        const screenX = pendingPick && Number.isFinite(pendingPick.x) ? pendingPick.x : null;
        const screenY = pendingPick && Number.isFinite(pendingPick.y) ? pendingPick.y : null;

        cleanup();
        chrome.runtime.sendMessage({
          type: "SET_CORNER_OFFSET",
          corner: corner,
          buildingId: buildingId,
          offsetLat: Number(coord.lat.toFixed(12)),
          offsetLon: Number(coord.lon.toFixed(12)),
          screenX: screenX,
          screenY: screenY
        }, (response) => {
          if (response && response.ok) {
            showToast("Offset saved for corner " + corner);
            loadPointsToCache();
          }
        });
      };

      const onCancel = () => {
        cleanup();
      };

      btnSave.addEventListener("click", onSave);
      btnCancel.addEventListener("click", onCancel);
    });
  }

  window.addEventListener("click", async (event) => {
    if ((!pickMode && !offsetPickMode) || !contextMenuArmed) return;

    const target = event.target && event.target.nodeType === Node.ELEMENT_NODE ? event.target : null;
    if (!target) return;

    const text = (target.innerText || target.textContent || "").trim();
    const coord = extractStrictMenuCoordinate(text);
    if (coord) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      contextMenuArmed = false;

      if (pickMode) {
        addFromTextCoordinate(text, "maps-menu-click", coord);
      } else if (offsetPickMode) {
        pendingOffsetCoord = coord;
        openOffsetComboModal(coord);
      }
      return;
    }

    if (contextMenuArmed && pickMode) {
      debugLog("Strict menu coordinate not found", { pendingPick, text });
      showToast("Google coordinate not found in menu.");
    }
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && pickMode) {
      event.preventDefault();
      setPickMode(false);
      contextMenuArmed = false;
      pendingPick = null;
      showToast("Pick mode canceled.");
      return;
    }

    if (event.code === "Escape" && offsetPickMode) {
      event.preventDefault();
      setOffsetPickMode(false);
      showToast("Offset pick canceled.");
      return;
    }

    if (event.code === "Escape" && (offsetModal.style.display === "flex" || buildingModal.style.display === "flex")) {
      event.preventDefault();
      offsetModal.style.display = "none";
      buildingModal.style.display = "none";
      return;
    }

    const hotkeyA = event.altKey && event.shiftKey && event.code === "KeyM";
    const hotkeyB = event.ctrlKey && event.shiftKey && event.code === "KeyM";
    if (hotkeyA || hotkeyB) {
      event.preventDefault();
      if (pickMode && pendingPick) {
        showToast("Use right click menu, then click coordinate text.");
        return;
      }
      const coord = getCoordinateAt(lastMouse.x, lastMouse.y);
      if (!coord) {
        showToast("Cursor coordinate not available. Move mouse over map.");
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: "ADD_COORD_TEXT",
          text: coord.lat.toFixed(12) + ", " + coord.lon.toFixed(12),
          source: "maps-shortcut-cursor",
          buildingId: currentBuildingId
        },
        (response) => {
          if (!response || !response.ok) {
            showToast("Could not add cursor coordinate.");
            return;
          }
          loadPointsToCache();
          showToast("Cursor point added (#" + response.result.count + ")");
        }
      );
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.bteDebugMode) {
      debugMode = Boolean(changes.bteDebugMode.newValue);
      debugLog("debug mode changed", { enabled: debugMode });
      if (!debugMode) setDebugState(null);
      else setDebugState(debugState || { enabled: true });
    }
    if (changes.buildings || changes.activeBuildingId || changes.points || changes.offsets || changes.hiddenBuildings) {
      loadPointsToCache();
    }
  });

  function ensureElementsAppended() {
    const root = document.documentElement;
    if (!root) return;
    
    if (!document.getElementById("bte-marker-fab")) {
      root.appendChild(fab);
      console.log("[BTEMarker] FAB appended.");
    }
    if (!document.getElementById("bte-marker-offset-btn")) root.appendChild(offsetBtn);
    if (!document.getElementById("bte-marker-offset-modal")) root.appendChild(offsetModal);
    if (!document.getElementById("bte-marker-toast")) root.appendChild(toast);
    if (!document.getElementById("bte-marker-overlay")) root.appendChild(overlay);
    if (!document.getElementById("bte-marker-debug")) root.appendChild(debugPanel);
    if (!document.getElementById("bte-marker-building-modal")) root.appendChild(buildingModal);
  }

  window.addEventListener("resize", renderOverlay);
  window.addEventListener("scroll", renderOverlay, { passive: true });
  
  window.setInterval(() => {
    loadPointsToCache();
    ensureElementsAppended();
  }, 1000);

  // Initial append
  if (document.readyState === "complete" || document.readyState === "interactive") {
    ensureElementsAppended();
  } else {
    document.addEventListener("DOMContentLoaded", ensureElementsAppended);
  }

  // Poll for URL changes to handle zoom/pan without messages
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (!pickMode && !offsetPickMode && !contextMenuArmed) {
        mapAnchor = captureMapState();
      }
      renderOverlay();
    }
  }, 100);

  // Initial load
  loadDebugMode();
  loadPointsToCache();
})();
