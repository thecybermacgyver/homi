// Service worker outage acceptance. Self-contained: needs no Homi stack and no
// database. It serves the real apps/web/public/sw.js from a throwaway localhost
// server, lets an installed "device" (one Chromium page) cache the app shell,
// then makes the server fail the ways a real outage does:
//   - a proxy error page (Cloudflare answers 521/522/502 when the origin is down)
//   - an origin that accepts the connection but never answers
// and checks the installed app still opens from its saved copy. The old worker
// only fell back to the saved copy when the network call itself threw, so a
// 5xx error page was shown instead of Homi. Also checks it does not mask a
// genuine 404, and that a healthy server still refreshes the saved copy.
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
  const state={mode:'up',version:'v1'};
  const server=http.createServer(async(req,res)=>{
    if(state.mode==='hang')return; // never answers; the worker must give up
    if(state.mode==='cf521'||state.mode==='cf522'||state.mode==='bad502'){
      res.writeHead({cf521:521,cf522:522,bad502:502}[state.mode],{'content-type':'text/html'});
      return res.end('<h1>Web server is down</h1>Error from the proxy in front of Homi');
    }
    if(req.url.startsWith('/sw.js')){res.writeHead(200,{'content-type':'application/javascript','cache-control':'no-store'});return res.end(SW);}
    if(req.url.startsWith('/assets/')){res.writeHead(200,{'content-type':'text/javascript'});return res.end('window.__app=1');}
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
    ctx.state.version='v2';
    await ctx.page.goto(ctx.url);
    assert.ok((await ctx.text()).includes('HOMI APP SHELL v2'));
    await expectShell(ctx,'cf521','refresh');
    assert.ok((await ctx.text()).includes('HOMI APP SHELL v2'),'the saved copy must be the last one a healthy server delivered');
    pass('a healthy server refreshes the saved copy, so an outage shows the newest shell');
  });
  console.log(`\nAll ${results.length} service worker outage checks passed.`);
}catch(e){console.error('FAIL',e.message);process.exitCode=1;}
