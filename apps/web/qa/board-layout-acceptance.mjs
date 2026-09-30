// Browser acceptance for arranging Family Board cards. Run only against an
// isolated localhost stack whose owner is a fixture account
// (HOMI_TEST_CREDENTIALS with HOMI_BOOTSTRAP_EMAIL and HOMI_OWNER_PASSWORD)
// and Calendar, Chequebook and Shopping installed. All data is invented.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const base=process.env.HOMI_TEST_URL ?? 'http://localhost:3400';
if(new URL(base).hostname!=='localhost')throw new Error('Board layout acceptance requires the isolated localhost test stack');
const OUT=process.env.HOMI_QA_OUT ?? new URL('.',import.meta.url).pathname;
const today=new Date(),month=today.toISOString().slice(0,7);
const day=d=>`${month}-${String(d).padStart(2,'0')}`;
const results=[];
const pass=(name,detail={})=>{results.push({name,...detail});console.log('PASS',name,JSON.stringify(detail));};

const browser=await chromium.launch({headless:true});
async function page(options){const ctx=await browser.newContext(options);const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('PAGE_ERROR',e.message));
  await p.goto(base);await p.waitForLoadState('networkidle');
  for(let tries=0;tries<6&&await p.getByLabel('Password',{exact:true}).count();tries++){
    await p.getByLabel('Email',{exact:true}).fill(env.HOMI_BOOTSTRAP_EMAIL);await p.getByLabel('Password',{exact:true}).fill(env.HOMI_OWNER_PASSWORD);
    await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForTimeout(3000);
    if(await p.getByText('Too many requests',{exact:false}).count()){await p.waitForTimeout(12000);await p.goto(base);}
  }
  await p.getByRole('button',{name:'Settings',exact:true}).first().waitFor({timeout:30000});return p;}
async function identity(p){return p.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('homi-client');q.onsuccess=()=>r(q.result);});return await new Promise(r=>{const q=db.transaction('meta').objectStore('meta').getAll();q.onsuccess=()=>r(JSON.parse(q.result.find(x=>x.key==='activeOfflineContext').value));});});}
async function api(p,path,method='GET',body){const id=await identity(p);return p.evaluate(async({path,method,body,id})=>{const r=await fetch('/api/v1/'+path,{method,headers:{'Content-Type':'application/json','X-Homi-Household-ID':id.householdId,'X-Homi-Client-ID':id.clientId},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};},{path,method,body,id});}
async function mutate(p,moduleKey,entityType,operation,payload,entityId=crypto.randomUUID(),baseRevision='0'){const r=await api(p,'core/sync/mutations','POST',{clientMutationId:crypto.randomUUID(),moduleKey,entityType,entityId,operation,baseRevision,payload});assert.equal(r.body.data?.status,'applied',JSON.stringify(r.body));return r.body.data;}
const preferences=async p=>(await api(p,'core/module-preferences')).body.data.preferences;
const cardKey=preference=>`${preference.moduleKey}:${preference.surfaceId}`;
// Declared by Calendar 0.6.11, Chequebook 0.1.15 and Shopping 0.3.1: [default, min] in wide units.
const SIZES={
  'calendar:today-count':[[2,2],[2,2]],'calendar:coming-week':[[3,4],[2,3]],'calendar:mini-month':[[3,5],[2,4]],
  'chequebook:current-balance':[[2,2],[2,2]],'chequebook:monthly-spend':[[2,2],[2,2]],'chequebook:cash-flow-forecast':[[2,2],[2,2]],
  'shopping:shopping-list':[[3,5],[2,3]],
};
const phoneWidth=w=>w<=2?w:4;

// Reads each card's grid cell from the rendered board.
async function board(p){
  return p.$$eval('[data-family-board-card]',cells=>Object.fromEntries(cells.map(cell=>{
    const [x,w]=cell.style.gridColumn.split(' / span ').map(Number);
    const [y,h]=cell.style.gridRow.split(' / span ').map(Number);
    return [cell.dataset.familyBoardCard,{x:x-1,y:y-1,w,h}];
  })));
}
function assertNoOverlaps(cards,columns){
  const list=Object.entries(cards);
  for(const [key,c] of list){assert(c.x>=0&&c.x+c.w<=columns,`${key} is off the ${columns}-column board`);}
  list.forEach(([ak,a],i)=>list.slice(i+1).forEach(([bk,b])=>assert(!(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h),`${ak} overlaps ${bk}`)));
}
async function steps(p){
  return p.$eval('.homi-family-board__grid',grid=>{const s=getComputedStyle(grid);const cols=Number(s.getPropertyValue('--homi-board-columns'));
    const gap=parseFloat(s.columnGap),row=parseFloat(s.getPropertyValue('--homi-board-row'));const r=grid.getBoundingClientRect();
    return {cols,column:(r.width-gap*(cols-1))/cols+gap,row:row+parseFloat(s.rowGap)};});
}
async function drag(p,from,dx,dy){
  const box=await from.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
  await p.mouse.move(x,y);await p.mouse.down();
  for(let i=1;i<=8;i++)await p.mouse.move(x+dx*i/8,y+dy*i/8);
  await p.mouse.up();
}
async function post0(p,target,payload){const current=(await preferences(p)).find(pref=>pref.id===target.id);return api(p,'core/sync/mutations','POST',{clientMutationId:crypto.randomUUID(),moduleKey:'core',entityType:'member-module-preference',entityId:current.id,operation:'update',baseRevision:current.revision,payload});}
async function settle(p){await p.waitForTimeout(1500);await p.waitForLoadState('networkidle');}

try{
  const p=await page({viewport:{width:1440,height:1000}});

  if(!process.env.SKIP_SEED){
    for(const m of (await api(p,'core/modules')).body.data.modules){
      if(!m.enabled){const r=await api(p,'core/modules/'+m.moduleKey,'PATCH',{enabled:true,baseRevision:m.revision});assert.equal(r.status,200,JSON.stringify(r.body));}
    }
    const setup=await api(p,'modules/chequebook/setup','PUT',{currency:'CAD',accountName:'Household chequing',openingBalance:'2500.00',openingDate:day(1)});
    assert.equal(setup.status,200,JSON.stringify(setup.body));
    const calendars=await api(p,'modules/calendar/calendars');const calendarId=calendars.body.data[0].id;
    const configured=await api(p,'modules/calendar/setup','PUT',{defaultView:'month',weekStart:'sunday',timeZone:'America/Toronto',defaultReminder:'none',defaultCalendarId:calendarId});
    assert.equal(configured.status,200,JSON.stringify(configured.body));
    const now=new Date();
    for(const [title,offsetHours] of [['Soccer practice',1],['Book club',3]]){
      const starts=new Date(now.getTime()+offsetHours*3600e3);
      await mutate(p,'calendar','event','create',{calendarId,title,description:null,allDay:false,timeZone:'America/Toronto',startsAt:starts.toISOString(),endsAt:new Date(starts.getTime()+45*60e3).toISOString(),startDate:null,endDateExclusive:null,location:null,notes:null,recurrence:null,recurrenceOverrides:[],personIds:[],reminderMinutes:[],transport:{mode:'none',pickupPersonId:null,dropoffPersonId:null,notes:null}});
    }
    for(const [name,store] of [['Milk','Corner Market'],['Bread','Corner Market'],['Batteries','Hardware Store']])
      await mutate(p,'shopping','item','create',{name,quantity:'1',store,aisle:'',assignedTo:null,checked:false});
  }
  await p.reload();await p.locator('[data-family-board-card]').first().waitFor();await settle(p);

  // 1. Unplaced cards are packed on the 8-column wide grid.
  let prefs=await preferences(p);
  assert(prefs.every(pref=>pref.phoneLayout===null&&pref.wideLayout===null),'fresh member has no saved placements');
  const initial=await board(p);
  const keys=Object.keys(initial);
  assert.equal(keys.length,prefs.filter(pref=>pref.visible).length);
  assertNoOverlaps(initial,8);
  for(const key of keys)assert.deepEqual([initial[key].w,initial[key].h],SIZES[key][0],`${key} starts at its declared size`);
  assert.deepEqual([initial[keys[0]].x,initial[keys[0]].y],[0,0]);
  await p.screenshot({path:OUT+'board-wide-default-1440.png',fullPage:true});
  pass('wide board packs unplaced cards',{cards:keys.length});

  // 2. Outside arranging, a card opens its module.
  await p.locator(`[data-family-board-card="${keys[0]}"] article`).click();
  await p.getByRole('button',{name:'Dashboard',exact:true}).first().waitFor();
  assert.equal(await p.locator('.homi-family-board').count(),0,'card opens its module page');
  await p.getByRole('button',{name:'Dashboard',exact:true}).first().click();
  await p.locator('[data-family-board-card]').first().waitFor();
  pass('card opens its module when not arranging');

  // 3. Drag the first card two columns right and six rows down, leaving its
  //    old space empty; every card is then saved where it is shown.
  await p.getByRole('button',{name:'Arrange cards'}).click();
  await p.getByText('Arranging your wide-screen layout',{exact:false}).waitFor();
  assert.equal(await p.locator('.homi-family-board__editor').count(),keys.length);
  await p.screenshot({path:OUT+'board-wide-arranging-1440.png',fullPage:true});
  let step=await steps(p);
  assert.equal(step.cols,8);
  const first=keys[0];
  await drag(p,p.locator(`[data-family-board-card="${first}"] .homi-family-board__editor`),step.column*2,step.row*6);
  await settle(p);
  let shown=await board(p);
  const dropX=Math.min(initial[first].x+2,8-initial[first].w);
  assert.deepEqual(shown[first],{...initial[first],x:dropX,y:initial[first].y+6});
  assertNoOverlaps(shown,8);
  prefs=await preferences(p);
  for(const pref of prefs.filter(pref=>pref.visible)){
    assert.deepEqual(pref.wideLayout,shown[cardKey(pref)],`${cardKey(pref)} saved where shown`);
    assert.equal(pref.phoneLayout,null,'phone layout untouched');
  }
  pass('drag moves a card and saves the wide arrangement',{moved:shown[first]});

  // 4. Resize by the corner, within the card's limits (default 2x2..8x12).
  const second=keys[1];
  const before=shown[second];
  await drag(p,p.locator(`[data-family-board-card="${second}"] .homi-family-board__resize`),-step.column*2,step.row);
  await settle(p);
  shown=await board(p);
  const [minW,minH]=SIZES[second][1];
  assert.deepEqual(shown[second],{...before,w:Math.max(minW,before.w-2),h:before.h+1});
  assertNoOverlaps(shown,8);
  await drag(p,p.locator(`[data-family-board-card="${second}"] .homi-family-board__resize`),-step.column*4,-step.row*6);
  await settle(p);
  shown=await board(p);
  assert.deepEqual({w:shown[second].w,h:shown[second].h},{w:minW,h:minH},'resize stops at the minimum size');
  pass('corner resize respects limits',{resized:shown[second]});

  // 5. Keyboard: arrows move, Shift+arrows resize.
  const editor=p.locator(`[data-family-board-card="${second}"] .homi-family-board__editor`);
  await editor.focus();await p.keyboard.press('ArrowRight');await settle(p);
  await editor.focus();await p.keyboard.press('Shift+ArrowDown');await settle(p);
  const nudged=(await board(p))[second];
  assert.deepEqual(nudged,{...shown[second],x:shown[second].x+1,h:shown[second].h+1});
  pass('keyboard moves and resizes',{nudged});

  // 6. Done; the arrangement, empty spaces included, survives a reload.
  await p.getByRole('button',{name:'Done'}).click();
  assert.equal(await p.locator('.homi-family-board__editor').count(),0);
  const arranged=await board(p);
  await p.reload();await p.locator('[data-family-board-card]').first().waitFor();await settle(p);
  assert.deepEqual(await board(p),arranged);
  const vacated=initial[first];
  const occupied=Object.values(arranged).some(c=>c.x<vacated.x+vacated.w&&vacated.x<c.x+c.w&&c.y<vacated.y+vacated.h&&vacated.y<c.y+c.h);
  assert.equal(occupied,false,'the space the first card left stays empty');
  await p.screenshot({path:OUT+'board-wide-arranged-1440.png',fullPage:true});
  pass('arrangement persists with its empty space');

  // 7. Core validates placements over HTTP.
  const target=prefs.find(pref=>cardKey(pref)===second);
  const maxTooBig=await post0(p,target,{wideLayout:{x:0,y:40,w:8,h:12}});
  assert.equal(maxTooBig.body.data.status,'rejected');assert.equal(maxTooBig.body.data.errorCode,'MODULE_PREFERENCE_LAYOUT_OUT_OF_BOUNDS');
  const current=(await preferences(p)).find(pref=>pref.id===target.id);
  const post=payload=>api(p,'core/sync/mutations','POST',{clientMutationId:crypto.randomUUID(),moduleKey:'core',entityType:'member-module-preference',entityId:current.id,operation:'update',baseRevision:current.revision,payload});
  let r=await post({wideLayout:{x:7,y:0,w:2,h:2}});
  assert.equal(r.status,400);assert.equal(r.body.error.code,'VALIDATION_FAILED');
  r=await post({phoneLayout:{x:0,y:0,w:2,h:2},extra:1});
  assert.equal(r.status,400);
  r=await post({wideLayout:{x:0,y:40,w:1,h:2}});
  assert.equal(r.body.data.status,'rejected');assert.equal(r.body.data.errorCode,'MODULE_PREFERENCE_LAYOUT_OUT_OF_BOUNDS');
  pass('Core rejects off-board and out-of-limit placements');

  // 8. The phone layout is separate: packed from defaults, arranged alone.
  const phone=await page({viewport:{width:390,height:844},deviceScaleFactor:2});
  await phone.locator('[data-family-board-card]').first().waitFor();await settle(phone);
  const phoneInitial=await board(phone);
  assertNoOverlaps(phoneInitial,4);
  for(const [key,c] of Object.entries(phoneInitial))assert.deepEqual([c.w,c.h],[phoneWidth(SIZES[key][0][0]),SIZES[key][0][1]],`${key} phone default size`);
  await phone.screenshot({path:OUT+'board-phone-default-390.png',fullPage:true});
  await phone.getByRole('button',{name:'Arrange cards'}).click();
  await phone.getByText('Arranging your phone layout',{exact:false}).waitFor();
  const phoneStep=await steps(phone);
  assert.equal(phoneStep.cols,4);
  const phoneFirst=Object.keys(phoneInitial).find(key=>phoneInitial[key].w===4);
  await drag(phone,phone.locator(`[data-family-board-card="${phoneFirst}"] .homi-family-board__resize`),-phoneStep.column*2,-phoneStep.row);
  await settle(phone);
  let phoneShown=await board(phone);
  assert.deepEqual(phoneShown[phoneFirst],{...phoneInitial[phoneFirst],w:2,h:Math.max(SIZES[phoneFirst][1][1],phoneInitial[phoneFirst].h-1)});
  assertNoOverlaps(phoneShown,4);
  await phone.screenshot({path:OUT+'board-phone-arranging-390.png',fullPage:true});
  prefs=await preferences(phone);
  for(const pref of prefs.filter(pref=>pref.visible)){
    assert.deepEqual(pref.phoneLayout,phoneShown[cardKey(pref)],`${cardKey(pref)} phone placement saved`);
    assert.deepEqual(pref.wideLayout,arranged[cardKey(pref)],`${cardKey(pref)} wide placement unchanged`);
  }
  pass('phone layout is arranged and saved separately',{resized:phoneShown[phoneFirst]});

  // 9. Reset puts the phone layout back in Homi's order; wide is kept.
  phone.once('dialog',dialog=>dialog.accept());
  await phone.getByRole('button',{name:'Reset layout'}).click();
  await settle(phone);
  prefs=await preferences(phone);
  assert(prefs.every(pref=>pref.phoneLayout===null),'phone placements cleared');
  assert(prefs.filter(pref=>pref.visible).every(pref=>pref.wideLayout!==null),'wide placements kept');
  assert.deepEqual(await board(phone),phoneInitial);
  await phone.getByRole('button',{name:'Done'}).click();
  pass('reset clears only the current layout');

  // 10. The wide device sees the saved wide arrangement at another width.
  const tablet=await page({viewport:{width:768,height:1024}});
  await tablet.locator('[data-family-board-card]').first().waitFor();await settle(tablet);
  assert.deepEqual(await board(tablet),arranged);
  await tablet.screenshot({path:OUT+'board-wide-768.png',fullPage:true});
  pass('wide arrangement is shared by all wide screens');

  writeFileSync(OUT+'board-layout-acceptance.json',JSON.stringify({date:new Date().toISOString(),base,results},null,2)+'\n');
  console.log('PASS_BOARD_LAYOUT_ACCEPTANCE',results.length);
}catch(error){
  for(const ctx of browser.contexts())for(const [i,pg] of ctx.pages().entries())await pg.screenshot({path:OUT+`failure-${browser.contexts().indexOf(ctx)}-${i}.png`,fullPage:true}).catch(()=>{});
  throw error;
}finally{await browser.close();}
