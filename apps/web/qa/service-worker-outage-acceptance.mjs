// Service worker outage acceptance. Self-contained: needs no Homi stack and no
// database. It serves the real apps/web/public/sw.js from a throwaway localhost
// server, lets an installed "device" (one Chromium page) cache the app shell,
// then makes the server fail the ways a real outage does:
//   - a proxy error page (Cloudflare answers 521/522/502 when the origin is down)
//   - an origin that accepts the connection but never answers
// and checks the installed app still opens from its saved copy. The old worker
// only fell back to the saved copy when the network call itself threw, so a
// 5xx error page was shown instead of Homi. Homi's own API calls (session
// check, sign-in, sync) get the same treatment: a proxy HTML error page becomes
// a failed network call, which is what makes the app use its saved sign-in and
// offline data instead of showing the sign-in screen, while Homi's own JSON
// answers (401, 500) pass through untouched. Also checks it does not mask a
// genuine 404, that a healthy server still refreshes the saved copy, and that
// upgrading a device from the previous worker keeps its saved module files.
//   node apps/web/qa/service-worker-outage-acceptance.mjs
//   HOMI_TEST_CHROME=/usr/bin/google-chrome  (optional Chrome/Chromium path)
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
const SW=readFileSync(new URL('../public/sw.js',import.meta.url));
const SHELL=v=>`<!doctype html><title>Homi</title><h1 id="app">HOMI APP SHELL ${v}</h1><script src="/assets/app.js"></script><script>navigator.serviceWorker.register("/sw.js",{scope:"/"})</script>`;
const results=[];
const pass=s=>{results.push(s);console.log('PASS',s);};

async function device(run){
  const state={mode:'up',version:'v1',sw:SW};
  const server=http.createServer(async(req,res)=>{
    if(state.mode==='hang')return; // never answers; the worker must give up
    if(state.mode==='cf521'||state.mode==='cf522'||state.mode==='bad502'){
      res.writeHead({cf521:521,cf522:522,bad502:502}[state.mode],{'content-type':'text/html'});
      return res.end('<h1>Web server is down</h1>Error from the proxy in front of Homi');
    }
    if(req.url.startsWith('/sw.js')){res.writeHead(200,{'content-type':'application/javascript','cache-control':'no-store'});return res.end(state.sw);}
    if(req.url.startsWith('/api/v1/core/module-assets/')){res.writeHead(200,{'content-type':'text/javascript'});return res.end('export default "MODULE LOADED"');}
    if(req.url.startsWith('/brand/')){res.writeHead(200,{'content-type':'image/png'});return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64'));}
    if(req.url.startsWith('/assets/')){res.writeHead(200,{'content-type':'text/javascript'});return res.end('window.__app=1');}
    if(req.url.startsWith('/api/')){
      if(req.url.includes('json401')){res.writeHead(401,{'content-type':'application/json'});return res.end('{"code":"UNAUTHORIZED","message":"Sign in"}');}
      if(req.url.includes('json500')){res.writeHead(500,{'content-type':'application/json'});return res.end('{"code":"BOOM","message":"Core error"}');}
      res.writeHead(200,{'content-type':'application/json'});return res.end('{"session":{"id":"x"}}');
    }
    if(req.url==='/missing'){res.writeHead(404,{'content-type':'text/html'});return res.end('<h1>NOT FOUND PAGE</h1>');}
    res.writeHead(200,{'content-type':'text/html'});res.end(SHELL(state.version));
  }).listen(0);
  const url=`http://localhost:${server.address().port}/`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.HOMI_TEST_CHROME??undefined});
  try{
    const page=await browser.newPage();
    await page.goto(url);
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload(); // the installed worker now controls the page
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
    const text=async()=>(await page.locator('body').innerText()).replace(/\s+/g,' ').trim();
    await run({state,url,page,text});
  }finally{await browser.close();server.close();}
}

async function expectShell(ctx,mode,label){
  ctx.state.mode=mode;
  const started=Date.now();
  await ctx.page.goto(ctx.url,{timeout:30000}).catch(()=>{});
  const shown=await ctx.text();
  assert.ok(shown.includes('HOMI APP SHELL'),`${label}: expected the saved app shell, the page showed "${shown.slice(0,80)}"`);
  return (Date.now()-started)/1000;
}

try{
  await device(async ctx=>{
    await expectShell(ctx,'cf521','521');
    pass('proxy error 521 (origin down): the installed app opens from its saved copy');
    await expectShell(ctx,'cf522','522');
    pass('proxy error 522 (origin timed out): the installed app opens from its saved copy');
    await expectShell(ctx,'bad502','502');
    pass('bad gateway 502: the installed app opens from its saved copy');
  });
  await device(async ctx=>{
    const seconds=await expectShell(ctx,'hang','hang');
    assert.ok(seconds<9,`a server that never answers must not hold the app for ${seconds}s`);
    pass(`origin that never answers: the app opens from its saved copy after ${seconds.toFixed(1)}s`);
  });
  await device(async ctx=>{
    ctx.state.mode='up';
    await ctx.page.goto(`${ctx.url}missing`);
    assert.ok((await ctx.text()).includes('NOT FOUND PAGE'),'a genuine 404 must not be replaced by the saved shell');
    pass('a genuine 404 while the server is up is shown as is, not masked by the saved shell');
  });
  await device(async ctx=>{
    const call=(path,method='GET')=>ctx.page.evaluate(async([path,method])=>{
      try{const r=await fetch(path,{method,body:method==='POST'?'{}':undefined,headers:{'content-type':'application/json'}});return {ok:true,status:r.status,body:await r.text()};}
      catch(e){return {ok:false,error:String(e).slice(0,60)};}
    },[path,method]);
    ctx.state.mode='up';
    assert.equal((await call('/api/auth/get-session')).status,200);
    ctx.state.mode='cf521';
    const session=await call('/api/auth/get-session');
    assert.equal(session.ok,false,`session check during an outage must fail like a dropped network, got ${JSON.stringify(session)}`);
    pass('session check during an outage fails like a dropped network, so the app uses its saved sign-in');
    const signIn=await call('/api/auth/sign-in/email','POST');
    assert.equal(signIn.ok,false,`sign-in during an outage must fail like a dropped network, got ${JSON.stringify(signIn)}`);
    pass('sign-in during an outage fails like a dropped network, not as "not valid JSON"');
    ctx.state.mode='up';
    const j401=await call('/api/x/json401','POST');
    assert.ok(j401.ok&&j401.status===401&&j401.body.includes('UNAUTHORIZED'),'a real 401 must reach the app unchanged');
    const j500=await call('/api/x/json500');
    assert.ok(j500.ok&&j500.status===500&&j500.body.includes('BOOM'),"Homi's own JSON 500 must reach the app unchanged");
    pass("Homi's own JSON answers (401 and 500) still reach the app unchanged");
  });
  await device(async ctx=>{
    ctx.state.mode='cf521';
    for(const f of ['homi_icon.png','homi_logo.png','homi_icon_192.png','homi_icon_512.png']){
      const got=await ctx.page.evaluate(async f=>{try{const r=await fetch('/brand/'+f);return r.ok&&r.headers.get('content-type');}catch(e){return 'FAILED '+e.message.slice(0,40);}},f);
      assert.equal(got,'image/png',`${f} must be saved for offline use, got ${got}`);
    }
    pass('the header icon and the logos are saved on install, so they show during an outage');
  });
  await device(async ctx=>{
    const loadModule=()=>ctx.page.evaluate(async()=>{
      try{return (await import('/api/v1/core/module-assets/calendar/0.6.24/dist/web.js?homi_retry=1')).default;}
      catch(e){return 'FAILED '+String(e.message).slice(0,50);}
    });
    // The previous worker kept module files in the versioned shell cache and deleted that cache on upgrade.
    const legacy=Buffer.from(SW.toString().replace(/"homi-shell-v\d+"/,'"homi-shell-v0"').replaceAll('caches.open(MODULE_CACHE)','caches.open(SHELL_CACHE)'));
    ctx.state.sw=legacy;
    await ctx.page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
    await ctx.page.waitForTimeout(1500);
    assert.equal(await loadModule(),'MODULE LOADED','a module must load while the server is up');
    // a brand image the worker does not pre-save: only a page load online put it in the old cache
    assert.ok(await ctx.page.evaluate(async()=>(await fetch('/brand/extra-brand.png')).ok),'brand image must load while the server is up');
    ctx.state.sw=SW; // the device is upgraded to the current worker
    await ctx.page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
    await ctx.page.waitForTimeout(2000);
    ctx.state.mode='cf521';
    await ctx.page.goto(ctx.url).catch(()=>{});
    const offline=await loadModule();
    assert.equal(offline,'MODULE LOADED',`modules saved before a worker upgrade must still load during an outage, got ${offline}`);
    pass('a worker upgrade keeps the saved module files, so every module still loads during an outage');
    const extra=await ctx.page.evaluate(async()=>{try{const r=await fetch('/brand/extra-brand.png');return r.ok&&r.headers.get('content-type');}catch(e){return 'FAILED '+e.message.slice(0,40);}});
    assert.equal(extra,'image/png',`a brand image saved before a worker upgrade must still show during an outage, got ${extra}`);
    pass('a worker upgrade keeps saved brand images, so the Homi logo still shows during an outage');
  });
  await device(async ctx=>{
    ctx.state.version='v2';
    await ctx.page.goto(ctx.url);
    assert.ok((await ctx.text()).includes('HOMI APP SHELL v2'));
    await expectShell(ctx,'cf521','refresh');
    assert.ok((await ctx.text()).includes('HOMI APP SHELL v2'),'the saved copy must be the last one a healthy server delivered');
    pass('a healthy server refreshes the saved copy, so an outage shows the newest shell');
  });
  console.log(`\nAll ${results.length} service worker outage checks passed.`);
}catch(e){console.error('FAIL',e.message);process.exitCode=1;}
