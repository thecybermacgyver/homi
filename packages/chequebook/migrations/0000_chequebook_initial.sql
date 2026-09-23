CREATE TABLE mod_chequebook.accounts (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  opening_date date NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_chequebook_accounts_name
    CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT ck_chequebook_accounts_type
    CHECK (type IN ('checking','savings','cash','credit')),
  CONSTRAINT ck_chequebook_accounts_revision CHECK (revision >= 1)
);

CREATE INDEX ix_chequebook_accounts_household
  ON mod_chequebook.accounts (household_id, archived, name)
  WHERE deleted_at IS NULL;

CREATE TABLE mod_chequebook.categories (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'expense',
  color text NOT NULL DEFAULT 'blue',
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT uq_chequebook_category_name
    UNIQUE (household_id, name),
  CONSTRAINT ck_chequebook_categories_name
    CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT ck_chequebook_categories_kind
    CHECK (kind IN ('expense','income','both')),
  CONSTRAINT ck_chequebook_categories_color
    CHECK (color IN (
      'red','orange','yellow','lime','green','dark green','aqua','cyan',
      'blue','navy','purple','violet','pink','magenta','brown','black'
    )),
  CONSTRAINT ck_chequebook_categories_revision CHECK (revision >= 1)
);

CREATE INDEX ix_chequebook_categories_household
  ON mod_chequebook.categories (household_id, archived, name)
  WHERE deleted_at IS NULL;

CREATE TABLE mod_chequebook.household_settings (
  household_id uuid PRIMARY KEY,
  currency text NOT NULL DEFAULT 'CAD',
  default_account_id uuid NOT NULL
    REFERENCES mod_chequebook.accounts(id),
  low_balance_threshold numeric(14,2),
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT ck_chequebook_settings_currency
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_chequebook_settings_revision CHECK (revision >= 1)
);

CREATE TABLE mod_chequebook.transactions (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  account_id uuid NOT NULL
    REFERENCES mod_chequebook.accounts(id),
  transfer_account_id uuid
    REFERENCES mod_chequebook.accounts(id),
  category_id uuid
    REFERENCES mod_chequebook.categories(id),
  person_id uuid,
  kind text NOT NULL,
  amount numeric(14,2) NOT NULL,
  description text NOT NULL,
  payee text,
  date date NOT NULL,
  cleared boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz(3),
  notes text,
  recurring_rule_id uuid,
  recurring_occurrence_date date,
  calendar_link_enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_chequebook_transactions_kind
    CHECK (kind IN ('expense','income','transfer')),
  CONSTRAINT ck_chequebook_transactions_amount
    CHECK (amount > 0 AND amount <= 999999999999.99),
  CONSTRAINT ck_chequebook_transactions_description
    CHECK (length(btrim(description)) BETWEEN 1 AND 200),
  CONSTRAINT ck_chequebook_transactions_recurring_source
    CHECK (
      (recurring_rule_id IS NULL AND recurring_occurrence_date IS NULL)
      OR
      (recurring_rule_id IS NOT NULL AND recurring_occurrence_date IS NOT NULL)
    ),
  CONSTRAINT ck_chequebook_transactions_shape
    CHECK (
      (
        kind = 'transfer'
        AND transfer_account_id IS NOT NULL
        AND transfer_account_id <> account_id
        AND category_id IS NULL
      )
      OR
      (
        kind IN ('expense','income')
        AND transfer_account_id IS NULL
      )
    ),
  CONSTRAINT ck_chequebook_transactions_revision CHECK (revision >= 1)
);

CREATE INDEX ix_chequebook_transactions_household_date
  ON mod_chequebook.transactions (household_id, date DESC, id)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_chequebook_transactions_account_date
  ON mod_chequebook.transactions (household_id, account_id, date DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE mod_chequebook.recurring_rules (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  account_id uuid NOT NULL
    REFERENCES mod_chequebook.accounts(id),
  transfer_account_id uuid
    REFERENCES mod_chequebook.accounts(id),
  category_id uuid
    REFERENCES mod_chequebook.categories(id),
  person_id uuid,
  kind text NOT NULL,
  amount numeric(14,2) NOT NULL,
  label text NOT NULL,
  notes text,
  start_date date NOT NULL,
  frequency text NOT NULL,
  recurrence_interval integer NOT NULL DEFAULT 1,
  recurrence_until date,
  active boolean NOT NULL DEFAULT true,
  calendar_link_enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT ck_chequebook_recurring_kind
    CHECK (kind IN ('expense','income','transfer')),
  CONSTRAINT ck_chequebook_recurring_amount
    CHECK (amount > 0 AND amount <= 999999999999.99),
  CONSTRAINT ck_chequebook_recurring_label
    CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CONSTRAINT ck_chequebook_recurring_frequency
    CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  CONSTRAINT ck_chequebook_recurring_interval
    CHECK (recurrence_interval BETWEEN 1 AND 365),
  CONSTRAINT ck_chequebook_recurring_until
    CHECK (recurrence_until IS NULL OR recurrence_until >= start_date),
  CONSTRAINT ck_chequebook_recurring_shape
    CHECK (
      (
        kind = 'transfer'
        AND transfer_account_id IS NOT NULL
        AND transfer_account_id <> account_id
        AND category_id IS NULL
      )
      OR
      (
        kind IN ('expense','income')
        AND transfer_account_id IS NULL
      )
    ),
  CONSTRAINT ck_chequebook_recurring_revision CHECK (revision >= 1)
);

CREATE INDEX ix_chequebook_recurring_household
  ON mod_chequebook.recurring_rules
    (household_id, active, start_date, id)
  WHERE deleted_at IS NULL;

ALTER TABLE mod_chequebook.transactions
  ADD CONSTRAINT fk_chequebook_transaction_recurring_rule
  FOREIGN KEY (recurring_rule_id)
  REFERENCES mod_chequebook.recurring_rules(id)
  ON DELETE SET NULL;

CREATE UNIQUE INDEX uq_chequebook_transaction_recurring_occurrence
  ON mod_chequebook.transactions
    (household_id, recurring_rule_id, recurring_occurrence_date)
  WHERE deleted_at IS NULL
    AND recurring_rule_id IS NOT NULL
    AND recurring_occurrence_date IS NOT NULL;

CREATE TABLE mod_chequebook.recurring_occurrences (
  recurring_rule_id uuid NOT NULL
    REFERENCES mod_chequebook.recurring_rules(id)
    ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  posted_transaction_id uuid
    REFERENCES mod_chequebook.transactions(id)
    ON DELETE SET NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (recurring_rule_id, occurrence_date),
  CONSTRAINT ck_chequebook_occurrence_status
    CHECK (status IN ('pending','posted','skipped'))
);

CREATE TABLE mod_chequebook.budget_limits (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  category_id uuid NOT NULL
    REFERENCES mod_chequebook.categories(id),
  budget_month date NOT NULL,
  amount numeric(14,2) NOT NULL,
  rollover_enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deleted_at timestamptz(3),
  CONSTRAINT uq_chequebook_budget_limit
    UNIQUE (household_id, category_id, budget_month),
  CONSTRAINT ck_chequebook_budget_month
    CHECK (EXTRACT(DAY FROM budget_month) = 1),
  CONSTRAINT ck_chequebook_budget_amount
    CHECK (amount >= 0 AND amount <= 999999999999.99),
  CONSTRAINT ck_chequebook_budget_revision CHECK (revision >= 1)
);

CREATE INDEX ix_chequebook_budget_limits_month
  ON mod_chequebook.budget_limits
    (household_id, budget_month, category_id)
  WHERE deleted_at IS NULL;

CREATE TABLE mod_chequebook.calendar_links (
  household_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  calendar_event_id uuid,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, source_type, source_id),
  CONSTRAINT ck_chequebook_calendar_link_source
    CHECK (source_type IN ('transaction','recurring-rule')),
  CONSTRAINT ck_chequebook_calendar_link_status
    CHECK (status IN ('pending','linked','unlinked','error'))
);

CREATE TABLE mod_chequebook.module_source_links (
  household_id uuid NOT NULL,
  source_module text NOT NULL,
  source_entity_type text NOT NULL,
  source_entity_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (
    household_id,
    source_module,
    source_entity_type,
    source_entity_id
  ),
  CONSTRAINT ck_chequebook_source_link_target
    CHECK (target_type IN ('transaction','recurring-rule'))
);

CREATE INDEX ix_chequebook_source_links_target
  ON mod_chequebook.module_source_links
    (household_id, target_type, target_id);
