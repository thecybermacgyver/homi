import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { defineHomiWebModule, type HomiWebModuleSearchProvider, HOMI_MODULE_API_VERSION, type HomiHouseholdPerson,
  type HomiWebModuleSurfaceProps, type HomiWebModuleHostActions,
  type HomiWebModuleMutationState, type HomiWebModuleMutationInput } from "@homi/module-sdk";
import { BottomSheet, Button, Checkbox, FormField, Select, TextField } from "@homi/ui";
import { AISLES, SHOPPING_MODULE_KEY, normalized } from "./constants.js";
import { parseShoppingItem, parseShoppingWorkingItem, shoppingItemChangeHandler, shoppingItemMutationAdapter } from "./sync.js";
import { payload, placement, storeCounts } from "./projection.js";
import type { ShoppingItem } from "./types.js";

const css = `
.shopping {color:var(--homi-text);font-size:1rem}
.shopping h2,.shopping h3,.shopping p {margin:0}
.shopping .shopping-title {font-size:clamp(1.7rem,5vw,2.2rem);font-weight:600;margin:0 0 1rem}
.shopping-list {list-style:none;margin:0;padding:0}
.shopping-row {display:flex;align-items:center;gap:.5rem;min-height:48px}
.shopping-row .homi-ui-check {flex:1;min-width:0;font-size:1.12rem;font-weight:600}
.shopping-row .homi-ui-check span {overflow-wrap:anywhere}
.shopping-row input[type=checkbox] {accent-color:var(--homi-sage-strong);width:23px;height:23px;flex-shrink:0}
.shopping-done .homi-ui-check span {text-decoration:line-through;color:var(--homi-text-muted)}
.shopping-edit {border:0;background:transparent;color:var(--homi-text-muted);padding:.6rem;min-height:46px;cursor:pointer;border-radius:var(--homi-radius-sm)}
.shopping-edit:hover {background:var(--homi-bg-soft)}
.shopping-meta {margin:0 0 .3rem 2rem!important;font-size:.8rem;color:var(--homi-text-muted)}
.shopping-paper {background:var(--homi-surface);border:1px solid var(--homi-border);border-radius:var(--homi-radius-xl);padding:clamp(1rem,3vw,1.7rem);box-shadow:var(--homi-shadow-sm);max-width:48rem;margin:auto}
.shopping-toolbar {display:flex;gap:.65rem;align-items:end;flex-wrap:wrap;margin-bottom:1rem}
.shopping-toolbar>* {flex:1;min-width:120px}
.shopping-tabs {display:flex;gap:.5rem;margin:1rem 0;flex-wrap:wrap}
.shopping-group {margin-top:1.3rem}
.shopping-group h2 {font-size:1.18rem;margin-bottom:.35rem}
.shopping-group h3 {font-size:.85rem;color:var(--homi-text-muted);margin:.8rem 0 .2rem;font-weight:600}
.shopping-status {font-size:.85rem;color:var(--homi-text-muted);margin:.6rem 0!important}
.shopping-error {color:var(--homi-danger);margin:.6rem 0!important}
.shopping-form {display:grid;gap:.7rem}
.shopping-form-footer {display:flex;gap:.5rem;justify-content:space-between;flex-wrap:wrap;margin-top:.6rem}
.shopping-quick {display:flex;gap:.5rem;margin:.6rem 0 1rem;align-items:center}
.shopping-quick input {min-width:0;flex:1}
/* The Dashboard card is a spiral notepad under the card's title: coils over
   the top edge of the pad, ruled paper with a red margin, a box to tick in the
   margin and the item written on the line. The pad fills the card (the SDK's
   flex: 1 0 auto opt-in); it shows up to nine items, like 0.3.2, and a short
   card leaves out the footer because the card itself opens the list. */
.shopping-pad {--pad-paper:#ddd3c1;--pad-rule:#c6bba6;--pad-margin:#d58c7c;--pad-ink:#3a2f27;--pad-pitch:46px;--pad-gutter:52px;--pad-box:20px;
  position:relative;flex:1 0 auto;display:flex;flex-direction:column;color:var(--pad-ink);
  font-family:ui-rounded,"Avenir Next","Trebuchet MS","Segoe UI",system-ui,sans-serif}
.homi-family-board__cell .shopping.shopping-pad {flex:1 0 auto}
.shopping-pad-spiral {position:absolute;z-index:1;top:0;left:6px;right:6px;height:30px;pointer-events:none;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='17' height='30' viewBox='0 0 17 30'%3E%3Cdefs%3E%3ClinearGradient id='m' x1='0' x2='1'%3E%3Cstop offset='0' stop-color='%23262321'/%3E%3Cstop offset='.42' stop-color='%23827e79'/%3E%3Cstop offset='.6' stop-color='%23d2cec8'/%3E%3Cstop offset='1' stop-color='%23353230'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cellipse cx='8.5' cy='23.6' rx='3.4' ry='2.5' fill='%233a332d'/%3E%3Cpath d='M5.8 23.6C4.4 13 4.6 2.6 9 1.8 13.4 1 13.3 12.6 11.7 21.8' fill='none' stroke='url(%23m)' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E") center top/16.5px 30px space no-repeat}
.shopping-pad-paper {position:relative;flex:1 0 auto;display:flex;flex-direction:column;margin-top:12px;border-radius:12px;
  border:1px solid rgba(34,31,31,.16);background:linear-gradient(#e2d9c8,var(--pad-paper));box-shadow:0 1px 2px rgba(34,31,31,.10),0 4px 9px rgba(34,31,31,.08)}
/* The paper carries the margin; the rules run under every item and carry on
   below the last one to the foot of the page. */
.shopping-pad-sheet {flex:1 0 auto;display:flex;flex-direction:column;padding-top:22px;border-radius:inherit;
  background:linear-gradient(to right,transparent calc(var(--pad-gutter) - 1px),var(--pad-margin) calc(var(--pad-gutter) - 1px),var(--pad-margin) calc(var(--pad-gutter) + 1px),transparent calc(var(--pad-gutter) + 1px)) no-repeat}
.shopping-pad-lines {flex:1 0 auto;border-top:2px solid var(--pad-rule);min-height:calc(var(--pad-pitch) * 2);
  background:repeating-linear-gradient(to bottom,transparent 0,transparent calc(var(--pad-pitch) - 2px),var(--pad-rule) calc(var(--pad-pitch) - 2px),var(--pad-rule) var(--pad-pitch))}
.shopping-pad .shopping-list,.shopping-pad .shopping-counts {list-style:none;margin:0;padding:0}
.shopping-pad-row {display:flex;align-items:center;height:var(--pad-pitch);box-sizing:border-box;padding-bottom:2px}
.shopping-pad-row .homi-ui-check {flex:1;min-width:0;display:flex;align-items:center;gap:calc(var(--pad-gutter) - var(--pad-box) - 22px + 6px);margin:0;cursor:pointer;
  font-size:1.07rem;font-weight:700;line-height:1.15}
.shopping-pad-row .homi-ui-check span {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:12px}
.shopping-pad-row input[type=checkbox] {appearance:none;-webkit-appearance:none;flex:0 0 auto;width:22px;height:22px;margin:0 0 0 var(--pad-box);
  border:1.5px solid #6a635c;border-radius:3px;background:#fffdf8 center/16px 16px no-repeat;box-shadow:inset 0 1px 2px rgba(34,31,31,.12);cursor:pointer}
.shopping-pad-row input[type=checkbox]:checked {background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='%233d322a' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.shopping-pad-row input[type=checkbox]:focus-visible {outline:3px solid var(--homi-primary-action);outline-offset:2px}
.shopping-pad-row input[type=checkbox]:disabled {cursor:progress}
.shopping-pad .shopping-count {display:flex;justify-content:space-between;align-items:center;gap:1rem;height:var(--pad-pitch);box-sizing:border-box;padding:0 14px 2px calc(var(--pad-gutter) + 6px);
  font-size:1.07rem;font-weight:700;border:0;min-height:0}
.shopping-pad .shopping-count-total {font-weight:800}
.shopping-pad-note {display:flex;align-items:center;height:var(--pad-pitch);box-sizing:border-box;padding:0 14px 2px calc(var(--pad-gutter) + 6px);margin:0!important;font-size:.95rem;font-weight:650;color:#59534e}
.shopping-pad-note.shopping-error {color:var(--homi-danger)}
.shopping-pad-footer {display:flex;justify-content:flex-end;padding:0 10px 4px}
.shopping-pad-open {border:0;background:none;padding:4px 8px;min-height:30px;border-radius:6px;color:#59534e;font:inherit;font-size:.95rem;font-weight:650;cursor:pointer;touch-action:manipulation}
.shopping-pad-open:hover {background:rgba(34,31,31,.06);color:var(--pad-ink)}
.shopping-pad-open:focus-visible {outline:3px solid var(--homi-primary-action);outline-offset:1px}
@container (max-height:250px) {.shopping-pad {--pad-pitch:36px} .shopping-pad-sheet {padding-top:18px} .shopping-pad-row .homi-ui-check,.shopping-pad .shopping-count {font-size:.98rem} .shopping-pad-footer {display:none}}
@container (max-width:240px) {.shopping-pad {--pad-gutter:42px;--pad-box:12px} .shopping-pad .shopping-count {gap:.5rem;padding-right:10px}}
`;

async function getData(path: string, props: HomiWebModuleSurfaceProps, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/v1/modules/shopping/" + path, {
    credentials:"same-origin", headers:{"X-Homi-Household-ID":props.context.householdId,
      "X-Homi-Client-ID":props.context.clientId}, ...(signal ? {signal}:{}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? "Shopping could not be loaded.");
  return body.data;
}

function useShopping(props: HomiWebModuleSurfaceProps) {
  const latest = useRef(props); latest.current = props;
  const [items,setItems] = useState<ShoppingItem[]>([]);
  const [mutations,setMutations] = useState<readonly HomiWebModuleMutationState[]>([]);
  const [people,setPeople] = useState<readonly HomiHouseholdPerson[]>([]);
  const [error,setError] = useState("");
  const [loaded,setLoaded] = useState(false);
  const [busy,setBusy] = useState(false);
  const saving = useRef(false);
  const active = useRef(true);
  const readGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++readGeneration.current;
    const actions = latest.current.actions;
    if (!actions.listMutations) throw new Error("This Shopping version needs the updated Homi offline module support.");
    const [records, pending] = await Promise.all([actions.listWorkingEntities("item"), actions.listMutations()]);
    if (!active.current || generation !== readGeneration.current) return;
    const working = records.map(row => parseShoppingWorkingItem(row.data)).filter(item => !item.deleted)
      .sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    setItems(working); setMutations(pending); setLoaded(true);
  },[]);
  useEffect(() => {
    active.current = true;
    return () => {active.current = false; readGeneration.current++;};
  },[]);
  // The host supplies new actions when Core's sync state changes.
  useEffect(() => { void refresh().catch(e => setError(String(e.message ?? e))); },[props.actions, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const initial = async () => {
      const p = latest.current;
      const stored = await p.actions.listCachedEntities("people");
      if (!controller.signal.aborted && stored[0]) setPeople(stored[0].data as HomiHouseholdPerson[]);
      if (!p.context.online) return;
      const [rows,persons] = await Promise.all([
        getData("items",p,controller.signal),getData("people",p,controller.signal),
      ]);
      if (controller.signal.aborted) return;
      if (!Array.isArray(rows) || !Array.isArray(persons)) throw new Error("Invalid Shopping response.");
      const parsed = rows.map(parseShoppingItem);
      await p.actions.replaceCachedEntities("item",parsed.map(item => ({
        entityId:item.id,revision:item.revision,data:item,
      })));
      await p.actions.replaceCachedEntities("people",[{entityId:"active",revision:"0",data:persons}]);
      if (controller.signal.aborted) return;
      setPeople(persons); await refresh();
    };
    void initial().catch(e => {if (!controller.signal.aborted) setError(String(e.message ?? e));});
    return () => controller.abort();
  },[props.context.authSubject,props.context.householdId,props.context.online,refresh]);
  const mutate = async (input:HomiWebModuleMutationInput) => {
    if (saving.current) return false;
    saving.current = true; setBusy(true);setError("");
    try {
      await latest.current.actions.enqueueMutation(input);
      await refresh();
      return true;
    } catch(e) {setError(e instanceof Error ? e.message : String(e));return false;}
    finally {saving.current=false;setBusy(false);}
  };
  const toggle = (item:ShoppingItem) => mutate({entityType:"item",entityId:item.id,
    operation:"update",baseRevision:item.revision,payload:payload(item,!item.checked)});
  const dismiss = async (id:string) => {
    try {
      await latest.current.actions.dismissMutation?.(id);
      await refresh();
    } catch(e) {setError(e instanceof Error ? e.message : String(e));}
  };
  return {items,people,error,loaded,busy,mutate,toggle,dismiss,
    pending:mutations.filter(m => m.status==="queued" || m.status==="sending").length,
    failures:mutations.filter(m => m.status==="conflict" || m.status==="rejected")};
}
interface Editor { resolutionId?:string; item:ShoppingItem|null; name:string; quantity:string; store:string; aisle:string; assignedTo:string; }
const fresh = (store=""):Editor => ({item:null,name:"",quantity:"1",store,aisle:"",assignedTo:""});
function edit(item:ShoppingItem):Editor {
  return {item,name:item.name,quantity:item.quantity,store:item.store==="Any store"?"":item.store,
    aisle:item.aisle,assignedTo:item.assignedTo??""};
}
function label(item:ShoppingItem) {return item.quantity==="1" ? item.name : item.name+" · "+item.quantity;}

function ShoppingPage(props:HomiWebModuleSurfaceProps) {
  const data = useShopping(props);
  const [editor,setEditor] = useState<Editor|null>(null);
  const [quick,setQuick] = useState("");
  const [store,setStore] = useState("");
  const [checked,setChecked] = useState(false);
  const latest = useRef({actions:props.actions,store});latest.current={actions:props.actions,store};
  useEffect(() => {
    latest.current.actions.registerContextActions({
      create:{label:"Add shopping item",invoke:()=>setEditor(fresh(latest.current.store))},
    });
    return () => latest.current.actions.registerContextActions(null);
  },[props.context.householdId]);
  // An item chosen in Core's universal search opens for viewing or editing once the list has loaded it.
  const appliedIntent = useRef(0);
  useEffect(() => {
    const intent = props.intent;
    if (!intent || appliedIntent.current === intent.nonce) return;
    const target = data.items.find(i => i.id === intent.params.itemId);
    if (!target) return;
    appliedIntent.current = intent.nonce;
    setChecked(target.checked);
    setEditor(edit(target));
  },[props.intent?.nonce, data.items]);
  const stores = [...new Set(data.items.map(i=>i.store).filter(s=>s!=="Any store"))].sort((a,b)=>a.localeCompare(b));
  const people = new Map(data.people.map(p=>[p.id,p.displayName]));
  const visible = data.items.filter(item => item.checked===checked && (!store || item.store===store));
  const groups = new Map<string,Map<string,ShoppingItem[]>>();
  for (const item of visible) {
    const aisles=groups.get(item.store)??new Map<string,ShoppingItem[]>();
    aisles.set(item.aisle,[...(aisles.get(item.aisle)??[]),item]);groups.set(item.store,aisles);
  }
  async function save(value:Editor) {
    const resolved=placement(value.name,value.store,value.aisle,data.items);
    const success=await data.mutate({entityType:"item",entityId:value.item?.id??crypto.randomUUID(),
      operation:value.item?"update":"create",baseRevision:value.item?.revision??"0",
      payload:{name:value.name.trim(),quantity:value.quantity.trim()||"1",...resolved,
        assignedTo:value.assignedTo||null,checked:value.item?.checked??false}});
    if(success) {
      if(value.resolutionId) await data.dismiss(value.resolutionId);
      setEditor(null);
    }
    return success;
  }
  async function submit(event:FormEvent) {event.preventDefault();if(editor) await save(editor);}
  async function quickAdd(event:FormEvent) {
    event.preventDefault();if(!quick.trim())return;
    if(await save({...fresh(store),name:quick}))setQuick("");
  }
  return <section className="shopping shopping-paper">
    <style>{css}</style>
    <h1 className="shopping-title">Shopping List</h1>
    <form className="shopping-quick" onSubmit={e=>void quickAdd(e)}>
      <TextField aria-label="Add an item" placeholder="Add an item…" maxLength={160} value={quick} onChange={e=>setQuick(e.currentTarget.value)}/>
      <Button type="submit" disabled={data.busy||!quick.trim()}>Add</Button>
    </form>
    <div className="shopping-toolbar">
      <FormField label="Store" htmlFor="shopping-filter">
        <Select id="shopping-filter" value={store} onChange={e=>setStore(e.currentTarget.value)}>
          <option value="">All stores</option>
          {stores.map(s=><option key={s}>{s}</option>)}
          <option>Any store</option>
        </Select>
      </FormField>
    </div>
    <div className="shopping-tabs" aria-label="List view">
      <Button variant={checked?"quiet":"secondary"} aria-pressed={!checked} onClick={()=>setChecked(false)}>To buy</Button>
      <Button variant={checked?"secondary":"quiet"} aria-pressed={checked} onClick={()=>setChecked(true)}>Checked ({data.items.filter(i=>i.checked).length})</Button>
    </div>
    {data.pending>0&&<p className="shopping-status" role="status">{props.context.online?"Sharing changes…":"Saved offline. Will share when connected."}</p>}
    {data.error&&<p className="shopping-error" role="alert">{data.error}</p>}
    {data.failures.map(f=><div role="alert" key={f.clientMutationId} className="shopping-error">
      <p>{f.status==="conflict"?"Someone changed this item before your change arrived.":"A change could not be saved."} {String(f.payload.name??"")}</p>
      <Button variant="quiet" onClick={()=>void data.dismiss(f.clientMutationId)}>Keep shared version</Button>
      <Button variant="quiet" onClick={()=>{
        const shared=f.serverState ? parseShoppingItem(f.serverState) : null;
        const current=shared&&!shared.deleted ? shared : null;
        setEditor({...current?edit(current):fresh(),resolutionId:f.clientMutationId,
          name:String(f.payload.name??current?.name??""),
          quantity:String(f.payload.quantity??current?.quantity??"1"),
          store:String(f.payload.store??current?.store??""),
          aisle:String(f.payload.aisle??current?.aisle??""),
          assignedTo:typeof f.payload.assignedTo==="string"?f.payload.assignedTo:current?.assignedTo??""});
      }}>Review item</Button>
    </div>)}
    {!data.loaded?<p className="shopping-status">Loading your list…</p>:visible.length===0?
      <p className="shopping-status">{checked?"No checked items.":store?"No items match this view.":"Your list is empty. Add what you need above."}</p>:
      [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([storeName,aisles])=><section className="shopping-group" key={storeName}>
        {(groups.size>1||storeName!=="Any store")&&<h2>{storeName}</h2>}
        {[...aisles].sort(([a],[b])=>{
          const x=AISLES.indexOf(a as typeof AISLES[number]),y=AISLES.indexOf(b as typeof AISLES[number]);
          return (x<0?99:x)-(y<0?99:y)||a.localeCompare(b,undefined,{numeric:true});
        }).map(([aisle,items])=><section key={aisle}><h3>{aisle}</h3>
          <ul className="shopping-list">{items.map(item=><li key={item.id}>
            <div className={"shopping-row"+(item.checked?" shopping-done":"")}>
              <Checkbox label={label(item)} checked={item.checked} disabled={data.busy} onChange={()=>void data.toggle(item)}/>
              <button type="button" className="shopping-edit" aria-label={"Edit "+item.name} onClick={()=>setEditor(edit(item))}>Edit</button>
            </div>
            {item.assignedTo&&<p className="shopping-meta">{people.get(item.assignedTo)??"Household member"}</p>}
          </li>)}</ul>
        </section>)}
      </section>)}
    <BottomSheet open={editor!==null} title={editor?.item?"Edit item":"Add shopping item"} onDismiss={()=>setEditor(null)}>
      {editor&&<form className="shopping shopping-form" onSubmit={e=>void submit(e)}>
        {editor.resolutionId&&<p role="status">Review your change below. Saving submits it against the shared version; Cancel keeps the unresolved change.</p>}
        <FormField label="Item" htmlFor="shopping-name"><TextField id="shopping-name" autoFocus required maxLength={160} value={editor.name} onChange={e=>setEditor({...editor,name:e.currentTarget.value})}/></FormField>
        <FormField label="Quantity" htmlFor="shopping-qty"><TextField id="shopping-qty" maxLength={40} value={editor.quantity} onChange={e=>setEditor({...editor,quantity:e.currentTarget.value})}/></FormField>
        <FormField label="Store" htmlFor="shopping-store" hint="Choose or type a store. Leave blank to reuse this item's last store."><TextField id="shopping-store" list="shopping-stores" maxLength={100} placeholder="Automatic / any store" value={editor.store} onChange={e=>setEditor({...editor,store:e.currentTarget.value})}/></FormField>
        <datalist id="shopping-stores">{stores.map(s=><option key={s} value={s}/>)}</datalist>
        <FormField label="Aisle or category" htmlFor="shopping-aisle" hint="Leave blank for automatic. You can enter a store's aisle number."><TextField id="shopping-aisle" list="shopping-aisles" maxLength={100} placeholder="Automatic" value={editor.aisle} onChange={e=>setEditor({...editor,aisle:e.currentTarget.value})}/></FormField>
        <datalist id="shopping-aisles">{AISLES.map(a=><option key={a} value={a}/>)}</datalist>
        <FormField label="Who's picking it up?" htmlFor="shopping-person"><Select id="shopping-person" value={editor.assignedTo} onChange={e=>setEditor({...editor,assignedTo:e.currentTarget.value})}><option value="">Anyone</option>{data.people.map(p=><option value={p.id} key={p.id}>{p.displayName}</option>)}</Select></FormField>
        <div className="shopping-form-footer">
          <Button type="submit" disabled={data.busy||!editor.name.trim()}>Save item</Button>
          {editor.item&&<Button variant="quiet" disabled={data.busy} onClick={()=>{const item=editor.item;if(item)void data.mutate({entityType:"item",entityId:item.id,operation:"delete",baseRevision:item.revision,payload:{}}).then(ok=>{if(ok)setEditor(null);});}}>Remove item</Button>}
          <Button variant="quiet" onClick={()=>setEditor(null)}>Cancel</Button>
        </div>
      </form>}
    </BottomSheet>
  </section>;
}
function ShoppingBoard(props:HomiWebModuleSurfaceProps) {
  const data=useShopping(props);
  const active=data.items.filter(item=>!item.checked);
  // Each member chooses the card style on the Modules page; Homi passes it in.
  const counts=props.presentation?.cardStyle==="store-counts";
  const note=(text:string,error=false)=><p className={"shopping-pad-note"+(error?" shopping-error":"")} role={error?"alert":undefined}>{text}</p>;
  // Ticking and Open list belong to the pad; a tap on the coils or the top of
  // the pad reaches the card, which opens the module like Homi's own title.
  return <div className="shopping shopping-board shopping-pad">
    <style>{css}</style>
    <div className="shopping-pad-spiral" aria-hidden="true"/>
    <div className="shopping-pad-paper">
      <div className="shopping-pad-sheet">
        <div className="shopping-pad-lines" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
          {counts?active.length>0&&<ul className="shopping-counts" aria-label="Items to buy by store">
            <li className="shopping-count shopping-count-total"><span>All stores</span><span className="shopping-count-value">{active.length}</span></li>
            {storeCounts(data.items).map(([store,count])=><li className="shopping-count" key={store}>
              <span>{store}</span><span className="shopping-count-value">{count}</span>
            </li>)}
          </ul>:<ul className="shopping-list" aria-label="Items to buy">{active.slice(0,9).map(item=><li className="shopping-pad-row" key={item.id}>
            <Checkbox label={label(item)} checked={false} disabled={data.busy} onChange={()=>void data.toggle(item)}/>
          </li>)}</ul>}
          {data.loaded&&active.length===0&&note("Nothing to pick up.")}
          {data.error&&note(data.error,true)}
          {data.failures.length>0&&note("Open your list to review a change.",true)}
          {data.pending>0&&!props.context.online&&note("Saved offline")}
        </div>
        <div className="shopping-pad-footer" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
          <button type="button" className="shopping-pad-open" onClick={()=>props.actions.navigate("/modules/shopping")}>{!counts&&active.length>9?"+ "+(active.length-9)+" more · Open list":"Open list"}</button>
        </div>
      </div>
    </div>
  </div>;
}
// Answers Core's universal search from the local working cache, so it also works offline.
const shoppingSearchProvider: HomiWebModuleSearchProvider = {
  label: "Shopping list items",
  async search(query, { context, actions }) {
    const needle = normalized(query.trim());
    if (needle === "") return [];
    const records = await actions.listWorkingEntities("item");
    const items = records.map(row => parseShoppingWorkingItem(row.data)).filter(item => !item.deleted);
    return items
      .filter(item => [item.name, item.store, item.aisle].some(value => normalized(value).includes(needle)))
      .sort((a,b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, context.locale))
      .map(item => ({
        id: item.id,
        title: item.name,
        subtitle: `${item.store} · ${item.aisle}${item.checked ? " · checked off" : ""}`,
        pageId: "shopping",
        intent: { itemId: item.id },
      }));
  },
};
export function createHomiWebModule() {
  return defineHomiWebModule({search:shoppingSearchProvider,moduleKey:SHOPPING_MODULE_KEY,moduleApiVersion:HOMI_MODULE_API_VERSION,
    pages:{shopping:ShoppingPage},familyBoard:{"shopping-list":ShoppingBoard},
    sync:{mutationAdapters:[shoppingItemMutationAdapter],changeHandlers:[shoppingItemChangeHandler]}});
}
