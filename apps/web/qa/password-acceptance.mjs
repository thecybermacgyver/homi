// Browser acceptance for self-service password change and administrator reset.
// Run only against an isolated localhost stack with fixture accounts: the
// bootstrap owner (administrator) and shopping-second@example.invalid (member),
// both starting with HOMI_BOOTSTRAP_PASSWORD.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const base=process.env.HOMI_TEST_URL ?? 'http://localhost:3400',PROFILES=process.env.HOMI_TEST_PROFILES;
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const OWNER=env.HOMI_BOOTSTRAP_EMAIL,MEMBER='shopping-second@example.invalid',MEMBER_NAME='Shopping Second Member';
const contexts=[],errors=[],results=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
async function launch(label,width=390){mkdirSync(PROFILES,{recursive:true});const ctx=await chromium.launchPersistentContext(PROFILES+'/'+label,{headless:true,viewport:{width,height:900}});contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(label+': '+e.message));return {ctx,p,label};}
async function poll(fn,message,seconds=45){let last;for(let i=0;i<seconds;i++){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
async function signInForm(d){await d.p.goto(base);await d.p.waitForLoadState('networkidle');return d.p.getByLabel('Password',{exact:true});}
// Better Auth limits sign-in attempts per address (a few per 10 seconds); this
// test signs in far faster than a person, so it waits out the limit and retries.
async function attempt(d,email,password){
  for(let tries=0;tries<6;tries++){
    const field=await signInForm(d);await field.waitFor({timeout:30000});
    await d.p.getByLabel('Email',{exact:true}).fill(email);await field.fill(password);
    await d.p.getByRole('button',{name:'Sign in',exact:true}).click();
    // Wait for a real outcome: the app, the new-password screen, or an error.
    await d.p.locator('.homi-ui-notice, .homi-platform-auth h1:text-is("Choose a new password")')
      .or(d.p.getByRole('button',{name:'Settings',exact:true}).first())
      .first().waitFor({timeout:30000});
    if(!(await d.p.getByText('Too many requests',{exact:false}).count()))return;
    await d.p.waitForTimeout(12000);
  }
  throw new Error('Sign-in stayed rate limited');
}
async function signedIn(d){await d.p.getByRole('button',{name:'Settings',exact:true}).first().waitFor({timeout:30000});}
async function settings(d){await d.p.getByRole('button',{name:'Settings',exact:true}).first().click();await d.p.getByRole('button',{name:'Change password',exact:true}).first().waitFor();}
function members(d){return d.p.locator('.homi-platform-members');}
async function onSignInScreen(d){await d.p.reload();await d.p.waitForLoadState('networkidle');return await d.p.getByRole('button',{name:'Sign in',exact:true}).count()>0;}
async function changeOwn(d,current,next){await settings(d);await d.p.getByRole('button',{name:'Change password',exact:true}).first().click();const form=d.p.locator('form',{has:d.p.locator('#homi-password-current')});await form.locator('#homi-password-current').fill(current);await form.locator('#homi-password-new').fill(next);await form.locator('#homi-password-confirm').fill(next);await form.getByRole('button',{name:'Change password',exact:true}).click();await d.p.getByText('Password changed. Your other devices have been signed out.').waitFor({timeout:30000});}
try{
  const owner=await launch('owner-a'),ownerB=await launch('owner-b',1440),member=await launch('member');
  await attempt(owner,OWNER,env.HOMI_BOOTSTRAP_PASSWORD);await signedIn(owner);
  await attempt(ownerB,OWNER,env.HOMI_BOOTSTRAP_PASSWORD);await signedIn(ownerB);
  await attempt(member,MEMBER,env.HOMI_BOOTSTRAP_PASSWORD);await signedIn(member);

  await settings(owner);await members(owner).waitFor({timeout:30000});
  // The member list loads after the panel appears.
  await poll(async()=>await members(owner).locator('li').count()===2,'member list loaded');
  assert.equal(await members(owner).locator('li',{hasText:'(you)'}).getByRole('button',{name:'Reset password'}).count(),0);
  await members(owner).locator('li',{hasText:'(you)'}).getByText('Administrator').waitFor();
  await settings(member);await member.p.waitForTimeout(3000);assert.equal(await members(member).count(),0);
  pass('administrator sees Members with their own row marked and no self-reset; a regular member sees no Members section');
  await owner.p.screenshot({path:ROOT+'password-settings-admin-390.png',fullPage:true});

  await members(owner).locator('li',{hasText:MEMBER_NAME}).getByRole('button',{name:'Reset password',exact:true}).click();
  const sheet=owner.p.locator('form',{has:owner.p.locator('#homi-temporary-password')});
  const temporary=await sheet.locator('#homi-temporary-password').inputValue();
  assert.match(temporary,/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){2}-[A-Za-z2-9]{2}$/);
  await owner.p.screenshot({path:ROOT+'password-reset-sheet-390.png',fullPage:true});
  await sheet.getByRole('button',{name:'Reset password',exact:true}).click();
  const issued=owner.p.locator('.homi-platform-members__password');await issued.waitFor({timeout:30000});
  assert.equal(await issued.innerText(),temporary);
  await members(owner).locator('li',{hasText:MEMBER_NAME}).getByText('Must choose a new password').waitFor();
  pass('reset issues a generated temporary password once and marks the member as needing a new password');

  assert.equal(await poll(()=>onSignInScreen(member),'member signed out'),true);
  pass("the member's existing session ends immediately");
  await attempt(member,MEMBER,env.HOMI_BOOTSTRAP_PASSWORD);await member.p.getByText('Sign in needs attention').waitFor({timeout:30000});
  pass('the forgotten old password no longer works');

  await attempt(member,MEMBER,temporary);await member.p.getByRole('heading',{name:'Choose a new password',exact:true}).waitFor({timeout:30000});
  assert.equal(await member.p.getByRole('button',{name:'Settings',exact:true}).count(),0);
  await member.p.screenshot({path:ROOT+'password-required-390.png',fullPage:true});
  const chosen='member-chosen-password-1';
  await member.p.locator('#homi-password-current').fill(temporary);await member.p.locator('#homi-password-new').fill(chosen);await member.p.locator('#homi-password-confirm').fill(chosen+'x');
  await member.p.getByRole('button',{name:'Save and continue',exact:true}).click();await member.p.getByText('The new passwords do not match.').waitFor();
  await member.p.locator('#homi-password-new').fill('short');await member.p.locator('#homi-password-confirm').fill('short');
  await member.p.getByRole('button',{name:'Save and continue',exact:true}).click();await member.p.getByText('Use at least 10 characters.').waitFor();
  await member.p.locator('#homi-password-new').fill(chosen);await member.p.locator('#homi-password-confirm').fill(chosen);
  await member.p.getByRole('button',{name:'Save and continue',exact:true}).click();await signedIn(member);
  pass('the temporary password opens only the Choose a new password screen, which validates input and then lets the member in');
  await member.p.reload();await signedIn(member);

  const fresh=await launch('member-fresh');
  await attempt(fresh,MEMBER,temporary);await fresh.p.getByText('Sign in needs attention').waitFor({timeout:30000});
  await attempt(fresh,MEMBER,chosen);await signedIn(fresh);
  pass('the temporary password stops working and the chosen one signs in on another device');
  await settings(owner);await owner.p.reload();await settings(owner);
  assert.equal(await members(owner).locator('li',{hasText:MEMBER_NAME}).getByText('Must choose a new password').count(),0);

  const ownerNew='owner-changed-password-1';
  await owner.p.screenshot({path:ROOT+'password-settings-1440.png',fullPage:true});
  await changeOwn(owner,env.HOMI_BOOTSTRAP_PASSWORD,ownerNew);
  await owner.p.reload();await signedIn(owner);
  assert.equal(await poll(()=>onSignInScreen(ownerB),'owner second device signed out'),true);
  await attempt(ownerB,OWNER,env.HOMI_BOOTSTRAP_PASSWORD);await ownerB.p.getByText('Sign in needs attention').waitFor({timeout:30000});
  await attempt(ownerB,OWNER,ownerNew);await signedIn(ownerB);
  pass("changing your own password keeps this device signed in, signs out your other devices, and the new password works");

  for(const [d,width] of [[owner,390],[ownerB,1440]]){await d.p.setViewportSize({width,height:900});await settings(d);assert.equal(await d.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  pass('Settings with Members fits phone and desktop widths without horizontal scrolling');
  assert.deepEqual(errors,[]);pass('no JavaScript page errors');
  writeFileSync(ROOT+'password-acceptance.json',JSON.stringify({date:new Date().toISOString(),results},null,2));
}catch(e){console.error(e);for(const [i,ctx]of contexts.entries()){try{const p=ctx.pages()[0];if(p){console.log('PAGE',i,(await p.locator('body').innerText()).slice(0,1500));await p.screenshot({path:ROOT+'failure-'+i+'.png'});}}catch{}}process.exitCode=1;}finally{for(const ctx of contexts)await ctx.close().catch(()=>{});}
