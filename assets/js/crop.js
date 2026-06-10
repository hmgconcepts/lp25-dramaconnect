/**
 * ============================================================================
 * Crop.js — lightweight, dependency-free square image cropper.
 * Opens a modal where the user can drag to pan and use a slider to zoom, then
 * outputs a square JPEG Blob (default 512x512) — perfect for avatars.
 * 100% client-side (canvas). No external library, no API.
 *
 * Usage:
 *   Crop.open(file).then(blob => { ...upload blob... }).catch(() => {}) // cancelled
 * ============================================================================
 */
const Crop = {
    open(file, outSize = 512) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => start(img, url);
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image.')); };
            img.src = url;

            function start(image) {
                const VIEW = 280; // px square viewport
                let scale = 1, minScale = 1, ox = 0, oy = 0; // pan offsets
                // fit image to cover the viewport
                const base = Math.max(VIEW / image.width, VIEW / image.height);
                minScale = base; scale = base;
                ox = (VIEW - image.width * scale) / 2;
                oy = (VIEW - image.height * scale) / 2;

                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;';
                overlay.innerHTML = `
                    <div style="background:#fff;border-radius:18px;max-width:340px;width:100%;padding:18px;text-align:center;">
                        <h3 style="font-weight:800;color:#1e293b;margin:0 0 12px;">Adjust your photo</h3>
                        <div style="position:relative;width:${VIEW}px;height:${VIEW}px;margin:0 auto;border-radius:9999px;overflow:hidden;touch-action:none;background:#eef;cursor:grab;" id="crop-stage">
                            <canvas id="crop-canvas" width="${VIEW}" height="${VIEW}"></canvas>
                            <div style="position:absolute;inset:0;box-shadow:0 0 0 9999px rgba(0,0,0,.04);border-radius:9999px;pointer-events:none;border:2px solid #fff;"></div>
                        </div>
                        <input id="crop-zoom" type="range" min="1" max="4" step="0.01" value="1" style="width:100%;margin:14px 0;">
                        <div style="display:flex;gap:10px;justify-content:center;">
                            <button id="crop-cancel" style="padding:9px 16px;border:none;border-radius:10px;background:#f1f5f9;color:#334155;font-weight:700;cursor:pointer;">Cancel</button>
                            <button id="crop-ok" style="padding:9px 16px;border:none;border-radius:10px;background:#003399;color:#fff;font-weight:700;cursor:pointer;">Use Photo</button>
                        </div>
                        <p style="font-size:11px;color:#94a3b8;margin-top:8px;">Drag to reposition • slider to zoom</p>
                    </div>`;
                document.body.appendChild(overlay);

                const canvas = overlay.querySelector('#crop-canvas');
                const ctx = canvas.getContext('2d');
                const zoom = overlay.querySelector('#crop-zoom');

                function clamp() {
                    const w = image.width * scale, h = image.height * scale;
                    ox = Math.min(0, Math.max(VIEW - w, ox));
                    oy = Math.min(0, Math.max(VIEW - h, oy));
                }
                function draw() {
                    clamp();
                    ctx.clearRect(0, 0, VIEW, VIEW);
                    ctx.drawImage(image, ox, oy, image.width * scale, image.height * scale);
                }
                draw();

                zoom.oninput = () => {
                    const newScale = minScale * parseFloat(zoom.value);
                    // zoom around center
                    const cx = VIEW / 2, cy = VIEW / 2;
                    ox = cx - (cx - ox) * (newScale / scale);
                    oy = cy - (cy - oy) * (newScale / scale);
                    scale = newScale; draw();
                };

                let dragging = false, lx = 0, ly = 0;
                const stage = overlay.querySelector('#crop-stage');
                const down = e => { dragging = true; const p = pt(e); lx = p.x; ly = p.y; stage.style.cursor = 'grabbing'; };
                const move = e => { if (!dragging) return; const p = pt(e); ox += p.x - lx; oy += p.y - ly; lx = p.x; ly = p.y; draw(); e.preventDefault(); };
                const up = () => { dragging = false; stage.style.cursor = 'grab'; };
                function pt(e) { const t = e.touches ? e.touches[0] : e; return { x: t.clientX, y: t.clientY }; }
                stage.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                stage.addEventListener('touchstart', down, { passive: false }); stage.addEventListener('touchmove', move, { passive: false }); stage.addEventListener('touchend', up);

                function cleanup() {
                    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
                    overlay.remove(); URL.revokeObjectURL(url);
                }
                overlay.querySelector('#crop-cancel').onclick = () => { cleanup(); reject(new Error('cancelled')); };
                overlay.querySelector('#crop-ok').onclick = () => {
                    const out = document.createElement('canvas');
                    out.width = outSize; out.height = outSize;
                    const r = outSize / VIEW;
                    out.getContext('2d').drawImage(image, ox * r, oy * r, image.width * scale * r, image.height * scale * r);
                    out.toBlob(b => {
                        cleanup();
                        if (b) { b.name = 'avatar.jpg'; resolve(b); } else reject(new Error('Crop failed.'));
                    }, 'image/jpeg', 0.9);
                };
            }
        });
    }
};
window.Crop = Crop;
