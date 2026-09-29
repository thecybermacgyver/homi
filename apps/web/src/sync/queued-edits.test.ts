import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { enqueueMutation, getModuleMutations, homiClientDb, dismissModuleMutation, applySyncActions } from "./local-db.js";
import { projectWorkingEntities } from "./working-entities.js";
import { deliverQueuedMutationBatch } from "./deliver-mutations.js";

test("offline create then edit reconnects without conflicting with itself", async () => {
  const authSubject = "11111111-1111-4111-8111-111111111111";
  const householdId = "22222222-2222-4222-8222-222222222222";
  const clientId = "33333333-3333-4333-8333-333333333333";
  const moduleKey = "proof";
  const entityId = "44444444-4444-4444-8444-444444444444";
  await enqueueMutation(authSubject, {householdId, moduleKey, entityType:"item", entityId,
    operation:"create", baseRevision:"0", payload:{name:"Milk",checked:false}});
  const working = projectWorkingEntities([], await getModuleMutations(authSubject,householdId,moduleKey),"item");
  await enqueueMutation(authSubject, {householdId, moduleKey, entityType:"item", entityId,
    operation:"update", baseRevision:working[0]!.revision, payload:{name:"Milk",checked:true}});
  homiClientDb.close();
  await homiClientDb.open();
  let revision = "0";
  let checked = false;
  const result = await deliverQueuedMutationBatch({adapters:[{moduleKey,entityType:"item",operations:["create","update"],
    async submit(mutation) {
      const matches = mutation.baseRevision === revision;
      if(matches) {revision=String(BigInt(revision)+1n); checked=mutation.payload.checked===true;}
      return {clientMutationId:mutation.clientMutationId,status:matches?"applied":"conflict",
        serverRevision:revision,changeSequence:revision,errorCode:matches?null:"REVISION_CONFLICT",
        serverState:{checked,revision},replayed:false};
    }}]}, {authSubject,householdId,clientId});
  assert.equal(result.conflicts,0,JSON.stringify(result));
  assert.equal(checked,true);
});

function fixture() {
  const authSubject=crypto.randomUUID(), householdId=crypto.randomUUID(),clientId=crypto.randomUUID(),entityId=crypto.randomUUID();
  return {authSubject,householdId,clientId,entityId,
    async queue(operation:string,payload:Record<string,unknown>,moduleKey="proof",baseRevision="0") {
      return enqueueMutation(authSubject,{householdId,moduleKey,entityType:"item",entityId,operation,baseRevision,payload});
    }};
}

test("sequential edits use actual revisions, survive restart, and keep retries immutable", async () => {
  const f=fixture(); const seen: unknown[]=[]; const receipts=new Map<string,{request:unknown;result:import("./deliver-mutations.js").MutationSubmissionResult}>();
  await f.queue("create",{name:"Bread",checked:false});
  await f.queue("update",{name:"Bread",checked:true});
  await f.queue("update",{name:"Bread",checked:false});
  await f.queue("delete",{});
  let revision="0", dropped=false;
  const adapter={moduleKey:"proof",entityType:"item",operations:["create","update","delete"],
    async submit(m: import("./local-db.js").QueuedMutation) {
      const request={id:m.clientMutationId,base:m.baseRevision,payload:m.payload};seen.push(request);
      const previous=receipts.get(m.clientMutationId);
      if(previous) {assert.deepEqual(request,previous.request);return {...previous.result,replayed:true};}
      assert.equal(m.baseRevision,revision);
      revision=String(BigInt(revision)+7n);
      const result={clientMutationId:m.clientMutationId,status:"applied" as const,serverRevision:revision,
        changeSequence:revision,errorCode:null,serverState:{revision},replayed:false};
      receipts.set(m.clientMutationId,{request,result});
      if(m.operation==="update"&&!dropped) {dropped=true;throw new Error("response lost after server commit");}
      return result;
    }};
  const first=await deliverQueuedMutationBatch({adapters:[adapter]},f);
  assert.equal(first.deferred,3);
  homiClientDb.close();await homiClientDb.open();
  const second=await deliverQueuedMutationBatch({adapters:[adapter]},f);
  assert.equal(second.conflicts,0);assert.equal(second.applied,3);assert.equal(revision,"28");
  assert.equal(seen.length,5);
});

test("conflict blocks dependent edits but not unrelated modules, including after dismissal", async () => {
  const f=fixture();
  const first=await f.queue("update",{name:"my edit"},"proof","5");
  await f.queue("update",{name:"later edit"},"proof","5");
  await f.queue("delete",{},"proof","5");
  await f.queue("create",{name:"unrelated"},"other");
  const sent:string[]=[];
  const adapters=["proof","other"].map(moduleKey=>({moduleKey,entityType:"item",operations:["create","update","delete"],
    async submit(m: import("./local-db.js").QueuedMutation) {sent.push(m.moduleKey);return {clientMutationId:m.clientMutationId,
      status:m.moduleKey==="proof"?"conflict" as const:"applied" as const,serverRevision:"6",changeSequence:"6",
      errorCode:m.moduleKey==="proof"?"REVISION_CONFLICT":null,serverState:{name:"remote edit"},replayed:false};}}));
  const result=await deliverQueuedMutationBatch({adapters},f);
  assert.equal(result.conflicts,1);assert.equal(result.applied,1);assert.deepEqual(sent,["proof","other"]);
  const rows=await getModuleMutations(f.authSubject,f.householdId,"proof");
  assert.deepEqual(rows.map(r=>r.status),["conflict","rejected","rejected"]);
  assert.equal(rows[1]!.payload.name,"later edit");assert.equal(rows[1]!.lastErrorCode,"MUTATION_DEPENDENCY_FAILED");
  await dismissModuleMutation(f.authSubject,f.householdId,"proof",first.clientMutationId);
  await deliverQueuedMutationBatch({adapters},f);
  assert.deepEqual(sent,["proof","other"]);
});

test("dependencies never cross account, household, module, or entity boundaries", async () => {
  const f=fixture();await f.queue("create",{});
  const base={householdId:f.householdId,moduleKey:"proof",entityType:"item",entityId:f.entityId,
    operation:"update",baseRevision:"0",payload:{}};
  for(const [account,patch] of [[crypto.randomUUID(),{}],[f.authSubject,{householdId:crypto.randomUUID()}],
    [f.authSubject,{moduleKey:"other"}],[f.authSubject,{entityType:"other"}],[f.authSubject,{entityId:crypto.randomUUID()}]] as const) {
    const row=await enqueueMutation(account,{...base,...patch});assert.equal(row.dependsOnMutationId,undefined);
  }
});

test("cache reconciliation retains a receipt needed by an unsent dependent", async () => {
  const f=fixture();const first=await f.queue("create",{});await f.queue("update",{});
  const adapter={moduleKey:"proof",entityType:"item",operations:["create","update"],async submit(m: import("./local-db.js").QueuedMutation) {
    return {clientMutationId:m.clientMutationId,status:"applied" as const,serverRevision:"9",changeSequence:"1",
      errorCode:null,serverState:{},replayed:false};}};
  await deliverQueuedMutationBatch({adapters:[adapter]},{...f,limit:1});
  await applySyncActions(f.authSubject,f.householdId,"1",[{kind:"put",moduleKey:"proof",entityType:"item",
    entityId:f.entityId,revision:"9",sequence:"1",data:{}}]);
  assert.ok((await getModuleMutations(f.authSubject,f.householdId,"proof")).some(r=>r.clientMutationId===first.clientMutationId));
  const next=await deliverQueuedMutationBatch({adapters:[adapter]},f);assert.equal(next.applied,1);
});

test("unavailable adapters and repeated transport failures preserve writes without blocking unrelated work", async () => {
 const f=fixture();await f.queue("create",{},"missing");await f.queue("create",{},"unreachable");await f.queue("create",{},"healthy");
 const adapters=[{moduleKey:"unreachable",entityType:"item",operations:["create"],async submit():Promise<never>{throw new Error("network unavailable");}},
 {moduleKey:"healthy",entityType:"item",operations:["create"],async submit(m:import("./local-db.js").QueuedMutation){return {clientMutationId:m.clientMutationId,status:"applied" as const,serverRevision:"1",changeSequence:"1",errorCode:null,serverState:{},replayed:false};}}];
 const first=await deliverQueuedMutationBatch({adapters},f);assert.equal(first.applied,1);
 for(let i=0;i<5;i++)await deliverQueuedMutationBatch({adapters},f);
 const [row]=await getModuleMutations(f.authSubject,f.householdId,"unreachable");assert.equal(row!.status,"queued");assert.equal(row!.attempts,6);
});
