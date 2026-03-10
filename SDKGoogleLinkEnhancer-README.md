# WME Utils — SDK Google Link Enhancer

**Version:** 2025.06.13.001
**Author:** MapOMatic, WazeDev group
**License:** GNU GPLv3

A utility library for Waze Map Editor (WME) Tampermonkey scripts that enhances Google Place links attached to Waze venues. It highlights data quality problems directly on the map and in the edit sidebar — no manual Google searching required.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Visual Indicators](#visual-indicators)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Public API](#public-api)
- [Customising Strings](#customising-strings)
- [How It Works Internally](#how-it-works-internally)
- [Debugging](#debugging)
- [Known Limitations](#known-limitations)
- [Changelog Highlights](#changelog-highlights)

---

## What It Does

When enabled, GLE automatically scans venues in the WME viewport and cross-references their linked Google Place IDs against live Google Places data. It surfaces five categories of data-quality issue:

| Issue | Map ring colour | Sidebar background |
|---|---|---|
| Permanently closed | Red `#F00` | Pink `#FAA` |
| Temporarily closed | Yellow `#FD3` | Yellow `#FFA` |
| Google place > N metres away | Cyan `#0FF` | Cyan `#0FF` |
| Invalid / not-found Google link | Magenta `#F0F` | Magenta `#F0F` |
| Same Google place linked to multiple Waze venues | Orange `#fb8d00` | Orange `#FFA500` |

Additionally, hovering over an External Provider entry in the sidebar displays a **yellow dot** at the Google Place's actual location and draws a **labelled dashed line** showing the distance from the Waze place to the Google place.

---

## Visual Indicators

### Map rings

- **Point places** — a circle ring (radius 15) drawn around the WME place dot.
- **Area places** — an outline drawn around the polygon boundary.
- **Dashed ring** — indicates the place name already contains the word "closed", so the Waze place itself acknowledges the closure. A solid ring means the name does not reflect the closure (action needed).

### Sidebar highlights

Appear on the **External Providers** section of the edit panel when a place is selected. The background colour of each provider entry matches the map ring colour for the same issue.

### Hover line

When the cursor enters an External Provider entry, a yellow dot and dashed line appear on the map connecting the Waze place to the Google place's GPS coordinates. The line label shows the distance in the user's preferred units (metric or imperial). The line auto-disappears after 4 seconds or when the cursor leaves the map.

---

## Requirements

| Dependency | Source | Notes |
|---|---|---|
| WME SDK | Loaded by WME itself | Passed to constructor |
| Turf.js v7+ | `https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js` | Passed to constructor |
| jQuery | Loaded by WME itself | Global `$` / `jQuery` |
| Google Maps Places library | Loaded by WME itself | Requires `places` library |

> **Google Places API note:** GLE supports both the legacy `PlacesService.getDetails` API and the new `Place.fetchFields` API (released March 2025). It will automatically use whichever is available. The legacy API remains functional and is not being discontinued yet, but migration to the new API is recommended.

---

## Installation

### As a `@require` in your Tampermonkey script header

```js
// @require   .../WME-Utils/SDKGoogleLinkEnhancer.js
```

### Local development (using a local copy)

```js
// @require   file:C:/path/to/SDKGoogleLinkEnhancer.js
```

> **Important:** For file:// requires to work you must enable **"Allow access to file URLs"** in Chrome's Extensions settings for the Tampermonkey extension.

---

## Quick Start

```js
// 1. Declare the global so your linter knows about it
/* global SDKGoogleLinkEnhancer */

// 2. Create the instance once the WME SDK is ready
//    (sdk = WME SDK object, turf = Turf.js library)
let GLE;

async function init(sdk) {
    // layerName is optional — customise it if multiple scripts each embed GLE
    GLE = new SDKGoogleLinkEnhancer(sdk, turf, { layerName: "My Script - GLE" });

    // 3. Optionally customise strings (see below)
    GLE.strings.permClosedPlace = "This place is permanently closed per Google.";

    // 4. Optionally set the distance threshold (default: 400 metres)
    GLE.distanceLimit = 500;

    // 5. Enable or disable based on user preference
    if (userWantsGLE) {
        GLE.enable();
    }
}

// 6. Wire up your settings toggle UI
checkboxElement.addEventListener('change', () => {
    if (checkboxElement.checked) {
        GLE.enable();
    } else {
        GLE.disable();
    }
});

// 7. Sync the temp-closed highlight to a second settings toggle
tempClosedCheckbox.addEventListener('change', () => {
    GLE.showTempClosedPOIs = tempClosedCheckbox.checked;
});
```

---

## Public API

### Constructor

```js
const gle = new SDKGoogleLinkEnhancer(sdk, trf, { layerName: "My Script - GLE" });
```

| Parameter | Type | Description |
|---|---|---|
| `sdk` | `WmeSDK` | The WME SDK object passed to your script's `init` function |
| `trf` | `turf` | The Turf.js library (global `turf` or your import) |
| `options` | `object` | *(optional)* Configuration options |
| `options.layerName` | `string` | *(optional)* Name of the map layer registered in the Layer Switcher. Defaults to `"Google Link Enhancements"`. Customise this if multiple scripts each embed GLE so their layers appear with distinct names. |

The constructor immediately:
- Creates the **"Google Link Enhancements."** map layer and registers it in the Layer Switcher.
- Registers WME event listeners for map data load and venue changes.
- Checks if a venue is already selected and styles its sidebar links.

> The map layer is always created, but map scanning (`#processPlaces`) only runs after `enable()` is called.

---

### `enable()`

Activates all GLE features:
- Installs the Google Places API interceptors (legacy and new).
- Begins scanning all venues in the viewport for link issues.
- Registers the sidebar update handler.

```js
GLE.enable();
```

Call this when the user turns GLE on in your settings UI.

---

### `disable()`

Deactivates GLE without destroying the instance:
- Stops the hover line feature.
- Unregisters the venue-change sidebar handler.
- Existing map rings remain visible until the next map refresh.

```js
GLE.disable();
```

---

### `distanceLimit` (get/set)

The distance in **metres** beyond which a Waze place is flagged as too far from its linked Google place.

- **Default:** `400` metres
- **Area places:** the limit is automatically extended by the distance from the area centroid to its furthest bounding-box corner, so large area places are not incorrectly flagged.

```js
GLE.distanceLimit = 500; // flag if > 500 m away
console.log(GLE.distanceLimit); // 500
```

---

### `showTempClosedPOIs` (get/set)

Controls whether **temporarily closed** places are highlighted.

- **Default:** `true`

```js
GLE.showTempClosedPOIs = false; // suppress temp-closed highlighting
```

Setting this to `false` does not affect permanently closed or other highlight types.

---

### `strings` (object — writeable properties)

All user-visible tooltip and warning messages. Override any or all to localise or customise the text.

```js
GLE.strings.permClosedPlace  = "Google: Permanently closed.";
GLE.strings.tempClosedPlace  = "Google: Temporarily closed.";
GLE.strings.multiLinked      = "Linked to multiple Waze places.";
GLE.strings.linkedToThisPlace = "Already linked here.";
GLE.strings.linkedNearby     = "Already linked to a nearby place.";
GLE.strings.linkedToXPlaces  = "Linked to {0} places."; // {0} = count
GLE.strings.badLink          = "Invalid Google link.";
GLE.strings.tooFar           = "Google place is more than {0} m away."; // {0} = distanceLimit
```

---

### `linkCache` (instance — advanced use)

The internal `GooglePlaceCache` instance. Normally you do not need to access this directly. It stores place data keyed by Google Place ID.

```js
// Check if a specific place ID is already cached
const isCached = GLE.linkCache.cache.has("ChIJxxxxxxx");

// Manually inject a result (e.g. for testing)
GLE.linkCache.addPlace("ChIJxxxxxxx", { permclosed: true, loc: { lng: -73.09, lat: 41.32 } });
```

---

### `SDKGoogleLinkEnhancer.isPointVenue(venue)` (static)

Returns `true` if a WME SDK `Venue` object is a point place (as opposed to an area place).

```js
if (SDKGoogleLinkEnhancer.isPointVenue(venue)) {
    // point place logic
}
```

---

## Customising Strings

The most common customisation is localisation. Override strings immediately after constructing GLE, before calling `enable()`:

```js
GLE = new SDKGoogleLinkEnhancer(sdk, turf);

// Spanish example
GLE.strings.permClosedPlace  = "Google indica que este lugar está permanentemente cerrado.";
GLE.strings.tempClosedPlace  = "Google indica que este lugar está temporalmente cerrado.";
GLE.strings.badLink          = "Enlace de Google no válido.";
GLE.strings.tooFar           = "El lugar de Google está a más de {0} metros.";
GLE.strings.multiLinked      = "Vinculado más de una vez.";
GLE.strings.linkedToXPlaces  = "Vinculado a {0} lugares.";
```

---

## How It Works Internally

Understanding the architecture helps when troubleshooting.

### 1. Map Layer

`#initLayer()` creates a WME SDK custom map layer named **"Google Link Enhancements."** (note the trailing period — this is the layer identifier). It is registered in the Layer Switcher panel so users can toggle it on/off independently.

### 2. Google Places API Interception

When `enable()` is called, GLE patches two Google Places API methods on their prototypes:

- **`PlacesService.prototype.getDetails`** (legacy callback API) — catches any `getDetails` calls made by WME or other scripts.
- **`Place.prototype.fetchFields`** (new Promise API, if available) — catches the modern equivalent.

Both patches write results into the same **`GooglePlaceCache`** and then trigger a map re-render.

### 3. Proactive Prefetching

When the map loads or venues change, `#processPlaces` iterates all venues in the viewport. For any Google Place IDs not yet in the cache, it calls `#prefetchPlaceData` — which makes `PlacesService.getDetails` calls (the legacy API is used exclusively for prefetching; `Place.fetchFields` calls `places.googleapis.com`, which is blocked by WME's Content Security Policy). This means map rings appear automatically for all venues, not just ones you have manually selected.

### 4. Place Cache

`GooglePlaceCache` stores results keyed by Google Place ID. Lookups that arrive before the Google API has responded use Promise-based pending entries with a **3-second timeout**. After 3 seconds, timed-out lookups are silently dropped (they will succeed on the next pass once prefetch data arrives).

### 5. Render Pipeline

After Google data arrives for a place:
1. Cache is updated.
2. A deferred `#processPlaces()` call is queued (via `setTimeout(..., 0)`).
3. `#processPlaces` clears all existing layer features and redraws highlights for every venue based on the now-populated cache.

### 6. Sidebar Colouring

When a venue is selected (`wme-selection-changed`), `#formatLinkElements` reads the External Provider elements from the edit panel DOM and applies background colours and tooltips matching the cache data for each linked Google Place ID.

---

## Debugging

All debug log messages use `console.debug` — you must set the DevTools console filter to **Verbose** to see them.

| Message | Meaning |
|---|---|
| `Google Maps PlacesService not loaded yet.` | Retrying every 500 ms until the legacy Places library is available |
| `Google Maps PlacesService.getDetails intercepted successfully.` | Legacy interceptor installed |
| `New Place class not available — skipping Place.fetchFields intercept.` | New API not loaded — legacy-only mode |
| `Google Maps Place.fetchFields intercepted successfully.` | New API interceptor installed |
| `Intercepted getDetails call: {...}` | A `getDetails` call was captured (shows the request) |
| `Intercepted getDetails response: {...}` | The Google API returned data |
| `PIE (Google Link Enhancer) error: ...` | An unhandled error in `#processPlaces` — check the full error |

### Common problems

| Symptom | Likely cause |
|---|---|
| Layer not visible in Map Layers panel | `sdk.LayerSwitcher.addLayerCheckbox` not called — check `#initLayer` |
| Map rings never appear | GLE not enabled — check that `GLE.enable()` is called after script init |
| Rings appear only after manually selecting a place | `#prefetchPlaceData` failing silently — check console for errors |
| Sidebar not coloured | `wme-selection-changed` event not firing, or `#formatLinkElements` erroring |
| All places show magenta (not found) | Google Places API key does not have the Places library enabled |

---

## Known Limitations

- **`AutocompleteService` deprecation warning** — This warning (`google.maps.places.AutocompleteService is not available to new customers`) comes from WME itself, not from GLE. It cannot be suppressed by GLE.
- **`fetchFields` error handling is conservative** — When WME calls `Place.fetchFields` for a stale or invalid Place ID, GLE only caches it as `notFound` (magenta) if the error message explicitly contains `NOT_FOUND`. Other failures — CSP blocks, quota exceeded, network errors — are left uncached so they can be retried on the next pass. Proactive prefetching via `PlacesService.getDetails` is not affected by this: the legacy API returns an unambiguous `NOT_FOUND` status, so invalid links are detected and shown as magenta rings proactively.
- **Rate limiting** — GLE makes one `PlacesService.getDetails` call per unique Google Place ID in the viewport on each map load. Large viewports with many linked places may approach Google's API rate limits.
- **Cache is session-only** — The place cache is not persisted. It is rebuilt on each WME page load as venues are scanned.
- **Temporarily closed display** — Controlled by `showTempClosedPOIs`. Set to `false` to suppress, for example during a global event (pandemic, etc.) when many places may be temporarily closed and the highlighting becomes noisy.

---
