-- A member may size any Family Board card from one cell to the whole board, so a
-- saved card layout may now be up to 40 rows tall (it used to stop at 12, the tallest
-- a module could declare). Every other rule is unchanged: whole numbers, the board's
-- columns (4 on a phone, 8 wide), and a row no lower than 999. This only relaxes the
-- constraint, so every layout already saved stays valid.
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
      AND ("phone_layout" ->> 'x') ~ '^[0-9]+$'
      AND ("phone_layout" ->> 'y') ~ '^[0-9]+$'
      AND ("phone_layout" ->> 'w') ~ '^[0-9]+$'
      AND ("phone_layout" ->> 'h') ~ '^[0-9]+$'
      AND ("phone_layout" ->> 'y')::integer <= 999
      AND ("phone_layout" ->> 'w')::integer >= 1
      AND ("phone_layout" ->> 'h')::integer BETWEEN 1 AND 40
      AND ("phone_layout" ->> 'x')::integer
        + ("phone_layout" ->> 'w')::integer <= 4
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
      AND ("wide_layout" ->> 'x') ~ '^[0-9]+$'
      AND ("wide_layout" ->> 'y') ~ '^[0-9]+$'
      AND ("wide_layout" ->> 'w') ~ '^[0-9]+$'
      AND ("wide_layout" ->> 'h') ~ '^[0-9]+$'
      AND ("wide_layout" ->> 'y')::integer <= 999
      AND ("wide_layout" ->> 'w')::integer >= 1
      AND ("wide_layout" ->> 'h')::integer BETWEEN 1 AND 40
      AND ("wide_layout" ->> 'x')::integer
        + ("wide_layout" ->> 'w')::integer <= 8
    )
  );
