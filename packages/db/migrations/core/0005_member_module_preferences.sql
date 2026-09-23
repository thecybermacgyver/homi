ALTER TABLE "core"."change_log"
  ADD COLUMN "recipient_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "core"."change_log"
  ADD CONSTRAINT "change_log_recipient_user_id_users_id_fk"
  FOREIGN KEY ("recipient_user_id") REFERENCES "core"."users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ix_core_change_log_recipient_sequence"
  ON "core"."change_log" USING btree
  ("household_id", "recipient_user_id", "sequence");
--> statement-breakpoint
CREATE TABLE "core"."household_member_module_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "membership_id" uuid NOT NULL,
  "module_id" uuid NOT NULL,
  "visible" boolean DEFAULT true NOT NULL,
  "display_order" integer NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ck_core_member_module_preferences_display_order"
    CHECK ("display_order" >= 0),
  CONSTRAINT "ck_core_member_module_preferences_revision"
    CHECK ("revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "core"."household_member_module_preferences"
  ADD CONSTRAINT "household_member_module_preferences_household_id_households_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "core"."households"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."household_member_module_preferences"
  ADD CONSTRAINT "household_member_module_preferences_module_id_modules_id_fk"
  FOREIGN KEY ("module_id") REFERENCES "core"."modules"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "core"."household_member_module_preferences"
  ADD CONSTRAINT "fk_core_member_module_preferences_membership_household"
  FOREIGN KEY ("household_id", "membership_id")
  REFERENCES "core"."household_memberships"("household_id", "id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_member_module_preferences"
  ON "core"."household_member_module_preferences" USING btree
  ("household_id", "membership_id", "module_id");
--> statement-breakpoint
CREATE INDEX "ix_core_member_module_preferences_order"
  ON "core"."household_member_module_preferences" USING btree
  ("household_id", "membership_id", "display_order");
