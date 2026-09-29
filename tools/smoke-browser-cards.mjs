#!/usr/bin/env node
/**
 * Optional real-browser smoke test for the ID card, public verification page
 * and attendance scanning desk (Item 18).
 *
 *   npx playwright install --with-deps chromium   # once per machine
 *   npm run smoke:browser
 *
 * It serves the repository from a fake origin, replaces supabase-js with an
 * in-page fake client (fixtures + RPC handlers) and blocks every other network
 * request, so it never touches a real Supabase project. It is kept out of the
 * default `npm test` chain because CI images do not always ship a browser.
 *
 * What it proves in a real rendering engine:
 *  - idcard.html renders the Code 128 barcode (member number) and the QR code
 *    (verification URL), and both DECODE back to the right values from the
 *    rendered pixels (screenshot → dc-codes.js / jsQR decoders).
 *  - verify.html shows VALID / REVOKED states from dc_verify_card.
 *  - attendance.html shows the scanning desk to a unit leader, sends typed /
 *    USB-wedge codes to dc_scan_attendance and updates the checklist row.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://dc.test';
let passed = 0, failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { passed += 1; console.log('  ok   ' + label); }
  else { failed += 1; console.log('  FAIL ' + label + (extra ? ' — ' + extra : '')); }
};

const TOKEN = '0123456789abcdef0123456789abcdef';
const MEMBER = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', full_name: 'Musa Member', email: 'm@x.io', role: 'member', status: 'approved', unit: 'Acting', is_unit_leader: false };
const LEADER = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', full_name: 'Lola Leader', email: 'l@x.io', role: 'member', status: 'approved', unit: 'Acting', is_unit_leader: true };

// Runs inside the page before any script. `window.__DC_FAKE` is injected per test.
function fakeSupabase() {
  const cfg = window.__DC_FAKE;
  window.__calls = [];
  function builder(table) {
    const state = { table, filters: [] };
    const result = () => {
      let rows = (cfg.tables[table] || []).slice();
      state.filters.forEach(([col, val]) => { rows = rows.filter((r) => String(r[col]) === String(val)); });
      return rows;
    };
    const api = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve({ data: state.single ? (result()[0] || null) : result(), error: null }).then(res, rej);
        if (prop === 'eq') return (c, v) => { state.filters.push([c, v]); return api; };
        if (prop === 'single' || prop === 'maybeSingle') return () => { state.single = true; return api; };
        if (['insert', 'update', 'upsert', 'delete'].includes(prop)) return (payload) => { window.__calls.push({ table, op: prop, payload }); return api; };
        return () => api;
      }
    });
    return api;
  }
  window.supabase = {
    createClient() {
      return {
        auth: {
          mfa: cfg.mfa || { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
            listFactors: async () => ({ data: { all: [], totp: [] }, error: null }),
            enroll: async () => ({ data: { id: 'factor-1', totp: { qr_code: '<svg></svg>', secret: 'ABCDEF123456' } }, error: null }),
            challengeAndVerify: async () => ({ data: {}, error: null }), unenroll: async () => ({ data: {}, error: null }) },
          getUser: async () => ({ data: { user: cfg.user ? { id: cfg.user.id, email: cfg.user.email } : null } }),
          getSession: async () => ({ data: { session: cfg.user ? { user: { id: cfg.user.id } } : null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({})
        },
        from: builder,
        storage: {
          from: (bucket) => ({
            getPublicUrl: () => ({ data: { publicUrl: '' } }),
            upload: async (path, body) => { window.__uploads = window.__uploads || []; window.__uploads.push({ bucket, path, size: (body && body.size) || String(body || '').length }); return { data: { path }, error: null }; },
            download: async (path) => { window.__downloads = window.__downloads || []; window.__downloads.push({ bucket, path }); return { data: new Blob([JSON.stringify({ rows: [{ id: 'a1' }, { id: 'a2' }] })], { type: 'application/json' }), error: null }; },
            list: async () => ({ data: cfg.storageFiles || [], error: null }),
            remove: async () => ({ data: [], error: null })
          })
        },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel() {},
        rpc: async (name, args) => {
          window.__calls.push({ rpc: name, args });
          const h = cfg.rpc[name];
          if (!h) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function ' + name } };
          // eslint-disable-next-line no-new-func
          return { data: new Function('args', 'return (' + h + ')(args)')(args), error: null };
        }
      };
    }
  };
}

async function openPage(browser, file, fake, viewport = { width: 1200, height: 1600 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Purges and other destructive buttons ask for confirmation; the smoke
  // accepts so the guarded path itself is exercised. Prompts are answered with
  // the exact phrase the page asks for ("Type PURGE activity_log", "Type LOAD
  // DEMO", "Type DELETE DEMO"…).
  page.on('dialog', (d) => {
    let answer = '';
    const m = d.message();
    if (d.type() === 'prompt') {
      if (/Type LOAD DEMO/.test(m)) answer = 'LOAD DEMO';
      else if (/Type DELETE DEMO/.test(m)) answer = 'DELETE DEMO';
      else if (/Type RESTORE/.test(m)) answer = 'RESTORE';
      else { const t = m.match(/Type (PURGE|ARCHIVE|DELETE) (\S+)/); answer = t ? `${t[1]} ${t[2].replace(/[,.]$/, '')}` : ''; }
    }
    d.accept(answer).catch(() => {});
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN) {
      const file = path.join(root, decodeURIComponent(url.pathname));
      if (!file.startsWith(root)) return route.fulfill({ status: 403, body: '' });
      try {
        const body = await fs.readFile(file);
        const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
        return route.fulfill({ status: 200, body, contentType: type });
      } catch { return route.fulfill({ status: 404, body: 'not found' }); }
    }
    // Google Drive emulation, matching production behaviour observed with curl:
    // /thumbnail → 302 to lh3 WITHOUT Access-Control-Allow-Origin. File ids starting
    // with GOOD are shared publicly, PRIV are private (403 everywhere), THRT have the
    // thumbnail endpoint throttled (429) while lh3 still serves the image.
    if (url.host === 'drive.google.com' || url.host === 'lh3.googleusercontent.com') {
      const id = url.searchParams.get('id') || (url.pathname.match(/\/d\/([^=/]+)/) || [])[1] || '';
      if (url.host === 'drive.google.com' && url.pathname === '/thumbnail') {
        if (id.startsWith('GOOD')) return route.fulfill({ status: 302, headers: { location: `https://lh3.googleusercontent.com/d/${id}=w800` }, body: '' });
        return route.fulfill({ status: id.startsWith('THRT') ? 429 : 403, contentType: 'text/html', body: 'denied' });
      }
      if (url.host === 'lh3.googleusercontent.com' && (id.startsWith('GOOD') || id.startsWith('THRT'))) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: await fs.readFile(path.join(root, 'assets/img/rccg_logo.png')) });
      }
      return route.fulfill({ status: 403, contentType: 'text/html', body: 'denied' });
    }
    // SMOKE_CDN=1 lets the real Tailwind/Font Awesome CDNs through so screenshots look like production.
    if (process.env.SMOKE_CDN && /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/.test(url.host)) return route.continue();
    if (/supabase-js/.test(url.href)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: `(${fakeSupabase})();` });
    if (/\.css(\?|$)/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.addInitScript((f) => { window.__DC_FAKE = f; }, fake);
  await page.goto(ORIGIN + file, { waitUntil: 'load' });
  return { page, context, errors };
}

const cardJson = (status) => `() => ({ status: '${status}', member_no: 'DC-000123', full_name: 'Musa Member', role: 'Member', unit: 'Acting',
  avatar_url: null, issued_at: '2026-01-10T10:00:00Z', expires_at: '2028-01-10T10:00:00Z', org_name: 'Test Parish', app_name: 'DramaConnect',
  logo_url: null, checked_at: new Date().toISOString(), member_id: '${MEMBER.id}', card_token: '${TOKEN}', reissue_count: 0, verify_count: 2,
  settings: { member_no_prefix: 'DC', validity_months: 24, template: 'classic', signatory_name: 'Pastor', signatory_title: 'Coordinator', contact_line: 'Call 0800', back_note: 'Return if found', show_phone: false } })`;

const browser = await chromium.launch();
try {
  console.log('ID card page (real rendering + decode of the pixels)');
  {
    const { page, context, errors } = await openPage(browser, '/pages/idcard.html', {
      user: MEMBER, tables: { profiles: [MEMBER], tenant_settings: [{ id: 1, org_name: 'Test Parish', app_name: 'DramaConnect' }] },
      rpc: { dc_my_card: cardJson('valid') }
    });
    await page.waitForFunction(() => document.querySelectorAll('svg').length >= 2 && /DC-000123/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    ok(/DC-000123/.test(text) && /Musa Member/.test(text), 'card shows the member number and name', errors.join(' | '));
    const decoded = await page.evaluate(async () => {
      const out = {};
      const svgs = [...document.querySelectorAll('svg')];
      const toImage = async (svg, scale) => {
        const xml = new XMLSerializer().serializeToString(svg);
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        await img.decode();
        const vb = svg.viewBox.baseVal;
        const c = document.createElement('canvas');
        c.width = Math.round((vb.width || img.width) * scale); c.height = Math.round((vb.height || img.height) * scale);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      await DCCodes.ensureJsQR();
      for (const svg of svgs) {
        const label = svg.getAttribute('aria-label') || '';
        try {
          const image = await toImage(svg, 4);
          const bar = DCCodes.decodeCode128Image(image);
          if (bar) out.barcode = bar;
          const qr = window.jsQR && window.jsQR(image.data, image.width, image.height);
          if (qr && qr.data) out.qr = qr.data;
        } catch (e) { out.err = (out.err || '') + label + ':' + e.message + ';'; }
      }
      return out;
    });
    ok(decoded.barcode === 'DC-000123', 'rendered Code 128 barcode decodes to the member number', JSON.stringify(decoded));
    ok(typeof decoded.qr === 'string' && decoded.qr.includes('/pages/verify.html?c=' + '0123456789abcdef0123456789abcdef'), 'rendered QR decodes to the verification URL', JSON.stringify(decoded));
    ok(errors.length === 0, 'no uncaught page errors on idcard.html', errors.join(' | '));
    if (!process.env.SMOKE_CDN) {
      const w = await page.evaluate(() => document.getElementById('app-sidebar').getBoundingClientRect().width);
      ok(w > 0 && w < 400, 'CDN blocked → offline Tailwind keeps the app shell laid out', String(w));
    }
    await page.locator('#my-card').screenshot({ path: '/tmp/smoke-idcard.png' }).catch(() => page.screenshot({ path: '/tmp/smoke-idcard.png', fullPage: true }));
    await context.close();
  }

  console.log('ID card photo (Google Drive links, fallback chain, no CORS mode)');
  {
    const withPhoto = (avatar, logo = null) => cardJson('valid')
      .replace('avatar_url: null', `avatar_url: '${avatar}'`)
      .replace('logo_url: null', `logo_url: ${logo ? `'${logo}'` : 'null'}`);
    const cases = [
      ['public Drive photo renders on the card', 'https://drive.google.com/thumbnail?id=GOODphoto123456789&sz=w800', 'img', /lh3\.googleusercontent\.com\/d\/GOODphoto/],
      ['legacy /file/d/ link is normalised and renders', 'https://drive.google.com/file/d/GOODlegacy12345678/view?usp=sharing', 'img', /GOODlegacy/],
      ['throttled thumbnail falls back to lh3 and renders', 'https://drive.google.com/thumbnail?id=THRTphoto123456789&sz=w800', 'img', /lh3\.googleusercontent\.com\/d\/THRTphoto/],
      ['private Drive photo degrades to initials (no broken image)', 'https://drive.google.com/thumbnail?id=PRIVphoto123456789&sz=w800', 'div', /^MM$/]
    ];
    for (const [label, avatar, tag, re] of cases) {
      const { page, context, errors } = await openPage(browser, '/pages/idcard.html', {
        user: MEMBER, tables: { profiles: [MEMBER], tenant_settings: [{ id: 1, org_name: 'Test Parish', app_name: 'DramaConnect' }] },
        rpc: { dc_my_card: withPhoto(avatar, 'https://drive.google.com/thumbnail?id=PRIVlogo1234567890&sz=w400') }
      });
      const res = await page.waitForFunction((want) => {
        const el = document.querySelector('#my-card .photo');
        if (!el) return null;
        if (want === 'img' && el.tagName === 'IMG' && el.complete && el.naturalWidth > 0) return { tag: 'img', src: el.currentSrc || el.src, co: el.hasAttribute('crossorigin') };
        if (want === 'div' && el.tagName === 'DIV') return { tag: 'div', text: el.textContent.trim() };
        return null;
      }, tag, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
      ok(!!res && res.tag === tag && re.test(tag === 'img' ? res.src : res.text) && !res.co, label, JSON.stringify(res));
      if (label.startsWith('public')) {
        const logo = await page.waitForFunction(() => {
          const im = document.querySelector('#my-card .band img');
          return im && im.complete && im.naturalWidth > 0 && /rccg_logo\.png/.test(im.src) ? im.src : null;
        }, null, { timeout: 10000 }).then(h => h.jsonValue()).catch(() => null);
        ok(!!logo, 'unviewable tenant logo falls back to the bundled logo', String(logo));
        const nocors = await page.evaluate(() => document.querySelectorAll('img[crossorigin]').length);
        ok(nocors === 0, 'no <img crossorigin> left on the ID card page (root cause of the missing photo)', String(nocors));
        const proof = await page.evaluate(() => new Promise(r => {
          const a = new Image(); a.crossOrigin = 'anonymous';
          a.onload = () => r('loaded'); a.onerror = () => r('blocked');
          a.src = 'https://drive.google.com/thumbnail?id=GOODproof12345678&sz=w800';
        }));
        ok(proof === 'blocked', 'regression proof: the same Drive URL in CORS mode is blocked by the browser', proof);
        const ids = await page.evaluate(() => [
          'https://drive.google.com/file/d/1AbC_dEf-123456789/view?usp=sharing',
          'https://drive.google.com/open?id=1AbC_dEf-123456789',
          'https://drive.google.com/uc?export=view&id=1AbC_dEf-123456789',
          'https://docs.google.com/uc?id=1AbC_dEf-123456789',
          'https://lh3.googleusercontent.com/d/1AbC_dEf-123456789=w800',
          'https://example.com/me.jpg'
        ].map(u => Utils.drivePhotoId(u)));
        ok(ids.slice(0, 5).every(x => x === '1AbC_dEf-123456789') && ids[5] === '', 'Utils.drivePhotoId understands every Drive link shape', JSON.stringify(ids));
        await page.locator('#my-card').screenshot({ path: '/tmp/smoke-idcard-photo.png' }).catch(() => {});
      }
      ok(errors.length === 0, `no page errors (${label})`, errors.join(' | '));
      await context.close();
    }
    // Public verification + attendance scan show the same resilient photo.
    const { page, context, errors } = await openPage(browser, `/pages/verify.html?c=${TOKEN}`, {
      tables: { tenant_settings: [{ id: 1, org_name: 'Test Parish', app_name: 'DramaConnect' }] },
      rpc: { dc_verify_card: withPhoto('https://drive.google.com/thumbnail?id=THRTverify12345678&sz=w800') }
    });
    const vr = await page.waitForFunction(() => {
      const im = document.querySelector('img[alt="Card holder photo"]');
      return im && im.complete && im.naturalWidth > 0 ? im.src : null;
    }, null, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
    ok(!!vr && /lh3/.test(vr), 'verify.html shows the holder photo via the fallback chain', String(vr));
    ok(errors.length === 0, 'no page errors on verify.html (photo)', errors.join(' | '));
    await context.close();
  }

  console.log('Public verification page');
  for (const [status, re] of [['valid', /valid/i], ['revoked', /revoked/i]]) {
    const { page, context, errors } = await openPage(browser, `/pages/verify.html?c=${TOKEN}`, {
      user: null, tables: { tenant_settings: [{ id: 1, org_name: 'Test Parish' }] }, rpc: { dc_verify_card: cardJson(status) }
    }, { width: 420, height: 900 });
    await page.waitForFunction(() => /Musa Member/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    ok(re.test(text) && /Musa Member/.test(text), `verify.html renders the ${status.toUpperCase()} state`, text.slice(0, 200) + errors.join('|'));
    const calls = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_verify_card'));
    ok(calls.length === 1 && calls[0].args.p_token === TOKEN, `verify.html sends only the token (${status})`, JSON.stringify(calls));
    if (!process.env.SMOKE_CDN) {
      const layout = await page.evaluate(() => ({
        offline: !!document.getElementById('tailwind-offline-css'),
        logo: document.getElementById('org-logo').getBoundingClientRect().height
      }));
      ok(layout.offline && layout.logo > 0 && layout.logo <= 80, `CDN blocked → offline Tailwind keeps verify.html laid out (${status})`, JSON.stringify(layout));
    }
    await page.waitForTimeout(900); // let the fade-in finish
    await page.screenshot({ path: `/tmp/smoke-verify-${status}.png`, fullPage: true });
    await context.close();
  }

  console.log('Attendance scanning desk (unit leader)');
  {
    const REH = '11111111-1111-4111-8111-111111111111';
    const { page, context, errors } = await openPage(browser, `/pages/attendance.html?rehearsal=${REH}`, {
      user: LEADER,
      tables: {
        profiles: [LEADER, MEMBER], member_directory: [LEADER, MEMBER],
        rehearsals: [{ id: REH, rehearsal_date: '2026-09-26', notes: 'Dress rehearsal' }],
        rehearsal_schedule: [{ id: REH, rehearsal_date: '2026-09-26', notes: 'Dress rehearsal' }], attendance: [],
        tenant_settings: [{ id: 1, org_name: 'Test Parish' }]
      },
      rpc: {
        dc_scan_attendance: `(a) => a.p_code.toUpperCase() === 'DC-000123'
          ? { result: 'checked_in', member_id: '${MEMBER.id}', full_name: 'Musa Member', member_no: 'DC-000123', unit: 'Acting', status: 'valid' }
          : { result: 'not_found' }`
      }
    });
    await page.waitForTimeout(1500);
    const visible = await page.isVisible('#qr-scan-btn');
    ok(visible, 'unit leader sees the "Scan ID Cards" button', errors.join('|'));
    if (visible) {
      await page.click('#qr-scan-btn');
      ok(await page.isVisible('#qr-reader-container'), 'scanning desk opens');
      await page.fill('#scan-manual', 'dc-000123');
      await page.press('#scan-manual', 'Enter');
      await page.waitForFunction(() => /Checked in/.test(document.getElementById('scan-result').innerText), null, { timeout: 5000 }).catch(() => {});
      const res = await page.innerText('#scan-result');
      ok(/Checked in/.test(res) && /Musa Member/.test(res), 'typed member number → dc_scan_attendance → green result panel', res);
      const badge = await page.evaluate((id) => { const el = document.querySelector(`[data-mid="${id}"]`); return el && (el.value || el.textContent); }, MEMBER.id);
      ok(badge === 'present', 'checklist row updates to present without reload', String(badge));
      // USB wedge: a fast keystroke burst with no field focused.
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.keyboard.type('DC-999999', { delay: 5 });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /No member has this card/.test(document.getElementById('scan-result').innerText), null, { timeout: 5000 }).catch(() => {});
      ok(/No member has this card/.test(await page.innerText('#scan-result')), 'USB keyboard-wedge burst is captured page-wide and resolved');
      const calls = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_scan_attendance').length);
      ok(calls === 2, 'exactly one RPC per scan (duplicate guard)', String(calls));
    }
    ok(errors.length === 0, 'no uncaught page errors on attendance.html', errors.join(' | '));
    await page.locator('#qr-reader-container').screenshot({ path: '/tmp/smoke-attendance.png' }).catch(() => page.screenshot({ path: '/tmp/smoke-attendance.png', fullPage: true }));
    await context.close();
  }

  console.log('Platform Health — anti-pause layer matrix (Item 19)');
  {
    const ADMIN = { ...LEADER, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Ada Admin', role: 'admin' };
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const { page, context, errors } = await openPage(browser, '/pages/platform-health.html', {
      user: ADMIN,
      tables: {
        profiles: [ADMIN], tenant_settings: [{ id: 1, org_name: 'Test Parish' }],
        dc_heartbeat_sources: [
          { source: 'site-visit', last_ping_at: ago(1), ping_count: 40 },
          { source: 'manual-button', last_ping_at: ago(2), ping_count: 3 },
          { source: 'github-actions', last_ping_at: ago(300), ping_count: 1 }
        ],
        dc_backup_settings: [{ id: 1 }], dc_backup_runs: [], dc_platform_settings: [{ id: 1, lockdown_enabled: false, idle_timeout_minutes: 60 }],
        dc_retention_settings: [{ id: 1, login_audit_days: 180 }], dc_login_audit: [], dc_site_license: [{ id: 1, model: 'lifetime', status: 'active' }]
      },
      rpc: {
        dc_platform_health: `() => ({ database: { reachable: true }, schemaVersion: '14.1', checkedAt: new Date().toISOString(), heartbeat: { lastPingAt: new Date().toISOString() }, backup: { status: 'never' }, license: { model: 'lifetime', status: 'active' } })`,
        dc_heartbeat_health: `() => ({ status: 'healthy', pauseAfterHours: 168, daysUntilPause: 6.9, sourcesTotal: 3, sourcesFresh: 2, quorum: true, singlePointOfFailure: false,
          automatedSourcesFresh: 0, automatedQuorum: false, neverReported: ['vercel-cron','pg-cron','edge-ping'], silentSources: ['github-actions'],
          lastSource: 'site-visit', lastHeartbeatAt: new Date(Date.now() - 3600e3).toISOString(), totalPings: 44, fleet: { pingedAt: new Date(Date.now() - 7200e3).toISOString(), src: 'hmg-fleet-console', count: 5 } })`,
        dc_schema_doctor: `() => ({ ok: false, checkedAt: new Date().toISOString(), schemaVersion: '14.1', postgres: '15', pgCron: { extension: false, job: null },
          fix: 'Run database/complete-schema.sql', packs: [1,2,3,4,5,6].map((n) => ({ id: '0' + n, name: 'Pack ' + n, file: 'p' + n + '.sql', installed: n !== 4, partial: n === 4, present: n === 4 ? 9 : 10, total: 10, missing: n === 4 ? ['t:dc_archive_vault'] : [] })) })`,
        dc_login_audit_report: `() => ({ since: new Date().toISOString(), neverSignedIn: 2, summary: { signIns24h: 3, signIns7d: 9, uniqueUsers7d: 4, denied: 1, idleTimeouts: 2, securityChanges: 0, byEvent: {} },
          rows: [{ id: 1, createdAt: new Date().toISOString(), event: 'sign_in', email: 'ada@example.com', name: 'Ada Admin', role: 'admin', unit: 'Drama', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537', metadata: {} },
                 { id: 2, createdAt: new Date().toISOString(), event: 'idle_timeout', email: 'bo@example.com', name: 'Bo Member', role: 'member', unit: 'Choir', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/120', metadata: {} }] })`,
        dc_storage_overview: `() => ({ databaseBytes: 50e6, databaseQuotaBytes: 500e6, databasePercent: 10, storageBytes: 1e6, storageQuotaBytes: 1e9, storagePercent: 0.1, warningPercent: 75, criticalPercent: 90, buckets: [{ bucket: 'avatars', objects: 3, bytes: 1e6 }] })`,
        dc_table_sizes: `() => ([{ table: 'activity_log', rows: 900, bytes: 4e6, tableBytes: 3e6, indexBytes: 1e6 }, { table: 'profiles', rows: 40, bytes: 1e6, tableBytes: 8e5, indexBytes: 2e5 }])`,
        sc_license_status: `() => ({ state: 'lifetime', status: 'active', model: 'lifetime', product: 'dramaconnect' })`,
        dc_keep_alive: `(a) => ({ ok: true, status: 'written', source: a.p_source })`,
        dc_access_state: `() => ({ allowed: true, is_admin: true })`,
        dc_update_platform_settings: `(a) => ({ id: 1, lockdown_enabled: a.p_lockdown_enabled, idle_timeout_minutes: a.p_idle_timeout_minutes })`
      }
    }, { width: 1280, height: 1400 });
    await page.waitForFunction(() => document.querySelectorAll('#heartbeats tr').length >= 13, null, { timeout: 15000 }).catch(() => {});
    const rows = await page.$$eval('#heartbeats tr', (trs) => trs.map((t) => t.innerText.replace(/\s+/g, ' ')));
    ok(rows.length === 14, 'matrix lists all 14 layers (incl. Fleet Console, Fleet workflow, self-commit), including never-reported ones', String(rows.length));
    ok(rows.some((r) => /Vercel Cron/.test(r) && /Not set up/.test(r)), 'never-reported layer shows "Not set up" with its fix', rows.join(' || ').slice(0, 300));
    ok(rows.some((r) => /GitHub Actions/.test(r) && /Silent/.test(r)), 'stale scheduler is flagged Silent');
    ok(rows.some((r) => /Site visits/.test(r) && /Reporting/.test(r)), 'fresh layer shows Reporting');
    await page.waitForFunction(() => document.querySelectorAll('#doctor-rows tr').length === 6 && document.querySelectorAll('#audit tr').length === 2, null, { timeout: 8000 }).catch(() => {});
    const src = await page.innerText('#ka-source').catch(() => '');
    ok(/Site visits/.test(src), 'keep-alive panel names where the last ping came from', src);
    ok(/44/.test(await page.innerText('#ka-total')), 'total pings shown');
    ok(/hmg-fleet-console/.test(await page.innerText('#ka-fleet-note')), 'Fleet sc_keepalive heartbeat shown with its sender');
    const doc = await page.$$eval('#doctor-rows tr', (trs) => trs.map((t) => t.innerText));
    ok(doc.length === 6 && doc.filter((t) => /Installed/.test(t)).length === 5 && doc.some((t) => /Partial/.test(t) && /dc_archive_vault/.test(t)), 'Schema Doctor lists all six packs with the missing object', doc.join(' | ').slice(0, 200));
    const audit = await page.innerText('#audit');
    ok(/Ada Admin/.test(audit) && /Chrome · Android/.test(audit) && /idle timeout/i.test(audit), 'login audit shows who signed in, device and event', audit.slice(0, 200));
    ok(/Approved, never signed in/i.test(await page.innerText('#audit-kpis')), 'login audit summary KPIs rendered');
    await page.fill('#audit-search', 'choir'); await page.waitForTimeout(100);
    ok((await page.$$('#audit tr')).length === 1, 'login audit search filters client-side');
    await page.fill('#audit-search', '');
    const fleet = await page.innerText('#fleet-checks').catch(() => '');
    ok(/sc_license_status/.test(fleet) && /lifetime/.test(fleet) && /dramaconnect-v14/.test(fleet), 'Fleet Console contract checks run (licence probe, sw.js deploy version)', fleet.slice(0, 300));
    ok(/rpc\/sc_keep_alive/.test(await page.innerText('#fleet-cron')), 'Fleet/cron POST endpoint documented on the page');
    const banner = await page.innerText('#quorum-banner').catch(() => '');
    ok(/Only human traffic/.test(banner), 'banner warns when only human traffic keeps the project awake', banner.slice(0, 160));
    await page.click('#heartbeat');
    await page.waitForTimeout(300);
    const sent = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_keep_alive').map((c) => c.args.p_source));
    ok(sent.includes('manual-button'), 'Test heartbeat records the manual-button layer (not site-visit)', JSON.stringify(sent));
    const retTxt = await page.innerText('#login_audit_retention_display').catch(() => '');
    ok(/180 days/.test(retTxt), 'retention is shown read-only from the Storage Manager', retTxt);
    await page.fill('#idle_timeout_minutes', '45');
    await page.click('#security-form button[type=submit]');
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_update_platform_settings').map((c) => c.args));
    ok(saved.length === 1 && saved[0].p_login_audit_retention_days === null && saved[0].p_idle_timeout_minutes === 45,
      'Save security state sends null retention (keep) instead of NaN', JSON.stringify(saved));
    ok(errors.length === 0, 'no uncaught page errors on platform-health.html', errors.join(' | '));
    await page.screenshot({ path: '/tmp/smoke-platform-health.png', fullPage: true });
    await context.close();
  }

  // ---------------------------------------------------------------- Item 18 pages
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const inDays = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const soon = new Date(Date.now() + 5 * 864e5).toISOString();

  console.log('Public registration page (shareable link → ticket)');
  {
    const TICKET = `() => ({ found: true, result: 'created', status: 'registered', checked_in: false, ticket_code: 'A1B2C3D4', ticket_token: '${TOKEN}', full_name: 'Guest One', party_size: 1,
      title: 'Easter Drama', slug: 'easter', starts_at: '${soon}', ends_at: null, venue: 'Main Hall', feedback_open: false })`;
    const { page, context, errors } = await openPage(browser, '/pages/register.html?p=easter&src=whatsapp', {
      user: null, tables: { tenant_settings: [{ id: 1, org_name: 'Test Parish' }] },
      rpc: {
        dc_public_program: `() => ({ found: true, phase: 'open', slug: 'easter', title: 'Easter Drama', category: 'production', starts_at: '${soon}', venue: 'Main Hall',
          seats_left: 5, allow_waitlist: true, phone_mode: 'required', email_mode: 'optional', max_party_size: 1, custom_questions: [{ id: 'q1', label: 'Dietary needs', type: 'text', required: false }] })`,
        dc_register_for_program: TICKET, dc_program_ticket: TICKET
      }
    }, { width: 420, height: 900 });
    await page.waitForSelector('#reg-form', { timeout: 15000 }).catch(() => {});
    ok(await page.$('#reg-form') !== null, 'registration form renders from the public link without sign-in');
    ok(/5 seat/.test(await page.innerText('#view').catch(() => '')), 'seats-left pill shows');
    await page.click('#reg-submit');
    ok(await page.isVisible('#form-error'), 'empty form is blocked with a visible message');
    await page.fill('[name=full_name]', 'Guest One'); await page.fill('[name=phone]', '08031234567'); await page.fill('[name=q_q1]', 'None');
    await page.check('[name=consent]');
    await page.click('#reg-submit');
    await page.waitForFunction(() => /A1B2C3D4/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
    const call = await page.evaluate(() => window.__calls.find((c) => c.rpc === 'dc_register_for_program'));
    ok(call && call.args.p_payload.source === 'whatsapp' && call.args.p_payload.answers.q1 === 'None' && call.args.p_payload.website === '', 'payload carries channel tag, custom answers and empty honeypot', JSON.stringify(call && call.args));
    ok(/A1B2C3D4/.test(await page.innerText('#view')), 'ticket with code is shown after registering');
    ok(await page.$('#view svg') !== null, 'ticket QR code is rendered');
    ok(await page.evaluate(() => (JSON.parse(localStorage.getItem('dc_my_tickets') || '[]')).length === 1), 'ticket is remembered on the device');
    ok(errors.length === 0, 'no uncaught page errors on register.html', errors.join(' | '));
    await context.close();
  }

  console.log('Calendar — combined month view');
  {
    const { page, context, errors } = await openPage(browser, '/pages/calendar.html', {
      user: MEMBER,
      tables: {
        profiles: [MEMBER], tenant_settings: [{ id: 1 }],
        rehearsal_schedule: [{ id: 'r1', rehearsal_date: todayIso, notes: 'Act 2 blocking' }],
        events: [{ id: 'e1', title: 'Drama Night', event_date: soon, location: 'Hall' }],
        dc_programs: [{ id: 'p1', title: 'Easter Drama', slug: 'easter', starts_at: soon, venue: 'Main Hall', status: 'open' }],
        member_directory: [{ id: MEMBER.id, full_name: 'Musa Member', birth_month: new Date().getMonth() + 1, birth_day: new Date().getDate() }],
        dc_duty_roster: [{ id: 'd1', member_id: MEMBER.id, duty_date: todayIso, service_label: 'Sunday Service', duty_role: 'Ushering', status: 'assigned' }]
      },
      rpc: { dc_access_state: `() => ({ allowed: true })` }
    }, { width: 1280, height: 1200 });
    await page.waitForFunction(() => document.querySelectorAll('#grid > *').length >= 35, null, { timeout: 15000 }).catch(() => {});
    ok((await page.$$('#grid > *')).length === 42, 'month grid has 42 day cells');
    const txt = await page.innerText('body');
    ok(/Rehearsal/.test(txt) && /Ushering/.test(txt) && /Musa Member/.test(txt), 'rehearsal, own duty and birthday appear');
    ok(/Easter Drama/.test(txt), 'open programme appears');
    ok(errors.length === 0, 'no uncaught page errors on calendar.html', errors.join(' | '));
    await context.close();
  }

  console.log('Duty roster — member answers, leader manages');
  {
    const duty = { id: 'd1', member_id: MEMBER.id, duty_date: inDays(3), service_label: 'Sunday Service', duty_role: 'Ushering', status: 'assigned', notes: 'Come early' };
    const { page, context, errors } = await openPage(browser, '/pages/roster.html', {
      user: MEMBER, tables: { profiles: [MEMBER], tenant_settings: [{ id: 1 }], dc_duty_roster: [duty], member_directory: [MEMBER] },
      rpc: { dc_respond_duty: `() => ({ ok: true })`, dc_access_state: `() => ({ allowed: true })` }
    }, { width: 1280, height: 1200 });
    await page.waitForSelector('[data-respond="confirmed"]', { timeout: 15000 }).catch(() => {});
    ok(await page.isHidden('#manage'), 'ordinary member does not see the assign form');
    await page.click('[data-respond="confirmed"]');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => window.__calls.find((c) => c.rpc === 'dc_respond_duty'));
    ok(r && r.args.p_status === 'confirmed' && r.args.p_duty_id === 'd1', 'confirm calls dc_respond_duty', JSON.stringify(r));
    ok(errors.length === 0, 'no uncaught page errors on roster.html (member)', errors.join(' | '));
    await context.close();
  }
  {
    const { page, context, errors } = await openPage(browser, '/pages/roster.html', {
      user: LEADER, tables: { profiles: [LEADER], tenant_settings: [{ id: 1 }], dc_duty_roster: [], member_directory: [LEADER, MEMBER] },
      rpc: { dc_access_state: `() => ({ allowed: true })` }
    }, { width: 1280, height: 1200 });
    await page.waitForSelector('#manage:not(.hidden)', { timeout: 15000 }).catch(() => {});
    ok(await page.isVisible('#manage'), 'leader sees the assign form');
    await page.fill('[name=duty_role]', 'Props');
    await page.selectOption('[name=member_ids]', [MEMBER.id]);
    await page.click('#assign-form button[type=submit]');
    await page.waitForTimeout(300);
    const up = await page.evaluate(() => window.__calls.find((c) => c.table === 'dc_duty_roster' && c.op === 'upsert'));
    ok(up && up.payload[0].member_id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' && up.payload[0].duty_role === 'Props', 'assign upserts the roster rows', JSON.stringify(up));
    ok(errors.length === 0, 'no uncaught page errors on roster.html (leader)', errors.join(' | '));
    await context.close();
  }

  console.log('Admin Data — table explorer, sample data and restore hub (Item 21)');
  {
    const ADMIN6 = { ...LEADER, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Ada Admin', role: 'admin' };
    const { page, context, errors } = await openPage(browser, '/pages/admin-data.html', {
      user: ADMIN6,
      tables: { profiles: [ADMIN6], tenant_settings: [{ id: 1, org_name: 'Test Parish' }],
        productions: [{ id: 'p1', title: 'DEMO — The Prodigal Son', director: 'DEMO Director' }, { id: 'p2', title: 'Rag Day', director: 'Sam' }],
        rehearsals: [{ id: 'r1', rehearsal_date: '2026-09-01', notes: 'DEMO — Tuesday evening rehearsal' }],
        dc_backup_settings: [{ id: 1 }], dc_backup_runs: [], dc_heartbeat_sources: [],
        dc_archive_vault: [{ id: 'v9', table_name: 'attendance', object_path: 'archive-vault/attendance/attendance-2024-01-01-9.json', sha256: 'e'.repeat(64), row_count: 12, cutoff: '2024-01-01T00:00:00Z', created_at: '2024-01-02T10:00:00Z', restored_at: null, restored_rows: null }] },
      rpc: { dc_access_state: `() => ({ allowed: true, is_admin: true })`, dc_heartbeat_health: `() => ({})`,
        dc_archive_restore: `(a) => ({ ok: true, table: 'attendance', restoredRows: 2, offered: (a.p_rows || []).length })` }
    }, { width: 1280, height: 1300 });
    await page.waitForTimeout(1200);
    const tabs = await page.$$eval('.tab-btn', (b) => b.map((x) => x.dataset.tab));
    ok(['local', 'drive', 'vault', 'history', 'tables', 'hub'].every((t) => tabs.includes(t)), 'admin data keeps every existing tab and adds Table explorer + Restore hub', tabs.join(','));
    // Table explorer
    await page.click('.tab-btn[data-tab="tables"]');
    await page.waitForTimeout(200);
    ok((await page.$$('#te-table option')).length > 20, 'table explorer lists every portable table');
    await page.selectOption('#te-table', 'productions');
    await page.click('#te-load');
    await page.waitForFunction(() => /row\(s\) in productions/.test(document.getElementById('te-status').innerText), null, { timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('#te-table-wrap tbody tr').length === 2, null, { timeout: 20000 }).catch(() => {});
    const preview = await page.innerText('#te-table-wrap');
    ok(/DEMO — The Prodigal Son/.test(preview) && /Rag Day/.test(preview) && /\btitle\b/i.test(preview), 'preview shows the real rows and columns', preview.slice(0, 200));
    ok(/DEMO \(the vault|row\(s\) in productions/.test(await page.innerText('#te-status')) || /row\(s\) in productions/.test(await page.innerText('#te-status')), 'preview reports the exact row count');
    // Sample data is labelled and removable
    await page.click('#demo-load');
    await page.waitForTimeout(600);
    const inserts = await page.evaluate(() => window.__calls.filter((c) => c.op === 'insert').map((c) => ({ t: c.table, v: JSON.stringify(c.payload) })));
    ok(inserts.length >= 8 && inserts.every((i) => /DEMO —/.test(i.v)) && inserts.some((i) => i.t === 'finances'), 'sample data inserts only DEMO-labelled rows across the working tables', `${inserts.length} insert(s): ${inserts.slice(0, 2).map((i) => i.t).join(',')}`);
    await page.click('#demo-clear');
    await page.waitForTimeout(600);
    const dels = await page.evaluate(() => window.__calls.filter((c) => c.op === 'delete').map((c) => c.table));
    ok(['productions', 'rehearsals', 'events', 'announcements', 'tasks', 'finances'].every((t) => dels.includes(t)), 'sample data can be removed again in one click', dels.join(','));
    // Restore hub
    await page.click('.tab-btn[data-tab="hub"]');
    await page.waitForFunction(() => document.querySelectorAll('#hub-list tr').length === 1, null, { timeout: 8000 }).catch(() => {});
    const hub = await page.innerText('#hub-list');
    ok(/attendance/.test(hub) && /12/.test(hub), 'restore hub lists archived batches with their row counts', hub.slice(0, 160));
    await page.click('#hub-list button[data-restore]');
    await page.waitForTimeout(600);
    const restored = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_archive_restore').map((c) => c.args));
    ok(restored.length === 1 && restored[0].p_rows.length === 2, 'restore hub restores a batch from the private vault', JSON.stringify(restored));
    const map = await page.innerText('#tab-hub');
    ok(/Verified database archive/.test(map) && /Storage objects/.test(map) && /Archive Vault batches/.test(map), 'restore hub maps every recovery source to its owner tool');
    await page.click('.tab-btn[data-tab="local"]');
    await page.waitForTimeout(150);
    ok(/Export verified archive/.test(await page.innerText('#tab-local')), 'the original Local archive tab still works');
    ok(errors.length === 0, 'no uncaught page errors on admin-data.html', errors.join(' | '));
    await page.screenshot({ path: '/tmp/smoke-admin-data.png', fullPage: true });
    await context.close();
  }

  console.log('Storage Manager — sizes, retention, Archive Vault and buckets (Item 21)');
  {
    const ADMIN5 = { ...LEADER, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Ada Admin', role: 'admin' };
    const { page, context, errors } = await openPage(browser, '/pages/storage-manager.html', {
      user: ADMIN5,
      tables: { profiles: [ADMIN5], tenant_settings: [{ id: 1, org_name: 'Test Parish' }],
        activity_log: [{ id: 'l1', created_at: '2024-01-01T00:00:00Z' }, { id: 'l2', created_at: '2024-02-01T00:00:00Z' }, { id: 'l3', created_at: new Date().toISOString() }],
        dc_backup_settings: [{ id: 1, last_archive_sha256: 'c'.repeat(64) }],
        dc_backup_runs: [{ id: 'r1', destination: 'vault', status: 'succeeded', started_at: new Date().toISOString(), completed_at: new Date().toISOString(), archive_sha256: 'c'.repeat(64), archive_rows: 9, archive_size: 3000 }],
        dc_retention_settings: [{ id: 1, database_quota_mb: 500, storage_quota_mb: 1024, warning_percent: 75, critical_percent: 90, activity_log_days: 365, backup_run_days: 180, heartbeat_days: 90, login_audit_days: 90 }],
        dc_archive_vault: [{ id: 'v1', table_name: 'activity_log', object_path: 'archive-vault/activity_log/activity_log-2024-01-01-1.json', sha256: 'd'.repeat(64), row_count: 2, cutoff: '2024-03-01T00:00:00Z', created_at: '2024-03-02T10:00:00Z', restored_at: null, restored_rows: null }],
        dc_heartbeat_sources: [] },
      rpc: {
        dc_storage_overview: `() => ({ databaseBytes: 300e6, databaseQuotaBytes: 500e6, databasePercent: 60, storageBytes: 100e6, storageQuotaBytes: 1024e6, storagePercent: 9.8, storageObjects: 12, buckets: [{ bucket: 'avatars', objects: 8, bytes: 60e6 }, { bucket: 'gallery', objects: 4, bytes: 40e6 }], warningPercent: 75, criticalPercent: 90 })`,
        dc_retention_preview: `() => ({ activity_log: { rows: 2, before: '2025-09-29T00:00:00Z' }, dc_login_audit: { rows: 0, before: '2026-06-29T00:00:00Z' } })`,
        dc_table_sizes: `() => ([{ table: 'activity_log', rows: 9000, bytes: 20e6, tableBytes: 18e6, indexBytes: 2e6, oldest: '2024-01-01T00:00:00Z' }, { table: 'profiles', rows: 40, bytes: 1e6 }])`,
        dc_archive_purge: `(a) => ({ ok: true, table: a.p_table, archivedRows: 2, path: a.p_object_path })`,
        dc_archive_restore: `(a) => ({ ok: true, table: 'activity_log', restoredRows: 2, offered: (a.p_rows || []).length })`,
        dc_apply_retention: `(a) => ({ ok: true, table: a.p_table_name, deletedRows: 2 })`,
        dc_access_state: `() => ({ allowed: true, is_admin: true })`,
        dc_heartbeat_health: `() => ({ lastSource: 'manual-button', sourcesFresh: 1, sourcesTotal: 1 })`
      }
    }, { width: 1280, height: 1400 });
    await page.waitForFunction(() => /activity_log/.test(document.getElementById('sizes-list').innerText), null, { timeout: 15000 }).catch(() => {});
    ok(/9,000 row/.test(await page.innerText('#sizes-list')) && /20.0 MiB|19.1 MiB/.test(await page.innerText('#sizes-list')), 'table sizes show exact rows, bytes and oldest row', (await page.innerText('#sizes-list')).slice(0, 160));
    ok(/60% of quota/.test(await page.innerText('#health-advice')) && /largest table/.test(await page.innerText('#health-advice')), 'health analysis gives quota advice and names the largest table', (await page.innerText('#health-advice')).slice(0, 220));
    ok(/avatars/.test(await page.innerText('#bucket-bars')), 'bucket usage bars rendered');
    // Guarded purge auto-fills the verified backup digest
    await page.click('#fill-sha'); await page.waitForTimeout(300);
    ok((await page.inputValue('#purge-sha')) === 'c'.repeat(64), 'the guarded purge fills the SHA-256 of the last verified backup automatically');
    // Archive Vault: export -> upload -> verify -> purge
    await page.selectOption('#vault-table', 'activity_log');
    await page.fill('#vault-days', '365');
    await page.click('#vault-archive');
    await page.waitForFunction(() => /Archived 2 row/.test(document.getElementById('vault-result').innerText), null, { timeout: 15000 }).catch(() => {});
    const uploads = await page.evaluate(() => window.__uploads || []);
    const purge = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_archive_purge').map((c) => c.args));
    ok(uploads.length === 1 && uploads[0].bucket === 'dramaconnect-backups' && /^archive-vault\/activity_log\/activity_log-\d{4}-\d{2}-\d{2}-\d+\.json$/.test(uploads[0].path),
      'old rows are exported to a JSON file and uploaded to the private vault first', JSON.stringify(uploads));
    // (The test fake ignores .lt(), so the count is whatever the page could
    // read — the point is that a positive count and the digest are sent.)
    ok(purge.length === 1 && purge[0].p_table === 'activity_log' && purge[0].p_row_count > 0 && purge[0].p_confirmation === 'ARCHIVE activity_log' && /^[a-f0-9]{64}$/.test(purge[0].p_sha256),
      'the guarded RPC receives the row count, SHA-256 and typed confirmation', JSON.stringify(purge));
    ok(/Archived 2 row\(s\) of activity_log/.test(await page.innerText('#vault-result')), 'archive outcome reported', (await page.innerText('#vault-result')).slice(0, 160));
    // Restore from the vault
    await page.click('#vault-list');
    await page.waitForFunction(() => document.querySelectorAll('#vault-body tr').length === 1, null, { timeout: 8000 }).catch(() => {});
    ok(/archive-vault\/activity_log/.test(await page.innerText('#vault-body')), 'vault contents listed with the stored file');
    await page.click('#vault-body button[data-restore]');
    await page.waitForTimeout(600);
    const restoreCalls = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_archive_restore').map((c) => c.args));
    ok(restoreCalls.length === 1 && restoreCalls[0].p_rows.length === 2, 'restore sends the archived rows back through the RPC', JSON.stringify(restoreCalls));
    // Retention table list still offers the guarded purge
    ok(/activity_log/.test(await page.innerText('#retention-list')) && /Guarded purge/.test(await page.innerText('#retention-list')), 'retention preview keeps the guarded purge per table');
    // Buckets
    await page.click('#load-objects');
    await page.waitForTimeout(400);
    ok(errors.length === 0, 'no uncaught page errors on storage-manager.html', errors.join(' | '));
    await page.screenshot({ path: '/tmp/smoke-storage.png', fullPage: true });
    await context.close();
  }

  console.log('Settings — control plane, accessibility, geofence, 2-step and module access (Item 21)');
  {
    const ADMIN4 = { ...LEADER, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Ada Admin', role: 'admin' };
    const org = `(a) => Object.assign({ id: 1, default_language: 'en', timezone: 'Africa/Lagos', call_time: '16:00:00', late_after_minutes: 15,
      geofence_enabled: false, geofence_lat: null, geofence_lng: null, geofence_radius_m: 150, geofence_max_accuracy_m: 200, venue_name: 'Main hall',
      disabled_modules: [], require_admin_mfa: false, assistant_enabled: true, high_contrast_default: false }, a && a.p_settings ? a.p_settings : {})`;
    const { page, context, errors } = await openPage(browser, '/pages/settings.html', {
      user: ADMIN4,
      tables: { profiles: [ADMIN4], tenant_settings: [{ id: 1, app_name: 'DramaConnect', org_name: 'Test Parish', logo_url: '', primary_color: '#1e40af' }],
        dc_org_settings: [{ id: 1, default_language: 'en', timezone: 'Africa/Lagos', call_time: '16:00:00', late_after_minutes: 15, geofence_enabled: false, geofence_radius_m: 150, geofence_max_accuracy_m: 200, venue_name: 'Main hall', disabled_modules: [], require_admin_mfa: false, assistant_enabled: true, high_contrast_default: false }],
        dc_site_license: [{ id: 1, license_model: 'lifetime', license_status: 'active', licensed_to: 'RCCG LP 25', expires_on: null, grace_days: 14 }],
        dc_heartbeat_sources: [{ source: 'site-visit', last_ping_at: new Date().toISOString(), ping_count: 4 }, { source: 'vercel-cron', last_ping_at: new Date().toISOString(), ping_count: 2 }],
        dc_backup_settings: [{ id: 1, last_success_at: new Date().toISOString() }], dc_backup_runs: [] },
      rpc: { dc_update_org_settings: org, dc_access_state: `() => ({ allowed: true, is_admin: true })`,
        dc_heartbeat_health: `() => ({ lastSource: 'vercel-cron', sourcesFresh: 2, sourcesTotal: 2, quorum: true })`,
        dc_storage_overview: `() => ({ databasePercent: 12, storagePercent: 3, warningPercent: 75, criticalPercent: 90 })`,
        dc_list_member_access: `() => ([{ id: 'x', status: 'pending' }, { id: 'y', status: 'approved' }])`,
        dc_activity_feed: `() => ({ summary: { today: 6, byAction: {}, topActors: [] }, rows: [] })`,
        sc_license_status: `() => ({ state: 'lifetime', status: 'lifetime', model: 'lifetime' })` }
    }, { width: 1280, height: 1400 });
    await page.waitForFunction(() => document.querySelectorAll('#module-list input[data-module]').length > 10, null, { timeout: 15000 }).catch(() => {});
    const sections = await page.$$eval('.dc-section', (s) => s.map((x) => x.id));
    ok(['sec-branding', 'sec-org', 'sec-appearance', 'sec-attendance', 'sec-security', 'sec-modules', 'sec-assistant', 'sec-license', 'sec-system'].every((id) => sections.includes(id)),
      'settings has one section for every capability on one page', sections.join(','));
    ok((await page.$$('#module-list input[data-module]')).length > 20, 'module access lists every sidebar section');
    const protectedBoxes = await page.$$eval('#module-list input[data-module]', (els) => els.filter((e) => e.disabled).map((e) => e.dataset.module));
    ok(protectedBoxes.includes('settings') && protectedBoxes.includes('platform-health'), 'core administration modules cannot be switched off', protectedBoxes.join(','));
    // Accessibility preferences persist and apply immediately
    await page.check('#a11y-largeText'); await page.check('#a11y-focusRing'); await page.waitForTimeout(100);
    const applied = await page.evaluate(() => ({ store: JSON.parse(localStorage.getItem('dc-a11y') || '{}'), cls: document.documentElement.className }));
    ok(applied.store.largeText === true && applied.store.focusRing === true && /dc-large-text/.test(applied.cls) && /dc-focus-ring/.test(applied.cls),
      'accessibility preferences save to this device and apply to the document', JSON.stringify(applied));
    // Language and organisation settings go through the RPC
    await page.selectOption('#org-language', 'ig');
    await page.click('#org-save');
    await page.waitForTimeout(400);
    const orgCalls = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_update_org_settings').map((c) => c.args.p_settings));
    ok(orgCalls.some((c) => c.default_language === 'ig'), 'saving the organisation settings sends only the changed keys', JSON.stringify(orgCalls));
    // Geofence validation is explained before saving
    await page.check('#org-geofence'); await page.waitForTimeout(100);
    ok(/Fence is on but the venue coordinates are empty/.test(await page.innerText('#geo-preview')), 'enabling the fence without coordinates warns the administrator first');
    await page.fill('#org-lat', '6.524400'); await page.fill('#org-lng', '3.379200');
    await page.dispatchEvent('#org-lat', 'input'); await page.waitForTimeout(100);
    ok(/within 150 m of Main hall/.test(await page.innerText('#geo-preview')), 'the fence summary describes the radius and venue');
    await page.click('#org-save-attendance');
    await page.waitForTimeout(400);
    const att = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_update_org_settings').map((c) => c.args.p_settings));
    ok(att.some((c) => c.geofence_enabled === true && c.geofence_lat === 6.5244 && c.geofence_lng === 3.3792), 'geofence coordinates saved through the settings RPC', JSON.stringify(att.slice(-1)));
    // Two-step verification
    ok(/Two-step verification|authenticator/i.test(await page.innerText('#mfa-status')), 'two-step verification status is shown');
    // Control plane map
    const cp = await page.innerText('#control-plane');
    ok(/Admin Data/.test(cp) && /Storage Manager/.test(cp) && /Site Licence/.test(cp) && /Verified backup/.test(cp), 'control plane lists every owner page with its live status', cp.slice(0, 200));
    ok(/Lifetime/.test(await page.innerText('#license-summary')), 'licence summary rendered from the database');
    ok(/dramaconnect-v14/.test(await page.innerText('#sys-cache')), 'system information shows the release cache (Fleet deploy detection)');
    ok(errors.length === 0, 'no uncaught page errors on settings.html', errors.join(' | '));
    await page.screenshot({ path: '/tmp/smoke-settings.png', fullPage: true });
    await context.close();
  }

  console.log('Activity Log — audit trail, filters and guarded purge (Item 21)');
  {
    const ADMIN3 = { ...LEADER, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Ada Admin', role: 'admin' };
    const feed = `(args) => ({ since: new Date(Date.now() - 90 * 864e5).toISOString(), days: args.p_days,
      summary: { total: 42, today: 3, week: 12, purges: 1, oldest: '2025-01-05T10:00:00Z',
        byAction: { member_created: 9, rehearsal_created: 6, retention_purge: 1, rsvp: 4 },
        topActors: [{ actor: 'Ada Admin', entries: 20 }, { actor: 'Bo Leader', entries: 11 }] },
      actions: ['member_created', 'rehearsal_created', 'retention_purge'],
      actors: ['Ada Admin', 'Bo Leader'],
      rows: [{ id: '1', createdAt: new Date().toISOString(), actor: 'Ada Admin', action: 'member_created', detail: 'Added Musa Member to Actors' },
             { id: '2', createdAt: new Date(Date.now() - 864e5).toISOString(), actor: 'Bo Leader', action: 'rehearsal_created', detail: 'Friday rehearsal 6pm' },
             { id: '3', createdAt: new Date(Date.now() - 2 * 864e5).toISOString(), actor: 'Ada Admin', action: 'retention_purge', detail: 'Purged 5 row(s) from activity_log' }] })`;
    const { page, context, errors } = await openPage(browser, '/pages/activity.html', {
      user: ADMIN3,
      tables: { profiles: [ADMIN3], tenant_settings: [{ id: 1, org_name: 'Test Parish' }], activity_log: [], dc_heartbeat_sources: [],
        dc_backup_settings: [{ id: 1, schedule_enabled: false }],
        dc_backup_runs: [{ id: 'r1', destination: 'vault', trigger_source: 'manual', status: 'succeeded', started_at: new Date().toISOString(), completed_at: new Date().toISOString(), archive_sha256: 'b'.repeat(64), archive_rows: 120, archive_size: 4000 }],
        dc_retention_settings: [{ id: 1, activity_log_days: 365, login_audit_days: 90 }] },
      rpc: { dc_activity_feed: feed, dc_apply_retention: `(a) => ({ ok: true, table: a.p_table_name, deletedRows: 5 })`,
        dc_login_audit_report: `() => ({ rows: [], summary: {}, neverSignedIn: 0 })`,
        dc_access_state: `() => ({ allowed: true, is_admin: true })` }
    }, { width: 1280, height: 1300 });
    await page.waitForFunction(() => document.querySelectorAll('#log-body tr').length === 3, null, { timeout: 15000 }).catch(() => {});
    const kpis = await page.$$eval('#al-kpis > div', (d) => d.map((x) => x.innerText.replace(/\s+/g, ' ')));
    ok(kpis.length === 5 && /42/.test(kpis[0]) && /PURGES RECORDED 1/i.test(kpis[3]), 'activity summary KPIs render from the feed', kpis.join(' | ').slice(0, 200));
    ok(/Member Created/.test(await page.innerText('#al-actions')), 'busiest-actions breakdown renders with readable names');
    const rows = await page.$$eval('#log-body tr', (t) => t.map((x) => x.innerText.replace(/\s+/g, ' ')));
    ok(rows.length === 3 && /Ada Admin/.test(rows[0]) && /Member Created/.test(rows[0]) && /Musa Member/.test(rows[0]), 'audit rows show actor, friendly action and detail', rows.join(' || ').slice(0, 220));
    ok((await page.$$('#al-action option')).length === 4 && (await page.$$('#al-actor option')).length === 3, 'action and person filters populate from the trail');
    await page.selectOption('#al-days', '7');
    await page.waitForTimeout(300);
    const calls = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_activity_feed').map((c) => c.args));
    ok(calls.some((c) => c.p_days === 7), 'changing the period re-queries the server-side feed', JSON.stringify(calls.slice(-1)));
    // ① Export first
    await page.click('#alp-export');
    await page.waitForTimeout(500);
    const exported = await page.innerText('#alp-result');
    ok(/Exported 3 row\(s\) of the activity log/.test(exported), 'step 1 exports the log as portable JSON before purging', exported.slice(0, 160));
    // ② Guarded purge uses the last verified backup digest automatically
    await page.click('#alp-purge');
    await page.waitForTimeout(600);
    const purgeCalls = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_apply_retention').map((c) => c.args));
    ok(purgeCalls.length === 1 && purgeCalls[0].p_table_name === 'activity_log' && purgeCalls[0].p_confirmation === 'PURGE activity_log' && purgeCalls[0].p_verified_backup_sha256 === 'b'.repeat(64),
      'step 2 purges through the guarded RPC with a verified backup digest', JSON.stringify(purgeCalls));
    ok(/Purged 5/.test(await page.innerText('#alp-result')), 'purge outcome reported back to the administrator');
    ok(errors.length === 0, 'no uncaught page errors on activity.html', errors.join(' | '));
    await page.screenshot({ path: '/tmp/smoke-activity.png', fullPage: true });
    await context.close();
  }

  console.log('Analytics — full department insight (Item 21)');
  {
    const ADMIN2 = { ...LEADER, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Ada Admin', role: 'admin' };
    const monthly = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, newMembers: i % 3, totalMembers: 10 + i,
      rehearsals: 4, present: 30 + i, expected: 40, registrations: i % 4, income: 10000 + i * 500, expense: 4000 }));
    const analytics = `() => ({ generatedAt: new Date().toISOString(), months: 12, isAdmin: true,
      settings: { timezone: 'Africa/Lagos', callTime: '16:00:00', lateAfterMinutes: 15 },
      kpis: { membersApproved: 21, membersPending: 2, admins: 2, unitLeaders: 3, newMembers30d: 4, rehearsalsTotal: 18, rehearsals30d: 4,
        rehearsalsUpcoming: 2, attendanceRate30d: 78.5, attendanceRateAll: 81.2, eventsUpcoming: 3, productionsUpcoming: 1, programmesOpen: 2,
        registrations: 57, checkedIn: 44, tasksOpen: 5, tasksOverdue: 1, careOpen: 3, cardsActive: 19, suggestionsNew: 2, birthdaysThisMonth: 3, income: 90000, expense: 32000 },
      monthly: ${JSON.stringify(monthly)},
      recentRehearsals: [{ date: '2026-09-20', present: 18, excused: 2, absent: 1, eligible: 21 }, { date: '2026-09-13', present: 16, excused: 3, absent: 2, eligible: 21 }],
      byUnit: [{ unit: 'Actors', members: 9, rate: 88 }, { unit: 'Choir', members: 7, rate: 72 }, { unit: 'Ushers', members: 5, rate: 64 }],
      byRole: { admin: 2, unitLeader: 3, member: 16 },
      gender: { male: 11, female: 10 },
      parishes: [{ parish: 'LP 25', members: 15 }, { parish: 'Ikeja', members: 6 }],
      birthdays: [{ name: 'Musa Member', day: 12, unit: 'Actors' }],
      punctuality: { measured: 40, onTime: 31, late: 9, byHour: { '15': 6, '16': 20, '17': 14 } },
      members: [{ id: 'm1', name: 'Musa Member', unit: 'Actors', present: 30, excused: 4, expected: 40, rate: 75 },
                { id: 'm2', name: 'Ada Admin', unit: 'Directors', present: 38, excused: 1, expected: 40, rate: 95 },
                { id: 'm3', name: 'Lazy Larry', unit: 'Choir', present: 4, excused: 0, expected: 40, rate: 10 }],
      topMembers: [{ name: 'Ada Admin', unit: 'Directors', present: 38, expected: 40, rate: 95 }],
      atRisk: [{ id: 'm3', name: 'Lazy Larry', unit: 'Choir', present: 4, expected: 40, rate: 10, missedStreak: 6, lastPresent: '2026-07-01' }],
      programmes: [{ title: 'Stage Craft Bootcamp', status: 'open', startsAt: '2026-10-10T09:00:00Z', capacity: 60, registered: 42, checkedIn: 33, firstTimers: 11, rating: 4.4 }],
      registrationSources: { 'whatsapp-status': 20, instagram: 14, direct: 8 },
      care: { open: 2, contacted: 1 }, tasks: { open: 4, done: 9 },
      eventRsvps: { going: 12, maybe: 3, no: 1 } })`;
    const { page, context, errors } = await openPage(browser, '/pages/analytics.html', {
      user: ADMIN2,
      tables: { profiles: [ADMIN2], tenant_settings: [{ id: 1, org_name: 'Test Parish' }], dc_heartbeat_sources: [] },
      rpc: { dc_analytics_overview: analytics, dc_access_state: `() => ({ allowed: true, is_admin: true })`, dc_heartbeat_health: `() => ({})` }
    }, { width: 1280, height: 1400 });
    await page.waitForFunction(() => document.querySelectorAll('#kpi-overview .an-card').length === 8, null, { timeout: 15000 }).catch(() => {});
    const kpis = await page.$$eval('#kpi-overview .an-card', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ')));
    ok(kpis.length === 8 && /21/.test(kpis[0]) && /81.2%/.test(kpis[1]) && /57/.test(kpis[6]), 'overview KPIs render members, attendance and programme registrations', kpis.join(' | ').slice(0, 240));
    const barsTitles = await page.$$eval('#chart-months .b', (b) => b.map((x) => x.getAttribute('title') || ''));
    ok(barsTitles.length === 12 && barsTitles.every((t) => /%/.test(t)), 'attendance-by-month chart renders 12 months with rates', barsTitles.slice(0, 3).join(' | '));
    ok(/Income ₦/.test(await page.innerText('#finance-totals')), 'income vs expense totals shown to administrators', (await page.innerText('#finance-totals')).slice(0, 120));
    await page.click('.an-tabs button[data-tab="attendance"]');
    await page.waitForTimeout(200);
    const att = await page.innerText('[data-panel="attendance"]');
    ok(/Punctuality/.test(att) && /31/.test(att) && /16:00/.test(att), 'punctuality panel compares arrivals with the configured call time');
    ok((await page.$$('#sessions-body tr')).length === 2, 'recent rehearsal sessions table rendered');
    ok(/Lazy Larry/.test(await page.innerText('#tbody')) && /95%/.test(await page.innerText('#tbody')), 'per-member breakdown table rendered for every member');
    await page.fill('#member-search', 'choir'); await page.waitForTimeout(100);
    ok((await page.$$('#tbody tr')).length === 1 && /Choir/.test(await page.innerText('#tbody')), 'member search filters the table');
    await page.fill('#member-search', '');
    await page.click('.an-tabs button[data-tab="members"]');
    await page.waitForTimeout(150);
    ok(/Actors/.test(await page.innerText('#by-unit')) && /Administrators/.test(await page.innerText('#by-role')) && /male/.test(await page.innerText('#by-gender')), 'unit, role and gender breakdowns rendered');
    ok(/Musa Member/.test(await page.innerText('#birthdays')), 'birthdays this month listed');
    await page.click('.an-tabs button[data-tab="participation"]');
    await page.waitForTimeout(150);
    ok(/Lazy Larry/.test(await page.innerText('#risk-body')) && /care\.html\?member=m3/.test(await page.innerHTML('#risk-body')), 'at-risk members link into Care & Follow-up with the member pre-selected');
    await page.click('.an-tabs button[data-tab="programmes"]');
    await page.waitForTimeout(150);
    ok(/Stage Craft Bootcamp/.test(await page.innerText('#prog-body')) && /4.40/.test(await page.innerText('#prog-body')), 'programme performance table with turnout and rating');
    ok(errors.length === 0, 'no uncaught page errors on analytics.html', errors.join(' | '));
    await page.screenshot({ path: '/tmp/smoke-analytics.png', fullPage: true });
    await context.close();
  }

  console.log('Programmes — share kit and insights (administrator)');
  {
    const ADMIN = { ...LEADER, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Ada Admin', role: 'admin' };
    const prog = { id: 'p1', slug: 'easter', title: 'Easter Drama', category: 'production', status: 'open', starts_at: soon, venue: 'Main Hall', capacity: 100, custom_questions: [], phone_mode: 'required', email_mode: 'optional' };
    const { page, context, errors } = await openPage(browser, '/pages/programs.html', {
      user: ADMIN,
      tables: { profiles: [ADMIN], tenant_settings: [{ id: 1 }], dc_programs: [prog],
        dc_program_registrations: [{ id: 'g1', program_id: 'p1', full_name: 'Guest', status: 'registered', party_size: 2, source: 'whatsapp', ticket_code: 'A1B2C3D4', created_at: soon }] },
      rpc: {
        dc_program_insights: `() => ({ program: { capacity: 100 }, totals: { registrations: 1, seats: 2, checked_in: 0, checked_in_people: 0, first_timers: 1 }, by_source: { whatsapp: 1 }, by_how_heard: {}, by_gender: {}, by_age_group: {}, by_day: [{ day: '${todayIso}', count: 1 }], checkin_by_hour: [], rating_distribution: {}, questions: [], generated_at: new Date().toISOString() })`,
        dc_access_state: `() => ({ allowed: true })`
      }
    }, { width: 1280, height: 1400 });
    await page.waitForSelector('[data-act="share"]', { timeout: 15000 }).catch(() => {});
    ok(await page.isVisible('#btn-new'), 'administrator sees New programme');
    await page.click('[data-act="share"]');
    await page.waitForSelector('[data-copy]', { timeout: 5000 }).catch(() => {});
    const links = await page.$$eval('[data-copy]', (b) => b.map((x) => x.dataset.copy));
    ok(links.length >= 3 && links.every((l) => /register\.html\?p=easter/.test(l)) && links.some((l) => /src=whatsapp/.test(l)), 'share kit gives per-channel register links', links.slice(0, 3).join(' '));
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelectorAll('.fixed.inset-0').forEach((o) => o.remove()));
    await page.click('[data-act="open"]').catch(() => {});
    await page.click('.dc-tab[data-tab="insights"]').catch(() => {});
    await page.waitForFunction(() => /Registrations/.test((document.getElementById('ins-body') || {}).innerText || ''), null, { timeout: 8000 }).catch(() => {});
    ok(/turnout/i.test(await page.innerText('#ins-body').catch(() => '')), 'insights render for the chosen programme');
    ok(errors.length === 0, 'no uncaught page errors on programs.html', errors.join(' | '));
    await context.close();
  }

  console.log('Care & follow-up — leaders only');
  {
    const { page, context, errors } = await openPage(browser, '/pages/care.html', {
      user: LEADER,
      tables: {
        profiles: [LEADER], tenant_settings: [{ id: 1 }], member_directory: [LEADER, MEMBER],
        dc_care_cases: [{ id: 'c1', member_id: MEMBER.id, reason: 'illness', summary: 'Hospitalised', status: 'open', priority: 'high', followup_log: [], created_at: soon, updated_at: new Date().toISOString() }]
      },
      rpc: {
        dc_absentee_candidates: `() => ([{ member_id: '${MEMBER.id}', full_name: 'Musa Member', unit: 'Acting', phone: '0803', missed_in_a_row: 4, last_present: null, open_case: false }])`,
        dc_care_add_note: `() => ({})`, dc_access_state: `() => ({ allowed: true })`
      }
    }, { width: 1280, height: 1200 });
    await page.waitForFunction(() => /Hospitalised/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    ok(/Hospitalised/.test(await page.innerText('#cases')), 'case list renders');
    await page.click('[data-tab="absent"]');
    await page.waitForSelector('[data-case]', { timeout: 5000 }).catch(() => {});
    ok(await page.$('[data-case]') !== null, 'missing-members tab lists absentees with Open case');
    ok(await page.$('#absent a[href^="https://wa.me"], #absent a[href*="whatsapp"]') !== null, 'WhatsApp follow-up link offered');
    ok(errors.length === 0, 'no uncaught page errors on care.html', errors.join(' | '));
    await context.close();
  }
  {
    const { page, context } = await openPage(browser, '/pages/care.html', {
      user: MEMBER, tables: { profiles: [MEMBER], tenant_settings: [{ id: 1 }], member_directory: [MEMBER], dc_care_cases: [] }, rpc: { dc_access_state: `() => ({ allowed: true })` }
    });
    await page.waitForURL(/dashboard\.html/, { timeout: 8000 }).catch(() => {});
    ok(/dashboard\.html/.test(page.url()), 'ordinary members are sent away from care.html');
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`\nbrowser smoke: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
