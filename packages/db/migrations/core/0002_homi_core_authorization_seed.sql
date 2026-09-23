INSERT INTO core.permissions (
  key,
  description
)
VALUES (
  'core.household.admin',
  'Administer household settings, members, roles, and permissions.'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO core.roles (
  id,
  household_id,
  key,
  name,
  is_system
)
VALUES (
  '00000000-0000-4000-8000-000000000013',
  NULL,
  'household-admin',
  'Household Administrator',
  TRUE
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO core.role_permissions (
  role_id,
  permission_key
)
SELECT
  r.id,
  'core.household.admin'
FROM core.roles AS r
WHERE r.household_id IS NULL
  AND r.key = 'household-admin'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO core.membership_roles (
  membership_id,
  role_id,
  granted_by_user_id
)
SELECT
  hm.id,
  r.id,
  h.created_by_user_id
FROM core.household_memberships AS hm
INNER JOIN core.households AS h
  ON h.id = hm.household_id
INNER JOIN core.roles AS r
  ON r.household_id IS NULL
 AND r.key = 'household-admin'
WHERE hm.user_id = h.created_by_user_id
  AND hm.status = 'active'
  AND hm.ended_at IS NULL
ON CONFLICT DO NOTHING;
