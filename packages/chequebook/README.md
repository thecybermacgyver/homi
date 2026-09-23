# Chequebook

Chequebook is Homi's household budgeting and cash-flow module.

## Capabilities

- Checking, savings, cash, and credit accounts with opening balances.
- Income, expenses, transfers, cleared status, and reconciliation.
- Recurring bills and income with projected cash flow.
- Monthly category limits with warning and over-limit states.
- Search, analytics, Calendar-linked entries, and Family Board cards.
- Offline-first mutations and cached reads through Homi's public module SDK.

## Module boundaries

Chequebook owns the `mod_chequebook` database schema and contains no private Core,
Web, Calendar, or other-module imports. Cross-module work uses declared broker
contracts. Installation, enablement, synchronization, navigation, and Family Board
placement remain owned by Homi Core.

## Validate

```sh
pnpm contract:validate
pnpm typecheck
pnpm build
```
