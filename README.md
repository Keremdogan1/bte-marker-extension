# BTE Marker Browser Extension (Phase)

This extension captures coordinates from Google Maps and exports BTEMarker JSON.

## Features
- Floating "Pick Corner" button on Google Maps pages (arms one-click capture mode)
- Keyboard shortcuts:
   - Alt + Shift + M
   - Ctrl + Shift + M (fallback)
- Visual overlay on map:
   - Numbered pin-style markers (map-pin look) for each selected point
   - Line segments between consecutive points (1-2, 2-3, ...)
   - Closing segment from last point to first when point count is 3+
- Popup actions:
  - Add from current tab URL
  - Copy JSON
  - Download points.json
  - Clear all / remove individual points
   - Debug mode toggle for logging captured menu text and parsed coordinates

## Install (Chrome/Edge)
1. Open extensions page:
   - Chrome: chrome://extensions
   - Edge: edge://extensions
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this folder:
   - custom-plugins-src/bte-marker-extension

## Usage
1. Open Google Maps and navigate to target corner.
2. Click "Pick Corner" once (button turns into Cancel Pick).
3. Click target corners on map one by one.
4. Pick mode stays active until you click "Cancel Pick" or press Esc.
5. For quick capture without clicking button: Alt+Shift+M or Ctrl+Shift+M (captures current mouse position on map).
6. Repeat for all corners.
7. Open extension popup and click "Download JSON".
8. Put JSON into server:
   - plugins/BTEMarker/points.json
9. In game:
   - /btemark import points.json
   - /btemark run

## Coordinate Sources
The extension parses coordinates from current URL patterns and menu text:
- @lat,lon
- !3dLAT!4dLON
- q=lat,lon

Debug mode shows the raw text, parsed coordinate, fallback coordinate, and the picked screen state in the popup content script console.

## Notes
- This MVP does not scrape internal Google Maps DOM structures.
- It estimates under-cursor coordinates from map center + zoom projection only as a fallback.
- Accuracy is best in top-down map mode (tilt/rotation off).
