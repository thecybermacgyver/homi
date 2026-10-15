# K.I.S.S. (Keep Igniting Special Sparks)

A private space for two partners in a household. It appears only as an icon in Homi's Modules pop-up: it adds no Dashboard card and nothing from it is shown anywhere else in Homi.

Module key `kiss`, schema `mod_kiss`, module API 1. It uses only the public SDK and `@homi/ui`; there is no Core or SDK change.

## Privacy

- A household administrator pairs exactly two members in the module's Settings. Only those two can read each other's answers, check-ins, notes, quiz answers and checklist choices. Nobody else in the household can, administrators included (an administrator who is not one of the partners can see only that a pairing exists).
- This is enforced on the server, not in the browser. Core's change feed carries only entity ids; each device then fetches the item from the module, and the module returns it only to the member entitled to it. Another member's id answers 404.
- Content that opens only when both have answered is withheld by the server until then:
  - a partner's daily answer, until you have answered the same day;
  - a partner's daily quiz answers, until you have finished the same day's quiz;
  - a partner's Yes/No/Maybe choice, only when you both chose Yes (a No, a Maybe or no answer is never revealed).
- Data is not end-to-end encrypted: Homi synchronizes through the household server, which holds it at rest like every other module's data.
- A PIN and a "Hide screen now" control lock the screen on a device; the PIN is a salted hash kept in that browser only, and the screen also locks when the tab is left. The module never sends notifications and shows no previews.

## What it does

- **Daily question.** 371 questions (playful, memories, deeper, romance) plus seasonal ones, ordered by the couple's relationship phase (newly dating, living together, married) so no question repeats within a pass. Each partner answers privately with a 1 to 5 "how true is this for you". When both have answered: the answers, a Vibe Match score (closeness of the two ratings and the words they share), common ground and conversation tips.
- **Streak.** The heart in the header counts consecutive days on which both partners answered the daily question. Today never breaks it; a day that ends without both answers resets it, and the heart becomes a sad face reading "<name> missed a day" until both answer again.
- **Check-in.** Emotional battery, closeness and stress sliders, and a tailored prompt for the evening from the partner's latest state.
- **Love notes.** A private jar between the two partners with read marking.
- **Date nights.** A deck of 50 ideas filtered by budget (Free, $, $$), time (quick, evening, weekend) and vibe (cozy, adventurous, romantic, spicy), a spin, planned dates with a live countdown, and a checklist both can tick.
- **Daily quizzes.** Each day brings 8 statements from one topic (love languages, desires and boundaries, emotional triggers), 40 statements per topic. Results (closeness, radar chart, shared strengths and gentle growth tips) open when both have finished the day, and a running picture per topic grows with every completed day. After a topic's whole bank has been asked, the next pass is reshuffled and regrouped from a seed derived from the topic and pass number, so both partners always get the same eight.
- **Passion.** A private Yes/No/Maybe checklist of 60 romantic, sensual (non-graphic) and playful ideas, the matches both said Yes to, and eight guided challenges with step timers.

## Data

| Entity | Who sees it | Operations |
| --- | --- | --- |
| `partnership` | the two partners and administrators | administrator create, update, delete |
| `answer` | author; partner once both answered that day | create, update (until the partner answers), delete |
| `checkin` | the two partners | create, update |
| `note` | author and recipient | create, mark read (recipient), delete (author) |
| `date` | the two partners | create, update, tick, delete |
| `quiz` | author; partner once both finished that day | create, update (until the partner finishes) |
| `swipe` | author; partner's only where both said Yes | create, update |

Statement ids (for example `words-3`) never change once shipped; new statements are only appended, so history stays meaningful.

## Known limitations

- The daily question and quiz banks are finite and repeat. Generated content (an LLM provider) is not included.
- A partner's answer appears within about 20 seconds, or at once with "Check now"; Core's change feed carries ids only, so there is no instant push of the reveal.
- Verified: the isolated two-account acceptance suite (`qa/acceptance.mjs`, 13 checks) and the axe accessibility pass (`qa/accessibility.mjs`, 28 screens, 0 violations) passed with the published 0.4.2 package.

## Build and validate

```sh
pnpm --filter @homi/kiss build
pnpm --filter @homi/kiss contract:validate
```
