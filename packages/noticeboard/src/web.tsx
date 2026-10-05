import {
  useCallback, useEffect, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent,
} from "react";
import {
  defineHomiWebModule, HOMI_MODULE_API_VERSION,
  type HomiWebModuleSearchProvider, type HomiWebModuleSurfaceProps,
  type HomiWebModuleMutationState, type HomiWebModuleMutationInput,
} from "@homi/module-sdk";
import { BottomSheet, Button, Checkbox, FormField, IconButton, TextArea, TextField } from "@homi/ui";
import { DEFAULT_COLOR, LIMITS, NOTICEBOARD_MODULE_KEY, SWATCHES } from "./constants.js";
import { shrinkImage } from "./image.js";
import { clampPlacement, excerpt, inkFor, newPlacement, nextZ, pinColor, searchText } from "./projection.js";
import { noticeChangeHandler, noticeMutationAdapter, parseNotice, parseWorkingNotice } from "./sync.js";
import type { ChecklistItem, Notice, NoticeContent, NoticePlacement } from "./types.js";

const css = `
.nb {color:var(--homi-text);font-size:1rem}
.nb h1,.nb h2,.nb h3,.nb p {margin:0}
.nb-title {font-size:clamp(1.7rem,5vw,2.2rem);font-weight:600;margin:0 0 1rem}
.nb-status {font-size:.85rem;color:var(--homi-text-muted);margin:.6rem 0!important}
.nb-error {color:var(--homi-danger);margin:.6rem 0!important}
.nb-paper {background:var(--homi-surface);border:1px solid var(--homi-border);border-radius:var(--homi-radius-xl);padding:clamp(1rem,3vw,1.7rem);box-shadow:var(--homi-shadow-sm);max-width:48rem;margin:auto}
.nb-list {list-style:none;margin:0;padding:0;display:grid;gap:.6rem}
.nb-row {display:flex;gap:.8rem;align-items:stretch;width:100%;text-align:left;border:1px solid var(--homi-border);border-radius:var(--homi-radius-md);background:var(--homi-surface-strong);color:inherit;padding:0;cursor:pointer;overflow:hidden;min-height:64px}
.nb-row:hover,.nb-row:focus-visible {border-color:var(--homi-border-strong);box-shadow:var(--homi-shadow-sm)}
.nb-row-swatch {flex:0 0 .6rem}
.nb-row-body {flex:1;min-width:0;padding:.65rem 0}
.nb-row-title {font-weight:700;font-size:1.05rem;overflow-wrap:anywhere}
.nb-row-brief {font-size:.9rem;color:var(--homi-text-muted);overflow-wrap:anywhere;margin-top:.15rem!important}
.nb-row-meta {display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:.25rem;padding:.65rem .8rem .65rem 0;font-size:.8rem;color:var(--homi-text-muted);white-space:nowrap}
.nb-row-thumb {width:64px;object-fit:cover;flex:0 0 64px}
.nb-pinned {font-weight:700;color:var(--homi-sage-text)}
.nb-failure {border:1px solid var(--homi-danger);border-radius:var(--homi-radius-md);padding:.7rem .9rem;margin:0 0 .8rem;background:var(--homi-danger-soft)}
.nb-form {display:grid;gap:.9rem}
.nb-swatches {display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.nb-swatch {width:40px;height:40px;border-radius:50%;border:2px solid var(--homi-border-strong);cursor:pointer;padding:0}
.nb-swatch[aria-pressed="true"] {outline:3px solid var(--homi-primary-action);outline-offset:2px}
.nb-color {width:46px;height:40px;padding:0;border:1px solid var(--homi-border-strong);border-radius:var(--homi-radius-sm);background:none}
.nb-check-row {display:flex;gap:.4rem;align-items:center}
.nb-check-row input[type=text] {flex:1;min-width:0}
.nb-photo {max-width:100%;max-height:220px;border-radius:var(--homi-radius-sm);display:block;margin-top:.5rem}
.nb-footer {display:flex;gap:.5rem;justify-content:space-between;flex-wrap:wrap;margin-top:.4rem}
.nb-view-body {white-space:pre-wrap;overflow-wrap:anywhere;font-size:1.05rem}
.nb-view-photo {max-width:100%;border-radius:var(--homi-radius-md);display:block;margin:0 0 .8rem}
.nb-view-checks {list-style:none;margin:.8rem 0 0;padding:0}
.nb-view-meta {font-size:.85rem;color:var(--homi-text-muted);margin-top:.8rem!important}
.homi-family-board__cell .nb.nb-card {position:relative;flex:1 0 auto;min-height:150px;display:grid}
.nb-board {position:relative;isolation:isolate;container-type:size;width:100%;min-height:140px;overflow:hidden;border-radius:14px;background:radial-gradient(circle at 30% 20%,#e3d6c6,#d4c4b2 70%);box-shadow:inset 0 0 0 1px rgba(62,45,39,.18),inset 0 6px 14px rgba(62,45,39,.12)}
.nb-note {position:absolute;border-radius:3px;box-shadow:0 1px 2px rgba(34,31,31,.28),0 6px 10px rgba(34,31,31,.16);font-size:clamp(.66rem,3.2cqw,1.05rem);line-height:1.25;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.nb-note.is-dragging {box-shadow:0 10px 22px rgba(34,31,31,.34);cursor:grabbing}
.nb-note-open {all:unset;box-sizing:border-box;display:block;width:100%;padding:1.25em .8em .8em;cursor:grab;color:inherit}
.nb-note-open:focus-visible {outline:3px solid var(--homi-primary-action);outline-offset:2px}
.nb-note-title {display:block;font-weight:800;overflow-wrap:anywhere}
.nb-note-brief {display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:.25em;overflow-wrap:anywhere}
.nb-note-photo {display:block;width:100%;height:5.5em;object-fit:cover;margin-top:.4em;border-radius:2px}
.nb-pin {position:absolute;top:0;left:50%;transform:translate(-50%,-40%);width:1.9em;height:1.9em;min-width:22px;min-height:22px;border-radius:50%;border:0;padding:0;cursor:pointer;box-shadow:0 2px 3px rgba(0,0,0,.45),inset -2px -3px 4px rgba(0,0,0,.28),inset 2px 2px 3px rgba(255,255,255,.4)}
.nb-pin:focus-visible {outline:3px solid #fff;outline-offset:2px}
.nb-tack,.nb-all {position:absolute;z-index:2;width:40px;height:40px;border-radius:50%;border:1px solid rgba(34,31,31,.25);background:rgba(249,247,241,.92);color:var(--homi-text);box-shadow:0 2px 5px rgba(34,31,31,.2);display:grid;place-items:center;padding:0;cursor:pointer;touch-action:manipulation}
.nb-tack {top:8px;left:8px}
.nb-all {bottom:8px;right:8px}
.nb-tack:focus-visible,.nb-all:focus-visible {outline:3px solid var(--homi-primary-action);outline-offset:2px}
.nb-empty {position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:3.2rem 1rem 1rem;color:#4a3f38;font-weight:650;font-size:.9rem}
@container (max-width:200px) {.nb-tack,.nb-all {width:34px;height:34px}}
`;

async function getData(path: string, props: HomiWebModuleSurfaceProps, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/v1/modules/noticeboard/" + path, {
    credentials: "same-origin",
    headers: { "X-Homi-Household-ID": props.context.householdId, "X-Homi-Client-ID": props.context.clientId },
    ...(signal ? { signal } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? "The Noticeboard could not be loaded.");
  return body.data;
}

interface Me { readonly personId: string; readonly administrator: boolean }

function useNoticeboard(props: HomiWebModuleSurfaceProps) {
  const latest = useRef(props); latest.current = props;
  const [notices, setNotices] = useState<Notice[]>([]);
  const [mutations, setMutations] = useState<readonly HomiWebModuleMutationState[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const generation = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    const actions = latest.current.actions;
    const [records, pending] = await Promise.all([actions.listWorkingEntities("notice"), actions.listMutations()]);
    if (!active.current || mine !== generation.current) return;
    setNotices(records.map((row) => parseWorkingNotice(row.data)).filter((notice) => !notice.deleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)));
    setMutations(pending);
    setLoaded(true);
  }, []);

  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  // The host supplies new actions when Core's sync state changes.
  useEffect(() => { void refresh().catch((e) => setError(String(e.message ?? e))); }, [props.actions, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const initial = async () => {
      const p = latest.current;
      const stored = await p.actions.listCachedEntities("me");
      if (!controller.signal.aborted && stored[0]) setMe(stored[0].data as Me);
      if (!p.context.online) return;
      const [rows, who] = await Promise.all([getData("notices", p, controller.signal), getData("me", p, controller.signal)]);
      if (controller.signal.aborted) return;
      if (!Array.isArray(rows)) throw new Error("Invalid Noticeboard response.");
      const parsed = rows.map(parseNotice);
      await p.actions.replaceCachedEntities("notice", parsed.map((n) => ({ entityId: n.id, revision: n.revision, data: n })));
      await p.actions.replaceCachedEntities("me", [{ entityId: "me", revision: "0", data: who }]);
      if (controller.signal.aborted) return;
      setMe(who as Me);
      await refresh();
    };
    void initial().catch((e) => { if (!controller.signal.aborted) setError(String(e.message ?? e)); });
    return () => controller.abort();
  }, [props.context.authSubject, props.context.householdId, props.context.online, refresh]);

  // Changes are queued one after another so quick moves are never dropped.
  const mutate = (input: HomiWebModuleMutationInput): Promise<boolean> => {
    const run = chain.current.then(async () => {
      setBusy(true); setError("");
      try {
        await latest.current.actions.enqueueMutation(input);
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally { setBusy(false); }
    });
    chain.current = run;
    return run;
  };
  const place = (notice: Notice, placement: NoticePlacement) => mutate({
    entityType: "notice", entityId: notice.id, operation: "update", baseRevision: notice.revision,
    payload: { ...placement },
  });
  const create = (content: NoticeContent, pinned: boolean) => mutate({
    entityType: "notice", entityId: crypto.randomUUID(), operation: "create", baseRevision: "0",
    payload: { ...content, ...newPlacement(notices), pinned },
  });
  const save = (notice: Notice, content: NoticeContent) => mutate({
    entityType: "notice", entityId: notice.id, operation: "update", baseRevision: notice.revision,
    payload: { ...content },
  });
  const tick = (notice: Notice, itemId: string, done: boolean) => mutate({
    entityType: "notice", entityId: notice.id, operation: "update", baseRevision: notice.revision,
    payload: { checklist: notice.checklist.map((item) => (item.id === itemId ? { ...item, done } : item)) },
  });
  const remove = (notice: Notice) => mutate({
    entityType: "notice", entityId: notice.id, operation: "delete", baseRevision: notice.revision, payload: {},
  });
  const dismiss = async (id: string) => {
    try { await latest.current.actions.dismissMutation(id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const canDelete = (notice: Notice) =>
    notice.authorPersonId === null || notice.authorPersonId === me?.personId || me?.administrator === true;
  return {
    notices, me, error, loaded, busy, place, create, save, tick, remove, dismiss, canDelete,
    pending: mutations.filter((m) => m.status === "queued" || m.status === "sending").length,
    failures: mutations.filter((m) => m.status === "conflict" || m.status === "rejected"),
  };
}
type Data = ReturnType<typeof useNoticeboard>;

function newItem(text = ""): ChecklistItem { return { id: crypto.randomUUID(), text, done: false }; }

function TackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
      <path d="M12 14v7" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

interface EditorState { readonly notice: Notice | null; readonly resolutionId?: string; readonly content: NoticeContent; readonly pinned: boolean }

function blankEditor(): EditorState {
  return { notice: null, pinned: true, content: { title: "", body: "", color: DEFAULT_COLOR, image: null, checklist: [] } };
}

function editorFor(notice: Notice): EditorState {
  const { title, body, color, image, checklist } = notice;
  return { notice, pinned: notice.pinned, content: { title, body, color, image, checklist } };
}

function EditorSheet({ editor, busy, onSave, onClose }: {
  editor: EditorState | null; busy: boolean;
  onSave: (editor: EditorState, content: NoticeContent, pinned: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  return (
    <BottomSheet portal open={editor !== null} title={editor?.notice ? "Edit notice" : "Add a notice"} onDismiss={onClose}>
      {editor && <EditorForm key={editor.notice?.id ?? "new"} editor={editor} busy={busy} onSave={onSave} onClose={onClose} />}
    </BottomSheet>
  );
}

function EditorForm({ editor, busy, onSave, onClose }: {
  editor: EditorState; busy: boolean;
  onSave: (editor: EditorState, content: NoticeContent, pinned: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const [content, setContent] = useState(editor.content);
  const [pinned, setPinned] = useState(editor.pinned);
  const [photoError, setPhotoError] = useState("");
  const [shrinking, setShrinking] = useState(false);
  const itemRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusLast = useRef(false);
  useEffect(() => {
    if (focusLast.current) { focusLast.current = false; itemRefs.current[content.checklist.length - 1]?.focus(); }
  }, [content.checklist.length]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setPhotoError(""); setShrinking(true);
    try { setContent((c) => ({ ...c, image: null })); const image = await shrinkImage(file); setContent((c) => ({ ...c, image })); }
    catch (e) { setPhotoError(e instanceof Error ? e.message : String(e)); }
    finally { setShrinking(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const items = content.checklist.map((item) => ({ ...item, text: item.text.trim() })).filter((item) => item.text !== "");
    if (await onSave(editor, { ...content, title: content.title.trim(), body: content.body.trim(), checklist: items }, pinned)) onClose();
  }
  const setItem = (index: number, text: string) =>
    setContent((c) => ({ ...c, checklist: c.checklist.map((item, i) => (i === index ? { ...item, text } : item)) }));
  return (
    <form className="nb nb-form" onSubmit={(e) => void submit(e)}>
      {editor.resolutionId && <p role="status">Review your change below. Saving submits it against the shared version.</p>}
      <FormField label="Title" htmlFor="nb-title">
        <TextField id="nb-title" autoFocus required maxLength={LIMITS.title} value={content.title}
          onChange={(e) => setContent({ ...content, title: e.currentTarget.value })} />
      </FormField>
      <FormField label="Notice" htmlFor="nb-body">
        <TextArea id="nb-body" rows={4} maxLength={LIMITS.body} value={content.body}
          onChange={(e) => setContent({ ...content, body: e.currentTarget.value })} />
      </FormField>
      <div role="group" aria-label="Paper colour">
        <div className="nb-swatches">
          {SWATCHES.map((swatch) => (
            <button key={swatch} type="button" className="nb-swatch" style={{ background: swatch }}
              aria-label={"Paper colour " + swatch} aria-pressed={content.color === swatch}
              onClick={() => setContent({ ...content, color: swatch })} />
          ))}
          <input type="color" className="nb-color" aria-label="Choose any colour" value={content.color}
            onChange={(e) => setContent({ ...content, color: e.currentTarget.value.toLowerCase() })} />
        </div>
      </div>
      <FormField label="Photo" htmlFor="nb-photo" hint="Photos are shrunk to fit.">
        <input id="nb-photo" type="file" accept="image/*" onChange={(e) => { void choose(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
      </FormField>
      {shrinking && <p className="nb-status" role="status">Shrinking photo…</p>}
      {photoError && <p className="nb-error" role="alert">{photoError}</p>}
      {content.image && <div>
        <img className="nb-photo" src={content.image} alt="Photo on this notice" />
        <Button variant="quiet" onClick={() => setContent({ ...content, image: null })}>Remove photo</Button>
      </div>}
      <div role="group" aria-label="List">
        <p><strong>List</strong></p>
        {content.checklist.map((item, index) => (
          <div className="nb-check-row" key={item.id}>
            <input type="text" className="homi-ui-input" aria-label={"List item " + (index + 1)} maxLength={LIMITS.checklistText}
              ref={(el) => { itemRefs.current[index] = el; }} value={item.text}
              onChange={(e) => setItem(index, e.currentTarget.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") { e.preventDefault(); focusLast.current = true; setContent((c) => ({ ...c, checklist: [...c.checklist, newItem()] })); }
              }} />
            <IconButton label={"Remove list item " + (index + 1)}
              onClick={() => setContent((c) => ({ ...c, checklist: c.checklist.filter((_, i) => i !== index) }))}>×</IconButton>
          </div>
        ))}
        {content.checklist.length < LIMITS.checklistItems && (
          <Button variant="quiet" onClick={() => { focusLast.current = true; setContent((c) => ({ ...c, checklist: [...c.checklist, newItem()] })); }}>Add list item</Button>
        )}
      </div>
      {!editor.notice && <Checkbox label="Pin to the board" checked={pinned} onChange={(e) => setPinned(e.currentTarget.checked)} />}
      <div className="nb-footer">
        <Button type="submit" disabled={busy || shrinking || !content.title.trim()}>Save notice</Button>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function ViewerSheet({ notice, data, locale, onEdit, onClose }: {
  notice: Notice | null; data: Data; locale: string; onEdit: (notice: Notice) => void; onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [notice?.id]);
  const date = notice ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(notice.createdAt)) : "";
  return (
    <BottomSheet portal open={notice !== null} title={notice?.title ?? ""} onDismiss={onClose}>
      {notice && <div className="nb">
        {notice.image && <img className="nb-view-photo" src={notice.image} alt="Photo on this notice" />}
        {notice.body && <p className="nb-view-body">{notice.body}</p>}
        {notice.checklist.length > 0 && <ul className="nb-view-checks" aria-label="List">
          {notice.checklist.map((item) => (
            <li key={item.id}><Checkbox label={item.text} checked={item.done} disabled={data.busy}
              onChange={(e) => void data.tick(notice, item.id, e.currentTarget.checked)} /></li>
          ))}
        </ul>}
        <p className="nb-view-meta">Added {date}{notice.pinned ? " · Pinned to the board" : " · Not on the board"}</p>
        <div className="nb-footer">
          <Button variant="secondary" disabled={data.busy} onClick={() => onEdit(notice)}>Edit</Button>
          <Button variant="secondary" disabled={data.busy}
            onClick={() => void data.place(notice, { pinned: !notice.pinned, x: notice.x, y: notice.y, w: notice.w, rotation: notice.rotation, z: nextZ(data.notices) })}>
            {notice.pinned ? "Unpin from board" : "Pin to board"}
          </Button>
          {data.canDelete(notice) && (confirming
            ? <>
              <Button variant="danger" disabled={data.busy} onClick={() => void data.remove(notice).then((ok) => { if (ok) onClose(); })}>Delete for everyone</Button>
              <Button variant="quiet" onClick={() => setConfirming(false)}>Keep notice</Button>
            </>
            : <Button variant="quiet" disabled={data.busy} onClick={() => setConfirming(true)}>Delete</Button>)}
          <Button variant="quiet" onClick={onClose}>Done</Button>
        </div>
      </div>}
    </BottomSheet>
  );
}

function Failures({ data, onReview }: { data: Data; onReview: (editor: EditorState, id: string) => void }) {
  return <>{data.failures.map((failure) => {
    const forbidden = failure.errorCode === "NOTICEBOARD_DELETE_FORBIDDEN";
    return (
      <div role="alert" key={failure.clientMutationId} className="nb-failure">
        <p>{forbidden ? "Only the person who wrote a notice, or a household administrator, can delete it."
          : failure.status === "conflict" ? "Someone changed this notice before your change arrived."
          : "A change could not be saved."} {String(failure.payload.title ?? "")}</p>
        <Button variant="quiet" onClick={() => void data.dismiss(failure.clientMutationId)}>{forbidden ? "Dismiss" : "Keep shared version"}</Button>
        {!forbidden && failure.operation === "update" && "title" in failure.payload && (
          <Button variant="quiet" onClick={() => {
            const shared = failure.serverState ? parseNotice(failure.serverState) : null;
            const base = shared && !shared.deleted ? editorFor(shared) : blankEditor();
            const p = failure.payload;
            onReview({
              ...base, resolutionId: failure.clientMutationId,
              content: {
                title: String(p.title ?? base.content.title), body: String(p.body ?? base.content.body),
                color: String(p.color ?? base.content.color), image: typeof p.image === "string" ? p.image : null,
                checklist: Array.isArray(p.checklist) ? (p.checklist as ChecklistItem[]) : base.content.checklist,
              },
            }, failure.clientMutationId);
          }}>Review notice</Button>
        )}
      </div>
    );
  })}</>;
}

// The module owns the two sheets (view and edit) so the page and the Dashboard
// card behave the same way.
function useSheets(data: Data) {
  const [viewId, setViewId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const viewing = data.notices.find((notice) => notice.id === viewId) ?? null;
  async function save(state: EditorState, content: NoticeContent, pinned: boolean) {
    const ok = state.notice ? await data.save(state.notice, content) : await data.create(content, pinned);
    if (ok && state.resolutionId) await data.dismiss(state.resolutionId);
    return ok;
  }
  return { viewId, setViewId, viewing, editor, setEditor, save };
}

interface Drag {
  id: string; pointerId: number; startX: number; startY: number; originX: number; originY: number;
  active: boolean; touch: boolean; timer: number | null;
}

function NoticeBoard({ notices, onOpen, onUnpin, onMove }: {
  notices: readonly Notice[]; onOpen: (notice: Notice) => void; onUnpin: (notice: Notice) => void;
  onMove: (notice: Notice, placement: NoticePlacement) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppress = useRef(false);
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const pinned = useMemo(() => notices.filter((n) => n.pinned).sort((a, b) => a.z - b.z || a.createdAt.localeCompare(b.createdAt)), [notices]);

  // A held touch picks a note up; while it is held, the page must not scroll.
  useEffect(() => {
    const block = (event: TouchEvent) => { if (drag.current?.active) event.preventDefault(); };
    window.addEventListener("touchmove", block, { passive: false });
    return () => window.removeEventListener("touchmove", block);
  }, []);

  function clear() {
    if (drag.current?.timer) window.clearTimeout(drag.current.timer);
    drag.current = null; setPreview(null);
  }
  function start(event: ReactPointerEvent<HTMLElement>, notice: Notice) {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".nb-pin")) return;
    const current: Drag = {
      id: notice.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      originX: notice.x, originY: notice.y, active: false, touch: event.pointerType === "touch", timer: null,
    };
    const target = event.currentTarget;
    if (current.touch) {
      current.timer = window.setTimeout(() => { current.active = true; try { target.setPointerCapture(current.pointerId); } catch { /* ignore */ } }, 300);
    }
    drag.current = current;
  }
  function move(event: ReactPointerEvent<HTMLElement>, notice: Notice) {
    const current = drag.current;
    if (!current || current.id !== notice.id) return;
    const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
    if (!current.active) {
      if (current.touch) { if (distance > 8) clear(); return; }
      if (distance < 4) return;
      current.active = true;
      try { event.currentTarget.setPointerCapture(current.pointerId); } catch { /* ignore */ }
    }
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const placed = clampPlacement({ pinned: true, x: current.originX + (event.clientX - current.startX) / rect.width,
      y: current.originY + (event.clientY - current.startY) / rect.height, w: notice.w, rotation: notice.rotation, z: notice.z });
    setPreview({ id: notice.id, x: placed.x, y: placed.y });
  }
  function end(event: ReactPointerEvent<HTMLElement>, notice: Notice) {
    const current = drag.current;
    if (current?.active && preview?.id === notice.id) {
      suppress.current = true; window.setTimeout(() => { suppress.current = false; }, 0);
      onMove(notice, { pinned: true, x: preview.x, y: preview.y, w: notice.w, rotation: notice.rotation, z: nextZ(notices) });
    }
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    clear();
  }
  function keys(event: KeyboardEvent<HTMLElement>, notice: Notice) {
    const delta: Record<string, [number, number]> = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.02], ArrowDown: [0, 0.02] };
    const step = delta[event.key];
    if (!step) return;
    event.preventDefault();
    const placed = clampPlacement({ pinned: true, x: notice.x + step[0], y: notice.y + step[1], w: notice.w, rotation: notice.rotation, z: nextZ(notices) });
    onMove(notice, placed);
  }

  return (
    <div className="nb-board" ref={boardRef}>
      {pinned.length === 0 && <p className="nb-empty">Nothing is pinned. Tack up a notice to get started.</p>}
      {pinned.map((notice, index) => {
        const live = preview?.id === notice.id ? preview : notice;
        const ink = inkFor(notice.color);
        return (
          <div key={notice.id} className={"nb-note" + (preview?.id === notice.id ? " is-dragging" : "")}
            style={{ left: live.x * 100 + "%", top: live.y * 100 + "%", width: notice.w * 100 + "%", zIndex: index + 1,
              transform: `rotate(${notice.rotation}deg)`, background: notice.color, color: ink }}
            onPointerDown={(e) => start(e, notice)} onPointerMove={(e) => move(e, notice)}
            onPointerUp={(e) => end(e, notice)} onPointerCancel={clear}>
            <button type="button" className="nb-note-open" aria-label={"Open notice: " + notice.title}
              onClick={() => { if (!suppress.current) onOpen(notice); }} onKeyDown={(e) => keys(e, notice)}>
              <span className="nb-note-title">{notice.title}</span>
              {notice.image
                ? <img className="nb-note-photo" src={notice.image} alt="" draggable={false} />
                : excerpt(notice, 90) && <span className="nb-note-brief">{excerpt(notice, 90)}</span>}
            </button>
            <button type="button" className="nb-pin" style={{ background: pinColor(notice.id) }}
              aria-label={"Unpin " + notice.title + " from the board"} title="Unpin"
              onPointerDown={(e) => e.stopPropagation()} onClick={() => onUnpin(notice)} />
          </div>
        );
      })}
    </div>
  );
}

function NoticeboardCard(props: HomiWebModuleSurfaceProps) {
  const data = useNoticeboard(props);
  const sheets = useSheets(data);
  return (
    <div className="nb nb-card" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <style>{css}</style>
      <NoticeBoard notices={data.notices} onOpen={(n) => sheets.setViewId(n.id)}
        onUnpin={(n) => void data.place(n, { pinned: false, x: n.x, y: n.y, w: n.w, rotation: n.rotation, z: n.z })}
        onMove={(n, placement) => void data.place(n, placement)} />
      <button type="button" className="nb-tack" aria-label="Add a notice" title="Add a notice" onClick={() => sheets.setEditor(blankEditor())}><TackIcon /></button>
      <button type="button" className="nb-all" aria-label="Open all notices" title="All notices" onClick={() => props.actions.navigate("/modules/noticeboard")}><ListIcon /></button>
      {data.error && <p className="nb-status nb-error" role="alert">{data.error}</p>}
      {data.failures.length > 0 && <p className="nb-status nb-error" role="alert">Open the Noticeboard to review a change.</p>}
      <ViewerSheet notice={sheets.viewing} data={data} locale={props.context.locale}
        onEdit={(n) => { sheets.setViewId(null); sheets.setEditor(editorFor(n)); }} onClose={() => sheets.setViewId(null)} />
      <EditorSheet editor={sheets.editor} busy={data.busy} onSave={sheets.save} onClose={() => sheets.setEditor(null)} />
    </div>
  );
}

function NoticeboardPage(props: HomiWebModuleSurfaceProps) {
  const data = useNoticeboard(props);
  const sheets = useSheets(data);
  const latest = useRef(props.actions); latest.current = props.actions;
  useEffect(() => {
    latest.current.registerContextActions({ create: { label: "Add notice", invoke: () => sheets.setEditor(blankEditor()) } });
    return () => latest.current.registerContextActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.context.householdId]);
  // A notice chosen in Core's universal search opens once it has loaded.
  const applied = useRef(0);
  useEffect(() => {
    const intent = props.intent;
    if (!intent || applied.current === intent.nonce) return;
    const target = data.notices.find((n) => n.id === intent.params.noticeId);
    if (!target) return;
    applied.current = intent.nonce;
    sheets.setViewId(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.intent?.nonce, data.notices]);
  const dateFormat = new Intl.DateTimeFormat(props.context.locale, { dateStyle: "medium" });
  return (
    <section className="nb nb-paper">
      <style>{css}</style>
      <h1 className="nb-title">Noticeboard</h1>
      {data.pending > 0 && <p className="nb-status" role="status">{props.context.online ? "Sharing changes…" : "Saved offline. Will share when connected."}</p>}
      {data.error && <p className="nb-error" role="alert">{data.error}</p>}
      <Failures data={data} onReview={(state) => sheets.setEditor(state)} />
      {!data.loaded ? <p className="nb-status">Loading the noticeboard…</p>
        : data.notices.length === 0 ? <p className="nb-status">No notices yet. Use + to add the first one.</p>
        : <ul className="nb-list" aria-label="Notices, newest first">
          {data.notices.map((notice) => (
            <li key={notice.id}>
              <button type="button" className="nb-row" onClick={() => sheets.setViewId(notice.id)}>
                <span className="nb-row-swatch" style={{ background: notice.color }} aria-hidden="true" />
                <span className="nb-row-body">
                  <p className="nb-row-title">{notice.title}</p>
                  {excerpt(notice) && <p className="nb-row-brief">{excerpt(notice)}</p>}
                </span>
                {notice.image && <img className="nb-row-thumb" src={notice.image} alt="" />}
                <span className="nb-row-meta">
                  <span>{dateFormat.format(new Date(notice.createdAt))}</span>
                  {notice.pinned && <span className="nb-pinned">Pinned</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>}
      <ViewerSheet notice={sheets.viewing} data={data} locale={props.context.locale}
        onEdit={(n) => { sheets.setViewId(null); sheets.setEditor(editorFor(n)); }} onClose={() => sheets.setViewId(null)} />
      <EditorSheet editor={sheets.editor} busy={data.busy} onSave={sheets.save} onClose={() => sheets.setEditor(null)} />
    </section>
  );
}

// Answers Core's universal search from the local working cache, so it also works offline.
const noticeSearchProvider: HomiWebModuleSearchProvider = {
  label: "Notices",
  async search(query, { context, actions }) {
    const needle = query.trim().toLocaleLowerCase();
    if (needle === "") return [];
    const records = await actions.listWorkingEntities("notice");
    const dateFormat = new Intl.DateTimeFormat(context.locale, { dateStyle: "medium" });
    return records.map((row) => parseWorkingNotice(row.data)).filter((n) => !n.deleted)
      .filter((n) => searchText(n).includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => ({
        id: n.id,
        title: n.title,
        subtitle: `${dateFormat.format(new Date(n.createdAt))}${n.pinned ? " · pinned" : ""}`,
        pageId: "noticeboard",
        intent: { noticeId: n.id },
      }));
  },
};

export function createHomiWebModule() {
  return defineHomiWebModule({
    search: noticeSearchProvider, moduleKey: NOTICEBOARD_MODULE_KEY, moduleApiVersion: HOMI_MODULE_API_VERSION,
    pages: { noticeboard: NoticeboardPage }, familyBoard: { noticeboard: NoticeboardCard },
    sync: { mutationAdapters: [noticeMutationAdapter], changeHandlers: [noticeChangeHandler] },
  });
}
