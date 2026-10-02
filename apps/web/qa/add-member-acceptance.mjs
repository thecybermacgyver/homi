// Browser acceptance for an administrator adding a household member. Run only
// against an isolated localhost stack whose bootstrap owner is the
// administrator (HOMI_TEST_CREDENTIALS with HOMI_BOOTSTRAP_EMAIL and
// HOMI_BOOTSTRAP_PASSWORD). All data is invented.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const base=process.env.HOMI_TEST_URL??'http://localhost:3400',PROFILES=process.env.HOMI_TEST_PROFILES;
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const run=Date.now().toString().slice(-6),NAME='Casey Example '+run,EMAIL=`casey${run}@example.invalid`;
const contexts=[],errors=[],results=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
async function launch(label,width=390){mkdirSync(PROFILES,{recursive:true});const ctx=await chromium.launchPersistentContext(PROFILES+'/'+label+'-'+run,{headless:true,viewport:{width,height:900},executablePath:process.env.HOMI_TEST_CHROME??undefined});contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(label+': '+e.message));return {ctx,p};}
async function poll(fn,message,seconds=45){let last;for(let i=0;i<seconds;i++){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
// Better Auth limits sign-in attempts per address, so wait out the limit and retry.
async function attempt(d,email,password){
  for(let tries=0;tries<6;tries++){
    await d.p.goto(base);const field=d.p.getByLabel('Password',{exact:true});await field.waitFor({timeout:30000});
    await d.p.getByLabel('Email',{exact:true}).fill(email);await field.fill(password);await d.p.getByRole('button',{name:'Sign in',exact:true}).click();
    await d.p.locator('.homi-ui-notice, .homi-platform-auth h1:text-is("Choose a new password")').or(d.p.getByRole('button',{name:'Settings',exact:true}).first()).first().waitFor({timeout:30000});
    if(!(await d.p.getByText('Too many requests',{exact:false}).count()))return;await d.p.waitForTimeout(12000);
  }
  throw new Error('Sign-in stayed rate limited');
}
const signedIn=d=>d.p.getByRole('button',{name:'Settings',exact:true}).first().waitFor({timeout:30000});
async function settings(d){await d.p.getByRole('button',{name:'Settings',exact:true}).first().click();await d.p.getByRole('button',{name:'Change password',exact:true}).first().waitFor();}
const members=d=>d.p.locator('.homi-platform-members');
async function rows(d,store){return d.p.evaluate(async store=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('homi-client');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return await new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>{db.close();res(r.result)};r.onerror=()=>rej(r.error);});},store);}
async function addViaApi(d,body){const id=JSON.parse((await rows(d,'meta')).find(r=>r.key==='activeOfflineContext').value);return d.p.evaluate(async({id,body})=>{const r=await fetch('/api/v1/core/household/members',{method:'POST',headers:{'Content-Type':'application/json','X-Homi-Household-ID':id.householdId,'X-Homi-Client-ID':id.clientId},body:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};},{id,body});}
try{
  const owner=await launch('owner'),ownerWide=await launch('owner-wide',1440);
  await attempt(owner,env.HOMI_BOOTSTRAP_EMAIL,env.HOMI_BOOTSTRAP_PASSWORD);await signedIn(owner);
  await settings(owner);await members(owner).waitFor({timeout:30000});await poll(async()=>await members(owner).locator('li').count()>=1,'member list');
  const before=await members(owner).locator('li').count();
  // 1. Add a member from Settings
  await members(owner).getByRole('button',{name:'Add member',exact:true}).first().click();
  const form=owner.p.locator('form',{has:owner.p.locator('#homi-new-member-name')});
  const temporary=await form.locator('#homi-new-member-password').inputValue();
  assert.match(temporary,/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){2}-[A-Za-z2-9]{2}$/);
  await form.locator('#homi-new-member-name').fill(NAME);await form.locator('#homi-new-member-email').fill(EMAIL.toUpperCase());
  await owner.p.screenshot({path:ROOT+'add-member-sheet-390.png',fullPage:true});
  await form.getByRole('button',{name:'Add member',exact:true}).click();
  const issued=owner.p.locator('.homi-platform-members__password');await issued.waitFor({timeout:30000});
  assert.equal(await issued.innerText(),temporary);
  await members(owner).getByText(EMAIL,{exact:false}).first().waitFor();
  await poll(async()=>await members(owner).locator('li').count()===before+1,'new member listed');
  await members(owner).locator('li',{hasText:NAME}).getByText('Must choose a new password').waitFor();
  pass('an administrator adds a member by name and email; Homi shows the temporary password once and lists them as needing to choose a new password (email stored lower-case)');
  // 2. Rejections
  const dup=await addViaApi(owner,{displayName:'Duplicate',email:EMAIL,temporaryPassword:'another-pass-1234'});assert.equal(dup.status,409);assert.equal(dup.body.error.code,'MEMBER_EMAIL_IN_USE');
  const shortPw=await addViaApi(owner,{displayName:'Short',email:`short${run}@example.invalid`,temporaryPassword:'short'});assert.equal(shortPw.status,400);assert.equal(shortPw.body.error.code,'PASSWORD_LENGTH_INVALID');
  const badEmail=await addViaApi(owner,{displayName:'Bad',email:'not-an-email',temporaryPassword:'another-pass-1234'});assert.equal(badEmail.status,400);assert.equal(badEmail.body.error.code,'MEMBER_EMAIL_INVALID');
  const noName=await addViaApi(owner,{displayName:'   ',email:`blank${run}@example.invalid`,temporaryPassword:'another-pass-1234'});assert.equal(noName.status,400);
  assert.equal(await members(owner).locator('li').count(),before+1);
  pass('a duplicate email, a short password, an invalid email and a blank name are all refused, and nothing is created');
  // 3. The new member signs in with the temporary password and must choose their own
  const member=await launch('member');
  await attempt(member,EMAIL,temporary);await member.p.getByRole('heading',{name:'Choose a new password',exact:true}).waitFor({timeout:30000});
  assert.equal(await member.p.getByRole('button',{name:'Settings',exact:true}).count(),0);
  const chosen='casey-chosen-password-1';
  await member.p.locator('#homi-password-current').fill(temporary);await member.p.locator('#homi-password-new').fill(chosen);await member.p.locator('#homi-password-confirm').fill(chosen);
  await member.p.getByRole('button',{name:'Save and continue',exact:true}).click();await signedIn(member);
  await settings(member);await member.p.waitForTimeout(3000);assert.equal(await members(member).count(),0);
  pass('the new member signs in with their email and the temporary password, is made to choose their own password, then enters the household as a regular member (no Members section)');
  // 4. A regular member cannot add members
  const forbidden=await addViaApi(member,{displayName:'Nope',email:`nope${run}@example.invalid`,temporaryPassword:'another-pass-1234'});assert.equal(forbidden.status,403);
  pass('a regular member cannot add members (403)');
  // 5. Temporary password is spent; the chosen one works on another device
  const fresh=await launch('member-fresh');
  await attempt(fresh,EMAIL,temporary);await fresh.p.getByText('Sign in needs attention').waitFor({timeout:30000});
  await attempt(fresh,EMAIL,chosen);await signedIn(fresh);
  pass('the temporary password stops working and the chosen password signs in on another device');
  // 6. Layout and errors
  await owner.p.reload();await settings(owner);await poll(async()=>await members(owner).locator('li',{hasText:NAME}).count()===1,'owner sees the member after reload');
  assert.equal(await members(owner).locator('li',{hasText:NAME}).getByText('Must choose a new password').count(),0);
  await attempt(ownerWide,env.HOMI_BOOTSTRAP_EMAIL,env.HOMI_BOOTSTRAP_PASSWORD);await settings(ownerWide);await ownerWide.p.screenshot({path:ROOT+'add-member-settings-1440.png',fullPage:true});
  for(const [d,width] of [[owner,390],[ownerWide,1440]]){await d.p.setViewportSize({width,height:900});await settings(d);assert.equal(await d.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  pass('Settings with Add member fits phone and desktop widths without horizontal scrolling');
  assert.deepEqual(errors,[]);pass('no JavaScript page errors');
  writeFileSync(ROOT+'add-member-acceptance.json',JSON.stringify({date:new Date().toISOString(),run,results},null,2));
}catch(e){console.error(e);for(const [i,ctx]of contexts.entries()){try{const p=ctx.pages()[0];if(p){console.log('PAGE',i,(await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,500));}}catch{}}process.exitCode=1;}finally{for(const ctx of contexts)await ctx.close().catch(()=>{});}
