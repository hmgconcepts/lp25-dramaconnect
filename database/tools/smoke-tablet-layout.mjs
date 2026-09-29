#!/usr/bin/env node
/**
 * Tablet layout regression (Item 19 live bug, 24 Sep 2026).
 * Emulates the reporter's Android tablet (1280x800, DPR 1.5, mobile UA) on
 * every page that has #app-sidebar, with the Tailwind CDN allowed and blocked,
 * and asserts the sidebar sits BESIDE the content (not stacked above it) and
 * that the Site License status pill is not stretched, and that the floating
 * Page-guide button never covers the sidebar footer (Sign Out / Powered by).
 *   npx playwright install --with-deps chromium && npm run smoke:tablet
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises'; import path from 'node:path';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..'), ORIGIN='https://dc.test';
const src=await fs.readFile(root+'/tools/smoke-browser-cards.mjs','utf8');
const fakeSrc=src.slice(src.indexOf('function fakeSupabase()'), src.indexOf('async function openPage'));
const ADMIN={ id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name:'Ada Admin', email:'a@x.io', role:'admin', status:'approved', unit:'Acting', is_unit_leader:true };
const pages=(await fs.readdir(root+'/pages')).filter(f=>f.endsWith('.html'));
const b=await chromium.launch(); let bad=0, n=0;
for (const cdn of [false,true]) for (const f of pages) {
  const html=await fs.readFile(`${root}/pages/${f}`,'utf8'); if(!html.includes('id="app-sidebar"')) continue; n++;
  const ctx=await b.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1.5,isMobile:true,hasTouch:true,serviceWorkers:'block',
    userAgent:'Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'});
  await ctx.route('**/*', async r=>{const u=new URL(r.request().url());
    if(u.origin===ORIGIN){try{const p=path.join(root,decodeURIComponent(u.pathname));const body=await fs.readFile(p);return r.fulfill({status:200,body,contentType:p.endsWith('.html')?'text/html':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}}
    if(cdn && /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/.test(u.host)) return r.continue().catch(()=>r.fulfill({status:200,body:''}));
    if(/supabase-js/.test(u.href)) return r.fulfill({status:200,contentType:'application/javascript',body:`(${fakeSrc.replace(/^function fakeSupabase\(\)/,'function()')})();`});
    if(/\.css(\?|$)/.test(u.pathname)) return r.fulfill({status:200,contentType:'text/css',body:''});
    return r.fulfill({status:200,contentType:'application/javascript',body:''});});
  const page=await ctx.newPage();
  await page.addInitScript(a=>{window.__DC_FAKE={user:a,tables:{profiles:[a],tenant_settings:[{id:1,org_name:'Test'}],dc_site_license:[{id:1,license_model:'lifetime',license_status:'active',plan_name:'Lifetime',licensed_to:'Test'}]},rpc:{dc_access_state:"()=>({allowed:true,is_admin:true})"}};},ADMIN);
  await page.goto(ORIGIN+'/pages/'+f,{waitUntil:'load'}).catch(()=>{}); await page.waitForTimeout(cdn?1500:600);
  const g=await page.evaluate(()=>{const s=document.getElementById('app-sidebar')?.firstElementChild||document.getElementById('app-sidebar');const m=document.querySelector('main');const sr=s.getBoundingClientRect(),mr=m?m.getBoundingClientRect():null;
    const pill=document.getElementById('status-pill');return {sw:Math.round(sr.width),sr:Math.round(sr.right),ml:mr&&Math.round(mr.left),mt:mr&&Math.round(mr.top),pillH:pill?Math.round(pill.getBoundingClientRect().height):null,helpL:(()=>{const h=document.getElementById('dc-page-help-btn');return h?Math.round(h.getBoundingClientRect().left):null;})()};});
  const ok=g.mt!==null && g.mt<120 && g.ml>=g.sr-2 && g.sw>150 && (g.pillH===null||g.pillH<60) && (g.helpL===null||g.helpL>=g.sr);
  if(!ok){bad++;console.log('FAIL',cdn?'cdn':'offline',f,JSON.stringify(g));}
  if(f==='site-license.html'&&cdn) await page.screenshot({path:'/tmp/tab-site-license.png'});
  await ctx.close();
}
await b.close(); console.log(`tablet layout: ${n-bad}/${n} OK`); if (bad) process.exit(1);
