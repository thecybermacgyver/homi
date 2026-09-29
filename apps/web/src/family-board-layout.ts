import {
  HOMI_FAMILY_BOARD_MAX_ROW,
  type HomiFamilyBoardCardLimits,
  type HomiFamilyBoardPlacement,
} from "@homi/module-sdk";

export interface FamilyBoardLayoutCard {
  readonly key: string;
  readonly saved: HomiFamilyBoardPlacement | null;
  readonly limits: HomiFamilyBoardCardLimits;
}

export type FamilyBoardArrangement = ReadonlyMap<
  string,
  HomiFamilyBoardPlacement
>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function overlaps(
  left: HomiFamilyBoardPlacement,
  right: HomiFamilyBoardPlacement,
): boolean {
  return (
    left.x < right.x + right.w &&
    right.x < left.x + left.w &&
    left.y < right.y + right.h &&
    right.y < left.y + left.h
  );
}

// Keeps a placement on the board and within the card's current limits, which
// a module update may have changed since the placement was saved.
export function fitPlacement(
  placement: HomiFamilyBoardPlacement,
  limits: HomiFamilyBoardCardLimits,
  columns: number,
): HomiFamilyBoardPlacement {
  const w = clamp(placement.w, limits.min.w, Math.min(limits.max.w, columns));
  const h = clamp(placement.h, limits.min.h, limits.max.h);
  return Object.freeze({
    x: clamp(placement.x, 0, columns - w),
    y: clamp(placement.y, 0, HOMI_FAMILY_BOARD_MAX_ROW),
    w,
    h,
  });
}

function bottom(placements: Iterable<HomiFamilyBoardPlacement>): number {
  let result = 0;
  for (const placement of placements) {
    result = Math.max(result, placement.y + placement.h);
  }
  return result;
}

function firstFreeSpot(
  taken: readonly HomiFamilyBoardPlacement[],
  size: { readonly w: number; readonly h: number },
  fromRow: number,
  columns: number,
): HomiFamilyBoardPlacement {
  for (let y = fromRow; ; y += 1) {
    for (let x = 0; x + size.w <= columns; x += 1) {
      const candidate = { x, y, w: size.w, h: size.h };
      if (!taken.some((placement) => overlaps(placement, candidate))) {
        return Object.freeze(candidate);
      }
    }
  }
}

// Saved placements are kept exactly where the member put them, empty spaces
// included. Cards without one, and cards whose saved spot is now taken (a
// card shown again after another moved there), are packed in display order:
// from the top when nothing is placed yet, otherwise below the arrangement so
// they never fill a space the member left empty.
export function arrangeFamilyBoard(
  cards: readonly FamilyBoardLayoutCard[],
  columns: number,
): FamilyBoardArrangement {
  const arrangement = new Map<string, HomiFamilyBoardPlacement>();
  const unplaced: { card: FamilyBoardLayoutCard; size: { w: number; h: number } }[] = [];

  for (const card of cards) {
    if (card.saved === null) {
      const fitted = fitPlacement(
        { x: 0, y: 0, ...card.limits.default },
        card.limits,
        columns,
      );
      unplaced.push({ card, size: { w: fitted.w, h: fitted.h } });
      continue;
    }
    const fitted = fitPlacement(card.saved, card.limits, columns);
    if ([...arrangement.values()].some((placed) => overlaps(placed, fitted))) {
      unplaced.push({ card, size: { w: fitted.w, h: fitted.h } });
      continue;
    }
    arrangement.set(card.key, fitted);
  }

  const fromRow = bottom(arrangement.values());
  for (const { card, size } of unplaced) {
    arrangement.set(
      card.key,
      firstFreeSpot([...arrangement.values()], size, fromRow, columns),
    );
  }
  return arrangement;
}

// Puts one card at a new placement. Cards it lands on move straight down just
// far enough to clear it, and any they land on in turn; nothing else moves.
export function placeFamilyBoardCard(
  arrangement: FamilyBoardArrangement,
  key: string,
  target: HomiFamilyBoardPlacement,
): FamilyBoardArrangement {
  const result = new Map<string, HomiFamilyBoardPlacement>([[key, target]]);
  const settled: HomiFamilyBoardPlacement[] = [target];
  const others = [...arrangement]
    .filter(([otherKey]) => otherKey !== key)
    .sort(([, left], [, right]) => left.y - right.y || left.x - right.x);

  for (const [otherKey, placement] of others) {
    let moved = placement;
    for (;;) {
      const blocker = settled.find((other) => overlaps(other, moved));
      if (!blocker) break;
      moved = Object.freeze({ ...moved, y: blocker.y + blocker.h });
    }
    settled.push(moved);
    result.set(otherKey, moved);
  }

  // Keep the caller's card order so rendering and saving stay stable.
  return new Map(
    [...arrangement.keys()].map((cardKey) => [cardKey, result.get(cardKey)!]),
  );
}

export function sameFamilyBoardPlacement(
  left: HomiFamilyBoardPlacement | null | undefined,
  right: HomiFamilyBoardPlacement | null | undefined,
): boolean {
  return (
    left === right ||
    (left != null &&
      right != null &&
      left.x === right.x &&
      left.y === right.y &&
      left.w === right.w &&
      left.h === right.h)
  );
}
