// The Family Board is a grid of equal columns and fixed-height rows. The wide
// layout has twice the phone layout's columns, so one column is roughly the
// same physical width on both and a card's declared size reads the same.
//
// Positions and sizes are measured in those cells but may be any multiple of
// 1/8 of a cell (a card can be 2 3/8 cells wide), so a member can size and place
// a card almost continuously while saved layouts stay screen-independent.
export const HOMI_FAMILY_BOARD_COLUMNS = Object.freeze({
  wide: 8,
  phone: 4,
});

// A saved position or size is a multiple of this fraction of a cell: 1 / 8.
export const HOMI_FAMILY_BOARD_GRANULARITY = 8;
// The smallest a card may be, in cells.
export const HOMI_FAMILY_BOARD_MIN_CARD_CELLS = 0.5;

// Rounds a measurement in cells to the nearest 1/8 of a cell.
export function snapToFamilyBoardGrid(cells: number): number {
  return Math.round(cells * HOMI_FAMILY_BOARD_GRANULARITY) / HOMI_FAMILY_BOARD_GRANULARITY;
}

function onFamilyBoardGrid(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value * HOMI_FAMILY_BOARD_GRANULARITY)
  );
}

// A card may be any size from half a cell up to the whole board. Forty rows is far
// taller than any screen, so a member can always make a card as big as their
// display; it only keeps stored layouts bounded.
export const HOMI_FAMILY_BOARD_MAX_CARD_ROWS = 40;
// Highest row a card may start on. Keeps stored layouts bounded.
export const HOMI_FAMILY_BOARD_MAX_ROW = 999;

export type HomiFamilyBoardLayout = keyof typeof HOMI_FAMILY_BOARD_COLUMNS;

export interface HomiFamilyBoardCardDimensions {
  w: number;
  h: number;
}

// Sizes are in wide-layout grid units: w columns of 8, h rows.
export interface HomiModuleFamilyBoardSizeManifest {
  default: HomiFamilyBoardCardDimensions;
  min?: HomiFamilyBoardCardDimensions;
  max?: HomiFamilyBoardCardDimensions;
}

export interface HomiFamilyBoardCardLimits {
  readonly default: Readonly<HomiFamilyBoardCardDimensions>;
  readonly min: Readonly<HomiFamilyBoardCardDimensions>;
  readonly max: Readonly<HomiFamilyBoardCardDimensions>;
}

export interface HomiFamilyBoardPlacement {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const UNDECLARED: HomiModuleFamilyBoardSizeManifest = Object.freeze({
  default: Object.freeze({ w: 4, h: 4 }),
});

// A phone column is half a wide one's share of the screen, so a card declared
// wider than half the wide board starts at the phone's full width, and a card
// declared one column wide starts two columns wide so it is readable.
function phoneWidth(w: number): number {
  return w <= 2
    ? Math.max(w, 2)
    : HOMI_FAMILY_BOARD_COLUMNS.phone;
}

// A member may size any card from half a cell to the whole board, on every screen.
// A module's declared size gives only the starting size: its `min` and `max`
// are still accepted in a manifest but no longer limit the member, because the
// card's contents scale to fit whatever size is chosen.
export function resolveHomiFamilyBoardCardLimits(
  size: HomiModuleFamilyBoardSizeManifest | undefined,
  layout: HomiFamilyBoardLayout,
): HomiFamilyBoardCardLimits {
  const declared = size ?? UNDECLARED;
  const columns = HOMI_FAMILY_BOARD_COLUMNS[layout];
  const start =
    layout === "wide"
      ? declared.default
      : { w: phoneWidth(declared.default.w), h: declared.default.h };
  return Object.freeze({
    default: Object.freeze({
      w: Math.min(Math.max(start.w, 1), columns),
      h: Math.min(Math.max(start.h, 1), HOMI_FAMILY_BOARD_MAX_CARD_ROWS),
    }),
    min: Object.freeze({
      w: HOMI_FAMILY_BOARD_MIN_CARD_CELLS,
      h: HOMI_FAMILY_BOARD_MIN_CARD_CELLS,
    }),
    max: Object.freeze({ w: columns, h: HOMI_FAMILY_BOARD_MAX_CARD_ROWS }),
  });
}

// True when a stored placement is a whole-cell rectangle on the board. It
// does not check module limits, which may change with a module update.
export function isHomiFamilyBoardPlacement(
  value: unknown,
  layout: HomiFamilyBoardLayout,
): value is HomiFamilyBoardPlacement {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length !== 4 ||
    !["x", "y", "w", "h"].every((key) => keys.includes(key)) ||
    !["x", "y", "w", "h"].every((key) => onFamilyBoardGrid(input[key]))
  ) {
    return false;
  }
  const { x, y, w, h } = input as unknown as HomiFamilyBoardPlacement;
  const columns = HOMI_FAMILY_BOARD_COLUMNS[layout];
  return (
    x >= 0 &&
    y >= 0 &&
    y <= HOMI_FAMILY_BOARD_MAX_ROW &&
    w >= HOMI_FAMILY_BOARD_MIN_CARD_CELLS &&
    h >= HOMI_FAMILY_BOARD_MIN_CARD_CELLS &&
    h <= HOMI_FAMILY_BOARD_MAX_CARD_ROWS &&
    x + w <= columns
  );
}
