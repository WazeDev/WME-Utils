# WME Utils – Google Link Enhancer (SDK Edition)

**A utility library for Waze Map Editor scripts: highlights Google Place link issues (closed, broken, duplicate, distant) directly on the map and in the sidebar.**

**Authors:** MapOMatic, karlsosha, JS55CT, WazeDev group
**License:** GNU GPLv3
**Latest Version:** 2026.03.23.00

---

## ⚠️ Library/Utility Script — Not Standalone

**This script is a _utility library_ for use by the WME Place Interface Enhancements script.**

- If installed by itself, it does _nothing visible_ in the editor.

---

## Table of Contents

- [WME Utils – Google Link Enhancer (SDK Edition)](#wme-utils--google-link-enhancer-sdk-edition)
  - [⚠️ Library/Utility Script — Not Standalone](#️-libraryutility-script--not-standalone)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Visual Indicators \& Color Key](#visual-indicators--color-key)
  - [Requirements](#requirements)
  - [Installation](#installation)
  - [How It Works](#how-it-works)
  - [Usage](#usage)
  - [Compatibility and Technical Notes](#compatibility-and-technical-notes)
    - [Monkey-Patching Notice](#monkey-patching-notice)
    - [Google Places API Version](#google-places-api-version)
    - [Layer and String Customization](#layer-and-string-customization)
  - [For Script Developers](#for-script-developers)
    - [API Quick Reference](#api-quick-reference)
      - [Constructor](#constructor)
      - [Properties](#properties)
      - [Methods](#methods)
    - [Custom Layer Checkbox Integration Example](#custom-layer-checkbox-integration-example)
  - [FAQ](#faq)
  - [Troubleshooting](#troubleshooting)

---

## Features

- **Visual Map Highlighting**
  - Red: Permanently closed in Google
  - Yellow: Temporarily closed in Google
  - Purple: Broken/invalid Google link
  - Orange: Google link assigned to multiple venues
  - Cyan: Google place too far from WME place
- **Hover Previews**
  - Hover Google links in the place panel to:
    - Draw line/distance to the Google Place location
    - Show exact distance in user's units
- **Proactive Checks**
  - Auto-fetches Google status for all visible venues when the highlight layer is visible, so issues are flagged as the map loads — no clicking required.
  - Fetching is skipped when the layer is hidden; sidebar link coloring still works reactively via the API interceptor.
- **Rate-Limited API Access**
  - Google API requests are queued and dispatched at a controlled concurrency (default: 20 simultaneous) to avoid request bursts when many venues are visible.
- **Layer Controls**
  - Toggle highlights on/off from the WME Layer panel (when supported by host script).
- **Customizable**
  - All highlight strings and distance thresholds are script-accessible.
- **Fast and Seamless**
  - Designed for modern SDK-based WME scripts.

---

## Visual Indicators & Color Key

| Color                | Issue               | Description                          |
| -------------------- | ------------------- | ------------------------------------ |
| **Red**              | Permanently closed  | Venue closed on Google               |
| **Yellow**           | Temporarily closed  | Venue temporarily closed on Google   |
| **Purple**           | Broken/invalid link | Place ID missing/invalid/not found   |
| **Orange**           | Multi-linked        | Same Place ID is used by >1 venue    |
| **Cyan**             | Too far away        | Google/WME place > threshold meters  |
| **Orange ring/line** | Preview line/hover  | Appears when hovering links in panel |

---

## Requirements

- **Dependencies:**
  - WME SDK (passed to constructor by WMEPIE script)
  - Turf.js v7+ (passed to constructor by WMEPIE script)
  - jQuery (provided by WME)
  - Google Maps JS API (with "places" library; loaded by WME)
- **No API key needed**—all Google API access is handled by WME

---

## Installation

_Developers:_
Your main script must:

- Create an instance:

  ```js
  const GLE = new SDKGoogleLinkEnhancer(sdk, turf, { layerName: '...' });
  ```

- Configure as needed.
- Call `.enable()` to turn on.

_End users:_
You do not need to install this directly—WME PIE integrates it for you.

---

## How It Works

- The WME Place Interface Enhancements (PIE) script constructs and enables a `SDKGoogleLinkEnhancer` instance.
- When the highlight layer is visible, all visible WME venues are scanned for Google Place links and place details are fetched from Google via WME's API. Requests are queued and sent at a controlled rate to avoid bursts.
- When the highlight layer is hidden, no proactive fetching occurs. Sidebar link coloring (closed/invalid/too-far indicators) still works by intercepting the API calls WME makes when rendering place details.
- Any issues are highlighted visually on the map and/or sidebar.
- Map redraws are debounced (150 ms) so that a batch of incoming API responses triggers a single redraw pass rather than one per response.
- Hovering a Google link in the sidebar draws a line to the Google Place location and shows distance in the user's units.
- UI strings and thresholds are customizable by the host script (set by PIE).

---

## Usage

**For Script Developers**
_End users: these actions are performed automatically by WME PIE._

Register the layer:

```js
const GLE = new SDKGoogleLinkEnhancer(sdk, turf, { layerName: 'My Script - GLE' });
```

Optionally localize strings:

```js
GLE.strings.permClosedPlace = I18n.t('pie.GLE.closedPlace');
// etc.
```

Set the distance warning as desired:

```js
GLE.distanceLimit = 500; // meters
```

Enable the overlay:

```js
GLE.enable();
```

Set up user toggle (optional):

```js
checkBoxElement.onchange = () => (GLE.showTempClosedPOIs = checkBoxElement.checked);
```

---

## Compatibility and Technical Notes

### Monkey-Patching Notice

> ⚠️ **IMPORTANT: Monkey-Patching**
> To track all Google Place lookups, this script **overwrites (monkey-patches)**
> `google.maps.places.PlacesService.prototype.getDetails`.
>
> **If multiple scripts patch this at once, only one will work.**
> (This includes classic Google Link Enhancer scripts and any other similar tool.)
>
> **Best practice:**
>
> - Use only one script that patches `getDetails` at a time.
> - SDK-based scripts (that do _not_ modify this function) are compatible.

### Google Places API Version

- As of March 2026, this library and WME both use the _legacy Google Maps Places JavaScript API_ (`PlacesService.getDetails`).
- If/when WME upgrades to the new [`Place.fetchFields`](https://developers.google.com/maps/documentation/javascript/reference/place), the enhancer will auto-detect and use it.

### Layer and String Customization

- You can fully localize all user-facing strings by overwriting properties on `GLE.strings`.

---

## For Script Developers

### API Quick Reference

#### Constructor

```js
const GLE = new SDKGoogleLinkEnhancer(sdk, turf, { layerName: 'My Script - GLE' });
```

| Parameter           | Type           | Required | Description                                                    |
| ------------------- | -------------- | -------- | -------------------------------------------------------------- |
| `sdk`               | WME SDK object | Yes      | The WME SDK instance                                           |
| `turf`              | Turf.js object | Yes      | The Turf.js library                                            |
| `options.layerName` | String         | No       | Name for the map layer (default: `"Google Link Enhancements"`) |

#### Properties

- **`GLE.strings`** — All user-facing UI strings. Overwrite individual properties to localize.
  ```js
  GLE.strings.permClosedPlace  = 'Permanently closed in Google';
  GLE.strings.tempClosedPlace  = 'Temporarily closed in Google';
  GLE.strings.badLink          = 'Invalid Google Place link';
  GLE.strings.multiLinked      = 'Linked more than once already';
  GLE.strings.linkedToXPlaces  = 'This is linked to {0} places'; // {0} = count
  GLE.strings.tooFar           = 'Google place is more than {0} meters away'; // {0} = limit
  GLE.strings.linkedToThisPlace = 'Already linked to this place';
  GLE.strings.linkedNearby     = 'Already linked to a nearby place';
  ```

- **`GLE.distanceLimit`** — Number (meters). Highlights venues whose Google Place marker is farther than this from the WME venue. Area places add the centroid-to-corner distance on top of this threshold.
  ```js
  GLE.distanceLimit = 400; // default
  ```

- **`GLE.showTempClosedPOIs`** — Boolean. When `true`, shows yellow highlights for temporarily closed venues. Setting this triggers an immediate map redraw.
  ```js
  GLE.showTempClosedPOIs = true; // default
  ```

- **`GLE.linkCache`** — The internal `GooglePlaceCache` instance. Exposes `.cache` (Map) and `.pendingPromises` (Map) for advanced use.

#### Methods

- **`GLE.enable()`** — Activates the enhancer: installs the API interceptor, starts listening for venue changes, and runs an initial map scan.
- **`GLE.disable()`** — Deactivates the enhancer: removes all map features and event listeners, cancels any pending debounce timer.

---

### Custom Layer Checkbox Integration Example

```js
$('#_cbEnableGLE').change(function () {
  if (this.checked) GLE.enable();
  else GLE.disable();
  $('#_cbGLEShowTempClosed')[0].disabled = !this.checked;
});
```

---

## FAQ

**Q: Does this script call Google directly?**
A: No, it uses the editor's loaded Google API via WME's own API key.

**Q: Why does it make many Google API requests when I enable it?**
A: When the highlight layer is visible, it proactively fetches place status for all Google-linked venues in the current viewport so map rings appear without requiring you to click each place. Requests are rate-limited to a maximum of 20 concurrent calls. If the layer is hidden, no proactive fetching occurs.

**Q: Can I use several SDK scripts together?**
A: Yes, _unless_ another script also monkey-patches `getDetails`.

**Q: Why don't I see highlighting?**
A: Your main script may not call `.enable()`, the highlight layer may be hidden in the Layer panel, or you may be running two GLE-type scripts together.

**Q: Do I need an API key?**
A: No. WME loads all keys and libraries for you.

---

## Troubleshooting

| Problem                               | Possible Cause/Solution                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Highlights missing/broken             | Only the last loaded script can patch `getDetails`. Disable conflicting scripts. |
| Highlights missing after pan          | Check that the highlight layer checkbox is enabled in the WME Layers panel.      |
| Multiple overlays/flicker             | Conflicting scripts — disable all but one GLE/monkey-patched script.             |
| No highlights but sidebar colors work | The highlight layer is hidden. Toggle it on in the WME Layers panel.             |
| Layer missing                         | Ensure your code calls the constructor before calling `.enable()`.               |
| Console errors                        | Please report with a screenshot/log.                                             |
