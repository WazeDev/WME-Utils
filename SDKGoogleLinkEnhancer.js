"use strict";
// ==UserScript==
// @name         WME Utils - SDK Google Link Enhancer
// @namespace    WazeDev
// @version      2026.03.23.00
// @description  Adds some extra WME functionality related to Google place links.
// @author       WazeDev group
// @include      /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @license      GNU GPLv3
// ==/UserScript==

/* global google */
/* eslint-disable max-classes-per-file */
const SDKGoogleLinkEnhancer = (() => {
    "use strict";
    var _a;
    class GooglePlaceCache {
        cache;
        pendingPromises;
        constructor() {
            this.cache = new Map();
            this.pendingPromises = new Map();
        }
        async getPlace(placeId) {
            if (this.cache.has(placeId)) {
                return this.cache.get(placeId);
            }
            if (!this.pendingPromises.has(placeId)) {
                let resolveFn;
                let rejectFn;
                const promise = new Promise((resolve, reject) => {
                    resolveFn = resolve;
                    rejectFn = reject;
                    // Set a timeout to reject the promise if not resolved in 3 seconds
                    setTimeout(() => {
                        if (this.pendingPromises.has(placeId)) {
                            this.pendingPromises.delete(placeId);
                            rejectFn(new Error(`Timeout: Place ${placeId} not found within 3 seconds`));
                        }
                    }, 3000);
                });
                this.pendingPromises.set(placeId, { promise, resolve: resolveFn, reject: rejectFn });
            }
            return this.pendingPromises.get(placeId).promise;
        }
        addPlace(placeId, properties) {
            this.cache.set(placeId, properties);
            if (this.pendingPromises.has(placeId)) {
                this.pendingPromises.get(placeId).resolve(properties);
                this.pendingPromises.delete(placeId);
            }
        }
    }
    class GLE {
        #DISABLE_CLOSED_PLACES = false; // Set to TRUE if the feature needs to be temporarily disabled, e.g. during the COVID-19 pandemic.
        #EXT_PROV_ELEM_QUERY = "wz-list-item.external-provider";
        #EXT_PROV_ELEM_CONTENT_QUERY = "div.external-provider-content";
        linkCache;
        #enabled = false;
        #venueChangeHandler = null;
        #mapLayer; // Set in constructor via options.layerName; defaults to "Google Link Enhancements"
        static #debug = false; // Set to true to enable verbose console logging
        #distanceLimit = 400; // Default distance (meters) when Waze place is flagged for being too far from Google place.
        // Area place is calculated as #distanceLimit + <distance between centroid and furthest node>
        #showTempClosedPOIs = true;
        #ptFeature;
        #lineFeature;
        #timeoutID = -1;
        #processDebounceID = -1;          // debounce timer handle for #processPlaces
        #prefetchQueue = [];               // IDs waiting to be dispatched to Google API
        #prefetchInflight = 0;             // count of in-flight getDetails requests
        static #PREFETCH_CONCURRENCY = 50; // max simultaneous getDetails calls
        strings = {
            permClosedPlace: "Google indicates this place is permanently closed.\nVerify with other sources or your editor community before deleting.",
            tempClosedPlace: "Google indicates this place is temporarily closed.",
            multiLinked: "Linked more than once already. Please find and remove multiple links.",
            linkedToThisPlace: "Already linked to this place",
            linkedNearby: "Already linked to a nearby place",
            linkedToXPlaces: "This is linked to {0} places",
            badLink: "Invalid Google link. Please remove it.",
            tooFar: "The Google linked place is more than {0} meters from the Waze place.  Please verify the link is correct.",
        };
        #styleConfig = {
            styleContext: {
                highNodeColor: (context) => {
                    return context?.feature?.properties?.style?.strokeColor;
                },
                strokeColor: (context) => {
                    return context?.feature?.properties?.style?.strokeColor;
                },
                strokeWidth: (context) => {
                    return context?.feature?.properties?.style?.strokeWidth;
                },
                strokeDashStyle: (context) => {
                    return context?.feature?.properties?.style?.strokeDashStyle;
                },
                label: (context) => {
                    return context?.feature?.properties?.style?.label;
                },
                labelYOffset: (context) => {
                    return context?.feature?.properties?.style?.labelYOffset;
                },
                fontColor: (context) => {
                    return context?.feature?.properties?.style?.fontColor;
                },
                fontWeight: (context) => {
                    return context?.feature?.properties?.style?.fontWeight;
                },
                labelOutlineColor: (context) => {
                    return context?.feature?.properties?.style?.labelOutlineColor;
                },
                labelOutlineWidth: (context) => {
                    return context?.feature?.properties?.style?.labelOutlineWidth;
                },
                fontSize: (context) => {
                    return context?.feature?.properties?.style?.fontSize;
                },
                pointRadius: (context) => {
                    return context?.feature?.properties?.style?.pointRadius;
                },
            },
            styleRules: [
                {
                    predicate: (properties) => {
                        return properties.styleName === "lineStyle";
                    },
                    style: {
                        strokeColor: "${strokeColor}",
                    },
                },
                {
                    predicate: (properties) => {
                        return properties.styleName === "default";
                    },
                    style: {
                        strokeColor: "${strokeColor}",
                        strokeWidth: "${strokeWidth}",
                        strokeDashstyle: "${strokeDashstyle}",
                        pointRadius: 15,
                        fillOpacity: 0,
                    },
                },
                {
                    predicate: (properties) => {
                        return properties.styleName === "venueStyle";
                    },
                    style: {
                        strokeColor: "${strokeColor}",
                        strokeWidth: "${strokeWidth}",
                        pointRadius: "${pointRadius}",
                        fillOpacity: 0,
                    },
                },
                {
                    predicate: (properties) => {
                        return properties.styleName === "placeStyle";
                    },
                    style: {
                        strokeColor: "${strokeColor}",
                        strokeWidth: "${strokeWidth}",
                        strokeDashStyle: "${strokeDashStyle}",
                        pointRadius: "${pointRadius}",
                        fillOpacity: 0,
                    },
                },
                {
                    predicate: (properties) => {
                        return properties.styleName === "googlePlacePointStyle";
                    },
                    style: {
                        pointRadius: "${pointRadius}",
                        strokeWidth: "${strokeWidth}",
                        strokeColor: "${strokeColor}",
                        fillColor: "${fillColor}",
                        strokeOpacity: "${strokeOpacity}",
                    },
                },
                {
                    predicate: (properties) => {
                        return properties.styleName === "googlePlaceLineStyle";
                    },
                    style: {
                        strokeWidth: "${strokeWidth}",
                        strokeDashstyle: "${strokeDashStyle}",
                        strokeColor: "${strokeColor}",
                        label: "${label}",
                        labelYOffset: "${labelYOffset}",
                        fontColor: "${fontColor}",
                        fontWeight: "${fontWeight}",
                        labelOutlineColor: "${labelOutlineColor}",
                        labelOutlineWidth: "${labelOutlineWidth}",
                        fontSize: "${fontSize}",
                    }
                }
            ],
        };
        sdk;
        trf;
        constructor(sdk, trf, { layerName = "Google Link Enhancements" } = {}) {
            let msg = "";
            if (!sdk) {
                msg += "SDK Must be defined to use GLE";
            }
            if (!trf) {
                msg += "\n";
                msg += "Turf Library Must be made available to GLE to Implement Some of the Functionality";
            }
            this.sdk = sdk;
            this.trf = trf;
            this.#mapLayer = layerName;
            this.linkCache = new GooglePlaceCache();
            this.#initLayer();
            this.sdk.Events.on({
                eventName: "wme-map-data-loaded",
                eventHandler: () => {
                    this.#processPlaces();
                }
            });
            this.sdk.Events.on({
                eventName: "wme-data-model-objects-added",
                eventHandler: (payload) => {
                    if (payload.dataModelName === "venues") {
                        this.#processPlaces();
                    }
                }
            });
            this.sdk.Events.on({
                eventName: "wme-data-model-objects-removed",
                eventHandler: (payload) => {
                    if (payload.dataModelName === "venues") {
                        this.#processPlaces();
                    }
                },
            });
            this.sdk.Events.on({
                eventName: "wme-data-model-objects-changed",
                eventHandler: (payload) => {
                    if (payload.dataModelName === "venues") {
                        this.#processPlaces();
                    }
                }
            });
            // This is a special event that will be triggered when DOM elements are destroyed.
            /* eslint-disable wrap-iife, func-names, object-shorthand */
            (($) => {
                $.event.special.destroyed = {
                    remove: (o) => {
                        if (o.handler && o.type !== "destroyed") {
                            o.handler();
                        }
                    },
                };
            })(jQuery);
            /* eslint-enable wrap-iife, func-names, object-shorthand */
            // In case a place is already selected on load.
            const currentSelection = this.sdk.Editing.getSelection();
            if (currentSelection?.ids?.length && currentSelection.objectType === "venue") {
                this.#formatLinkElements();
            }
            this.sdk.Events.on({
                eventName: "wme-selection-changed",
                eventHandler: this.#onWmeSelectionChanged.bind(this),
            });
            this.sdk.Events.on({
                eventName: "wme-layer-checkbox-toggled",
                eventHandler: (payload) => {
                    if (payload.name === this.#mapLayer) {
                        if (payload.checked) {
                            // Layer re-shown: redraw rings from cache (no new API calls needed).
                            this.#processPlaces();
                        } else {
                            // Layer hidden: clear features but keep GLE running so sidebar
                            // colouring, hover line, and API interception continue to work.
                            this.sdk.Map.removeAllFeaturesFromLayer({ layerName: this.#mapLayer });
                        }
                    }
                },
            });
        }
        #initLayer() {
            this.sdk.Map.addLayer({
                layerName: this.#mapLayer,
                styleContext: this.#styleConfig.styleContext,
                styleRules: this.#styleConfig.styleRules,
            });
            this.sdk.Map.setLayerOpacity({ layerName: this.#mapLayer, opacity: 0.8 });
            this.sdk.LayerSwitcher.addLayerCheckbox({ name: this.#mapLayer, isChecked: true });
        }
        #onWmeSelectionChanged() {
            if (this.#enabled) {
                this.#destroyPoint();
                const selected = this.sdk.Editing.getSelection();
                if (selected?.objectType === "venue") {
                    // The setTimeout is necessary (in beta WME currently, at least) to allow the
                    // panel UI DOM to update after a place is selected.
                    setTimeout(() => this.#formatLinkElements(), 0);
                }
            }
        }
        enable() {
            if (!this.#enabled) {
                this.#interceptGooglePlacesAPIs();
                $("#map").on("mouseenter", null, this, _a.#onMapMouseenter);
                this.#venueChangeHandler = (payload) => {
                    if (payload.dataModelName === "venues") {
                        this.#formatLinkElements();
                    }
                };
                this.sdk.Events.on({
                    eventName: "wme-data-model-objects-changed",
                    eventHandler: this.#venueChangeHandler,
                });
                this.#enabled = true;
                this.#processPlaces();
            }
        }
        disable() {
            if (this.#enabled) {
                $("#map").off("mouseenter", _a.#onMapMouseenter);
                if (this.#venueChangeHandler) {
                    this.sdk.Events.off({
                        eventName: "wme-data-model-objects-changed",
                        eventHandler: this.#venueChangeHandler,
                    });
                    this.#venueChangeHandler = null;
                }
                if (this.#processDebounceID !== -1) {
                    clearTimeout(this.#processDebounceID);
                    this.#processDebounceID = -1;
                }
                this.#enabled = false;
                this.sdk.Map.removeAllFeaturesFromLayer({ layerName: this.#mapLayer });
            }
        }
        // The distance (in meters) before flagging a Waze place that is too far from the linked Google place.
        // Area places use distanceLimit, plus the distance from the centroid of the AP to its furthest node.
        get distanceLimit() {
            return this.#distanceLimit;
        }
        set distanceLimit(value) {
            this.#distanceLimit = value;
        }
        get showTempClosedPOIs() {
            return this.#showTempClosedPOIs;
        }
        set showTempClosedPOIs(value) {
            this.#showTempClosedPOIs = value;
            this.#processPlaces();
        }
        #distanceBetweenPoints(point1, point2) {
            const ls = this.trf.lineString([point1, point2]);
            const length = this.trf.length(ls);
            return length * 1000; // multiply by 3.28084 to convert to feet
        }
        static isPointVenue(venue) {
            return venue.geometry.type === "Point";
        }
        #isLinkTooFar(link, venue) {
            if (link.loc) {
                const linkPt = this.trf.point([link.loc.lng, link.loc.lat]);
                let venuePt;
                let distanceLim = this.distanceLimit;
                if (venue.geometry.type === "Point") {
                    venuePt = venue.geometry;
                }
                else {
                    const center = this.trf.centroid(venue.geometry);
                    venuePt = center.geometry;
                    let bbox = venue.geometry.bbox;
                    if (!bbox) {
                        bbox = this.trf.bbox(venue.geometry);
                    }
                    const topRightPt = this.trf.point([bbox[0], bbox[1]]);
                    distanceLim += this.#distanceBetweenPoints(venuePt.coordinates, topRightPt.geometry.coordinates);
                }
                const distance = this.#distanceBetweenPoints(linkPt.geometry.coordinates, venuePt.coordinates);
                return distance > distanceLim;
            }
            return false;
        }
        #processPlaces() {
            if (!this.#enabled) return;
            if (this.#processDebounceID !== -1) clearTimeout(this.#processDebounceID);
            this.#processDebounceID = setTimeout(() => {
                this.#processDebounceID = -1;
                this.#doProcessPlaces();
            }, 150);
        }
        #doProcessPlaces() {
            try {
                    // Only draw map rings when the layer is visible in the Map Layers panel.
                    // Always clear first (even when hidden) so in-flight API responses can't
                    // ghost features back onto a layer the user has just hidden.
                    // Prefetch always runs so the cache stays warm and rings reappear instantly
                    // when the layer is re-shown, without needing new API calls.
                    const layerVisible = this.sdk.LayerSwitcher.isLayerCheckboxChecked({ name: this.#mapLayer });
                    // Get a list of already-linked id's
                    const existingLinks = SDKGoogleLinkEnhancer.#getExistingLinks(this.sdk);
                    this.sdk.Map.removeAllFeaturesFromLayer({ layerName: this.#mapLayer });
                    const drawnLinks = [];
                    // Clear stale queue entries from previous viewport before building uncachedIds.
                    this.#prefetchQueue = [];
                    const objectIds = [];
                    for (const venue of this.sdk.DataModel.Venues.getAll()) {
                        objectIds.push(venue.id);
                    }
                    const uncachedIds = new Set();
                    for (const objId of objectIds) {
                        const promises = [];
                        const venue = this.sdk.DataModel.Venues.getById({ venueId: objId.toString() });
                        if (venue === null)
                            continue;
                        for (const provID of venue.externalProviderIds) {
                            const id = provID;
                            if (!this.linkCache.cache.has(id) && !this.linkCache.pendingPromises.has(id)) {
                                uncachedIds.add(id);
                            }
                            // Check for duplicate links
                            const linkInfo = existingLinks[id];
                            if (linkInfo?.count > 1) {
                                const geometry = venue.geometry;
                                const width = _a.isPointVenue(venue) ? 4 : 12;
                                const color = "#fb8d00";
                                const features = [
                                    geometry.type === "Point"
                                        ? this.trf.point(geometry.coordinates, {
                                            styleName: "venueStyle",
                                            style: {
                                                strokeWidth: width,
                                                strokeColor: color,
                                                pointRadius: 15,
                                            },
                                        }, { id: `venue_${geometry.toString()}` })
                                        : this.trf.polygon(geometry.coordinates, {
                                            styleName: "venueStyle",
                                            style: {
                                                strokeColor: color,
                                                strokeWidth: width,
                                            },
                                        }, { id: `polyvenue_${geometry.toString()}` }),
                                ];
                                const lineStart = this.trf.centroid(geometry);
                                for (const linkVenue of linkInfo.venues) {
                                    if (linkVenue !== venue &&
                                        !drawnLinks.some((dl) => (dl[0] === venue && dl[1] === linkVenue) ||
                                            (dl[0] === linkVenue && dl[1] === venue))) {
                                        const endPoint = this.trf.centroid(linkVenue.geometry);
                                        features.push(this.trf.lineString([lineStart.geometry.coordinates, endPoint.geometry.coordinates], {
                                            styleName: "lineStyle",
                                            style: {
                                                strokeWidth: 4,
                                                strokeColor: color,
                                                strokeDashstyle: "12 12",
                                            },
                                        }, { id: `ls_${lineStart.geometry.toString()}_${endPoint.geometry.toString()}` }));
                                        drawnLinks.push([venue, linkVenue]);
                                    }
                                }
                                if (layerVisible) {
                                    this.sdk.Map.addFeaturesToLayer({ features: features, layerName: this.#mapLayer });
                                }
                            }
                            promises.push(this.linkCache.getPlace(id));
                        }
                        // Process all results of link lookups and add a highlight feature if needed.
                        Promise.all(promises).then((results) => {
                            let strokeColor = null;
                            let strokeDashStyle = "solid";
                            if (!this.#DISABLE_CLOSED_PLACES && results.some((res) => res.permclosed)) {
                                if (/^(\[|\()?(permanently )?closed(\]|\)| -)/i.test(venue.name) ||
                                    /(\(|- |\[)(permanently )?closed(\)|\])?$/i.test(venue.name)) {
                                    strokeDashStyle = _a.isPointVenue(venue) ? "2 6" : "2 16";
                                }
                                strokeColor = "#F00";
                            }
                            else if (results.some((res) => this.#isLinkTooFar(res, venue))) {
                                strokeColor = "#0FF";
                            }
                            else if (!this.#DISABLE_CLOSED_PLACES &&
                                this.#showTempClosedPOIs &&
                                results.some((res) => res.tempclosed)) {
                                if (/^(\[|\()?(temporarily )?closed(\]|\)| -)/i.test(venue.name) ||
                                    /(\(|- |\[)(temporarily )?closed(\)|\])?$/i.test(venue.name)) {
                                    strokeDashStyle = _a.isPointVenue(venue) ? "2 6" : "2 16";
                                }
                                strokeColor = "#FD3";
                            }
                            else if (results.some((res) => res.notFound)) {
                                strokeColor = "#F0F";
                            }
                            if (strokeColor && layerVisible) {
                                const style = {
                                    strokeWidth: _a.isPointVenue(venue) ? 4 : 12,
                                    strokeColor,
                                    strokeDashStyle,
                                    pointRadius: 15,
                                };
                                const feature = _a.isPointVenue(venue)
                                    ? this.trf.point(venue.geometry.coordinates, {
                                        styleName: "placeStyle",
                                        style: style,
                                    }, { id: `place_${venue.id}` })
                                    : this.trf.polygon(venue.geometry.coordinates, {
                                        styleName: "placeStyle",
                                        style: style,
                                    }, { id: `place_${venue.id}` });
                                this.sdk.Map.addFeaturesToLayer({ features: [feature], layerName: this.#mapLayer });
                            }
                        }).catch(() => {
                            // Timeout: Google hasn't called getDetails for this venue yet — suppress silently.
                        });
                    }
                    // Proactively fetch Google data for venues not yet in cache.
                    // When responses arrive the interceptor populates the cache and
                    // triggers another #processPlaces pass to render the highlights.
                    // Skip prefetch when the layer is hidden — sidebar coloring works
                    // reactively via the interceptor, so there's no benefit fetching
                    // data for rings that aren't being displayed.
                    if (layerVisible) {
                        this.#prefetchPlaceData([...uncachedIds]);
                    }
                }
                catch (ex) {
                    console.error("PIE (Google Link Enhancer) error:", ex);
                }
        }
        // Proactively fetches Google place data for each uncached place ID so that
        // GLE can highlight closed/far venues in the viewport without requiring user selection.
        // Always uses the legacy PlacesService.getDetails — the new Place.fetchFields API calls
        // places.googleapis.com which is not in WME's Content Security Policy connect-src list
        // and will be blocked by the browser. The Place.fetchFields interceptor in
        // #interceptGooglePlacesAPIs remains active in case WME itself ever migrates to the new API.
        // Requests are capped at #PREFETCH_CONCURRENCY simultaneous in-flight calls; the rest
        // are queued and drained automatically as each response arrives.
        #prefetchPlaceData(placeIds) {
            if (!placeIds.length) return;
            if (typeof google === "undefined" || !google.maps?.places?.PlacesService) return;
            for (const id of placeIds) {
                if (!this.#prefetchQueue.includes(id)) {
                    this.#prefetchQueue.push(id);
                }
            }
            this.#drainPrefetchQueue();
        }
        #drainPrefetchQueue() {
            if (this.#prefetchInflight >= SDKGoogleLinkEnhancer.#PREFETCH_CONCURRENCY
                || this.#prefetchQueue.length === 0) return;
            if (typeof google === "undefined" || !google.maps?.places?.PlacesService) return;
            const service = new google.maps.places.PlacesService(document.createElement("div"));
            while (this.#prefetchInflight < SDKGoogleLinkEnhancer.#PREFETCH_CONCURRENCY
                   && this.#prefetchQueue.length > 0) {
                const placeId = this.#prefetchQueue.shift();
                this.#prefetchInflight++;
                service.getDetails(
                    { placeId, fields: ["place_id", "geometry", "business_status"] },
                    () => {
                        // Interceptor in #interceptGooglePlacesAPIs handles cache population
                        // and triggers #processPlaces(). This callback only manages queue state.
                        this.#prefetchInflight--;
                        this.#drainPrefetchQueue();
                    }
                );
            }
        }
        static #onMapMouseenter(event) {
            // If the point isn't destroyed yet, destroy it when mousing over the map.
            event.data.#destroyPoint();
        }
        async #formatLinkElements() {
            const $links = $("#edit-panel").find(this.#EXT_PROV_ELEM_QUERY);
            if ($links.length) {
                const existingLinks = _a.#getExistingLinks(this.sdk);
                // fetch all links first
                const promises = [];
                const extProvElements = [];
                $links.each((ix, linkEl) => {
                    const $linkEl = $(linkEl);
                    extProvElements.push($linkEl);
                    const id = this.#getIdFromElement($linkEl);
                    promises.push(this.linkCache.getPlace(id));
                });
                const links = await Promise.all(promises);
                extProvElements.forEach(($extProvElem, i) => {
                    const id = this.#getIdFromElement($extProvElem);
                    if (!id)
                        return;
                    const link = links[i];
                    if (existingLinks[id] && existingLinks[id].count > 1 && existingLinks[id].isThisVenue) {
                        setTimeout(() => {
                            $extProvElem
                                .find(this.#EXT_PROV_ELEM_CONTENT_QUERY)
                                .css({ backgroundColor: "#FFA500" })
                                .attr({
                                title: this.strings.linkedToXPlaces.replace("{0}", existingLinks[id].count),
                            });
                        }, 50);
                    }
                    this.#addHoverEvent($extProvElem);
                    if (link) {
                        if (link.permclosed && !this.#DISABLE_CLOSED_PLACES) {
                            $extProvElem
                                .find(this.#EXT_PROV_ELEM_CONTENT_QUERY)
                                .css({ backgroundColor: "#FAA" })
                                .attr("title", this.strings.permClosedPlace);
                        }
                        else if (link.tempclosed && !this.#DISABLE_CLOSED_PLACES) {
                            $extProvElem
                                .find(this.#EXT_PROV_ELEM_CONTENT_QUERY)
                                .css({ backgroundColor: "#FFA" })
                                .attr("title", this.strings.tempClosedPlace);
                        }
                        else if (link.notFound) {
                            $extProvElem
                                .find(this.#EXT_PROV_ELEM_CONTENT_QUERY)
                                .css({ backgroundColor: "#F0F" })
                                .attr("title", this.strings.badLink);
                        }
                        else {
                            const selection = this.sdk.Editing.getSelection();
                            if (selection?.objectType === "venue") {
                                const venue = this.sdk.DataModel.Venues.getById({ venueId: selection.ids[0] });
                                if (venue && this.#isLinkTooFar(link, venue)) {
                                    $extProvElem
                                        .find(this.#EXT_PROV_ELEM_CONTENT_QUERY)
                                        .css({ backgroundColor: "#0FF" })
                                        .attr("title", this.strings.tooFar.replace("{0}", this.distanceLimit.toString()));
                                }
                                else {
                                    // reset in case we just deleted another provider
                                    $extProvElem
                                        .find(this.#EXT_PROV_ELEM_CONTENT_QUERY)
                                        .css({ backgroundColor: "" })
                                        .attr("title", "");
                                }
                            }
                        }
                    }
                });
            }
        }
        static #getExistingLinks(sdk = undefined) {
            if (!sdk) {
                const msg = "SDK Is Not Available";
                console.error(msg);
                throw new Error(msg);
            }
            const existingLinks = {};
            const thisVenue = sdk.Editing.getSelection();
            if (thisVenue?.objectType !== "venue")
                return {};
            for (const venue of sdk.DataModel.Venues.getAll()) {
                const isThisVenue = venue.id === thisVenue.ids[0];
                const thisPlaceIDs = [];
                for (const provID of venue.externalProviderIds) {
                    const id = provID;
                    if (!thisPlaceIDs.includes(id)) {
                        thisPlaceIDs.push(id);
                        let link = existingLinks[id];
                        if (link) {
                            link.count++;
                            link.venues.push(venue);
                        }
                        else {
                            link = { count: 1, venues: [venue] };
                            existingLinks[id] = link;
                        }
                        link.isThisVenue = link.isThisVenue || isThisVenue;
                    }
                }
            }
            return existingLinks;
        }
        // Remove the POI point from the map.
        #destroyPoint() {
            if (this.#ptFeature) {
                this.sdk.Map.removeFeaturesFromLayer({ featureIds: [this.#ptFeature.id, this.#lineFeature.id], layerName: this.#mapLayer });
                this.#ptFeature = null;
                this.#lineFeature = null;
            }
        }
        #getOLMapExtent() {
            return this.sdk.Map.getMapExtent();
        }
        // Add the POI point to the map.
        async #addPoint(id) {
            if (!id)
                return;
            const link = await this.linkCache.getPlace(id);
            if (link) {
                if (!link.notFound) {
                    const coord = link.loc;
                    const poiPt = this.trf.point([coord.lng, coord.lat]);
                    const selection = this.sdk.Editing.getSelection();
                    let placeGeom;
                    if (selection?.objectType === "venue") {
                        const v = this.sdk.DataModel.Venues.getById({ venueId: selection.ids[0] });
                        placeGeom = v?.geometry && this.trf.centroid(v?.geometry)?.geometry;
                    }
                    else {
                        return;
                    }
                    const placePt = this.trf.point(placeGeom.coordinates);
                    const ext = this.#getOLMapExtent();
                    const lsBounds = this.trf.lineString([
                        [ext[0], ext[3]],
                        [ext[0], ext[1]],
                        [ext[2], ext[1]],
                        [ext[2], ext[3]],
                        [ext[0], ext[3]],
                    ]);
                    let lsLine = this.trf.lineString([placePt.geometry.coordinates, poiPt.geometry.coordinates]);
                    // If the line extends outside the bounds, split it so we don't draw a line across the world.
                    const splits = this.trf.lineSplit(lsLine, lsBounds);
                    let label = "";
                    if (splits) {
                        for (const split of splits.features) {
                            for (const component of split.geometry.coordinates) {
                                if (component[0] === placePt.geometry.coordinates[0] &&
                                    component[1] === placePt.geometry.coordinates[1])
                                    lsLine = split;
                            }
                        }
                        let distance = this.#distanceBetweenPoints(poiPt.geometry.coordinates, placePt.geometry.coordinates);
                        let unitConversion;
                        let unit1;
                        let unit2;
                        if (this.sdk.Settings.getUserSettings().isImperial) {
                            distance *= 3.28084;
                            unitConversion = 5280;
                            unit1 = " ft";
                            unit2 = " mi";
                        }
                        else {
                            unitConversion = 1000;
                            unit1 = " m";
                            unit2 = " km";
                        }
                        if (distance > unitConversion * 10) {
                            label = Math.round(distance / unitConversion) + unit2;
                        }
                        else if (distance > 1000) {
                            label = Math.round(distance / (unitConversion / 10)) / 10 + unit2;
                        }
                        else {
                            label = Math.round(distance) + unit1;
                        }
                    }
                    this.#destroyPoint(); // Just in case it still exists.
                    this.#ptFeature = this.trf.point(poiPt.geometry.coordinates, {
                        styleName: "googlePlacePointStyle",
                        style: {
                            pointRadius: 6,
                            strokeWidth: 30,
                            strokeColor: "#FF0",
                            fillColor: "#FF0",
                            strokeOpacity: 0.5,
                        },
                    }, { id: `PoiPT_${poiPt.toString()}` });
                    this.#lineFeature = this.trf.lineString(lsLine.geometry.coordinates, {
                        styleName: "googlePlaceLineStyle",
                        style: {
                            strokeWidth: 3,
                            strokeDashstyle: "12 8",
                            strokeColor: "#FF0",
                            label,
                            labelYOffset: 45,
                            fontColor: "#FF0",
                            fontWeight: "bold",
                            labelOutlineColor: "#000",
                            labelOutlineWidth: 4,
                            fontSize: "18",
                        },
                    }, { id: `LsLine_${lsLine.toString()}` });
                    this.sdk.Map.addFeaturesToLayer({ features: [this.#ptFeature, this.#lineFeature], layerName: this.#mapLayer });
                    this.#timeoutDestroyPoint();
                }
            }
        }
        // Destroy the point after some time, if it hasn't been destroyed already.
        #timeoutDestroyPoint() {
            if (this.#timeoutID > 0)
                clearTimeout(this.#timeoutID);
            this.#timeoutID = setTimeout(() => this.#destroyPoint(), 4000);
        }
        #getIdFromElement($el) {
            const providerIndex = $el.parent().children().toArray().indexOf($el[0]);
            const selection = this.sdk.Editing.getSelection();
            if (!selection || selection.objectType !== "venue") return null;
            const venue = this.sdk.DataModel.Venues.getById({ venueId: selection.ids[0] });
            return venue?.externalProviderIds?.[providerIndex] ?? null;
        }
        #addHoverEvent($el) {
            $el.hover(() => this.#addPoint(this.#getIdFromElement($el)), () => this.#destroyPoint());
        }
        #interceptGooglePlacesAPIs() {
            // --- Legacy PlacesService.getDetails interceptor ---
            // Kept for backward compat: WME may still call the legacy API internally.
            if (typeof google === "undefined" ||
                !google.maps ||
                !google.maps.places ||
                !google.maps.places.PlacesService) {
                if (_a.#debug) console.debug("Google Maps PlacesService not loaded yet.");
                setTimeout(this.#interceptGooglePlacesAPIs.bind(this), 500); // Retry until it loads
                return;
            }
            const originalGetDetails = google.maps.places.PlacesService.prototype.getDetails;
            const that = this;
            google.maps.places.PlacesService.prototype.getDetails = function interceptedGetDetails(request, callback) {
                const customCallback = (result, status) => {
                    const link = {};
                    let cacheUpdated = false;
                    switch (status) {
                        case google.maps.places.PlacesServiceStatus.OK: {
                            const loc = result.geometry.location;
                            link.loc = { lng: loc.lng(), lat: loc.lat() };
                            if (result.business_status === google.maps.places.BusinessStatus.CLOSED_PERMANENTLY) {
                                link.permclosed = true;
                                if (_a.#debug) console.debug("GLE: permanently closed place detected:", request.placeId);
                            }
                            else if (result.business_status === google.maps.places.BusinessStatus.CLOSED_TEMPORARILY) {
                                link.tempclosed = true;
                                if (_a.#debug) console.debug("GLE: temporarily closed place detected:", request.placeId);
                            }
                            that.linkCache.addPlace(request.placeId, link);
                            cacheUpdated = true;
                            break;
                        }
                        case google.maps.places.PlacesServiceStatus.NOT_FOUND:
                            link.notFound = true;
                            that.linkCache.addPlace(request.placeId, link);
                            cacheUpdated = true;
                            if (_a.#debug) console.debug("GLE: invalid/not-found Google link:", request.placeId);
                            break;
                        default:
                            link.error = status;
                            if (_a.#debug) console.debug("GLE: unexpected getDetails status:", status, request.placeId);
                    }
                    // Re-render map highlights now that Google data has arrived for this place.
                    // #processPlaces ran earlier (on map load) before the cache was populated,
                    // so a new pass is needed each time a getDetails response comes back.
                    // The debounce inside #processPlaces coalesces rapid back-to-back calls.
                    if (cacheUpdated) {
                        that.#processPlaces();
                    }
                    callback(result, status); // Pass the result to the original callback
                };
                return originalGetDetails.call(this, request, customCallback);
            };
            if (_a.#debug) console.debug("Google Maps PlacesService.getDetails intercepted successfully.");

            // --- New Place.fetchFields interceptor ---
            // Intercepts calls from WME itself if/when it migrates to the new API.
            // Note: #prefetchPlaceData always uses the legacy PlacesService.getDetails because
            // Place.fetchFields calls places.googleapis.com which is blocked by WME's CSP.
            if (!google.maps.places.Place) {
                if (_a.#debug) console.debug("New Place class not available — skipping Place.fetchFields intercept.");
                return;
            }
            const originalFetchFields = google.maps.places.Place.prototype.fetchFields;
            google.maps.places.Place.prototype.fetchFields = async function interceptedFetchFields(options) {
                try {
                    const result = await originalFetchFields.call(this, options);
                    const place = result.place;
                    const link = {};
                    if (place.location) {
                        link.loc = { lng: place.location.lng(), lat: place.location.lat() };
                    }
                    if (place.businessStatus === google.maps.places.BusinessStatus.CLOSED_PERMANENTLY) {
                        link.permclosed = true;
                    } else if (place.businessStatus === google.maps.places.BusinessStatus.CLOSED_TEMPORARILY) {
                        link.tempclosed = true;
                    }
                    that.linkCache.addPlace(this.id, link);
                    that.#processPlaces();
                    return result;
                } catch (err) {
                    // Only cache as notFound for a definitive NOT_FOUND response.
                    // Other errors (CSP block, quota, network) are transient — leave uncached for retry.
                    const status = String(err?.status ?? err?.code ?? err?.message ?? "").toUpperCase();
                    if (status.includes("NOT_FOUND")) {
                        that.linkCache.addPlace(this.id, { notFound: true });
                        that.#processPlaces();
                    }
                    throw err; // Re-throw so WME and other callers still receive the error.
                }
            };
            if (_a.#debug) console.debug("Google Maps Place.fetchFields intercepted successfully.");
        }
    }
    _a = GLE;
    return GLE;
})();
