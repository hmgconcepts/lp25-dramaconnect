#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.LP25_URL || 'http://127.0.0.1:4174/pages/site-license.html?restricted=license_expired';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
await page.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({
  contentType: 'application/javascript',
  body: `
    (() => {
      const member = { id: '00000000-0000-4000-8000-000000000001', email: 'member@example.test', full_name: 'Browser Member', role: 'member', status: 'approved', is_unit_leader: false };
      const license = { id: 1, license_model: 'subscription', license_status: 'expired', plan_name: 'Browser Annual', licensed_to: 'Browser Theatre', starts_on: '2026-01-01', expires_on: '2026-08-01', grace_days: 7, renewal_url: 'https://billing.example.test/renew', support_email: 'support@example.test', public_message: 'Renew to restore member access.', registry_url: null };
      const state = { allowed: false, reason: 'license_expired', lockdownEnabled: false, lockdownMessage: '', idleTimeoutMinutes: 30, schemaVersion: '14.0', license: { status: 'expired', message: license.public_message } };
      const tableData = table => table === 'profiles' ? member : table === 'dc_site_license' ? license : table === 'tenant_settings' ? null : [];
      function query(table) {
        const result = () => ({ data: tableData(table), error: null, count: 0 });
        const chain = new Proxy({}, { get(_target, prop) {
          if (prop === 'then') return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
          if (prop === 'maybeSingle' || prop === 'single') return async () => result();
          return () => chain;
        }});
        return chain;
      }
      const client = {
        auth: {
          getUser: async () => ({ data: { user: member }, error: null }),
          getSession: async () => ({ data: { session: { user: member } }, error: null }),
          signOut: async () => ({ error: null })
        },
        from: table => query(table),
        rpc: async name => ({ data: name === 'dc_access_state' ? state : null, error: null })
      };
      window.supabase = { createClient: () => client };
    })();`
}));

try {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.getElementById('plan-name')?.textContent === 'Browser Annual');
  assert.equal(await page.locator('#restricted-banner').isVisible(), true);
  assert.match(await page.locator('#restricted-message').textContent(), /Renew to restore member access/);
  assert.equal(await page.locator('#model-label').textContent(), 'Subscription license');
  assert.equal(await page.locator('#status-pill').textContent(), 'expired');
  assert.equal(await page.locator('#admin-editor').isVisible(), false);
  assert.equal(await page.locator('a[href="site-license.html"]').count() > 0, true);
  assert.equal(await page.locator('a[href="settings.html"]').count(), 0);
  assert.equal(page.url(), url);
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  console.log('Playwright restricted-license recovery surface: PASS');
} finally {
  await browser.close();
}
