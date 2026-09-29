import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  HOMI_FAMILY_BOARD_COLUMNS,
  HOMI_FAMILY_BOARD_MAX_ROW,
  resolveHomiFamilyBoardCardLimits,
  type HomiFamilyBoardCardLimits,
  type HomiFamilyBoardLayout,
  type HomiFamilyBoardPlacement,
  type HomiModuleFamilyBoardSizeManifest,
} from "@homi/module-sdk";
import {
  arrangeFamilyBoard,
  fitPlacement,
  placeFamilyBoardCard,
  sameFamilyBoardPlacement,
  type FamilyBoardArrangement,
} from "./family-board-layout.js";

// Screens at least this wide use the wide layout; narrower ones the phone
// layout. Each member arranges the two separately.
const WIDE_QUERY = "(min-width: 720px)";

function subscribeToLayout(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useFamilyBoardLayout(): HomiFamilyBoardLayout {
  return useSyncExternalStore(
    subscribeToLayout,
    () => (window.matchMedia(WIDE_QUERY).matches ? "wide" : "phone"),
    () => "wide",
  );
}

export interface FamilyBoardGridItem {
  readonly key: string;
  readonly label: string;
  readonly size: HomiModuleFamilyBoardSizeManifest | undefined;
  readonly phoneLayout: HomiFamilyBoardPlacement | null;
  readonly wideLayout: HomiFamilyBoardPlacement | null;
  readonly content: ReactNode;
}

interface Drag {
  readonly key: string;
  readonly mode: "move" | "resize";
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startScrollY: number;
  readonly origin: HomiFamilyBoardPlacement;
  readonly from: FamilyBoardArrangement;
  readonly preview: FamilyBoardArrangement;
  readonly dx: number;
  readonly dy: number;
}

interface Metrics {
  readonly columnStep: number;
  readonly rowStep: number;
}

function changed(
  before: FamilyBoardArrangement,
  after: FamilyBoardArrangement,
): boolean {
  return [...after].some(
    ([key, placement]) => !sameFamilyBoardPlacement(before.get(key), placement),
  );
}

const EDGE_SCROLL_ZONE = 56;
const EDGE_SCROLL_STEP = 14;

export function FamilyBoardGrid({
  items,
  layout,
  editing,
  onSave,
}: {
  readonly items: readonly FamilyBoardGridItem[];
  readonly layout: HomiFamilyBoardLayout;
  readonly editing: boolean;
  readonly onSave: (
    layout: HomiFamilyBoardLayout,
    arrangement: FamilyBoardArrangement,
  ) => Promise<void>;
}) {
  const columns = HOMI_FAMILY_BOARD_COLUMNS[layout];
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Shown between letting go of a card and the saved placements coming back.
  const [pending, setPending] = useState<FamilyBoardArrangement | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const limits = useMemo(
    () =>
      new Map<string, HomiFamilyBoardCardLimits>(
        items.map((item) => [
          item.key,
          resolveHomiFamilyBoardCardLimits(item.size, layout),
        ]),
      ),
    [items, layout],
  );
  const saved = useMemo(
    () =>
      arrangeFamilyBoard(
        items.map((item) => ({
          key: item.key,
          saved: layout === "wide" ? item.wideLayout : item.phoneLayout,
          limits: limits.get(item.key)!,
        })),
        columns,
      ),
    [items, layout, limits, columns],
  );
  const shown = drag?.preview ?? pending ?? saved;

  useEffect(() => {
    if (!editing) setDrag(null);
  }, [editing]);

  function metrics(): Metrics | null {
    const grid = gridRef.current;
    if (!grid) return null;
    const style = window.getComputedStyle(grid);
    const columnGap = Number.parseFloat(style.columnGap) || 0;
    const rowGap = Number.parseFloat(style.rowGap) || 0;
    const row = Number.parseFloat(
      style.getPropertyValue("--homi-board-row"),
    ) || 56;
    const width = grid.clientWidth;
    return {
      columnStep: (width - columnGap * (columns - 1)) / columns + columnGap,
      rowStep: row + rowGap,
    };
  }

  async function save(arrangement: FamilyBoardArrangement): Promise<void> {
    setPending(arrangement);
    try {
      await onSave(layout, arrangement);
    } finally {
      setPending(null);
    }
  }

  function target(
    current: Drag,
    dx: number,
    dy: number,
  ): HomiFamilyBoardPlacement | null {
    const measured = metrics();
    const cardLimits = limits.get(current.key);
    if (!measured || !cardLimits) return null;
    const columnsMoved = Math.round(dx / measured.columnStep);
    const rowsMoved = Math.round(dy / measured.rowStep);
    const origin = current.origin;
    return fitPlacement(
      current.mode === "move"
        ? {
            ...origin,
            x: origin.x + columnsMoved,
            y: Math.max(0, origin.y + rowsMoved),
          }
        : {
            ...origin,
            w: Math.max(1, origin.w + columnsMoved),
            h: Math.max(1, origin.h + rowsMoved),
          },
      cardLimits,
      columns,
    );
  }

  function beginDrag(
    event: PointerEvent<HTMLElement>,
    key: string,
    mode: Drag["mode"],
  ): void {
    if (!editing || event.button !== 0) return;
    // Touch keeps scrolling the board; only the grip and corner handles
    // pick a card up with a finger.
    if (
      event.pointerType === "touch" &&
      !(event.target as Element).closest("[data-family-board-handle]")
    ) {
      return;
    }
    const origin = shown.get(key);
    if (!origin) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      key,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollY: window.scrollY,
      origin,
      from: shown,
      preview: shown,
      dx: 0,
      dy: 0,
    });
  }

  function continueDrag(event: PointerEvent<HTMLElement>): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.clientY < EDGE_SCROLL_ZONE) {
      window.scrollBy(0, -EDGE_SCROLL_STEP);
    } else if (event.clientY > window.innerHeight - EDGE_SCROLL_ZONE) {
      window.scrollBy(0, EDGE_SCROLL_STEP);
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY + window.scrollY - drag.startScrollY;
    const next = target(drag, dx, dy);
    if (!next) return;
    const preview = sameFamilyBoardPlacement(drag.preview.get(drag.key), next)
      ? drag.preview
      : placeFamilyBoardCard(drag.from, drag.key, next);
    setDrag({ ...drag, preview, dx, dy });
  }

  function endDrag(event: PointerEvent<HTMLElement>, keep: boolean): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    setDrag(null);
    if (keep && changed(finished.from, finished.preview)) {
      void save(finished.preview);
    }
  }

  function nudge(event: KeyboardEvent<HTMLElement>, item: FamilyBoardGridItem): void {
    const steps: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = steps[event.key];
    const current = shown.get(item.key);
    const cardLimits = limits.get(item.key);
    if (!step || !current || !cardLimits) return;
    event.preventDefault();
    const [across, down] = step;
    const next = fitPlacement(
      event.shiftKey
        ? {
            ...current,
            w: Math.max(1, current.w + across),
            h: Math.max(1, current.h + down),
          }
        : {
            ...current,
            x: current.x + across,
            y: Math.min(
              Math.max(0, current.y + down),
              HOMI_FAMILY_BOARD_MAX_ROW,
            ),
          },
      cardLimits,
      columns,
    );
    if (sameFamilyBoardPlacement(current, next)) return;
    setAnnouncement(
      `${item.label}: column ${next.x + 1}, row ${next.y + 1}, ` +
        `${next.w} wide by ${next.h} tall.`,
    );
    void save(placeFamilyBoardCard(shown, item.key, next));
  }

  const dragged = drag ? shown.get(drag.key) : undefined;
  const measured = drag ? metrics() : null;
  // The picked-up card follows the pointer smoothly; its snapped spot is
  // outlined underneath so the member sees where it will land.
  const follow =
    drag && dragged && measured && drag.mode === "move"
      ? `translate(${drag.dx - (dragged.x - drag.origin.x) * measured.columnStep}px, ` +
        `${drag.dy - (dragged.y - drag.origin.y) * measured.rowStep}px)`
      : undefined;

  return (
    <div
      ref={gridRef}
      className={[
        "homi-family-board__grid",
        `homi-family-board__grid--${layout}`,
        editing ? "is-editing" : "",
      ].join(" ")}
      style={{ "--homi-board-columns": columns } as CSSProperties}
    >
      {drag && dragged && (
        <div
          className="homi-family-board__drop-target"
          aria-hidden="true"
          style={{
            gridColumn: `${dragged.x + 1} / span ${dragged.w}`,
            gridRow: `${dragged.y + 1} / span ${dragged.h}`,
          }}
        />
      )}
      {items.map((item) => {
        const placement = shown.get(item.key);
        if (!placement) return null;
        const active = drag?.key === item.key;
        return (
          <div
            key={item.key}
            className={[
              "homi-family-board__cell",
              active ? "is-dragging" : "",
            ].join(" ")}
            data-family-board-card={item.key}
            style={{
              gridColumn: `${placement.x + 1} / span ${placement.w}`,
              gridRow: `${placement.y + 1} / span ${placement.h}`,
              ...(active && follow ? { transform: follow } : {}),
            }}
          >
            <div className="homi-family-board__content" inert={editing}>
              {item.content}
            </div>
            {editing && (
              <div
                className="homi-family-board__editor"
                role="group"
                tabIndex={0}
                aria-label={
                  `${item.label}, ${placement.w} wide by ${placement.h} tall. ` +
                  "Arrow keys move the card; Shift with arrow keys resizes it."
                }
                onPointerDown={(event) => beginDrag(event, item.key, "move")}
                onPointerMove={continueDrag}
                onPointerUp={(event) => endDrag(event, true)}
                onPointerCancel={(event) => endDrag(event, false)}
                onKeyDown={(event) => nudge(event, item)}
              >
                <span
                  className="homi-family-board__grip"
                  data-family-board-handle
                  aria-hidden="true"
                >
                  ⠿
                </span>
                <span
                  className="homi-family-board__resize"
                  data-family-board-handle
                  aria-hidden="true"
                  onPointerDown={(event) =>
                    beginDrag(event, item.key, "resize")}
                />
              </div>
            )}
          </div>
        );
      })}
      <span className="homi-ui-visually-hidden" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
