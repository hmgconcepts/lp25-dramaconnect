/**
 * ============================================================================
 * DramaConnect — codes.js  (window.DCCodes)
 * ============================================================================
 * ONE owner for everything "machine readable" on the platform:
 *
 *   • QR codes   — SVG from the vendored, pinned qrcode-generator 2.0.4
 *                  (assets/js/vendor/qrcode-generator.js). No external QR API,
 *                  no CDN: cards print and verify offline.
 *   • Code 128   — a real, standards-conformant Code 128 (set B) barcode with
 *                  the mod-103 check symbol and the mandatory quiet zones.
 *                  The previous card had no barcode that any scanner could read;
 *                  this one is decoded by phone cameras, USB/Bluetooth
 *                  "keyboard" scanners and ZXing (proved in tools/test-codes.mjs).
 *   • Scanning   — camera scanner that uses the native BarcodeDetector when the
 *                  browser has it (Chrome/Edge/Android) and otherwise falls back
 *                  to the vendored jsQR 1.4.0 for QR plus the built-in Code 128
 *                  scan-line decoder below. iPhone Safari therefore scans both
 *                  symbologies too. Hardware scanners that type + Enter work in
 *                  every input wired with DCCodes.wireWedge().
 *
 * Nothing here talks to the database: pages pass the decoded text to the RPCs
 * (dc_lookup_card, dc_program_checkin, dc_verify_card) which accept every
 * format — full verification URL, bare token, member number or legacy code.
 * ============================================================================
 */
(function (global) {
    'use strict';

    // Resolve sibling asset URLs from this script's own location so the module
    // works from /pages/*.html, from the root and from sub-path deployments.
    const SELF_SRC = (function () {
        try {
            if (document.currentScript && document.currentScript.src) return document.currentScript.src;
            const tags = document.getElementsByTagName('script');
            for (let i = tags.length - 1; i >= 0; i -= 1) {
                if (/\/dc-codes\.js(\?|$)/.test(tags[i].src)) return tags[i].src;
            }
        } catch (_) { /* non-browser */ }
        return (global.location && global.location.href) || 'http://localhost/assets/js/dc-codes.js';
    })();
    function assetUrl(relative) { return new URL(relative, SELF_SRC).href; }

    /** Public verification URL printed inside every card QR. */
    function verifyUrl(token) {
        return assetUrl('../../pages/verify.html') + '?c=' + encodeURIComponent(String(token || ''));
    }
    /** Public registration / ticket links for programmes. */
    function registerUrl(slug, source) {
        let url = assetUrl('../../pages/register.html') + '?p=' + encodeURIComponent(String(slug || ''));
        if (source) url += '&src=' + encodeURIComponent(String(source).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24));
        return url;
    }
    function ticketUrl(token) {
        return assetUrl('../../pages/register.html') + '?t=' + encodeURIComponent(String(token || ''));
    }

    function escapeXml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function safeColor(value, fallback) {
        return /^#[0-9a-fA-F]{3,8}$/.test(String(value || '')) ? value : fallback;
    }

    // ------------------------------------------------------------------ QR --
    function qrLib() {
        return global.qrcode || (typeof qrcode !== 'undefined' ? qrcode : null); // eslint-disable-line no-undef
    }
    /** Returns the boolean module matrix (true = dark) for text. */
    function qrMatrix(text, ecl) {
        const lib = qrLib();
        if (!lib) throw new Error('QR library not loaded');
        const qr = lib(0, ecl || 'M');
        qr.addData(String(text), 'Byte');
        qr.make();
        const n = qr.getModuleCount();
        const rows = [];
        for (let r = 0; r < n; r += 1) {
            const row = [];
            for (let c = 0; c < n; c += 1) row.push(qr.isDark(r, c));
            rows.push(row);
        }
        return rows;
    }
    /**
     * QR as an inline SVG string. Includes the 4-module quiet zone that the
     * old card omitted (a major reason phone cameras failed to read it).
     */
    function qrSvg(text, options) {
        const o = options || {};
        const matrix = qrMatrix(text, o.ecl || 'M');
        const n = matrix.length;
        const margin = o.margin == null ? 4 : o.margin;
        const total = n + margin * 2;
        const size = o.size || 160;
        let path = '';
        for (let r = 0; r < n; r += 1) {
            for (let c = 0; c < n; c += 1) {
                if (matrix[r][c]) path += 'M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z';
            }
        }
        const dark = safeColor(o.dark, '#0f172a');
        const light = safeColor(o.light, '#ffffff');
        return '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + escapeXml(o.label || 'QR code') + '"' +
            ' width="' + size + '" height="' + size + '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
            '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
            '<path d="' + path + '" fill="' + dark + '"/></svg>';
    }

    // ------------------------------------------------------------ Code 128 --
    // Bar/space module widths for symbol values 0..105 and STOP (106).
    const C128 = [
        '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
        '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
        '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
        '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
        '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
        '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
        '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
        '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
        '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
        '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
        '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
    ];
    const START_B = 104;
    const STOP = 106;

    /** Symbol values (start, data, checksum, stop) for printable ASCII text. */
    function code128Values(text) {
        const s = String(text == null ? '' : text);
        if (!s.length) throw new Error('Nothing to encode');
        const values = [START_B];
        for (let i = 0; i < s.length; i += 1) {
            const code = s.charCodeAt(i);
            if (code < 32 || code > 126) throw new Error('Code 128-B supports printable ASCII only');
            values.push(code - 32);
        }
        let sum = values[0];
        for (let i = 1; i < values.length; i += 1) sum += values[i] * i;
        values.push(sum % 103);
        values.push(STOP);
        return values;
    }
    /** Module string ('1' bar, '0' space) including 10-module quiet zones. */
    function code128Modules(text, quiet) {
        const q = quiet == null ? 10 : quiet;
        let bits = '0'.repeat(q);
        code128Values(text).forEach(function (value) {
            const widths = C128[value];
            for (let i = 0; i < widths.length; i += 1) bits += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]));
        });
        return bits + '0'.repeat(q);
    }
    function code128Svg(text, options) {
        const o = options || {};
        const bits = code128Modules(text, o.quiet);
        const module = o.module || 2;
        const barHeight = o.height || 48;
        const showText = o.showText !== false;
        const textHeight = showText ? 14 : 0;
        const width = bits.length * module;
        let rects = '';
        for (let i = 0; i < bits.length;) {
            if (bits[i] === '1') {
                let j = i;
                while (j < bits.length && bits[j] === '1') j += 1;
                rects += '<rect x="' + (i * module) + '" y="0" width="' + ((j - i) * module) + '" height="' + barHeight + '"/>';
                i = j;
            } else i += 1;
        }
        const dark = safeColor(o.dark, '#0f172a');
        const light = safeColor(o.light, '#ffffff');
        return '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Barcode ' + escapeXml(text) + '"' +
            ' width="' + width + '" height="' + (barHeight + textHeight) + '" viewBox="0 0 ' + width + ' ' + (barHeight + textHeight) + '"' +
            ' shape-rendering="crispEdges" preserveAspectRatio="none">' +
            '<rect width="100%" height="100%" fill="' + light + '"/><g fill="' + dark + '">' + rects + '</g>' +
            (showText ? '<text x="' + (width / 2) + '" y="' + (barHeight + 12) + '" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="12" letter-spacing="2" fill="' + dark + '">' + escapeXml(text) + '</text>' : '') +
            '</svg>';
    }

    /**
     * Decode Code 128 from one row of luminance values (0..255). Returns the
     * text or null. Works on either scan direction; tolerant to blur and
     * uneven lighting (local-mean threshold) and to up to ±40% width error per
     * element (nearest-pattern matching as ZXing does).
     */
    const C128_NORM = C128.map(function (p) { return p.split('').map(Number); });
    function matchSymbol(runs, offset, count) {
        let total = 0;
        for (let i = 0; i < count; i += 1) total += runs[offset + i];
        if (!total) return { value: -1, err: Infinity };
        const unit = total / (count === 7 ? 13 : 11);
        let best = -1;
        let bestErr = Infinity;
        const limit = count === 7 ? STOP + 1 : STOP;
        const from = count === 7 ? STOP : 0;
        for (let v = from; v < limit; v += 1) {
            const pattern = C128_NORM[v];
            let err = 0;
            for (let i = 0; i < count; i += 1) err += Math.abs(runs[offset + i] / unit - pattern[i]);
            if (err < bestErr) { bestErr = err; best = v; }
        }
        return { value: best, err: bestErr, unit: unit };
    }
    function decodeRuns(runs) {
        // runs[0] is a bar. Look for a start symbol at every bar position.
        for (let s = 0; s + 6 < runs.length; s += 2) {
            const start = matchSymbol(runs, s, 6);
            if (start.value < 103 || start.value > 105 || start.err > 1.6) continue;
            // Quiet zone before the start symbol must be wide (≥ 5 modules) unless at the edge.
            if (s > 0 && runs[s - 1] < start.unit * 5) continue;
            const values = [start.value];
            let pos = s + 6;
            let ok = false;
            while (pos + 6 <= runs.length) {
                const stop = pos + 7 <= runs.length ? matchSymbol(runs, pos, 7) : { value: -1, err: Infinity };
                const sym = matchSymbol(runs, pos, 6);
                // A STOP must be followed by a quiet zone (or the edge of the
                // frame) and must fit better than any data symbol; otherwise a
                // data symbol + the next bar can masquerade as STOP.
                const trailing = runs[pos + 7];
                const quietAfter = trailing === undefined || trailing >= stop.unit * 4;
                if (stop.value === STOP && stop.err < 2.2 && quietAfter && (stop.err <= sym.err || sym.err > 1.2)) { ok = true; break; }
                if (sym.value < 0 || sym.value > 102 || sym.err > 1.8) break;
                values.push(sym.value);
                pos += 6;
                if (values.length > 80) break;
            }
            if (!ok || values.length < 3) continue;
            const check = values.pop();
            let sum = values[0];
            for (let i = 1; i < values.length; i += 1) sum += values[i] * i;
            if (sum % 103 !== check) continue;
            let set = values[0] === 103 ? 'A' : values[0] === 104 ? 'B' : 'C';
            let out = '';
            for (let i = 1; i < values.length; i += 1) {
                const v = values[i];
                if (set === 'C') {
                    if (v < 100) { out += (v < 10 ? '0' : '') + v; continue; }
                    if (v === 100) { set = 'B'; continue; }
                    if (v === 101) { set = 'A'; continue; }
                    continue;
                }
                if (v === 99) { set = 'C'; continue; }
                if (set === 'B' && v === 101) { set = 'A'; continue; }
                if (set === 'A' && v === 100) { set = 'B'; continue; }
                if (v >= 96) continue; // FNC / shift — not used by DramaConnect codes
                if (set === 'B') out += String.fromCharCode(v + 32);
                else out += String.fromCharCode(v < 64 ? v + 32 : v - 64);
            }
            if (out) return out;
        }
        return null;
    }
    function decodeCode128Row(lum) {
        const n = lum.length;
        if (n < 40) return null;
        // Local-mean threshold (window ≈ 1/8 of the row) handles gradients.
        const win = Math.max(8, Math.floor(n / 8));
        const prefix = new Float64Array(n + 1);
        for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i] + lum[i];
        let min = 255, max = 0;
        for (let i = 0; i < n; i += 1) { if (lum[i] < min) min = lum[i]; if (lum[i] > max) max = lum[i]; }
        if (max - min < 40) return null;
        const bits = new Uint8Array(n);
        for (let i = 0; i < n; i += 1) {
            const a = Math.max(0, i - win), b = Math.min(n, i + win);
            const mean = (prefix[b] - prefix[a]) / (b - a);
            const t = Math.min(mean, (min + max) / 2 + (max - min) * 0.15);
            bits[i] = lum[i] < t ? 1 : 0;
        }
        const tryDirection = function (arr) {
            const runs = [];
            let i = 0;
            while (i < arr.length && arr[i] === 0) i += 1;
            while (i < arr.length) {
                const color = arr[i];
                let j = i;
                while (j < arr.length && arr[j] === color) j += 1;
                runs.push(j - i);
                i = j;
            }
            // Re-insert leading quiet zone as a large space so the check passes.
            return decodeRuns(runs);
        };
        return tryDirection(bits) || tryDirection(Array.prototype.slice.call(bits).reverse());
    }
    /** Scan several rows of an ImageData-like object for Code 128. */
    function decodeCode128Image(image) {
        const w = image.width, h = image.height, d = image.data;
        const rows = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.2, 0.8];
        const lum = new Float64Array(w);
        for (let k = 0; k < rows.length; k += 1) {
            const y = Math.min(h - 1, Math.max(0, Math.round(h * rows[k])));
            for (let x = 0; x < w; x += 1) {
                // Average 3 rows to suppress sensor noise.
                let sum = 0, cnt = 0;
                for (let dy = -1; dy <= 1; dy += 1) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= h) continue;
                    const o = (yy * w + x) * 4;
                    sum += 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
                    cnt += 1;
                }
                lum[x] = sum / cnt;
            }
            const text = decodeCode128Row(lum);
            if (text) return text;
        }
        return null;
    }

    // ------------------------------------------------------------ scanning --
    const scriptPromises = {};
    function loadScript(src) {
        if (scriptPromises[src]) return scriptPromises[src];
        scriptPromises[src] = new Promise(function (resolve, reject) {
            const el = document.createElement('script');
            el.src = src;
            el.async = true;
            el.onload = function () { resolve(); };
            el.onerror = function () { delete scriptPromises[src]; reject(new Error('Could not load ' + src)); };
            document.head.appendChild(el);
        });
        return scriptPromises[src];
    }
    function ensureQrLib() {
        return qrLib() ? Promise.resolve() : loadScript(assetUrl('vendor/qrcode-generator.js'));
    }
    function ensureJsQR() {
        return global.jsQR ? Promise.resolve() : loadScript(assetUrl('vendor/jsqr.js'));
    }
    async function nativeDetector() {
        if (!('BarcodeDetector' in global)) return null;
        try {
            const supported = await global.BarcodeDetector.getSupportedFormats();
            const wanted = ['qr_code', 'code_128'].filter(function (f) { return supported.indexOf(f) !== -1; });
            if (!wanted.length) return null;
            return { detector: new global.BarcodeDetector({ formats: wanted }), formats: wanted };
        } catch (_) { return null; }
    }
    function cameraSupported() {
        return !!(global.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }
    function cameraErrorMessage(error) {
        const name = error && error.name;
        if (!global.isSecureContext) return 'The camera needs a secure (https) connection.';
        if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was refused. Allow camera access in the browser settings, or type the code instead.';
        if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Type the code or use a USB scanner.';
        if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
        return 'The camera could not start (' + (error && error.message ? error.message : 'unknown error') + ').';
    }

    /**
     * createScanner({ video, onResult(text, format), onStatus(msg), cooldownMs })
     * → { start(), stop(), running, engine, toggleTorch() }
     * Same code within cooldownMs is ignored, so holding a card in front of
     * the camera never double-counts.
     */
    function createScanner(options) {
        const o = options || {};
        const video = o.video;
        const cooldown = o.cooldownMs || 2500;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let stream = null, timer = null, native = null, busy = false, lastText = '', lastAt = 0, frame = 0;
        const api = { running: false, engine: 'none' };
        function emit(text, format) {
            const clean = String(text || '').trim();
            if (!clean) return;
            const now = Date.now();
            if (clean === lastText && now - lastAt < cooldown) return;
            lastText = clean; lastAt = now;
            if (global.navigator && navigator.vibrate) { try { navigator.vibrate(60); } catch (_) { /* ignore */ } }
            try { o.onResult && o.onResult(clean, format); } catch (e) { console.error(e); }
        }
        async function tick() {
            if (!api.running || busy || !video || video.readyState < 2) return;
            busy = true;
            try {
                frame += 1;
                if (native) {
                    const found = await native.detector.detect(video);
                    if (found && found.length) emit(found[0].rawValue, found[0].format);
                } else {
                    const vw = video.videoWidth, vh = video.videoHeight;
                    if (vw && vh) {
                        const scale = Math.min(1, 900 / Math.max(vw, vh));
                        canvas.width = Math.round(vw * scale);
                        canvas.height = Math.round(vh * scale);
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        let text = null, format = null;
                        if (global.jsQR) {
                            const qr = global.jsQR(image.data, image.width, image.height, { inversionAttempts: frame % 4 === 0 ? 'attemptBoth' : 'dontInvert' });
                            if (qr && qr.data) { text = qr.data; format = 'qr_code'; }
                        }
                        if (!text) {
                            text = decodeCode128Image(image);
                            if (text) format = 'code_128';
                        }
                        if (text) emit(text, format);
                    }
                }
            } catch (error) {
                if (o.onStatus) o.onStatus('Scanning… (' + (error.message || 'retrying') + ')');
            } finally { busy = false; }
        }
        api.start = async function () {
            if (api.running) return;
            if (!cameraSupported()) throw new Error(cameraErrorMessage({ name: 'NotFoundError' }));
            native = await nativeDetector();
            if (!native) await ensureJsQR().catch(function () { /* Code 128 still works without jsQR */ });
            api.engine = native ? 'native (' + native.formats.join(', ') + ')' : 'built-in (' + (global.jsQR ? 'QR + ' : '') + 'Code 128)';
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
                });
            } catch (error) { throw new Error(cameraErrorMessage(error)); }
            video.setAttribute('playsinline', '');
            video.muted = true;
            video.srcObject = stream;
            await video.play().catch(function () { /* autoplay policies: stream still renders */ });
            api.running = true;
            timer = setInterval(tick, native ? 180 : 140);
            if (o.onStatus) o.onStatus('Camera ready — point it at a QR code or barcode.');
        };
        api.stop = function () {
            api.running = false;
            if (timer) clearInterval(timer);
            timer = null;
            if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
            stream = null;
            if (video) video.srcObject = null;
        };
        api.toggleTorch = async function () {
            const track = stream && stream.getVideoTracks()[0];
            if (!track || !track.getCapabilities || !track.getCapabilities().torch) return false;
            api.torch = !api.torch;
            await track.applyConstraints({ advanced: [{ torch: api.torch }] });
            return true;
        };
        api.resetCooldown = function () { lastText = ''; lastAt = 0; };
        return api;
    }

    /**
     * USB / Bluetooth barcode scanners behave like keyboards: they type the
     * code very quickly and press Enter. wireWedge(input, onCode) submits on
     * Enter and also recognises a burst of keystrokes anywhere on the page
     * (when no other field has focus) so the desk never has to click first.
     */
    function wireWedge(input, onCode) {
        if (!input) return function () {};
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                const value = input.value.trim();
                if (value) { input.value = ''; onCode(value, 'keyboard'); }
            }
        });
        let buffer = '', last = 0;
        function onKey(event) {
            const target = event.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
            const now = Date.now();
            if (now - last > 60) buffer = '';
            last = now;
            if (event.key === 'Enter') {
                if (buffer.length >= 6) { onCode(buffer, 'keyboard'); event.preventDefault(); }
                buffer = '';
            } else if (event.key && event.key.length === 1) buffer += event.key;
        }
        document.addEventListener('keydown', onKey);
        return function () { document.removeEventListener('keydown', onKey); };
    }

    global.DCCodes = {
        version: '14.1',
        assetUrl: assetUrl,
        verifyUrl: verifyUrl,
        registerUrl: registerUrl,
        ticketUrl: ticketUrl,
        ensureQrLib: ensureQrLib,
        ensureJsQR: ensureJsQR,
        qrMatrix: qrMatrix,
        qrSvg: qrSvg,
        code128Values: code128Values,
        code128Modules: code128Modules,
        code128Svg: code128Svg,
        decodeCode128Row: decodeCode128Row,
        decodeCode128Image: decodeCode128Image,
        cameraSupported: cameraSupported,
        createScanner: createScanner,
        wireWedge: wireWedge,
        _patterns: C128
    };
})(typeof window !== 'undefined' ? window : globalThis);
