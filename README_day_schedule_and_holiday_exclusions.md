# Day schedule and holiday exclusions (standalone scripts)

These two scripts are meant to run **in Google Ads alongside your existing legacy hourly budget script**. They do **not** replace it. They add **office-style schedule pauses** and **calendar-based holiday pauses** using their **own labels**, so the legacy budget script can keep using its own pause label unchanged.

| Script file | Purpose |
|-------------|---------|
| `day_schedule_only.js` | Pause on **configured weekdays** when that weekday is in a **closed** week (anchor + repeat). **Neutral weekdays** (not listed in config) are not treated as closed. |
| `holiday_exclusions_only.js` | Pause on **specific dates** listed in `forcedClosedDates`; re-enable when today is not in that list. |

Optional **preview copies** (preset dates / distinct labels for safe testing in Preview):  
`day_schedule_only_PREVIEW_2026-04-20.js`, `holiday_exclusions_only_PREVIEW_2026-04-20.js`.

For **budget + schedule in one script** (different product—not the legacy budget script), see `budget_schedule_per_day_anchors.js`.

---

## Google Ads setup

1. **Create two separate scripts** (or three if you also keep the legacy budget script): legacy budget, day schedule, holiday exclusions.
2. **Schedule**: Run at least **hourly** in the Google Ads Scripts scheduler for predictable open/closed behavior. The scripts’ internal comments refer to **budget period** wording (e.g. “Monthly”) only where it matches **label text** on entities—not how often Google runs the script.
3. **Paste** the full contents of each `.js` file into its script. After updates, **replace the whole script body** so line numbers and behavior match what you tested in this repo.
4. **Authorizations**: Approve OAuth and preview once before relying on schedules.

---

## Shared concepts

### Scopes

Both scripts support the same **scope** string (see CONFIG in each file): **Campaign**, **Account**, **Ad Group**, **Ad Text**, **Keyword** (spelling and wording must match the examples in the file).

### Optional filters

- **`labelName`**: If set, only entities that already have this label are in scope (empty = all in scope, subject to scope type).
- **`campaignNameContains`**: For **Campaign** / **Account** scope only, narrows to campaigns whose name contains the given text (case-insensitive).

### Legacy budget safety (`legacyBudgetLabelContains`)

When **re-enabling**, both scripts **skip** entities that still carry a label whose name **contains** this substring (default: `stopped by budget script`). That avoids turning ads back on while the **legacy budget script** still considers them budget-paused.

Set this to match how your **actual** budget pause labels appear in the account (e.g. they may include `(Monthly)` or similar). It is a **substring** match, not the full label.

### Labels (must be distinct per script)

- **Day schedule** uses `scheduleLabelToAdd` (e.g. `stopped by day schedule script`).
- **Holiday** uses `holidayLabelToAdd` (e.g. `stopped by holiday exclusions script`).

If both standalone scripts run on the same entities, **use different label strings** so each script only removes its own label.

---

## Day schedule only (`day_schedule_only.js`)

### CONFIG: `DAY_SCHEDULE_CONFIG`

| Field | Meaning |
|-------|---------|
| `emailTo` | Comma-separated addresses for notification emails. |
| `scope` | Account / Campaign / Ad Group / etc. |
| `labelName` | Optional pre-filter label. |
| `campaignNameContains` | Optional name filter (Campaign / Account scope). |
| `legacyBudgetLabelContains` | Substring for “still paused by budget”—see above. |
| `scheduleLabelToAdd` | Exact label name applied when this script pauses for schedule. |
| `daySchedules` | Object keyed by weekday (`Monday` … `Sunday`). **Omitted weekdays are neutral** (no schedule pause for that day; script may still **re-enable** items that still carry the schedule label so closed days do not carry over). |

Each weekday you configure needs:

- **`anchorOpenDate`**: `yyyy-MM-dd` on **that same weekday**. It anchors “week 0” for the open/closed pattern.
- **`repeatEveryWeeks`**: `1` = every week, `2` = every other week, etc.

Details and examples are in the **banner comment block** at the top of `day_schedule_only.js`—that is the source of truth for non-technical editors.

### Empty `daySchedules`

If `daySchedules` is empty `{}`, the script logs and **exits** (no pause, no re-enable).

---

## Holiday exclusions only (`holiday_exclusions_only.js`)

### CONFIG: `HOLIDAY_CONFIG`

| Field | Meaning |
|-------|---------|
| `emailTo` | Comma-separated notification emails. |
| `scope` | Same as day schedule. |
| `labelName` / `campaignNameContains` | Same optional filters. |
| `legacyBudgetLabelContains` | Same budget safety substring. |
| `holidayLabelToAdd` | Exact label applied when pausing for a forced-closed date. |
| `forcedClosedDates` | Array of `yyyy-MM-dd` strings in **account timezone** date terms. |

### Empty `forcedClosedDates`

If the array is empty `[]`, the script logs and **exits** (no action).

### Open vs closed day

- **Today in list** → pause enabled entities in scope (and apply `holidayLabelToAdd`), send “Closed Day” style notification if configured.
- **Today not in list** → re-enable entities that have the holiday label (subject to legacy budget skip), send “Open Day” style notification if anything was re-enabled.

---

## Emails and preview

- Notifications use **HTML** bodies with entity lists when the script changes items.
- **`DEBUG`** at the top of each file can be used for extra logging (see file).
- **Preview** in Google Ads does not apply mutations; logs still help validate logic. Use the `*_PREVIEW_*.js` copies when you want **different dates/labels** from production so you do not confuse live labels.

---

## Troubleshooting (short)

| Symptom | Things to check |
|---------|-------------------|
| Script “does nothing” | Day: `daySchedules` empty? Holiday: `forcedClosedDates` empty? Optional `labelName` excluding all entities? |
| Re-enable never runs | `legacyBudgetLabelContains` too broad or wrong—entities still match “budget paused.” |
| `SystemError` about labels | Use the **latest** repo version of the script; older builds lacked safe label removal and selector fallbacks for edge cases / Preview. |
| Wrong open/closed week | **Day schedule**: `anchorOpenDate` must be the correct **weekday** and represent the **open week** you intend as week 0. |

---

## Repo layout (relevant files)

```
day_schedule_only.js
day_schedule_only_PREVIEW_2026-04-20.js
holiday_exclusions_only.js
holiday_exclusions_only_PREVIEW_2026-04-20.js
budget_schedule_per_day_anchors.js   # combined budget + schedule (not legacy)
README_day_schedule_and_holiday_exclusions.md
```

Questions or changes to behavior should be tracked against the **version comment** at the top of each script file.
