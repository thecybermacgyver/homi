import assert from "node:assert/strict";
import test from "node:test";
import { resolveHomiFamilyBoardCardLimits } from "@homi/module-sdk";
import {
  arrangeFamilyBoard,
  fitPlacement,
  overlaps,
  placeFamilyBoardCard,
  type FamilyBoardLayoutCard,
} from "./family-board-layout.js";

const halfWidth = resolveHomiFamilyBoardCardLimits(undefined, "wide");
const small = resolveHomiFamilyBoardCardLimits(
  { default: { w: 2, h: 2 }, min: { w: 2, h: 2 }, max: { w: 4, h: 3 } },
  "wide",
);

function card(
  key: string,
  saved: FamilyBoardLayoutCard["saved"] = null,
  limits = halfWidth,
): FamilyBoardLayoutCard {
  return { key, saved, limits };
}

function noOverlaps(arrangement: ReadonlyMap<string, { x: number; y: number; w: number; h: number }>) {
  const placements = [...arrangement.values()];
  placements.forEach((left, index) =>
    placements.slice(index + 1).forEach((right) =>
      assert.equal(overlaps(left, right), false)));
}

test("cards without saved places pack from the top in display order", () => {
  const arrangement = arrangeFamilyBoard(
    [card("a"), card("b"), card("c", null, small), card("d", null, small)],
    8,
  );
  assert.deepEqual(arrangement.get("a"), { x: 0, y: 0, w: 4, h: 4 });
  assert.deepEqual(arrangement.get("b"), { x: 4, y: 0, w: 4, h: 4 });
  assert.deepEqual(arrangement.get("c"), { x: 0, y: 4, w: 2, h: 2 });
  assert.deepEqual(arrangement.get("d"), { x: 2, y: 4, w: 2, h: 2 });
});

test("saved places, and the empty spaces between them, are kept", () => {
  const arrangement = arrangeFamilyBoard(
    [
      card("a", { x: 0, y: 0, w: 2, h: 2 }),
      card("b", { x: 6, y: 5, w: 2, h: 2 }),
    ],
    8,
  );
  assert.deepEqual(arrangement.get("a"), { x: 0, y: 0, w: 2, h: 2 });
  assert.deepEqual(arrangement.get("b"), { x: 6, y: 5, w: 2, h: 2 });
});

test("a newly added card goes below the arrangement, not into a gap", () => {
  const arrangement = arrangeFamilyBoard(
    [
      card("a", { x: 0, y: 0, w: 2, h: 2 }),
      card("b", { x: 6, y: 0, w: 2, h: 3 }),
      card("new", null, small),
    ],
    8,
  );
  assert.deepEqual(arrangement.get("new"), { x: 0, y: 3, w: 2, h: 2 });
});

test("a card whose saved spot is now taken moves below instead of overlapping", () => {
  const arrangement = arrangeFamilyBoard(
    [
      card("a", { x: 0, y: 0, w: 4, h: 4 }),
      card("returning", { x: 2, y: 1, w: 3, h: 2 }),
    ],
    8,
  );
  assert.deepEqual(arrangement.get("returning"), { x: 0, y: 4, w: 3, h: 2 });
  noOverlaps(arrangement);
});

test("saved places are fitted to the board, not to a module's declared limits", () => {
  // A declared max of 4 x 3 no longer limits the member: the card keeps its
  // size and only moves left so it stays on the board.
  assert.deepEqual(
    fitPlacement({ x: 7, y: 0, w: 6, h: 9 }, small, 8),
    { x: 2, y: 0, w: 6, h: 9 },
  );
  // A card can be one column wide on a phone and as tall as the screen needs.
  const phone = resolveHomiFamilyBoardCardLimits(undefined, "phone");
  assert.deepEqual(
    fitPlacement({ x: 3, y: 2, w: 1, h: 4 }, phone, 4),
    { x: 3, y: 2, w: 1, h: 4 },
  );
  assert.deepEqual(
    fitPlacement({ x: 0, y: 0, w: 9, h: 99 }, halfWidth, 8),
    { x: 0, y: 0, w: 8, h: 40 },
  );
});

test("any card can be half a cell on any screen, and starts at least two columns wide on a phone", () => {
  const size = {
    default: { w: 2, h: 2 },
    min: { w: 1, h: 2 },
    max: { w: 4, h: 6 },
  };
  assert.deepEqual(resolveHomiFamilyBoardCardLimits(size, "wide").min, { w: 0.5, h: 0.5 });
  assert.deepEqual(resolveHomiFamilyBoardCardLimits(size, "phone").min, { w: 0.5, h: 0.5 });
  assert.deepEqual(resolveHomiFamilyBoardCardLimits(size, "wide").max, { w: 8, h: 40 });
  assert.deepEqual(resolveHomiFamilyBoardCardLimits(size, "phone").max, { w: 4, h: 40 });
  assert.equal(
    resolveHomiFamilyBoardCardLimits(
      { ...size, default: { w: 1, h: 2 } },
      "phone",
    ).default.w,
    2,
  );
});

test("placing a card pushes only the cards it lands on straight down", () => {
  const start = arrangeFamilyBoard(
    [
      card("a", { x: 0, y: 0, w: 4, h: 4 }),
      card("b", { x: 4, y: 0, w: 4, h: 4 }),
      card("c", { x: 0, y: 6, w: 4, h: 2 }),
      card("d", { x: 4, y: 4, w: 4, h: 2 }),
    ],
    8,
  );
  const moved = placeFamilyBoardCard(start, "c", { x: 4, y: 1, w: 4, h: 2 });
  assert.deepEqual(moved.get("c"), { x: 4, y: 1, w: 4, h: 2 });
  assert.deepEqual(moved.get("a"), { x: 0, y: 0, w: 4, h: 4 });
  assert.deepEqual(moved.get("b"), { x: 4, y: 3, w: 4, h: 4 });
  assert.deepEqual(moved.get("d"), { x: 4, y: 7, w: 4, h: 2 });
  assert.deepEqual([...moved.keys()], ["a", "b", "c", "d"]);
  noOverlaps(moved);
});

test("moving a card away leaves its old space empty", () => {
  const start = arrangeFamilyBoard(
    [
      card("a", { x: 0, y: 0, w: 4, h: 4 }),
      card("b", { x: 0, y: 4, w: 4, h: 4 }),
    ],
    8,
  );
  const moved = placeFamilyBoardCard(start, "a", { x: 4, y: 0, w: 4, h: 4 });
  assert.deepEqual(moved.get("b"), { x: 0, y: 4, w: 4, h: 4 });
});

test("fractional placements pack, push and compare exactly", () => {
  // Multiples of 1/8 are exact in binary, so overlap and push arithmetic is exact.
  const a = { x: 0, y: 0, w: 2.375, h: 3.125 };
  const b = { x: 2.375, y: 0, w: 1.625, h: 3.125 };
  assert.equal(overlaps(a, b), false, "cards that meet edge to edge do not overlap");
  assert.equal(overlaps(a, { ...b, x: 2.25 }), true);
  const arrangement = new Map([["a", a], ["b", b]]);
  const placed = placeFamilyBoardCard(arrangement, "a", { x: 1.5, y: 0.125, w: 2.375, h: 2.5 });
  assert.deepEqual(placed.get("a"), { x: 1.5, y: 0.125, w: 2.375, h: 2.5 });
  const pushed = placed.get("b")!;
  assert.equal(pushed.x, 2.375);
  assert.equal(pushed.y, 2.625, "the card it landed on moves straight down to just clear it (0.125 + 2.5)");
  assert.equal(overlaps(placed.get("a")!, pushed), false);
  assert.deepEqual(fitPlacement({ x: 7.5, y: 0, w: 2.375, h: 0.125 }, halfWidth, 8), { x: 5.625, y: 0, w: 2.375, h: 0.5 }, "kept on the board and no smaller than half a cell");
});
