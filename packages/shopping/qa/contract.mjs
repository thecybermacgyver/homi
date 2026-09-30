import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHomiWebModule} from './web-contract.mjs';
import {parseShoppingItem,parseShoppingWorkingItem} from '../dist/sync.js';
const manifest=JSON.parse(readFileSync(new URL('../homi.module.json',import.meta.url)));
const web=createHomiWebModule();
assert.ok(manifest.coreCapabilities.includes('sync'));
for(const entity of manifest.sync.entities){
 assert.equal(web.sync.changeHandlers.filter(h=>h.entityType===entity.entityType).length,1);
 for(const op of entity.operations)assert.equal(web.sync.mutationAdapters.filter(a=>a.entityType===entity.entityType&&a.operations.includes(op)).length,1);
}
const item={id:crypto.randomUUID(),name:'Milk',quantity:'1',store:'Any store',aisle:'Dairy & eggs',assignedTo:null,checked:false,revision:'0',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
assert.equal(parseShoppingWorkingItem(item).revision,'0');assert.throws(()=>parseShoppingItem(item));
assert.equal(web.familyBoard['shopping-list'] instanceof Function,true);
assert.deepEqual(manifest.extensions.familyBoard[0].styles.map(s=>s.id),['items','store-counts']);
assert.equal(manifest.settings.user,false);assert.equal(web.settings,undefined);
const {storeCounts}=await import('../dist/projection.js');
const at=(name,store,checked=false)=>({...item,id:crypto.randomUUID(),name,store,checked,deleted:false});
assert.deepEqual(storeCounts([at('Bread','Browns'),at('Soap','Dollarama'),at('Aspirin','Drug store'),at('Shampoo · 3','Drug store'),
  at('Milk','Any store'),at('Eggs','Browns',true)]),[['Browns',1],['Dollarama',1],['Drug store',2],['Any store',1]]);
console.log('PASS_SHOPPING_EXACT_SYNC_AND_WORKING_CACHE_CONTRACT');
