// ==UserScript==
// @name         WME Utils - Bootstrap
// @namespace    WazeDev
// @version      2024.09.22.002
// @description  Adds a bootstrap function for easier startup of wmeSdk, WazeWrap, and ScriptUpdateMonitor.
// @author       MapOMatic, WazeDev group
// @include      /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @license      GNU GPLv3
// ==/UserScript==

/* global WazeWrap */
/* global getWmeSdk */

// Using var here to allow scripts to override with their own bootstrap, if needed,
// without having to remove the @require line for this code.

// eslint-disable-next-line no-unused-vars, func-names, no-var
var bootstrap = (function() {
    'use strict';

    let wmeSdk;

    function wmeReady(scriptName, scriptId) {
        wmeSdk = getWmeSdk({ scriptName, scriptId });
        return new Promise(resolve => {
            if (wmeSdk.State.isReady()) resolve();
            wmeSdk.Events.once('wme-ready').then(resolve);
        });
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

    function loadScriptUpdateMonitor(scriptName, scriptVersion, downloadUrl, metaUrl, metaRegExp) {
        let updateMonitor;
        try {
            if (!GM_xmlhttpRequest) {
                throw new Error('GM_xmlhttpRequest is required for WazeWrap.Alerts.ScriptUpdateMonitor');
            }
            updateMonitor = new WazeWrap.Alerts.ScriptUpdateMonitor(scriptName, scriptVersion, downloadUrl, GM_xmlhttpRequest, metaUrl, metaRegExp);
            updateMonitor.start();
        } catch (ex) {
            // Report, but don't stop if ScriptUpdateMonitor fails.
            console.error(`${scriptName}:`, ex);
        }
    }

    async function bootstrapFunc(args) {
        // SDK: Remove this when fixed
        if (!window.SDK_INITIALIZED) {
            window.SDK_INITIALIZED = new Promise(resolve => {
                document.body.addEventListener('sdk-initialized', () => resolve());
            });
        }
        // --------

        await window.SDK_INITIALIZED;
        await wmeReady(args.scriptName, args.scriptId);
        if (args.useWazeWrap) await wazeWrapReady(args);
        if (args.scriptUpdateMonitor) {
            loadScriptUpdateMonitor(
                args.scriptName,
                args.scriptUpdateMonitor.scriptVersion,
                args.scriptUpdateMonitor.downloadUrl,
                args.scriptUpdateMonitor.metaUrl,
                args.scriptUpdateMonitor.metaRegExp
            );
        }
        args.callback(wmeSdk);
    }

    return bootstrapFunc;
})();
