# Accessibility review

Review started: 2026-09-23.

## Completed checks

- Shared controls expose visible keyboard focus and use native buttons, links, inputs, labels, selects, and textareas where applicable.
- Core navigation identifies the current page and provides a named primary navigation landmark.
- Search and Add icon controls have accessible names.
- Shared dialogs and bottom sheets now move focus inside on open, trap forward and reverse Tab navigation, support Escape dismissal when dismissible, use unique title identifiers, and restore the prior focus when closed.
- Form fields associate visible labels with controls; validation text uses an alert role.
- The global reduced-motion media query removes meaningful animation and smooth scrolling.
- The shell has 320px minimum support and established phone, tablet, and desktop breakpoints; prior Calendar phone acceptance at 390px found no horizontal page overflow.
- Lighthouse on the current live signed-out surface found one 3.49:1 primary-button contrast failure. The release candidate uses a darker action-only terracotta token; Lighthouse against that candidate signed-out surface scores 100 for the accessibility category.

## Authenticated browser pass (2026-10-02, automated)

`apps/web/qa/accessibility-acceptance.mjs` runs against an isolated stack at the released versions with invented data. It signs in and scans every signed-in screen with the axe engine (WCAG 2.0 and 2.1, levels A and AA): Dashboard, Modules, Settings, Calendar (Day, Week, Month, Upcoming, event form, an empty week), Chequebook (Register, Recurring, Budget, Analytics, transaction form, an empty month), Shopping List (and its empty Checked tab) and the Search sheet, at 390, 768 and 1440 px, in light and dark colour schemes: 108 screen states. It also checks keyboard order and visible focus, accessible names, dialog focus (focus moves in, Tab stays inside, Escape closes, focus returns to the opener) for Search, the Calendar event form and the Chequebook transaction form, reduced motion, and no horizontal scrolling at 320 px.

The first run found real problems, all fixed: secondary text, the active navigation label, badges, eyebrows and expense amounts fell below 4.5:1 contrast (shared colour tokens darkened: muted text, a new sage text colour, danger, active navigation); the Calendar month event-count dots used an ARIA label without a role (Calendar 0.6.19); Calendar's event form and external-event detail were custom overlays with no dialog role, focus handling or Escape (now the shared sheet and dialog, Calendar 0.6.19); and a dialog containing an autofocused field did not return focus to the control that opened it (shared modal fixed, which affects Search). The final run reports zero violations and every keyboard check passing.

## Manual pass (2026-10-02)

The owner confirmed on real devices that a screen-reader pass on a phone (reading order, Search results announced and openable, Add forms announced and returning focus), a keyboard-only pass on a desktop (visible focus in a sensible order, Search reachable and usable, forms trapping focus and closing on Escape) and zoom to 200% on the Dashboard, Calendar and Chequebook all work. Together with the automated pass above, the accessibility gate is closed.
