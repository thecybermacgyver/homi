# Changelog

All notable changes to Homi are recorded here, newest first. Homi follows semantic versioning from 1.0, and entries before 1.0 are identified by date; each module is versioned independently and every module release is published with a signed, verified entry in the [module directory](docs/MODULE_DIRECTORY.md). Known limitations are in [the release notes](docs/RELEASE_NOTES.md#known-limitations).

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
