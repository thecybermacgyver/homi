// Regenerates the README screenshots in docs/assets from invented data, so no
// real household information is ever published. Run only against an isolated
// localhost stack whose owner account is a fixture (HOMI_TEST_CREDENTIALS with
// HOMI_BOOTSTRAP_EMAIL and HOMI_OWNER_PASSWORD) and Calendar/Chequebook enabled.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const base=process.env.HOMI_TEST_URL ?? 'http://localhost:3400';
if(new URL(base).hostname!=='localhost')throw new Error('Screenshots require the isolated localhost test stack');
const ASSETS=new URL('../../../docs/assets/',import.meta.url).pathname;
const today=new Date(),month=today.toISOString().slice(0,7);
const day=d=>`${month}-${String(d).padStart(2,'0')}`;

const browser=await chromium.launch({headless:true});
async function page(options){const ctx=await browser.newContext(options);const p=await ctx.newPage();
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

try{
  const p=await page({viewport:{width:1440,height:960}});

  // SCREENSHOTS_ONLY=1 retakes the images without adding the invented data again.
  if(!process.env.SCREENSHOTS_ONLY){
  for(const m of (await api(p,'core/modules')).body.data.modules){
    if(!m.enabled){const r=await api(p,'core/modules/'+m.moduleKey,'PATCH',{enabled:true,baseRevision:m.revision});assert.equal(r.status,200,JSON.stringify(r.body));}
  }

  // Invented Chequebook data for the current month.
  const setup=await api(p,'modules/chequebook/setup','PUT',{currency:'CAD',accountName:'Household chequing',openingBalance:'2500.00',openingDate:day(1)});
  assert.equal(setup.status,200,JSON.stringify(setup.body));
  const accountId=setup.body.data.accounts[0].id,categories=setup.body.data.categories;
  const category=(kind,...names)=>(categories.find(c=>c.kind===kind&&names.some(n=>c.name.toLowerCase().includes(n)))??categories.find(c=>c.kind===kind)).id;
  for(const [kind,amount,description,payee,date,cat] of [
    ['income','1850.00','Paycheque','Employer Inc.',day(15),category('income','salary','pay','income')],
    ['expense','1200.00','Rent','Maple Property Co.',day(1),category('expense','hous','rent')],
    ['expense','142.36','Groceries','Corner Market',day(12),category('expense','grocer','food')],
    ['expense','65.00','Internet','Fibre Co.',day(9),category('expense','util','bill')],
  ])await mutate(p,'chequebook','transaction','create',{kind,accountId,transferAccountId:null,categoryId:cat,personId:null,amount,description,payee,date,cleared:true,reconciledAt:null,notes:null,recurringRuleId:null,recurringOccurrenceDate:null,calendarLinkEnabled:false});

  // Invented Calendar events for the current month.
  const calendars=await api(p,'modules/calendar/calendars');const calendarId=calendars.body.data[0].id;
  const configured=await api(p,'modules/calendar/setup','PUT',{defaultView:'month',weekStart:'sunday',timeZone:'America/Toronto',defaultReminder:'none',defaultCalendarId:calendarId});
  assert.equal(configured.status,200,JSON.stringify(configured.body));
  for(const [title,d,hour] of [['Soccer practice',8,22],['Dentist appointment',16,14],['Book club',24,23],['Recycling day',30,12]])
    await mutate(p,'calendar','event','create',{calendarId,title,description:null,allDay:false,timeZone:'America/Toronto',startsAt:`${day(d)}T${hour}:00:00.000Z`,endsAt:`${day(d)}T${hour}:45:00.000Z`,startDate:null,endDateExclusive:null,location:null,notes:null,recurrence:null,recurrenceOverrides:[],personIds:[],reminderMinutes:[],transport:{mode:'none',pickupPersonId:null,dropoffPersonId:null,notes:null}});

  // Invented Shopping items for the list card.
  for(const [name,store] of [['Milk','Corner Market'],['Apples','Corner Market'],['Bread','Corner Market'],['Batteries','Hardware Store']])
    await mutate(p,'shopping','item','create',{name,quantity:'1',store,aisle:'',assignedTo:null,checked:false});
  }
  await p.reload();await p.waitForLoadState('networkidle');
  // Every card at its module's default size, in Homi's own arrangement.
  const dashboard=async q=>{
    await q.getByRole('button',{name:'Dashboard',exact:true}).first().click();
    await q.locator('[data-family-board-card="chequebook:current-balance"] .cheq-board-figure').getByText(/\$[0-9]/).waitFor({timeout:30000});
    await q.locator('[data-family-board-card="calendar:today-count"] .cal-board-count').waitFor();
    await q.waitForTimeout(1500);};
  await dashboard(p);await p.screenshot({path:ASSETS+'homi-dashboard-desktop.png'});

  const phone=await page({viewport:{width:390,height:846},deviceScaleFactor:945/390,isMobile:true,hasTouch:true});
  await dashboard(phone);await phone.screenshot({path:ASSETS+'homi-dashboard-phone.jpg',type:'jpeg',quality:88});

  await p.setViewportSize({width:1001,height:1204});
  await p.locator('[data-family-board-card="chequebook:current-balance"] article').click();await p.getByText('Corner Market').first().waitFor({timeout:30000});await p.waitForTimeout(1500);
  await p.screenshot({path:ASSETS+'homi-chequebook-desktop.png'});
  await p.getByRole('button',{name:'Dashboard',exact:true}).first().click();
  await p.locator('[data-family-board-card="calendar:mini-month"] article').click();await p.getByText('Book club').first().waitFor({timeout:30000});await p.waitForTimeout(1500);
  await p.screenshot({path:ASSETS+'homi-calendar-desktop.png'});
  console.log('PASS_README_SCREENSHOTS_FROM_INVENTED_DATA');
}finally{await browser.close();}
