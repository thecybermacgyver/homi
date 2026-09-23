CREATE TABLE "core"."household_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"invited_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_core_household_invitations_status" CHECK ("core"."household_invitations"."status" in ('pending', 'accepted', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "core"."household_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp (3) with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_core_memberships_household_id_id" UNIQUE("household_id","id"),
	CONSTRAINT "ck_core_memberships_status" CHECK ("core"."household_memberships"."status" in ('active', 'suspended', 'ended')),
	CONSTRAINT "ck_core_memberships_revision" CHECK ("core"."household_memberships"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."household_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"linked_membership_id" uuid,
	"display_name" text NOT NULL,
	"avatar_file_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_core_household_people_household_id_id" UNIQUE("household_id","id"),
	CONSTRAINT "ck_core_household_people_status" CHECK ("core"."household_people"."status" in ('active', 'inactive')),
	CONSTRAINT "ck_core_household_people_revision" CHECK ("core"."household_people"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_locale" text DEFAULT 'en-CA' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "ck_core_households_status" CHECK ("core"."households"."status" in ('active', 'suspended', 'deleting')),
	CONSTRAINT "ck_core_households_revision" CHECK ("core"."households"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_subject" text NOT NULL,
	"display_name" text NOT NULL,
	"preferred_locale" text DEFAULT 'en-CA' NOT NULL,
	"time_zone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "ck_core_users_status" CHECK ("core"."users"."status" in ('active', 'suspended', 'disabled')),
	CONSTRAINT "ck_core_users_revision" CHECK ("core"."users"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."membership_roles" (
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by_user_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_core_membership_roles" PRIMARY KEY("membership_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "core"."permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "pk_core_role_permissions" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "core"."roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."household_modules" (
	"household_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"enabled_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp (3) with time zone,
	"enabled_by_user_id" uuid NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_core_household_modules" PRIMARY KEY("household_id","module_id"),
	CONSTRAINT "ck_core_household_modules_revision" CHECK ("core"."household_modules"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."module_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"version" text NOT NULL,
	"package_digest" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"migration_state" text DEFAULT 'applied' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp (3) with time zone,
	CONSTRAINT "ck_core_module_versions_migration_state" CHECK ("core"."module_versions"."migration_state" in ('pending', 'applied', 'failed', 'rolled_back'))
);
--> statement-breakpoint
CREATE TABLE "core"."modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_key" text NOT NULL,
	"name" text NOT NULL,
	"publisher" text NOT NULL,
	"state" text DEFAULT 'installed' NOT NULL,
	"current_version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_core_modules_state" CHECK ("core"."modules"."state" in ('installed', 'updating', 'disabled', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "core"."files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"household_id" uuid,
	"owner_user_id" uuid,
	"uploaded_by_user_id" uuid NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "uq_core_files_household_id_id" UNIQUE("household_id","id"),
	CONSTRAINT "ck_core_files_scope" CHECK ("core"."files"."scope" in ('household', 'user', 'system')),
	CONSTRAINT "ck_core_files_status" CHECK ("core"."files"."status" in ('active', 'quarantined', 'deleted')),
	CONSTRAINT "ck_core_files_size" CHECK ("core"."files"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."change_log" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"revision" bigint NOT NULL,
	"changed_by_user_id" uuid,
	"client_id" uuid,
	"changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_core_change_log_operation" CHECK ("core"."change_log"."operation" in ('create', 'update', 'delete')),
	CONSTRAINT "ck_core_change_log_revision" CHECK ("core"."change_log"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_instance_id" uuid NOT NULL,
	"label" text,
	"platform" text,
	"app_version" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."sync_cursors" (
	"client_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"last_change_sequence" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_core_sync_cursors" PRIMARY KEY("client_id","household_id"),
	CONSTRAINT "ck_core_sync_cursors_sequence" CHECK ("core"."sync_cursors"."last_change_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."sync_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"client_mutation_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"base_revision" bigint,
	"status" text DEFAULT 'received' NOT NULL,
	"server_revision" bigint,
	"change_sequence" bigint,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp (3) with time zone,
	"error_code" text,
	CONSTRAINT "ck_core_sync_mutations_status" CHECK ("core"."sync_mutations"."status" in ('received', 'applied', 'conflict', 'rejected')),
	CONSTRAINT "ck_core_sync_mutations_base_revision" CHECK ("core"."sync_mutations"."base_revision" is null or "core"."sync_mutations"."base_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."audit_log" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"household_id" uuid,
	"actor_user_id" uuid,
	"actor_client_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"source_module_key" text DEFAULT 'core' NOT NULL,
	"request_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"source_module_key" text NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text,
	"aggregate_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp (3) with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_module_key" text NOT NULL,
	"notification_type" text NOT NULL,
	"title_key" text NOT NULL,
	"body_key" text NOT NULL,
	"arguments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp (3) with time zone,
	"dismissed_at" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."localization_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" text NOT NULL,
	"message_key" text NOT NULL,
	"source_locale" text NOT NULL,
	"source_text" text NOT NULL,
	"source_hash" text NOT NULL,
	"source_version" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_core_localization_sources_version" CHECK ("core"."localization_sources"."source_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."localization_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"translated_text" text NOT NULL,
	"translation_version" integer NOT NULL,
	"provider_key" text,
	"origin" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reviewed_by_user_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_core_localization_translations_origin" CHECK ("core"."localization_translations"."origin" in ('provider', 'human')),
	CONSTRAINT "ck_core_localization_translations_status" CHECK ("core"."localization_translations"."status" in ('active', 'stale', 'rejected')),
	CONSTRAINT "ck_core_localization_translations_version" CHECK ("core"."localization_translations"."translation_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "core"."backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backup_type" text NOT NULL,
	"app_version" text NOT NULL,
	"database_version" text NOT NULL,
	"storage_location" text NOT NULL,
	"checksum" text NOT NULL,
	"size_bytes" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ck_core_backups_status" CHECK ("core"."backups"."status" in ('pending', 'running', 'complete', 'failed')),
	CONSTRAINT "ck_core_backups_size" CHECK ("core"."backups"."size_bytes" is null or "core"."backups"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."update_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_type" text NOT NULL,
	"module_id" uuid,
	"from_version" text,
	"to_version" text NOT NULL,
	"backup_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"rollback_of_update_id" uuid,
	"error_details" text,
	CONSTRAINT "ck_core_update_runs_component_type" CHECK ("core"."update_runs"."component_type" in ('core', 'module')),
	CONSTRAINT "ck_core_update_runs_status" CHECK ("core"."update_runs"."status" in ('pending', 'running', 'complete', 'failed', 'rolled_back'))
);
--> statement-breakpoint
ALTER TABLE "core"."household_invitations" ADD CONSTRAINT "household_invitations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."household_invitations" ADD CONSTRAINT "household_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."household_invitations" ADD CONSTRAINT "household_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."household_memberships" ADD CONSTRAINT "household_memberships_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."household_memberships" ADD CONSTRAINT "household_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."household_people" ADD CONSTRAINT "household_people_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."household_people" ADD CONSTRAINT "fk_core_household_people_membership_household" FOREIGN KEY ("household_id","linked_membership_id") REFERENCES "core"."household_memberships"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."households" ADD CONSTRAINT "households_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."membership_roles" ADD CONSTRAINT "membership_roles_membership_id_household_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "core"."household_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."membership_roles" ADD CONSTRAINT "membership_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."membership_roles" ADD CONSTRAINT "membership_roles_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "core"."permissions"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."roles" ADD CONSTRAINT "roles_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."household_modules" ADD CONSTRAINT "household_modules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."household_modules" ADD CONSTRAINT "household_modules_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "core"."modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."household_modules" ADD CONSTRAINT "household_modules_enabled_by_user_id_users_id_fk" FOREIGN KEY ("enabled_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."module_versions" ADD CONSTRAINT "module_versions_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "core"."modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."files" ADD CONSTRAINT "files_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."files" ADD CONSTRAINT "files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."files" ADD CONSTRAINT "files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."change_log" ADD CONSTRAINT "change_log_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."change_log" ADD CONSTRAINT "change_log_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."change_log" ADD CONSTRAINT "change_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."sync_cursors" ADD CONSTRAINT "sync_cursors_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."sync_cursors" ADD CONSTRAINT "sync_cursors_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."sync_mutations" ADD CONSTRAINT "sync_mutations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."sync_mutations" ADD CONSTRAINT "sync_mutations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."audit_log" ADD CONSTRAINT "audit_log_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."audit_log" ADD CONSTRAINT "audit_log_actor_client_id_clients_id_fk" FOREIGN KEY ("actor_client_id") REFERENCES "core"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_outbox" ADD CONSTRAINT "event_outbox_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notifications" ADD CONSTRAINT "notifications_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "core"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."localization_translations" ADD CONSTRAINT "localization_translations_source_id_localization_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "core"."localization_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."localization_translations" ADD CONSTRAINT "localization_translations_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."backups" ADD CONSTRAINT "backups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "core"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."update_runs" ADD CONSTRAINT "update_runs_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "core"."modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."update_runs" ADD CONSTRAINT "update_runs_backup_id_backups_id_fk" FOREIGN KEY ("backup_id") REFERENCES "core"."backups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_household_invitations_token_hash" ON "core"."household_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_core_household_invitations_household_status" ON "core"."household_invitations" USING btree ("household_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_memberships_active_user_household" ON "core"."household_memberships" USING btree ("household_id","user_id") WHERE "core"."household_memberships"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "ix_core_memberships_user" ON "core"."household_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_household_people_membership" ON "core"."household_people" USING btree ("linked_membership_id") WHERE "core"."household_people"."linked_membership_id" is not null;--> statement-breakpoint
CREATE INDEX "ix_core_household_people_household" ON "core"."household_people" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_users_auth_subject" ON "core"."users" USING btree ("auth_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_roles_system_key" ON "core"."roles" USING btree ("key") WHERE "core"."roles"."household_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_roles_household_key" ON "core"."roles" USING btree ("household_id","key") WHERE "core"."roles"."household_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_module_versions_module_version" ON "core"."module_versions" USING btree ("module_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_modules_module_key" ON "core"."modules" USING btree ("module_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_files_storage" ON "core"."files" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE INDEX "ix_core_files_household" ON "core"."files" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "ix_core_change_log_household_sequence" ON "core"."change_log" USING btree ("household_id","sequence");--> statement-breakpoint
CREATE INDEX "ix_core_change_log_entity" ON "core"."change_log" USING btree ("household_id","module_key","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_clients_user_instance" ON "core"."clients" USING btree ("user_id","client_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_sync_mutations_client_mutation" ON "core"."sync_mutations" USING btree ("client_id","client_mutation_id");--> statement-breakpoint
CREATE INDEX "ix_core_sync_mutations_household" ON "core"."sync_mutations" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "ix_core_audit_log_household_sequence" ON "core"."audit_log" USING btree ("household_id","sequence");--> statement-breakpoint
CREATE INDEX "ix_core_audit_log_actor" ON "core"."audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_core_event_outbox_pending" ON "core"."event_outbox" USING btree ("available_at") WHERE "core"."event_outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "ix_core_notifications_user_created" ON "core"."notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_core_notifications_user_read" ON "core"."notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_push_subscriptions_endpoint" ON "core"."push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "ix_core_push_subscriptions_user" ON "core"."push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_localization_sources_version" ON "core"."localization_sources" USING btree ("namespace","message_key","source_locale","source_version");--> statement-breakpoint
CREATE INDEX "ix_core_localization_sources_lookup" ON "core"."localization_sources" USING btree ("namespace","message_key","source_locale");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_core_localization_translations_version" ON "core"."localization_translations" USING btree ("source_id","locale","translation_version");--> statement-breakpoint
CREATE INDEX "ix_core_backups_status_created" ON "core"."backups" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ix_core_update_runs_status_started" ON "core"."update_runs" USING btree ("status","started_at");