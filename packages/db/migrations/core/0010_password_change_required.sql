ALTER TABLE "core"."users"
  ADD COLUMN "password_change_required" boolean NOT NULL DEFAULT false;
