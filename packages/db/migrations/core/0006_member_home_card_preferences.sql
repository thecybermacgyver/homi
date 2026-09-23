ALTER TABLE "core"."household_member_module_preferences"
  ADD COLUMN "surface_id" text;
--> statement-breakpoint
UPDATE "core"."household_member_module_preferences" AS p
SET "surface_id" = first_card."surface_id"
FROM (
  SELECT DISTINCT ON (m.id)
    m.id AS module_id,
    contribution.value ->> 'surfaceId' AS surface_id
  FROM "core"."modules" AS m
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(
      m.manifest -> 'extensions' -> 'familyBoard',
      '[]'::jsonb
    )
  ) WITH ORDINALITY AS contribution(value, ordinal)
  ORDER BY m.id, contribution.ordinal
) AS first_card
WHERE first_card.module_id = p.module_id;
--> statement-breakpoint
DELETE FROM "core"."household_member_module_preferences"
WHERE "surface_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "core"."household_member_module_preferences"
  ALTER COLUMN "surface_id" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "core"."uq_core_member_module_preferences";
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_member_module_preferences"
  ON "core"."household_member_module_preferences" USING btree
  (
    "household_id",
    "membership_id",
    "module_id",
    "surface_id"
  );
