// ==UserScript==
// @name         WME Utils - Google Link Enhancer
// @namespace    WazeDev
// @version      2018.08.18.001
// @description  Adds some extra WME functionality related to Google place links.
// @author       MapOMatic, WazeDev group
// @include      /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @license      GNU GPLv3
// ==/UserScript==

/* global $ */
/* global OL */
/* global Promise */
/* global W */
/* global Node */

class GoogleLinkEnhancer {

    constructor() {
        this.EXT_PROV_ELEM_QUERY = 'li.external-provider-item';
        this.LINK_CACHE_NAME = 'gle_link_cache';
        this.LINK_CACHE_CLEAN_INTERVAL_MIN = 1;   // Interval to remove old links and save new ones.
        this.LINK_CACHE_LIFESPAN_HR = 6;          // Remove old links when they exceed this time limit.
        this._enabled = false;
        this._mapLayer = null;
        this._urlOrigin = window.location.origin;
        this._distanceLimit = 400;                // Default distance (meters) when Waze place is flagged for being too far from Google place.
                                                  // Area place is calculated as _distanceLimit + <distance between centroid and furthest node>

        this.strings = {};
        this.strings.closedPlace = 'Google indicates this place is permanently closed.\nVerify with other sources or your editor community before deleting.';
        this.strings.multiLinked = 'Linked more than once already. Please find and remove multiple links.';
        this.strings.linkedToThisPlace = 'Already linked to this place';
        this.strings.linkedNearby = 'Already linked to a nearby place';
        this.strings.linkedToXPlaces = 'This is linked to {0} places';
        this.strings.badLink = 'Invalid Google link.  Please remove it.';
        this.strings.tooFar = 'The Google linked place is more than {0} meters from the Waze place.  Please verify the link is correct.';

        this._initLZString();

        let storedCache = localStorage.getItem(this.LINK_CACHE_NAME);
        try {
            this._linkCache = storedCache ? $.parseJSON(this._LZString.decompressFromUTF16(storedCache)) : {};
        } catch (ex) {
            if (ex.name === 'SyntaxError') {
                // In case the cache is corrupted and can't be read.
                this._linkCache = {};
                console.warn('GoogleLinkEnhancer:', 'An error occurred while loading the stored cache.  A new cache was created.');
            } else {
                throw ex;
            }
        }
        if (this._linkCache === null || this._linkCache.length === 0) this._linkCache = {};

        this._initLayer();

        // Watch for ext provider elements being added to the DOM, and add hover events.
        this._linkObserver = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                for (let idx=0; idx<mutation.addedNodes.length; idx++) {
                    let nd = mutation.addedNodes[idx];
                    if (nd.nodeType === Node.ELEMENT_NODE) {
                        let $el = $(nd);
                        if ($el.is(this.EXT_PROV_ELEM_QUERY)) {
                            this._addHoverEvent($el);
                        } else {
                            if ($el.find('div.uuid').length) {
                                this._formatLinkElements();
                            }
                        }
                    }
                }
            });
        });

        // Watch the side panel for addition of the sidebar-layout div, which indicates a mode change.
        this._modeObserver = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                for (let idx = 0; idx<mutation.addedNodes.length; idx++) {
                    let nd = mutation.addedNodes[idx];
                    if (nd.nodeType === Node.ELEMENT_NODE && $(nd).is('.sidebar-layout')) {
                        this._observeLinks();
                        break;
                    }
                }
            });
        });

        // This is a special event that will be triggered when DOM elements are destroyed.
        (function($){
            $.event.special.destroyed = {
                remove: function(o) {
                    if (o.handler && o.type !== 'destroyed') {
                        o.handler();
                    }
                }
            };
        })(jQuery);
    }


    _initLayer(){
        this._mapLayer = new OL.Layer.Vector('Google Link Enhancements.', {
            uniqueName: '___GoogleLinkEnhancements',
            displayInLayerSwitcher: true,
            styleMap: new OL.StyleMap({
                default: {
                    strokeColor: '${strokeColor}',
                    strokeWidth: '${strokeWidth}',
                    strokeDashstyle: '${strokeDashstyle}',
                    pointRadius: '15',
                    fillOpacity: '0'
                }
            })
        });

        this._mapLayer.setOpacity(0.8);

        W.map.addLayer(this._mapLayer);

        W.model.events.register('mergeend',this,function(e){
            this._processPlaces();
        },true);
        W.map.events.register('moveend',this,function(e){
            this._processPlaces();
        },true);
        W.model.venues.on('objectschanged', function(e) {
            this._processPlaces();
        }, this);
    }

    enable() {
        this._enabled = true;
        this._modeObserver.observe($('.edit-area #sidebarContent')[0], {childList: true, subtree:false});
        this._observeLinks();
        // Note: Using on() allows passing "this" as a variable, so it can be used in the handler function.
        $(document).on('ajaxSuccess', null, this, this._onAjaxSuccess);
        $('#map').on('mouseenter', null, this, this._onMapMouseenter);
        $(window).on('unload', null, this, this._onWindowUnload);
        W.model.venues.on('objectschanged', this._formatLinkElements, this);
        this._processPlaces();
        this._cleanAndSaveLinkCache();
        this._cacheCleanIntervalID = setInterval(() => this._cleanAndSaveLinkCache(), 1000 * 60 * this.LINK_CACHE_CLEAN_INTERVAL_MIN);
    }

    disable() {
        this._enabled = false;
        this._modeObserver.disconnect();
        this._linkObserver.disconnect();
        $(document).off('ajaxSuccess', this._onAjaxSuccess);
        $('#map').off('mouseenter', this._onMapMouseenter);
        $(window).off('unload', null, this, this._onWindowUnload);
        W.model.venues.off('objectschanged', this._formatLinkElements, this);
        if (this._cacheCleanIntervalID) clearInterval(this._cacheCleanIntervalID);
        this._cleanAndSaveLinkCache();
        this._mapLayer.removeAllFeatures();
    }

    // The distance (in meters) before flagging a Waze place that is too far from the linked Google place.
    // Area places use distanceLimit, plus the distance from the centroid of the AP to its furthest node.
    get distanceLimit() {
        return this._distanceLimit;
    }
    set distanceLimit(value) {
        this._distanceLimit = value;
        this._processPlaces();
    }

    _onWindowUnload(evt) {
        evt.data._cleanAndSaveLinkCache();
    }

    _cleanAndSaveLinkCache() {
        if (!this._linkCache) return;
        let now = new Date();
        Object.keys(this._linkCache).forEach(id => {
            let link = this._linkCache[id];
            // Bug fix:
            if (link.location) {
                link.loc = link.location;
                delete link.location;
            }
            // Delete link if older than X hours.
            if (!link.ts || (now - new Date(link.ts)) > this.LINK_CACHE_LIFESPAN_HR * 3600 * 1000) {
                delete this._linkCache[id];
            }
        });
        localStorage.setItem(this.LINK_CACHE_NAME, this._LZString.compressToUTF16(JSON.stringify(this._linkCache)));
        //console.log('link cache count: ' + Object.keys(this._linkCache).length, this._linkCache);
    }

    _distanceBetweenPoints(x1, y1, x2, y2) {
        return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
    }

    _isLinkTooFar(link, venue) {
        if (link.loc) {
            let linkPt = new OL.Geometry.Point(link.loc.lng, link.loc.lat);
            linkPt.transform(W.map.displayProjection, W.map.projection);
            let venuePt;
            let distanceLimit;
            if (venue.isPoint()) {
                venuePt = venue.geometry.getCentroid();
                distanceLimit = this.distanceLimit;
            } else {
                let bounds = venue.geometry.getBounds();
                let center = bounds.getCenterLonLat();
                venuePt = {x: center.lon, y: center.lat};
                distanceLimit = this._distanceBetweenPoints(center.lon, center.lat, bounds.right, bounds.top) + this.distanceLimit;
            }
            let distance = this._distanceBetweenPoints(linkPt.x, linkPt.y, venuePt.x, venuePt.y);

            return distance > distanceLimit;
        } else {
            return false;
        }
    }

    _processPlaces() {
        try {
            if (this._enabled) {
                let that = this;
                let projFrom = W.map.displayProjection;
                let projTo = W.map.projection;
                let mapExtent = W.map.getExtent();
                this._mapLayer.removeAllFeatures();
                W.model.venues.getObjectArray().forEach(function(venue) {
                    let isTooFar = false;
                    venue.attributes.externalProviderIDs.forEach(provID => {
                        let id = provID.attributes.uuid;
                        that._getLinkInfoAsync(id).then(link => {
                            // Check for distance from Google POI.
                            if (that._isLinkTooFar(link, venue) && !isTooFar) {
                                isTooFar = true;
                                let venuePt = venue.geometry.getCentroid();
                                let dashStyle = 'solid'; //venue.isPoint() ? '2 6' : '2 16';
                                let geometry = venue.isPoint() ? venuePt : venue.geometry.clone();
                                let width = venue.isPoint() ? '4' : '12';
                                that._mapLayer.addFeatures([new OL.Feature.Vector(geometry, {strokeWidth:width, strokeColor:'#0FF', strokeDashstyle:dashStyle})]);
                            }

                            // Check for closed places or invalid Google links.
                            if (link.closed || link.notFound) {
                                let dashStyle = link.closed && (/^(\[|\()?(permanently )?closed(\]|\)| -)/i.test(venue.attributes.name) || /(\(|- |\[)(permanently )?closed(\)|\])?$/i.test(venue.attributes.name)) ? (venue.isPoint() ? '2 6' : '2 16') : 'solid';
                                let geometry = venue.isPoint() ? venue.geometry.getCentroid() : venue.geometry.clone();
                                let width = venue.isPoint() ? '4' : '12';
                                let color = link.notFound ? '#F0F' : '#F00';
                                that._mapLayer.addFeatures([new OL.Feature.Vector(geometry, {strokeWidth:width, strokeColor:color, strokeDashstyle:dashStyle})]);
                            }
                        }).catch(res => {
                            console.log(res);
                        });
                    });
                });
            }
        } catch (ex) {
            console.error('PIE (Google Link Enhancer) error:', ex);
        }
    }

    _cacheLink(id, link) {
        link.ts = new Date();
        this._linkCache[id] = link;
        //console.log('link cache count: ' + Object.keys(this._linkCache).length, this._linkCache);
    }

    _getLinkInfoAsync(id) {
        var link = this._linkCache[id];
        if (link) {
            return Promise.resolve(link);
        } else {
            return new Promise((resolve, reject) => {
                $.getJSON(this._urlOrigin + '/maps/api/place/details/json?&key=AIzaSyDf-q2MCay0AE7RF6oIMrDPrjBwxVtsUuI&placeid=' + id).then(json => {
                    if (json.status==='NOT_FOUND')  {
                        link = {notFound: true};
                        console.debug('GLE (link not found for ' + id + '):', json);
                    } else {
                        link = {loc:json.result.geometry.location,closed:json.result.permanently_closed};
                    }
                    this._cacheLink(id, link);
                    resolve(link);
                }).fail(res => {
                    reject(res);
                });
            });
        }
    }

    _onMapMouseenter(event) {
        // If the point isn't destroyed yet, destroy it when mousing over the map.
        event.data._destroyPoint();
    }

    _getSelectedFeatures(){
        if(!W.selectionManager.getSelectedFeatures)
            return W.selectionManager.selectedItems;
        return W.selectionManager.getSelectedFeatures();
    }

    _formatLinkElements(a,b,c) {
        let existingLinks = this._getExistingLinks();
        $('#edit-panel').find(this.EXT_PROV_ELEM_QUERY).each((ix, childEl) => {
            let $childEl = $(childEl);
            let id = this._getIdFromElement($childEl);
            if (existingLinks[id] && existingLinks[id].count > 1 && existingLinks[id].isThisVenue) {
                setTimeout(() => {
                    $childEl.find('div.uuid').css({backgroundColor:'#FFA500'}).attr({'title':this.strings.linkedToXPlaces.replace('{0}', existingLinks[id].count)});
                }, 50);
            }
            this._addHoverEvent($(childEl));

            let link = this._linkCache[id];
            if (link) {
                if (link.closed) {
                    // A delay is needed to allow the UI to do its formatting so it doesn't overwrite ours.
                    setTimeout(() => {
                        $childEl.find('div.uuid').css({backgroundColor:'#FAA'}).attr('title',this.strings.closedPlace);
                    }, 50);
                } else if (link.notFound) {
                    setTimeout(() => {
                        $childEl.find('div.uuid').css({backgroundColor:'#F0F'}).attr('title',this.strings.badLink);
                    }, 50);
                } else {
                    let venue = this._getSelectedFeatures()[0].model;
                    if (this._isLinkTooFar(link, venue)) {
                        setTimeout(() => {
                            $childEl.find('div.uuid').css({backgroundColor:'#0FF'}).attr('title',this.strings.tooFar.replace('{0}',this.distanceLimit));
                        }, 50);
                    }
                }
            }
        });
    }

    _getExistingLinks() {
        let existingLinks = {};
        let thisVenue;
        if (this._getSelectedFeatures().length) {
            thisVenue = this._getSelectedFeatures()[0].model;
        }
        W.model.venues.getObjectArray().forEach(venue => {
            let isThisVenue = venue === thisVenue;
            let thisPlaceIDs = [];
            venue.attributes.externalProviderIDs.forEach(provID => {
                let id = provID.attributes.uuid;
                if (thisPlaceIDs.indexOf(id) === -1) {
                    thisPlaceIDs.push(id);
                    let link = existingLinks[id];
                    if (link) {
                        link.count++;
                    } else {
                        link = {count: 1};
                        existingLinks[id] = link;
                    }
                    link.isThisVenue = link.isThisVenue || isThisVenue;
                }
            });
        });
        return existingLinks;
    }

    _onAjaxSuccess(event, jqXHR, ajaxOptions, data) {
        let url = ajaxOptions.url;
        let that = event.data;

        if(/^\/maps\/api\/place\/autocomplete\/json?/i.test(url)) {
            // After an "autocomplete" api call...

            // Get a list of already-linked id's
            let existingLinks = that._getExistingLinks();

            // Examine the suggestions and format any that are already linked.
            $('#select2-drop ul li').each((idx, el) => {
                let $el = $(el);
                let linkData = $el.data('select2Data');
                if (linkData) {
                    let link = existingLinks[linkData.id];
                    if (link) {
                        let title, bgColor, textColor, fontWeight;
                        if (link.count > 1) {
                            title = that.strings.multiLinked;
                            textColor = '#000';
                            bgColor = '#FFA500';
                        } else {
                            bgColor = '#ddd';
                            if (link.isThisVenue) {
                                title = that.strings.linkedToThisPlace;
                                textColor = '#444';
                                fontWeight = 600;
                            } else {
                                title = that.strings.linkedNearby;
                                textColor = '#888';
                            }
                        }
                        if (bgColor) $el.css({backgroundColor: bgColor});
                        if (textColor) $el.css({color: textColor});
                        if (fontWeight) $el.css({fontWeight: fontWeight});
                        $el.attr('title',title);
                    }
                    $el.mouseover(function() {
                        that._addPoint(linkData.id);
                    }).mouseleave(() => that._destroyPoint()).bind('destroyed', () => that._destroyPoint()).mousedown(() => that._destroyPoint());
                }
            });
        } else if (/^\/maps\/api\/place\/details\/json?/i.test(url)) {
            //After a "details" api call...

            // Cache location results.  Note this isn't absolutely necessary because they're
            // cached when calling for them on mouseover.  However, WME calls this api for each link
            // when the place is first loaded, so might as well take advantage of it.

            let link = {};
            if (data.status === 'NOT_FOUND') {
                link.notFound = true;
            } else {
                link.loc = data.result.geometry.location;
                link.closed = data.result.permanently_closed;
            }
            var id = url.match(/placeid=(.*)&?/)[0];
            if (link.notFound) {
                console.debug('GLE (link not found for ' + id + '):', data);
            }
            that._cacheLink(id, link);
            that._formatLinkElements();
        }
    }

    // Remove the POI point from the map.
    _destroyPoint() {
        if (this._ptFeature) {
            this._ptFeature.destroy();
            this._ptFeature = null;
            this._lineFeature.destroy();
            this._lineFeature = null;
        }
    }

    // Add the POI point to the map.
    _addPoint(id) {
        if (!id) return;
        let link = this._linkCache[id];
        if (link) {
            if (!link.notFound) {
                let coord = link.loc;
                let poiPt = new OL.Geometry.Point(coord.lng, coord.lat);
                poiPt.transform(W.map.displayProjection, W.map.projection);
                let placeGeom = this._getSelectedFeatures()[0].geometry.getCentroid();
                let placePt = new OL.Geometry.Point(placeGeom.x, placeGeom.y);
                let ext = W.map.getExtent();
                var lsBounds = new OL.Geometry.LineString([new OL.Geometry.Point(ext.left, ext.bottom), new OL.Geometry.Point(ext.left, ext.top),
                                                         new OL.Geometry.Point(ext.right, ext.top),new OL.Geometry.Point(ext.right, ext.bottom),new OL.Geometry.Point(ext.left, ext.bottom)]);
                let lsLine = new OL.Geometry.LineString([placePt, poiPt]);

                // If the line extends outside the bounds, split it so we don't draw a line across the world.
                let splits = lsLine.splitWith(lsBounds);
                let label = '';
                if (splits) {
                    let splitPoints;
                    splits.forEach(split => {
                        split.components.forEach(component => {
                            if (component.x === placePt.x && component.y === placePt.y) splitPoints = split;
                        });
                    });
                    lsLine = new OL.Geometry.LineString([splitPoints.components[0], splitPoints.components[1]]);
                    let distance = poiPt.distanceTo(placePt);
                    let unitConversion, unit1, unit2;
                    if (W.model.isImperial) {
                        distance *= 3.28084;
                        unitConversion = 5280;
                        unit1 = ' ft';
                        unit2 = ' mi';
                    } else {
                        unitConversion = 1000;
                        unit1 = ' m';
                        unit2 = ' km';
                    }
                    if (distance > unitConversion * 10) {
                        label = Math.round(distance / unitConversion) + unit2;
                    } else if (distance > 1000) {
                        label = (Math.round(distance / (unitConversion / 10)) / 10) + unit2;
                    } else {
                        label = Math.round(distance) + unit1;
                    }
                }

                this._destroyPoint();  // Just in case it still exists.
                this._ptFeature = new OL.Feature.Vector(poiPt,{poiCoord:true},{
                    pointRadius: 6,
                    strokeWidth: 30,
                    strokeColor: '#FF0',
                    fillColor: '#FF0',
                    strokeOpacity: 0.5
                });
                this._lineFeature = new OL.Feature.Vector(lsLine, {}, {
                    strokeWidth: 3,
                    strokeDashstyle: '12 8',
                    strokeColor: '#FF0',
                    label: label,
                    labelYOffset: 45,
                    fontColor: '#FF0',
                    fontWeight: 'bold',
                    labelOutlineColor: "#000",
                    labelOutlineWidth: 4,
                    fontSize: '18'
                });
                W.map.getLayerByUniqueName('landmarks').addFeatures([this._ptFeature, this._lineFeature]);
                this._timeoutDestroyPoint();
            }
        } else {
            $.getJSON(this._urlOrigin + '/maps/api/place/details/json?&key=AIzaSyDf-q2MCay0AE7RF6oIMrDPrjBwxVtsUuI&placeid=' + id).then(json => {
                this._cacheLink(id, {loc:json.result.geometry.location,closed:json.result.permanently_closed});
                this._addPoint(id);
            });
        }
    }

    // Destroy the point after some time, if it hasn't been destroyed already.
    _timeoutDestroyPoint() {
        if (this._timeoutID) clearTimeout(this._timeoutID);
        this._timeoutID = setTimeout(() => this._destroyPoint(), 4000);
    }

    _getIdFromElement($el) {
        return $el.find('input.uuid').attr('value');
    }

    _addHoverEvent($el) {
        $el.hover(() => this._addPoint(this._getIdFromElement($el)) , () => this._destroyPoint());
    }

    _observeLinks() {
        this._linkObserver.observe($('#edit-panel')[0],{ childList: true, subtree: true });
    }

    _initLZString() {
        // LZ Compressor
        // Copyright (c) 2013 Pieroxy <pieroxy@pieroxy.net>
        // This work is free. You can redistribute it and/or modify it
        // under the terms of the WTFPL, Version 2
        // LZ-based compression algorithm, version 1.4.4
        this._LZString = (function() {
            // private property
            var f = String.fromCharCode;
            var keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
            var keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
            var baseReverseDic = {};

            function getBaseValue(alphabet, character) {
                if (!baseReverseDic[alphabet]) {
                    baseReverseDic[alphabet] = {};
                    for (var i = 0; i < alphabet.length; i++) {
                        baseReverseDic[alphabet][alphabet.charAt(i)] = i;
                    }
                }
                return baseReverseDic[alphabet][character];
            }
            var LZString = {
                compressToBase64: function(input) {
                    if (input === null) return "";
                    var res = LZString._compress(input, 6, function(a) {
                        return keyStrBase64.charAt(a);
                    });
                    switch (res.length % 4) { // To produce valid Base64
                        default: // When could this happen ?
                        case 0:
                            return res;
                        case 1:
                            return res + "===";
                        case 2:
                            return res + "==";
                        case 3:
                            return res + "=";
                    }
                },
                decompressFromBase64: function(input) {
                    if (input === null) return "";
                    if (input === "") return null;
                    return LZString._decompress(input.length, 32, function(index) {
                        return getBaseValue(keyStrBase64, input.charAt(index));
                    });
                },
                compressToUTF16: function(input) {
                    if (input === null) return "";
                    return LZString._compress(input, 15, function(a) {
                        return f(a + 32);
                    }) + " ";
                },
                decompressFromUTF16: function(compressed) {
                    if (compressed === null) return "";
                    if (compressed === "") return null;
                    return LZString._decompress(compressed.length, 16384, function(index) {
                        return compressed.charCodeAt(index) - 32;
                    });
                },

                compress: function(uncompressed) {
                    return LZString._compress(uncompressed, 16, function(a) {
                        return f(a);
                    });
                },
                _compress: function(uncompressed, bitsPerChar, getCharFromInt) {
                    if (uncompressed === null) return "";
                    var i, value,
                        context_dictionary = {},
                        context_dictionaryToCreate = {},
                        context_c = "",
                        context_wc = "",
                        context_w = "",
                        context_enlargeIn = 2, // Compensate for the first entry which should not count
                        context_dictSize = 3,
                        context_numBits = 2,
                        context_data = [],
                        context_data_val = 0,
                        context_data_position = 0,
                        ii;
                    for (ii = 0; ii < uncompressed.length; ii += 1) {
                        context_c = uncompressed.charAt(ii);
                        if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
                            context_dictionary[context_c] = context_dictSize++;
                            context_dictionaryToCreate[context_c] = true;
                        }
                        context_wc = context_w + context_c;
                        if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
                            context_w = context_wc;
                        } else {
                            if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                                if (context_w.charCodeAt(0) < 256) {
                                    for (i = 0; i < context_numBits; i++) {
                                        context_data_val = (context_data_val << 1);
                                        if (context_data_position === bitsPerChar - 1) {
                                            context_data_position = 0;
                                            context_data.push(getCharFromInt(context_data_val));
                                            context_data_val = 0;
                                        } else {
                                            context_data_position++;
                                        }
                                    }
                                    value = context_w.charCodeAt(0);
                                    for (i = 0; i < 8; i++) {
                                        context_data_val = (context_data_val << 1) | (value & 1);
                                        if (context_data_position === bitsPerChar - 1) {
                                            context_data_position = 0;
                                            context_data.push(getCharFromInt(context_data_val));
                                            context_data_val = 0;
                                        } else {
                                            context_data_position++;
                                        }
                                        value = value >> 1;
                                    }
                                } else {
                                    value = 1;
                                    for (i = 0; i < context_numBits; i++) {
                                        context_data_val = (context_data_val << 1) | value;
                                        if (context_data_position === bitsPerChar - 1) {
                                            context_data_position = 0;
                                            context_data.push(getCharFromInt(context_data_val));
                                            context_data_val = 0;
                                        } else {
                                            context_data_position++;
                                        }
                                        value = 0;
                                    }
                                    value = context_w.charCodeAt(0);
                                    for (i = 0; i < 16; i++) {
                                        context_data_val = (context_data_val << 1) | (value & 1);
                                        if (context_data_position === bitsPerChar - 1) {
                                            context_data_position = 0;
                                            context_data.push(getCharFromInt(context_data_val));
                                            context_data_val = 0;
                                        } else {
                                            context_data_position++;
                                        }
                                        value = value >> 1;
                                    }
                                }
                                context_enlargeIn--;
                                if (context_enlargeIn === 0) {
                                    context_enlargeIn = Math.pow(2, context_numBits);
                                    context_numBits++;
                                }
                                delete context_dictionaryToCreate[context_w];
                            } else {
                                value = context_dictionary[context_w];
                                for (i = 0; i < context_numBits; i++) {
                                    context_data_val = (context_data_val << 1) | (value & 1);
                                    if (context_data_position === bitsPerChar - 1) {
                                        context_data_position = 0;
                                        context_data.push(getCharFromInt(context_data_val));
                                        context_data_val = 0;
                                    } else {
                                        context_data_position++;
                                    }
                                    value = value >> 1;
                                }
                            }
                            context_enlargeIn--;
                            if (context_enlargeIn === 0) {
                                context_enlargeIn = Math.pow(2, context_numBits);
                                context_numBits++;
                            }
                            // Add wc to the dictionary.
                            context_dictionary[context_wc] = context_dictSize++;
                            context_w = String(context_c);
                        }
                    }
                    // Output the code for w.
                    if (context_w !== "") {
                        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                            if (context_w.charCodeAt(0) < 256) {
                                for (i = 0; i < context_numBits; i++) {
                                    context_data_val = (context_data_val << 1);
                                    if (context_data_position === bitsPerChar - 1) {
                                        context_data_position = 0;
                                        context_data.push(getCharFromInt(context_data_val));
                                        context_data_val = 0;
                                    } else {
                                        context_data_position++;
                                    }
                                }
                                value = context_w.charCodeAt(0);
                                for (i = 0; i < 8; i++) {
                                    context_data_val = (context_data_val << 1) | (value & 1);
                                    if (context_data_position === bitsPerChar - 1) {
                                        context_data_position = 0;
                                        context_data.push(getCharFromInt(context_data_val));
                                        context_data_val = 0;
                                    } else {
                                        context_data_position++;
                                    }
                                    value = value >> 1;
                                }
                            } else {
                                value = 1;
                                for (i = 0; i < context_numBits; i++) {
                                    context_data_val = (context_data_val << 1) | value;
                                    if (context_data_position === bitsPerChar - 1) {
                                        context_data_position = 0;
                                        context_data.push(getCharFromInt(context_data_val));
                                        context_data_val = 0;
                                    } else {
                                        context_data_position++;
                                    }
                                    value = 0;
                                }
                                value = context_w.charCodeAt(0);
                                for (i = 0; i < 16; i++) {
                                    context_data_val = (context_data_val << 1) | (value & 1);
                                    if (context_data_position === bitsPerChar - 1) {
                                        context_data_position = 0;
                                        context_data.push(getCharFromInt(context_data_val));
                                        context_data_val = 0;
                                    } else {
                                        context_data_position++;
                                    }
                                    value = value >> 1;
                                }
                            }
                            context_enlargeIn--;
                            if (context_enlargeIn === 0) {
                                context_enlargeIn = Math.pow(2, context_numBits);
                                context_numBits++;
                            }
                            delete context_dictionaryToCreate[context_w];
                        } else {
                            value = context_dictionary[context_w];
                            for (i = 0; i < context_numBits; i++) {
                                context_data_val = (context_data_val << 1) | (value & 1);
                                if (context_data_position === bitsPerChar - 1) {
                                    context_data_position = 0;
                                    context_data.push(getCharFromInt(context_data_val));
                                    context_data_val = 0;
                                } else {
                                    context_data_position++;
                                }
                                value = value >> 1;
                            }
                        }
                        context_enlargeIn--;
                        if (context_enlargeIn === 0) {
                            context_enlargeIn = Math.pow(2, context_numBits);
                            context_numBits++;
                        }
                    }
                    // Mark the end of the stream
                    value = 2;
                    for (i = 0; i < context_numBits; i++) {
                        context_data_val = (context_data_val << 1) | (value & 1);
                        if (context_data_position === bitsPerChar - 1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value = value >> 1;
                    }
                    // Flush the last char
                    while (true) {
                        context_data_val = (context_data_val << 1);
                        if (context_data_position === bitsPerChar - 1) {
                            context_data.push(getCharFromInt(context_data_val));
                            break;
                        } else context_data_position++;
                    }
                    return context_data.join('');
                },
                decompress: function(compressed) {
                    if (compressed === null) return "";
                    if (compressed === "") return null;
                    return LZString._decompress(compressed.length, 32768, function(index) {
                        return compressed.charCodeAt(index);
                    });
                },
                _decompress: function(length, resetValue, getNextValue) {
                    var dictionary = [],
                        next,
                        enlargeIn = 4,
                        dictSize = 4,
                        numBits = 3,
                        entry = "",
                        result = [],
                        i,
                        w,
                        bits, resb, maxpower, power,
                        c,
                        data = {
                            val: getNextValue(0),
                            position: resetValue,
                            index: 1
                        };
                    for (i = 0; i < 3; i += 1) {
                        dictionary[i] = i;
                    }
                    bits = 0;
                    maxpower = Math.pow(2, 2);
                    power = 1;
                    while (power !== maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position === 0) {
                            data.position = resetValue;
                            data.val = getNextValue(data.index++);
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                    }
                    switch (next = bits) {
                        case 0:
                            bits = 0;
                            maxpower = Math.pow(2, 8);
                            power = 1;
                            while (power !== maxpower) {
                                resb = data.val & data.position;
                                data.position >>= 1;
                                if (data.position === 0) {
                                    data.position = resetValue;
                                    data.val = getNextValue(data.index++);
                                }
                                bits |= (resb > 0 ? 1 : 0) * power;
                                power <<= 1;
                            }
                            c = f(bits);
                            break;
                        case 1:
                            bits = 0;
                            maxpower = Math.pow(2, 16);
                            power = 1;
                            while (power !== maxpower) {
                                resb = data.val & data.position;
                                data.position >>= 1;
                                if (data.position === 0) {
                                    data.position = resetValue;
                                    data.val = getNextValue(data.index++);
                                }
                                bits |= (resb > 0 ? 1 : 0) * power;
                                power <<= 1;
                            }
                            c = f(bits);
                            break;
                        case 2:
                            return "";
                    }
                    dictionary[3] = c;
                    w = c;
                    result.push(c);
                    while (true) {
                        if (data.index > length) {
                            return "";
                        }
                        bits = 0;
                        maxpower = Math.pow(2, numBits);
                        power = 1;
                        while (power !== maxpower) {
                            resb = data.val & data.position;
                            data.position >>= 1;
                            if (data.position === 0) {
                                data.position = resetValue;
                                data.val = getNextValue(data.index++);
                            }
                            bits |= (resb > 0 ? 1 : 0) * power;
                            power <<= 1;
                        }
                        switch (c = bits) {
                            case 0:
                                bits = 0;
                                maxpower = Math.pow(2, 8);
                                power = 1;
                                while (power !== maxpower) {
                                    resb = data.val & data.position;
                                    data.position >>= 1;
                                    if (data.position === 0) {
                                        data.position = resetValue;
                                        data.val = getNextValue(data.index++);
                                    }
                                    bits |= (resb > 0 ? 1 : 0) * power;
                                    power <<= 1;
                                }
                                dictionary[dictSize++] = f(bits);
                                c = dictSize - 1;
                                enlargeIn--;
                                break;
                            case 1:
                                bits = 0;
                                maxpower = Math.pow(2, 16);
                                power = 1;
                                while (power !== maxpower) {
                                    resb = data.val & data.position;
                                    data.position >>= 1;
                                    if (data.position === 0) {
                                        data.position = resetValue;
                                        data.val = getNextValue(data.index++);
                                    }
                                    bits |= (resb > 0 ? 1 : 0) * power;
                                    power <<= 1;
                                }
                                dictionary[dictSize++] = f(bits);
                                c = dictSize - 1;
                                enlargeIn--;
                                break;
                            case 2:
                                return result.join('');
                        }
                        if (enlargeIn === 0) {
                            enlargeIn = Math.pow(2, numBits);
                            numBits++;
                        }
                        if (dictionary[c]) {
                            entry = dictionary[c];
                        } else {
                            if (c === dictSize) {
                                entry = w + w.charAt(0);
                            } else {
                                return null;
                            }
                        }
                        result.push(entry);
                        // Add w+entry[0] to the dictionary.
                        dictionary[dictSize++] = w + entry.charAt(0);
                        enlargeIn--;
                        w = entry;
                        if (enlargeIn === 0) {
                            enlargeIn = Math.pow(2, numBits);
                            numBits++;
                        }
                    }
                }
            };
            return LZString;
        })();
    }
}
