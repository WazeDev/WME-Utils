# WME Utils – Google Link Enhancer (SDK Edition)

**A utility library for Waze Map Editor scripts: highlights Google Place link issues (closed, broken, duplicate, distant) directly on the map and in the sidebar.**

**Authors:** MapOMatic, karlsosha, JS55CT, WazeDev group  
**License:** GNU GPLv3  
**Latest Version:** 2026.03.10.00

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
    - Show exact distance in user’s units
- **Proactive Checks**
  - Auto-fetches Google status for all visible venues and flags issues instantly as the map loads.
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
- All visible WME venues are scanned for Google Place links.
- Place details are fetched live from Google via WME’s API.
- Any issues are highlighted visually on the map and/or sidebar (handled by PIE).
- Hovering a Google link draws a line and shows distance (by PIE).
- UI strings and thresholds are customizable, but set by PIE.

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

- You can fully localize all user-facing strings by overwriting `GLE.strings`.

---

## For Script Developers

### API Quick Reference

#### Constructor

```js
const GLE = new SDKGoogleLinkEnhancer(sdk, turf, { layerName: 'My Script - GLE' });
```

#### Properties

- **GLE.strings**: All user-facing UI strings and messages.
  ```js
  GLE.strings.permClosedPlace = 'Permanently closed in Google';
  GLE.strings.tempClosedPlace = 'Temporarily closed in Google';
  GLE.strings.brokenPlace = 'Invalid Google Place link';
  GLE.strings.duplicatePlace = 'This Place ID is used by multiple venues';
  GLE.strings.distantPlace = 'Google Place marker is too far from Waze place';
  ```
- **GLE.distanceLimit**: Number (meters). Highlight venues whose Google Place marker is farther away than this from WME's venue location.
  ```js
  GLE.distanceLimit = 400;
  ```
- **GLE.showTempClosedPOIs**: Boolean. If `true`, shows highlight for temp-closed venues; if `false`, suppresses it.
  ```js
  GLE.showTempClosedPOIs = false;
  ```
- **GLE.layerName**: String. Name for the overlay/layer in the panel.

#### Methods

- `GLE.enable()` – Start monitoring, show overlay
- `GLE.disable()` – Stop overlay and highlighting
- `GLE.refresh()` – Force rescan of all visible venues (optional)
- `GLE.setStrings({...})` – Bulk set UI text
  ```js
  GLE.setStrings({
    permClosedPlace: 'Closed!',
    tempClosedPlace: 'Temporarily closed!',
  });
  ```

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
A: No, it uses the editor’s loaded Google API.

**Q: Can I use several SDK scripts together?**  
A: Yes, _unless_ another script also monkey-patches `getDetails`.

**Q: Why don’t I see highlighting?**  
A: Your main script may not call `.enable()`, or you may be running two GLE-type scripts together.

**Q: Do I need an API key?**  
A: No. WME loads all keys and libraries for you.

---

## Troubleshooting

| Problem                   | Possible Cause/Solution                                            |
| ------------------------- | ------------------------------------------------------------------ |
| Highlights missing/broken | Only the last loaded script can patch `getDetails`.                |
| Multiple overlays/flicker | Conflicting scripts—disable all but one GLE/monkey-patched script. |
| Layer missing             | Ensure your code calls layer registration.                         |
| Console errors            | Please report with a screenshot/log.                               |
