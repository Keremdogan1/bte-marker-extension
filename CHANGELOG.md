# Changelog

## 0.5.3
- Hard mode now uses only the exact Google menu coordinate.
- Removed projection fallback from the corner capture path.
- Debug logs are quieter unless debug mode is enabled.

## 0.5.2
- Prioritized strict right-click menu coordinate over projection fallback.
- Reduced small/shifted polygon risk when map zoom parsing is unreliable.

## 0.5.1
- Added debug mode for menu capture diagnostics.
- Prefer right-click screen coordinate as the primary corner source.
- Tightened coordinate parsing and documented the capture flow.

## 0.5.0
- Added multi-building storage and export support.
- Added team selection in the popup.
- Added upload flow and map overlay improvements.

## 0.4.0
- Initial Google Maps capture flow with overlay rendering.
