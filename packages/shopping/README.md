# Homi Shopping List

Shopping is a first-party Homi module for a shared household shopping list.

## Household behavior

- List changes use Homi's offline mutation queue and authoritative server synchronization.
- Items can be checked off from the full module page or its Family Board card.
- The full list is automatically grouped first by store and then by aisle.
- Common items receive an aisle automatically; the person adding an item can override it.
- Each item can be assigned to an active household person.
- Search covers item names, stores, aisles, and assigned people.
- Checked items remain available behind the “Show checked items” control.
- The Homi shell owns the single-star pin control and per-person widget order.

## Isolation

The module uses only the public `@homi/module-sdk`, `@homi/ui`, module host capabilities,
and the module-owned `mod_shopping` PostgreSQL schema. It does not modify Homi Core,
the web shell, Calendar, Chequebook, or another module.

## Validation

From the repository root:

```sh
pnpm --filter @homi/shopping contract:validate
pnpm --filter @homi/shopping typecheck
pnpm --filter @homi/shopping build
pnpm typecheck
pnpm build
```
