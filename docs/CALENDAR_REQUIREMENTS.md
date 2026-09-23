# Homi Calendar — Locked Product Requirements

This file is the authoritative acceptance scope for Master Step 5. Calendar is not complete until every required area below is implemented and validated. A bounded technical checkpoint being complete does not mean the Calendar module is complete.

## Module deployment and setup

- Installing/enabling Calendar must not immediately present an unconfigured module as finished.
- First use must enter a Calendar setup flow and persist household-owned Calendar settings on the server.
- Setup must be resumable and editable later; clients synchronize the persisted result.
- Calendar is considered configured only after required settings are saved successfully.
- The setup flow covers the Calendar choices that affect the household: calendar layers/sources, colors, time zone/week behavior, reminder defaults, and external calendar connections as those providers become available.
- This establishes the Homi module rule: a module with required settings must complete and persist its setup before normal module UI is presented as deployed.

## Responsive Calendar experience

- Phone: Today-focused list with upcoming events and fast event creation/editing.
- Tablet: Today plus Upcoming with direct access to full calendar views.
- Desktop: familiar calendar workspace, not an agenda card. At minimum it includes a calendar sidebar/mini-calendar, central Day/Week/Month calendar surface, and Upcoming/Details context on larger layouts.
- Required views: Day, Week, Month, Upcoming.
- Week/Day use time-grid event placement; Month uses populated-date cells with visible event color/layer identity.
- Navigation includes Today, previous/next period, date selection, and a localized date picker.
- Clicking populated dates/events opens the appropriate day/event details without losing calendar context.

## Calendar layers and colors

- Household schedule is layered and color-coded.
- Event/layer color stays consistent across Month, Day, Week, Upcoming, Search, and read projections.
- Initial palette: red, orange, yellow, lime, green, dark green, aqua, cyan, blue, navy, purple, violet, pink, magenta, brown, black.

## Event model

- Timed and true all-day events use correct time-zone/date semantics.
- Rich event details include title, description/notes, location, household people/attendees, and contextual transportation/pickup/drop-off information.
- Events can be assigned to multiple household people.
- Search covers title, description/notes, location, and people.

## Recurrence

- Daily, weekly, monthly, yearly recurrence.
- Repeat intervals and optional end dates.
- Stable occurrence identity.
- Edit one occurrence or the entire series.
- Skip/override exceptions.
- Correct month-end and leap-year behavior.

## Reminders and household coordination

- Calendar owns event reminder configuration while Core delivers notifications.
- Initial reminder presets include 30 minutes and 1 hour and remain extensible to additional offsets/delivery types.
- Calendar participates in household morning/evening digest information through Core/module contracts.

## External calendars and sharing

- Google Calendar synchronization.
- Apple Calendar synchronization.
- Outlook Calendar synchronization.
- Private tokenized iCal/ICS subscription feeds with token regeneration/revocation behavior.

## Cross-module contracts

- No direct cross-module SQL or imports.
- Planning consumes Calendar read projections/range capability.
- Transportation/pickup context uses brokered module contracts.
- Meals, Tasks, Dashboard/reminders, and other schedule consumers integrate through the module broker/capabilities rather than direct coupling.
- Budget-related Calendar actions use broker commands rather than cross-module database access.

## Acceptance gate

Calendar may not be marked complete until setup persistence, core event behavior, responsive Day/Week/Month/Upcoming UI, recurrence, reminders, people/context, search, external sync/sharing, offline/sync behavior, and module-contract integrations have each passed their defined tests. Only after Master Step 5 is complete may Master Step 6 multi-device Calendar acceptance begin.
