CREATE TABLE core.module_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES core.households(id) ON DELETE RESTRICT,
  module_id uuid NOT NULL REFERENCES core.modules(id) ON DELETE RESTRICT,
  secret_key text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_core_module_secrets_revision CHECK (revision >= 1)
);

CREATE UNIQUE INDEX uq_core_module_secrets_scope_key
  ON core.module_secrets (household_id, module_id, secret_key);

CREATE TABLE core.module_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES core.households(id) ON DELETE RESTRICT,
  module_id uuid NOT NULL REFERENCES core.modules(id) ON DELETE RESTRICT,
  job_type text NOT NULL,
  run_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  context jsonb NOT NULL,
  dedupe_key text,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_core_module_jobs_status
    CHECK (status IN ('pending', 'running', 'complete', 'failed', 'cancelled')),
  CONSTRAINT ck_core_module_jobs_attempt_count
    CHECK (attempt_count >= 0)
);

CREATE INDEX ix_core_module_jobs_due
  ON core.module_jobs (run_at, created_at)
  WHERE status = 'pending';

CREATE INDEX ix_core_module_jobs_scope
  ON core.module_jobs (household_id, module_id, status, run_at);

CREATE UNIQUE INDEX uq_core_module_jobs_pending_dedupe
  ON core.module_jobs (household_id, module_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status = 'pending';
