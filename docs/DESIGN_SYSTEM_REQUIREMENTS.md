# Homi Design System — Locked Product Requirements

This file defines the Homi-owned visual and interaction language that the application shell and all feature modules must follow.

It restores the product direction established before feature-module implementation began.

## Product character

Homi must feel:

- warm.
- friendly.
- household-oriented rather than enterprise/corporate.
- instantly understandable.
- calm and low-friction.
- useful with minimal screen interaction.

Homi is not a server dashboard and must not default to a corporate-blue SaaS aesthetic.

## Brand direction

The Homi identity uses the established rounded roofline/open-smile concept. Reference imagery may use placeholder or incorrect logos; the visual reference does not replace Homi's actual brand mark.

The locked visual target is a calm, comfortable household product rather than a technical dashboard:

- warm cream/oat page backgrounds rather than stark white or black.
- soft off-white cards and panels with generous breathing room.
- terracotta/coral as the primary action and emphasis color.
- sage green for supportive household/status actions.
- muted honey/mustard for secondary highlights and illustrated accents.
- dark warm-charcoal text rather than blue-black corporate text.
- large rounded cards, controls, and navigation surfaces.
- subtle warm shadows and borders that create depth without glassy/neon effects.
- friendly, simple illustrated iconography with rounded forms.
- restrained decorative household motifs where they improve comfort and orientation.
- clear hierarchy with large welcoming headings and uncomplicated labels.

The reference look should feel approachable enough for everyday family use while remaining clean and modern. It should not drift toward enterprise SaaS, gamer/neon, medical, or generic Material-dashboard styling.

Exact accessible token values are owned by the shared design system and must be validated for contrast. Modules use semantic tokens rather than privately copying raw brand colors.

## Responsive priority

Homi is designed in this order:

1. phones.
2. tablets, including wall-mounted household dashboards.
3. desktop browsers.

Desktop is not the source layout scaled downward.

## Phone behavior

Phone interaction is the primary Homi experience.

It must favor:

- one-handed workflows.
- large touch targets.
- minimal typing.
- fast common actions.
- clear bottom navigation for primary Homi destinations.
- sheets/dialogs and focused detail flows that work on narrow screens.
- concise information hierarchy rather than dense administration surfaces.

## Tablet and wall-dashboard behavior

Tablet layouts expand the phone model without becoming a separate product.

They may use:

- split views.
- persistent secondary context.
- larger household summary surfaces.
- wall-dashboard presentation where appropriate.
- touch-first controls at dashboard distance.

## Desktop behavior

Desktop layouts support:

- richer multi-column context.
- administration.
- setup/configuration.
- bulk work.
- larger information surfaces.

Desktop modules must still use the same Homi components, tokens, terminology, and interaction conventions.

## Core-owned application shell

The Homi shell is platform-owned.

Feature modules may contribute only through documented extension points. They do not replace arbitrary Core screens or invent a parallel shell.

Initial extension points are:

- Home cards/widgets.
- primary/module navigation.
- module pages/surfaces.
- household settings contributions.
- notifications.
- search.
- setup/configuration entry points.

The shell remains coherent when zero feature modules are enabled.

## Shared UI package

The repository must provide a versioned shared Homi UI package, expected as `@homi/ui` unless an explicit later architecture decision changes the package name.

It owns:

- semantic color tokens.
- typography scale.
- spacing scale.
- border radii.
- elevation/shadow tokens.
- motion/duration tokens.
- responsive breakpoints.
- focus/hover/pressed/disabled/error/success/warning states.
- accessible touch-target minimums.
- layout primitives.

It also provides reusable components including at minimum:

- Button.
- IconButton.
- TextField.
- TextArea.
- Select.
- Checkbox.
- Radio.
- Switch.
- FormField.
- Card/Surface.
- List/ListItem.
- Badge.
- Banner/Notice.
- EmptyState.
- Loading/Skeleton.
- Dialog.
- BottomSheet.
- Menu.
- Tabs/SegmentedControl.
- AppHeader.
- BottomNavigation.
- SideNavigation/DesktopNavigation.
- ModuleHeader.
- SetupLayout.
- SettingsSection.
- SearchField/SearchResults surface.
- conflict/offline/sync-state presentation primitives.

Names may evolve during implementation, but modules must not independently recreate equivalent visual systems.

## Module visual contract

A module created from the Homi module template:

- consumes `@homi/ui`.
- uses semantic design tokens rather than private theme values.
- receives the shell/context appropriate to its registered extension point.
- may introduce domain-specific visualization where necessary but must frame it inside Homi surfaces and interaction patterns.
- may not ship an unrelated private theme for normal module UI.
- must remain localization-safe.
- must support phone, tablet, and desktop behavior defined by its declared surfaces.

## Accessibility

The design system must provide accessible defaults for:

- keyboard operation on desktop.
- visible focus.
- screen-reader labels/relationships.
- contrast.
- touch-target sizing.
- reduced-motion preferences where motion is used.
- semantic form/error states.

Accessibility requirements belong to the shared platform so individual module authors are not required to solve basic accessibility repeatedly.

## PWA behavior

Homi uses one installable PWA codebase across phone, tablet, and desktop.

The design system and shell must continue to work with:

- offline shell startup.
- cached module state where supported.
- connectivity transitions.
- install/home-screen behavior.
- browser and standalone display modes.

## Acceptance gate

The design system is not established merely because the application has CSS.

Acceptance requires:

1. semantic token implementation.
2. shared component package implementation.
3. Homi shell migrated to shared components.
4. phone navigation implemented from the shared shell.
5. tablet and desktop shell adaptations implemented.
6. a module generated from `homi-module-template` using the same shared components with no private Homi-theme recreation.
7. visual/responsive checks at representative phone, tablet, and desktop sizes.
8. accessibility checks for the shared primitives used by the proof module.
9. no feature module hard-coded into shell layout or styling.

Existing Calendar-specific styling is reference material only. Calendar must later be refactored to consume the established Homi design system before it is accepted as a normal first-party module.
