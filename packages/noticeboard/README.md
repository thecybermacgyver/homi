# Homi Noticeboard

Noticeboard is a first-party Homi module: a shared household board where anyone can pin notes, photos and lists.

## Household behavior

- The Dashboard card is a board of pinned notices that scales to the card and the device. Drag a notice to move it; the last one touched comes to the front, and notices may overlap like paper on a real board.
- Every notice has a pin. Clicking the pin unpins it, so it leaves the board. It stays in the module until it is deleted, and anyone can pin it back.
- The tack in the card's upper left adds a notice: a title, text, any paper colour, a photo (shrunk on the device to a small JPEG), and a list of things to tick off. The module's `+` does the same.
- The module page lists every notice, newest first, with a short description; choosing one opens the whole notice. Core's Search finds notice titles, text and list items.
- Anyone can edit, tick list items, pin and unpin. Only the author or a household administrator can delete a notice; the server enforces this.
- Placement is shared by the household, as on a real board, and is stored as fractions of the board so it looks the same at every size. Moving, pinning and ticking never clash with someone editing a notice's text; a stale text edit is surfaced for review.
- Everything works offline and synchronizes through Homi's offline queue.

## Isolation

The module uses only the public `@homi/module-sdk`, `@homi/ui`, host capabilities (`household-people`, `household-roles`, `localization`, `sync`), and the module-owned `mod_noticeboard` PostgreSQL schema. It does not modify Homi Core, the web shell, or another module.

## Validation

From the repository root:

```sh
pnpm --filter @homi/noticeboard contract:validate
pnpm --filter @homi/noticeboard typecheck
pnpm --filter @homi/noticeboard build
```

Browser acceptance (`qa/acceptance.mjs`) runs only against an isolated localhost stack with a fixture owner and the second fixture member made by `qa/seed-member.mjs`; all data is invented.
