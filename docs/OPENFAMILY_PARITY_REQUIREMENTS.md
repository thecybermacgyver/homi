# Homi OpenFamily Functional Parity Requirements

This document is an authoritative product requirement for Homi.

Homi is a clean-sheet platform and does not inherit OpenFamily's implementation architecture, database structure, direct module coupling, visual design, branding, or deployment-specific configuration. However, functional capabilities that were added to the customized OpenFamily installation are a minimum parity floor for Homi unless the user explicitly removes or replaces a requirement.

A Homi implementation may improve a feature, split it into modules, or expose it through Core capabilities, but it must not silently omit the user-facing capability.

## Architecture translation rule

- Homi Core remains module-neutral.
- First-party modules use the same public SDK and host contracts as community modules.
- Cross-module behavior uses the public Homi module broker/capability contracts. Direct cross-module SQL, private imports, and feature-specific Core patches are not acceptable substitutes.
- Offline-first behavior and automatic synchronization use Homi's existing synchronization platform.
- Homi's localization service replaces OpenFamily's manually maintained translation-file model.
- Homi's shared design system is authoritative for UI and responsive behavior.

## Calendar parity floor

Calendar must preserve or improve the customized OpenFamily behaviors:

- Day, Week, Month, and Upcoming views.
- The last view chosen by a user is remembered instead of resetting on every visit.
- Calendar data synchronizes automatically; a manual Sync action is not part of the normal workflow.
- Empty dates can open event creation directly.
- Populated dates provide access to all events on that date and an Add Event path.
- Selecting an event opens its full event details/editor.
- Calendar Event search covers title, description, location, notes, and assigned household people.
- Recurrence frequencies: none, daily, weekly, monthly, yearly.
- Recurrence interval support.
- Optional recurrence end date.
- Per-occurrence edit/override without changing the whole series.
- Per-occurrence deletion/skip without deleting the whole series.
- Whole-series editing.
- Monthly recurrence on the 29th/30th/31st skips invalid months rather than silently moving dates.
- February 29 yearly recurrence occurs only in leap years.
- Stable occurrence identity is used anywhere recurring occurrences appear outside the main Calendar surface.
- Each Calendar Event owns a stored shared color.
- Event color uses the fixed 16-color family: red, orange, yellow, lime, green, dark green, aqua, cyan, blue, navy, purple, violet, pink, magenta, brown, black.
- Event color is visible consistently in Month, Day/Week, Upcoming, search/results, offline state, and synchronized copies.
- A recurring occurrence override may carry a color independent of its parent series.
- Calendar remains usable offline from cached state and queues supported changes for automatic synchronization after reconnect.
- External Google/Outlook/Apple calendar connections synchronize automatically; external events remain read-only in Homi unless an explicit later contract says otherwise.
- Private ICS feed creation/rotation/revocation remains supported.
- Calendar reminders and household-person/transport context remain supported.
- Phone layout prioritizes the calendar itself. Search and Add Event are compact/floating actions rather than permanent large panels.
- Calendar-layer creation, default-calendar selection, external connections, and other management controls belong in Calendar Settings rather than consuming the main phone Calendar surface.

## Calendar ↔ Budget parity floor

The customized OpenFamily installation supports linking Calendar and Budget records. Homi must preserve this capability through public module-broker contracts rather than direct database coupling.

Required behavior when the Budget module exists:

- A one-time Budget entry may optionally create a linked all-day Calendar Event on the same date.
- A recurring Budget transaction may optionally create a linked recurring all-day Calendar Event with the same recurrence frequency, interval, and repeat-until date.
- Editing a linked Budget transaction keeps its Calendar representation synchronized.
- Removing/disabling the Calendar link removes the linked Calendar representation without deleting the owning Budget record.
- Calendar-created financial items must be able to register/link into Budget where the user requests it.
- Calendar and Budget must retain clear ownership of their own records while storing a durable public linkage identity.
- Expenses and income may use distinct default presentation colors, but event color remains a normal Calendar event property after creation.
- Recurrence month-end and leap-day rules must remain consistent between linked Budget and Calendar records.

## Other customized OpenFamily parity requirements

The following functional additions are also part of Homi's feature floor and should be incorporated into the appropriate Homi modules/platform surfaces during Master Step 8 expansion:

- Recipe cards display a supplied recipe image, with a sensible fallback when no image is present.
- Long selection/dropdown interfaces remain usable within the available screen height and scroll vertically rather than extending off-screen.
- Category capacity must support at least the customized OpenFamily level of 60 categories where category limits apply.
- Household/family notifications use the recipient's preferred language rather than a fixed source language.
- Notification parity includes ownership transfer and household access request/accepted/declined flows.
- User-facing Calendar Event terminology is localized consistently across surfaces where Calendar data appears.
- Recurring Calendar occurrences shown in dashboard/planning/kiosk-style surfaces use occurrence identity rather than treating the series ID as a unique displayed occurrence.
- Data import/export coverage must include the user's functional household data represented by installed modules, including family members, tasks/chores, recipes, meal plans, Budget entries/limits, shopping items, Calendar Events, planning/schedules, and other module-owned data through Homi's module-safe export/import contracts.

## OpenFamily feature domains that must be represented in Homi

Where equivalent functionality is useful in the Homi product, the customized OpenFamily installation establishes a functional baseline for:

- Budget and financial tracking.
- Rewards / children's allowance and rewards.
- Meals and meal planning.
- Recipes.
- Planning / weekly schedules.
- Shopping.
- Tasks/chores.
- Family/household people.
- External integrations.
- Shared display / kiosk-style household views.
- Dashboard/home notes.
- AI-assisted capture/organization.
- Import/export and recovery-related user data flows.

These capabilities do not have to use the same OpenFamily page structure. They should be implemented as Homi modules or Core capabilities according to the locked Homi architecture.

## Calendar 0.6.1 parity status

Calendar 0.6.1 currently proves the following Homi-native parity locally:

- SDK/managed-module packaging and corrective version 0.6.1 manifest.
- Day/Week/Month/Upcoming views and remembered per-user/per-household last view.
- automatic offline/reconnect synchronization.
- recurrence, recurrence overrides/skips, month-end and leap-year behavior.
- reminders, household people, transport context and search.
- external calendar synchronization and private ICS feeds.
- three configurable Family Board card contributions.
- phone-first calendar layout with floating Search and Add Event actions.
- empty-day Add Event and populated-day review behavior.
- per-event stored colors using the fixed 16-color palette.
- event-color synchronization, offline queueing, and occurrence override color.
- safe legacy color and schema normalization during the 0.5 -> 0.6.1 migration.
- race-safe single starter-calendar initialization.

Calendar-to-Budget linkage remains a required future broker integration because the Homi Budget module does not yet exist.

## Source audits

This requirement was derived from the retained functional audits of the customized OpenFamily installation, including:

- `OpenFamily_Community_Customization_Comparison.md`
- `openfamily_budget_audit.txt`
- `openfamily_budget_unified.patch`

Branding-only changes, local compose/deployment files, backups, credentials, and installation-specific paths are explicitly not parity requirements.
