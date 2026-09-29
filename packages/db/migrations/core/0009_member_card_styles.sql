ALTER TABLE "core"."household_member_module_preferences"
  ADD COLUMN "card_style" text;
--> statement-breakpoint
ALTER TABLE "core"."household_member_module_preferences"
  ADD CONSTRAINT "ck_core_member_module_preferences_card_style"
  CHECK ("card_style" IS NULL OR "card_style" ~ '^[a-z][a-z0-9-]{0,63}$');
