// Audits every versioned module-directory release on GitHub, anonymously: the
// signature must verify against the trusted public key, and every entry's
// release asset must hash to the package digest the entry pins. Requires a
// built Core (`pnpm --filter @homi/core build`) and the GitHub CLI for listing.
// Usage: node scripts/audit-module-directory.mjs <public-key.pem> [owner/repo]
import {execFileSync} from 'node:child_process';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [keyFile,repo='thecybermacgyver/homi']=process.argv.slice(2);
if(!keyFile){console.error('Usage: node scripts/audit-module-directory.mjs <public-key.pem> [owner/repo]');process.exit(2);}
const {inspectHomiModulePackage}=await import(pathToFileURL(new URL('../apps/core/dist/module-package.js',import.meta.url).pathname).href);
const publicKey=createPublicKey(readFileSync(keyFile));
const work=mkdtempSync(join(tmpdir(),'homi-directory-audit-'));
const tags=JSON.parse(execFileSync('gh',['release','list','--repo',repo,'-L','200','--json','tagName'],{encoding:'utf8'})).map(r=>r.tagName).filter(t=>t.startsWith('module-directory-')).sort();
const digests=new Map();let checked=0,problems=0;
async function packageDigest(url){
  if(digests.has(url))return digests.get(url);
  const dir=join(work,createHash('sha1').update(url).digest('hex'));mkdirSync(dir,{recursive:true});
  const response=await fetch(url,{redirect:'follow'});let digest;
  if(!response.ok)digest=`HTTP ${response.status}`;
  else{writeFileSync(dir+'.tgz',Buffer.from(await response.arrayBuffer()));execFileSync('tar',['-xzf',dir+'.tgz','-C',dir]);
    try{digest=(await inspectHomiModulePackage(dir)).packageDigest;}catch(error){digest='INVALID '+error.message.slice(0,60);}}
  digests.set(url,digest);return digest;
}
for(const tag of tags){
  const response=await fetch(`https://github.com/${repo}/releases/download/${tag}/directory.json`);
  if(!response.ok){console.log(tag,'directory.json HTTP',response.status);problems++;continue;}
  const envelope=await response.json();
  const signatureValid=verify(null,Buffer.from(envelope.payload,'utf8'),publicKey,Buffer.from(envelope.signature.value,'base64'));
  if(!signatureValid)problems++;
  const results=[];
  for(const entry of JSON.parse(envelope.payload).entries){
    const actual=await packageDigest(entry.artifactUrl);checked++;
    if(actual!==entry.packageDigest)problems++;
    results.push(`${entry.moduleKey}@${entry.latestVersion}:${actual===entry.packageDigest?'ok':'MISMATCH'}`);
  }
  console.log(tag,'signature',signatureValid?'valid':'INVALID','|',results.join(' '));
}
console.log(`releases=${tags.length} entries=${checked} problems=${problems}`);
process.exit(problems===0?0:1);
