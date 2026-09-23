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

## Remaining release-gate checks

The accessibility gate stays open until an authenticated browser pass covers Dashboard, Modules, Settings, Calendar, and Chequebook at phone, tablet, and desktop widths. That pass must verify keyboard order, dialog focus behavior, names/labels, contrast in populated and empty states, zoom/reflow, and reduced-motion behavior. Automated results do not replace this manual pass.
