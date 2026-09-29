// The Family Board is a grid of equal columns and fixed-height rows. The wide
// layout has twice the phone layout's columns, so one column is roughly the
// same physical width on both and a card's declared size reads the same.
export const HOMI_FAMILY_BOARD_COLUMNS = Object.freeze({
  wide: 8,
  phone: 4,
});

export const HOMI_FAMILY_BOARD_MAX_CARD_ROWS = 12;
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

// A phone column is half a wide one's share of the screen, so a card wider
// than half the wide board fills the phone's width.
function phoneWidth(w: number): number {
  return w <= 2 ? w : HOMI_FAMILY_BOARD_COLUMNS.phone;
}

export function resolveHomiFamilyBoardCardLimits(
  size: HomiModuleFamilyBoardSizeManifest | undefined,
  layout: HomiFamilyBoardLayout,
): HomiFamilyBoardCardLimits {
  const declared = size ?? UNDECLARED;
  const wide = {
    default: declared.default,
    min: declared.min ?? {
      w: Math.min(2, declared.default.w),
      h: Math.min(2, declared.default.h),
    },
    max: declared.max ?? {
      w: HOMI_FAMILY_BOARD_COLUMNS.wide,
      h: HOMI_FAMILY_BOARD_MAX_CARD_ROWS,
    },
  };
  if (layout === "wide") {
    return Object.freeze({
      default: Object.freeze({ ...wide.default }),
      min: Object.freeze({ ...wide.min }),
      max: Object.freeze({ ...wide.max }),
    });
  }
  return Object.freeze({
    default: Object.freeze({
      w: phoneWidth(wide.default.w),
      h: wide.default.h,
    }),
    min: Object.freeze({
      w: Math.min(wide.min.w, HOMI_FAMILY_BOARD_COLUMNS.phone),
      h: wide.min.h,
    }),
    max: Object.freeze({
      w: HOMI_FAMILY_BOARD_COLUMNS.phone,
      h: wide.max.h,
    }),
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
    !["x", "y", "w", "h"].every((key) => Number.isSafeInteger(input[key]))
  ) {
    return false;
  }
  const { x, y, w, h } = input as unknown as HomiFamilyBoardPlacement;
  const columns = HOMI_FAMILY_BOARD_COLUMNS[layout];
  return (
    x >= 0 &&
    y >= 0 &&
    y <= HOMI_FAMILY_BOARD_MAX_ROW &&
    w >= 1 &&
    h >= 1 &&
    h <= HOMI_FAMILY_BOARD_MAX_CARD_ROWS &&
    x + w <= columns
  );
}
