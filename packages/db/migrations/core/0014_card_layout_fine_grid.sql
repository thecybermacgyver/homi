-- A member may position and size a Family Board card in eighths of a cell (a card
-- can be 2 3/8 cells wide), so resizing follows the pointer closely instead of
-- jumping a whole cell at a time. The saved layout keeps its shape (x, y, w, h in
-- cells); the numbers may now be any multiple of 1/8, a card may be as small as half
-- a cell, and a card may start no lower than row 999, be at most 40 rows tall, and
-- end within the board's columns (4 on a phone, 8 wide). This only relaxes the
-- constraints, so every layout already saved (whole numbers) stays valid, and it
-- is safe to run twice.
ALTER TABLE "core"."household_member_module_preferences"
  DROP CONSTRAINT IF EXISTS "ck_core_member_module_preferences_phone_layout";
--> statement-breakpoint
ALTER TABLE "core"."household_member_module_preferences"
  ADD CONSTRAINT "ck_core_member_module_preferences_phone_layout"
  CHECK (
    "phone_layout" IS NULL OR (
      jsonb_typeof("phone_layout") = 'object'
      AND "phone_layout" - 'x' - 'y' - 'w' - 'h' = '{}'::jsonb
      AND jsonb_typeof("phone_layout" -> 'x') = 'number'
      AND jsonb_typeof("phone_layout" -> 'y') = 'number'
      AND jsonb_typeof("phone_layout" -> 'w') = 'number'
      AND jsonb_typeof("phone_layout" -> 'h') = 'number'
      AND ("phone_layout" ->> 'x')::numeric >= 0
      AND ("phone_layout" ->> 'y')::numeric BETWEEN 0 AND 999
      AND ("phone_layout" ->> 'w')::numeric >= 0.5
      AND ("phone_layout" ->> 'h')::numeric BETWEEN 0.5 AND 40
      AND ("phone_layout" ->> 'x')::numeric * 8 = trunc(("phone_layout" ->> 'x')::numeric * 8)
      AND ("phone_layout" ->> 'y')::numeric * 8 = trunc(("phone_layout" ->> 'y')::numeric * 8)
      AND ("phone_layout" ->> 'w')::numeric * 8 = trunc(("phone_layout" ->> 'w')::numeric * 8)
      AND ("phone_layout" ->> 'h')::numeric * 8 = trunc(("phone_layout" ->> 'h')::numeric * 8)
      AND ("phone_layout" ->> 'x')::numeric + ("phone_layout" ->> 'w')::numeric <= 4
    )
  );
--> statement-breakpoint
ALTER TABLE "core"."household_member_module_preferences"
  DROP CONSTRAINT IF EXISTS "ck_core_member_module_preferences_wide_layout";
--> statement-breakpoint
ALTER TABLE "core"."household_member_module_preferences"
  ADD CONSTRAINT "ck_core_member_module_preferences_wide_layout"
  CHECK (
    "wide_layout" IS NULL OR (
      jsonb_typeof("wide_layout") = 'object'
      AND "wide_layout" - 'x' - 'y' - 'w' - 'h' = '{}'::jsonb
      AND jsonb_typeof("wide_layout" -> 'x') = 'number'
      AND jsonb_typeof("wide_layout" -> 'y') = 'number'
      AND jsonb_typeof("wide_layout" -> 'w') = 'number'
      AND jsonb_typeof("wide_layout" -> 'h') = 'number'
      AND ("wide_layout" ->> 'x')::numeric >= 0
      AND ("wide_layout" ->> 'y')::numeric BETWEEN 0 AND 999
      AND ("wide_layout" ->> 'w')::numeric >= 0.5
      AND ("wide_layout" ->> 'h')::numeric BETWEEN 0.5 AND 40
      AND ("wide_layout" ->> 'x')::numeric * 8 = trunc(("wide_layout" ->> 'x')::numeric * 8)
      AND ("wide_layout" ->> 'y')::numeric * 8 = trunc(("wide_layout" ->> 'y')::numeric * 8)
      AND ("wide_layout" ->> 'w')::numeric * 8 = trunc(("wide_layout" ->> 'w')::numeric * 8)
      AND ("wide_layout" ->> 'h')::numeric * 8 = trunc(("wide_layout" ->> 'h')::numeric * 8)
      AND ("wide_layout" ->> 'x')::numeric + ("wide_layout" ->> 'w')::numeric <= 8
    )
  );
