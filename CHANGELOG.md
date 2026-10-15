# Changelog

All notable changes to Homi are recorded here, newest first. Homi follows semantic versioning from 1.0, and entries before 1.0 are identified by date; each module is versioned independently and every module release is published with a signed, verified entry in the [module directory](docs/MODULE_DIRECTORY.md). Known limitations are in [the release notes](docs/RELEASE_NOTES.md#known-limitations).

## 1.5.1 — 2026-10-15

### Modules
- **K.I.S.S. 0.4.2:** colour contrast raised so every screen passes the axe WCAG 2.0/2.1 A and AA rules at phone and desktop widths in light and dark schemes (card purple darkened, buttons and secondary text no longer rely on reduced opacity). No data or behaviour change.
- **Certification:** Calendar 0.6.23, Noticeboard 0.1.5 and K.I.S.S. 0.4.2 passed their isolated acceptance suites with the exact published packages and are marked verified in the signed directory. K.I.S.S. gained `packages/kiss/qa/acceptance.mjs` (two partners and an administrator who is not a partner: pairing, server-withheld reveal, Vibe Match, streak, check-in, love note, PIN lock, layout) and `qa/accessibility.mjs`.

## 1.5.0 — 2026-10-15

### Core and web app
- **Notifications now reach people.** Modules have always been able to send a notification through the notifications capability (Calendar reminders are one), but Core only stored them: nothing showed them and nothing sent them to a device. A **bell with an unread count** now sits with the floating Search and Add buttons on every page and opens the member's inbox (mark read, dismiss, mark all read). A member can **turn on notifications for a device**; reminders then arrive there as push notifications even when Homi is closed. Delivery uses standard Web Push (RFC 8030) with RFC 8291 payload encryption and RFC 8292 VAPID signing, implemented with Node's own crypto: no new dependency. Core renders each notification's text from the module's own locale file in the household's language, falling back to the English file and then to the title the module supplied.
- Core: member-scoped routes `GET /api/v1/core/notifications`, `POST …/notifications/:id/read`, `POST …/notifications/:id/dismiss`, `POST …/notifications/read-all`, and Web Push routes `GET /api/v1/core/push/config`, `POST …/push/subscriptions`, `…/subscriptions/check`, `…/subscriptions/remove`. A notification is delivered once (`push_sent_at`); a push service that reports a device gone (404/410) revokes that subscription.
- Migration `0012_notification_delivery.sql`: `core.notifications.push_sent_at`, and `core.push_server_keys` for the server's push identity (created on first use). Notifications that exist at upgrade are marked as already pushed so no burst of old reminders arrives.
- Service worker (cache `homi-shell-v20`) shows push notifications and focuses Homi when one is clicked.
- No change to the module API: `moduleApiVersion` stays 1 and no module needs to change to benefit.

### Modules
- **Calendar 0.6.23:** defines `calendar.reminder.title` and `calendar.reminder.body` and passes a readable `when` ("in 15 minutes", "in 1 hour 30 minutes") so a reminder reads "Dentist — Starts in 15 minutes."
- **Noticeboard 0.1.5:** line breaks typed in a note are kept on the board and in the list preview (they were flattened to a single space). Full-note view is unchanged.
- **K.I.S.S. 0.4.1 (new):** a private module for two partners. See [its README](packages/kiss/README.md).

### Testing
- `apps/core/scripts/validate-notification-push.mjs` (`pnpm --filter @homi/core notifications:validate`) round-trips the payload encryption and verifies the VAPID signature.
- `apps/web/qa/notifications-acceptance.mjs` drives the inbox and device subscription in a real browser against an isolated stack.

## 1.4.4 — 2026-10-14

### Modules
- **Shopping List 0.4.1: the Dashboard card is a spiral notepad.** Under the card's title, a pad with coils along its top edge fills the card: the items are written on ruled lines beside a red margin with a box to tick in the margin, the lines carry on below the last item to the foot of the page, and "Open list" sits at the bottom right. Up to nine items show, with "+ N more · Open list" for a longer list, and the Counts by store style is written on the same paper. The pad is drawn entirely by the module; no Core change. (0.4.0, which needed a Core change to put the coils above the title, was withdrawn before publication.)

## 1.4.3 — 2026-10-14

### Modules
- **Noticeboard 0.1.4: notices can be sized freely, and what is on them is drawn to fit.** Every pinned notice has a corner handle: drag it right or left to make the notice wider or narrower and down or up to make it taller or shorter, or use the arrow keys on the handle. A notice now stores its height as well as its width (migration `0001_noticeboard_notice_height.sql`; existing notices keep their corner and start at the default height for their kind, moved up only if they would hang off the bottom of the board). The writing on a notice is sized from the notice, so a bigger notice has bigger words and can be made to stand out. A photo is drawn as large as the notice allows, keeping its shape and never cropped, including past the size it was taken at. The tack stands on top of the paper again instead of being clipped inside it. A drag released past the edge of the cork no longer opens the Noticeboard page, and the board's "All notices" button moves to the top of the cork beside "Add a notice", so it never covers the corner a notice is resized by. A move queued offline by an older version keeps the notice's stored height.

## 1.4.2 — 2026-10-14

### Modules
- **Noticeboard 0.1.3: notices can be resized, and photos follow the size.** (Superseded by 0.1.4 before its public module release; 0.1.4 includes everything here.) A pinned notice now has a corner handle: drag it to make the notice wider or narrower, between the same limits the board already stored (15% to 90% of the board width). Dragging stops the notice at the edge of the cork; arrow keys on the handle keep going to the widest size and slide the notice along the edge, so the keyboard reaches every size without a mouse. A photo now keeps its own shape and scales with the notice instead of being cropped to a fixed band, so a bigger notice shows a bigger picture; a very tall picture is fitted whole rather than cropped. A notice also ends at the bottom edge of the board, so a long notice can no longer carry its handle off the cork. Widths were already stored and synchronized per notice, so existing notices keep their size and no migration is needed.

## 1.4.1 — 2026-10-14

### Modules
- **Calendar 0.6.22: moved occurrences of a recurring event now move.** Editing one occurrence of a repeating event (or the whole series) to a different day saved the change but left the entry on its original day, because the views placed it by the repeat-rule date rather than the date it was moved to. Occurrences are now shown, counted, searched and reminded on the date they were moved to, including when they are moved across a month boundary. "All events" edits shift the series by the change you made instead of re-anchoring it on the occurrence you clicked. No Core, SDK or data migration; existing events are unchanged.

### Testing
- `packages/calendar/scripts/validate-recurrence-moves.mjs` (part of `contract:validate`) covers moved, skipped and cross-range occurrences.

## 1.4.0 — 2026-10-08

### Core (web app)
- **Modules pop-up.** The Modules button in the navigation now opens a small pop-up listing the modules installed and turned on for the household; choosing one launches straight into it (Calendar, Chequebook and so on).
- **Manage modules moved to Settings.** Installing, turning modules on or off, and choosing Dashboard cards (the previous Modules page, unchanged) now live in Settings → Manage modules, with the other module settings. No Core service, API, SDK or module change.

## 1.3.0 — 2026-10-05

### Core (web app)
- **Date and time on the Dashboard.** The Family Board header shows the date and a large clock at the top right, beside the search control: for example "5th October 2026" and "03:15 P.M." They follow the household's time zone and language (English uses the board's own style; other languages use the browser's long date and short time), update every minute and roll over at midnight. On a phone the time is the same size as the date and stays clear of the logo, down to the narrowest screens. No Core service, API or module change.

### Documentation
- The README screenshots were retaken from invented data on an isolated stack: the widescreen Dashboard now shows the clock, the cork Noticeboard and the Meal Planner, and the phone screenshot shows the clock with the Noticeboard first, as on a real phone.

### Testing
- Clock browser acceptance (`apps/web/qa/clock-acceptance.mjs`: household time zone, minute update, midnight roll-over, placement with a clear gap from the logo and equal date and time sizes on phones from 1440 down to 320 px) and unit tests for the formatting. The accessibility (168 screens), board-layout and universal-search acceptances pass unchanged.

## 2026-10-05 (Meal Planner)

### Modules
- **Meal Planner 0.1.0 (new).** One shared household meal plan. Plan meals by day and meal (Dinner by default; Breakfast, Lunch and Snack optional), as meals, eating out, leftovers, takeout or no meal, with notes, servings and who is cooking; mark meals cooked; repeat a meal weekly; copy a meal or a whole week; keep a list of meal ideas and ask for a suggestion. The Dashboard card shows one coloured row per day: the household chooses any days, the meal shown and a colour for each day. Core's Search finds meals and `+` adds one. It can pull recipes from a Recipes module through the new `recipes.lookup.v1` broker capability (documented in the module README); until one exists, meals are free text. No Core or platform changes.

### Testing
- Meal Planner browser acceptance (`packages/mealplanner/qa/acceptance.mjs`): three browser profiles and two members, 16 checks, with a test-only recipes provider standing in for the future Recipes module. The accessibility and board-layout acceptances now include the Meal Planner card, page and sheets.

## 1.2.1 — 2026-10-05

### Modules
- **Noticeboard 0.1.1.** The board now looks like cork: a speckled tan surface with a wooden frame, drawn in CSS so it scales and stays sharp at any size.

## 1.2.0 — 2026-10-05

### Core
- **New module capability `household-roles`.** A module that declares it can ask the host whether the requesting member is a household administrator (`host.householdRoles.isAdministrator(context)`), so it can restrict an action such as delete to the author or an administrator. Additive: the module API version stays 1.
- **Dialogs and sheets can opt in to `portal`.** A Family Board card clips a fixed-position dialog to the card, so `<BottomSheet portal>` / `<Dialog portal>` render in `document.body`. The default is unchanged.
- **Family Board cards can fill their card.** A card's content area is now a flex column, so a surface that sets its own `flex: 1 0 auto` fills the card at any size; other surfaces keep their natural height.

### Modules
- **Noticeboard 0.1.0 (new).** A shared household board. The Dashboard card is a board of pinned notices that scales to the card and the device; drag notices to arrange them, and they may overlap like paper on a real board. Each notice has a pin: clicking it unpins the notice, which leaves the board but stays in the module until it is deleted, and anyone can pin it back. A tack in the card's upper left (and the module's `+`) adds a notice with a title, text, any paper colour, a photo (shrunk on the device to a small JPEG) and a list to tick off. The module page lists every notice newest first with a short description; choosing one opens the whole notice, and Core's Search finds titles, text and list items. Anyone can edit, tick, pin and unpin; only the author or a household administrator can delete. Works offline.

### Testing
- Noticeboard browser acceptance (`packages/noticeboard/qa/acceptance.mjs`): three browser profiles and two members, 13 checks. The accessibility acceptance now covers the Noticeboard card, page and sheets (132 screens, no violations) and the board-layout acceptance includes the new card.

## 1.1.3 — 2026-10-05

### Core
- **Smaller minimum card sizes are honoured per layout.** A card's declared minimum is in wide-layout units; on phones a card is never narrower than two columns (a phone column is only a quarter of the screen), so a module that declares a one-column minimum for wide screens does not make phone cards unreadable. The platform's test script now runs every web test file (the unquoted glob had been skipping `src/*.test.ts`).

### Modules
- **Calendar 0.6.21 and Chequebook 0.1.27.** The Events today and Current balance cards can be resized down to one column by two rows on wide screens. Phone layouts are unchanged (two columns by two rows at the smallest).

### Testing
- Board-layout acceptance gained a check that both cards shrink to 1×2 on wide screens and 2×2 on phones, independently.

## 1.1.2 — 2026-10-05

### Core
- **"Arrange & resize" is now an icon.** The Dashboard's text button is replaced by a rounded-card-with-resize-arrow icon in the Homi palette. Hovering it (or focusing it with the keyboard) shows "Arrange & resize"; while arranging it turns terracotta and reads "Done arranging". Moving and resizing cards work exactly as before (drag a card, drag its corner, or use the arrow keys). The README screenshots were regenerated from invented data.

## 1.1.1 — 2026-10-05

### Core
- **The Family Board fills wide screens.** The board frame was capped at 1460 px and centred, which left a large empty margin on each side of a full-HD or larger display. The cap is now 2400 px, so the board follows the window width on desktops and wall displays; phone and tablet layouts are unchanged.

## 1.1.0 — 2026-10-02

### Core
- **Add household members in the app.** A Household Administrator adds a member from Settings → Members → Add member: name, email and a generated temporary password. Homi creates the account immediately, links it to the household, and requires the member to choose their own password at first sign-in. Nothing is emailed, so no mail server is needed. Duplicate emails, invalid emails, short passwords and blank names are refused, and a regular member cannot add members. This removes the main limitation listed for 1.0.

### Testing
- Browser acceptance for adding a member (`apps/web/qa/add-member-acceptance.mjs`): the full flow, every refusal, first sign-in with a forced password change, a regular member's 403, and layout at phone and desktop widths; the existing password acceptance still passes.

## 1.0.0 — 2026-10-02

- **Homi 1.0.** The release candidate `v0.1.0-rc.2` is declared stable: the code is unchanged apart from documentation and version labels. Core, the public SDK (`@homi/module-sdk`, module API version 1), the shared UI and the starter module template are released together with Calendar 0.6.19, Chequebook 0.1.25 and Shopping List 0.3.2, which are verified in the signed module directory. Documentation no longer describes Homi as pre-1.0; known limitations remain in [the release notes](docs/RELEASE_NOTES.md#known-limitations).

## 2026-10-02 (release candidate)

- Tagged **v0.1.0-rc.2**: all release-checklist gates are checked (offline and reconnect, PWA install and update, universal Search and Add, accessibility, multi-device acceptance, signed directory audit). Added `scripts/audit-module-directory.mjs`, which checks every versioned directory release's signature and every listed package's pinned digest.

## 2026-10-02 (accessibility)

### Core
- Accessibility pass over the signed-in app: shared text, badge, eyebrow, expense and active-navigation colours now meet 4.5:1 contrast, and a dialog with an autofocused field (such as Search) returns focus to the control that opened it.

### Modules
- **Calendar 0.6.19.** The event form and external-event detail use the shared accessible sheet and dialog (focus handling, Tab trap, Escape), and the month event-count dots carry a proper image role.

### Testing
- Authenticated accessibility acceptance over 108 screen states with zero axe violations and passing keyboard, focus, reduced-motion and reflow checks.

## 2026-10-02 (universal Search)

### Core
- **Universal Search.** One Core-owned Search control, reachable from the Dashboard and from every module page, now searches every enabled module at once and groups the matches by module. Search is not limited to the week, month or register on screen, works offline from the data already on the device, and choosing a result opens that item in its module. Previously Search only filtered the page being viewed and showed no results list.
- **Search provider contract.** Modules take part in Search through a new, additive public SDK contract (`search` on the web module definition, plus an `intent` that a page receives when it is opened from a result). Core renders the search box, results and navigation, so modules never build their own and community modules get Search without Core changes. See [Module authoring](docs/MODULE_AUTHORING.md#search).
- Module authoring guide: the contextual-action registration effect must not depend on the host's `actions`, or it re-registers in a render loop.

### Modules
- **Calendar 0.6.18**, **Chequebook 0.1.25** and **Shopping List 0.3.2** supply search providers and open the chosen day, transaction or item. Their own page-level search boxes are replaced by Core's.
- **Chequebook 0.1.22.** A transaction form opened before the household's accounts had loaded had no account and could not be saved; it now adopts the default account once it loads.

### Testing
- PWA install and update acceptance: valid manifest, no installability errors, module upgrades picked up by an open app on reconnect with no reload or cache clearing, a device offline during an upgrade keeping its queued change, and a new app shell installing and reloading itself on the next open.
- Universal Search acceptance across Calendar, Chequebook and Shopping List, including offline.

## 2026-10-01

### Modules
- **Chequebook 0.1.21.** Changes made on another device, and the balances they affect, now appear automatically instead of only after reopening Chequebook. Fixed a continuous re-rendering loop (about 500 renders a second) while Chequebook was open, a transaction created offline vanishing from every view until it synced, and a refresh that would have shown a stale conflicted edit instead of the shared version.
- **Calendar 0.6.16.** An event created while offline now appears immediately instead of vanishing until it syncs, and saving offline refreshes the list.
- **Calendar 0.6.14.** On phones and narrow windows, month cells show up to three coloured event dots and a "+N" count instead of looking empty.

### Testing
- Isolated multi-device acceptance suites for Calendar and Chequebook (two devices of one member plus a second member): automatic propagation, offline create, edit and delete across full browser restarts, reconnect without self-conflicts, reviewable stale-edit conflicts, balances that match the server, and responsive layout.

## 2026-09-30

### Modules
- **Calendar 0.6.13 and 0.6.12.** Form Save and Cancel buttons stay clear of the bottom navigation and the device safe area; weekly Chequebook-linked Calendar events carry a weekday.
- **Chequebook 0.1.15.** Card figures show on devices that have not opened Chequebook yet.
- **Shopping List 0.3.1.** Compact rows, and no footer on short cards.
- Calendar, Chequebook and Shopping List are all marked **verified** in the signed module directory.

### Testing
- Isolated acceptance scripts for Shopping List, Chequebook and the Family Board.

## 2026-09-29

### Core
- **Arrangeable Family Board.** The Dashboard is a grid (8 columns on wide screens, 4 on phones) that each member arranges with "Arrange cards": drag to move, drag a corner to resize, or use the arrow keys. Phone and wide layouts are saved separately and cards stay where they are left. Modules may declare card sizes.
- **Per-member card styles**, chosen on the Modules page (for example Shopping's list or counts by store).
- **Password management.** Members can change their own password, and an administrator can reset one, requiring the member to choose a new password at their next sign-in.

### Modules
- **Calendar, Chequebook and Shopping List cards** declare sizes and adapt to the size each member chooses: today's events with times, the coming week by day, a mini month with event dots, bold balance and spending figures, and the shopping list or counts by store.
- **Shopping List 0.3.0** adds counts by store and the card styles; offline-queue fixes ensure an edit made right after creating an item continues from its delivered revision, conflicts and rejections stay available for review until dismissed, and writes that are still retrying are never discarded.
- **Chequebook 0.1.14**: clean error log.

### Documentation
- README and release documents verified against the running system and corrected.

## 2026-09-26

### Core
- **Module verification states** in the signed directory (`verified`, `unverified`, `failed`, `revoked`) are enforced server-side. Unverified releases are hidden unless an administrator deliberately reveals developer-mode entries and acknowledges the warning, and failed releases are never installable.
- Legacy unpinned module directories retired.

## 2026-09-25

### Core
- Module synchronization failures are isolated so one module cannot stop the others, and cached modules stay active during outages.
- Stale maintenance images can no longer be used during a deployment.

### Modules
- Offline-ready **Calendar** and **Chequebook** released.

## 2026-09-23

### Core
- First public source snapshot, tagged `v0.1.0-rc.1`.
- Offline synchronization is now required of every module, with a durable mutation-recovery contract and restoration of offline working state across modules.
- Stable signed module-directory endpoint.

### Modules
- Shared **Shopping List** module added. A first build was withdrawn pending a rebuild and server acceptance; the rebuilt module was verified and published on 2026-09-28 as 0.2.2.
