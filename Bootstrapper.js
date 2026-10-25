// ==UserScript==
// @name         WME Utils - Bootstrap
// @namespace    WazeDev
// @version      2026.10.23.000
// @description  Adds a bootstrap function for easier startup of wmeSdk, WazeWrap, and ScriptUpdateMonitor.
// @author       MapOMatic, WazeDev group
// @include      /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @license      GNU GPLv3
// ==/UserScript==

/* global WazeWrap */
/* global getWmeSdk */
/* global SDK_INITIALIZED */

// Using var here to allow scripts to override with their own bootstrap, if needed,
// without having to remove the @require line for this code.

// eslint-disable-next-line no-unused-vars, func-names, no-var
var bootstrap = (function() {
    'use strict';

    let wmeSdk;

    async function wmeReady(scriptName, scriptId, mode) {
        wmeSdk = getWmeSdk({ scriptName, scriptId, mode });
        // Register the listener before checking state so a wme-ready fired in between isn't missed.
        const readyEvent = wmeSdk.Events.once({ eventName: 'wme-ready' });
        if (await wmeSdk.State.isReady()) return;
        await readyEvent;
    }

    function wazeWrapReady(scriptName) {
        return new Promise(resolve => {
            (function checkWazeWrapReady(tries = 0) {
                if (WazeWrap.Ready) {
                    resolve();
                } else if (tries < 1000) {
                    setTimeout(checkWazeWrapReady, 200, ++tries);
                } else {
                    console.error(`${scriptName}: WazeWrap took too long to load.`);
                }
            })();
        });
    }

    function loadScriptUpdateMonitor(args) {
        let updateMonitor;
        try {
            if (typeof GM_xmlhttpRequest === 'undefined') {
                throw new Error('GM_xmlhttpRequest is required to use WazeWrap.Alerts.ScriptUpdateMonitor');
            }
            updateMonitor = new WazeWrap.Alerts.ScriptUpdateMonitor(
                args.scriptName,
                args.scriptUpdateMonitor.scriptVersion,
                args.scriptUpdateMonitor.downloadUrl,
                GM_xmlhttpRequest,
                args.scriptUpdateMonitor.metaUrl,
                args.scriptUpdateMonitor.metaRegExp
            );
            updateMonitor.start();
        } catch (ex) {
            // Report, but don't stop if ScriptUpdateMonitor fails.
            console.error(`${args.scriptName}:`, ex);
        }
    }

    /**
     * Waits for WME (and optionally WazeWrap) to be ready, then resolves with the SDK instance.
     *
     * @param {Object} [args]
     * @param {string} [args.scriptName] - Display name. Defaults to the userscript name.
     * @param {string} [args.scriptId] - Unique ID. Defaults to the userscript name with spaces removed.
     * @param {'async'} [args.mode] - SDK mode. Use `'async'` so SDK methods return Promises. Omit for legacy sync mode, which logs a deprecation warning.
     * @param {boolean} [args.useWazeWrap=false] - Wait for WazeWrap to be ready.
     * @param {{downloadUrl: string, scriptVersion?: string, metaUrl?: string, metaRegExp?: RegExp}} [args.scriptUpdateMonitor] - Starts a WazeWrap ScriptUpdateMonitor. Implies waiting for WazeWrap.
     * @param {(wmeSdk: Object) => void} [args.callback] - Called with the SDK instance before the promise resolves.
     * @returns {Promise<Object>} The initialized WME SDK instance.
     */
    async function bootstrapFunc(args) {
        args = { ...args };
        args.scriptName ??= GM_info.script.name;
        args.scriptId ??= GM_info.script.name.replaceAll(' ', '');
        await SDK_INITIALIZED;
        await wmeReady(args.scriptName, args.scriptId, args.mode);
        if (args.useWazeWrap || args.scriptUpdateMonitor) await wazeWrapReady(args);
        if (args.scriptUpdateMonitor) {
            args.scriptUpdateMonitor.scriptVersion ??= GM_info.script.version;
            loadScriptUpdateMonitor(args);
        }
        args.callback?.(wmeSdk);
        return wmeSdk;
    }

    return bootstrapFunc;
})();
