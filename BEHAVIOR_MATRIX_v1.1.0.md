# Budget Script Behavior Matrix (v1.1.0)

Script: `budget_schedule_per_day_anchors.js`  
Version: `v1.1.0`

## Scope-by-Event Matrix

| Scope | Budget Exceeded | Budget Reset Re-enable | Schedule Closed | Schedule Open Re-enable |
|---|---|---|---|---|
| Account | Uses account-level spend from `ACCOUNT_PERFORMANCE_REPORT`; pauses enabled campaigns in selector and applies budget label. | Re-enables budget-labeled campaign entities when period flips, only if budget is healthy and schedule allows today; includes `shoppingCampaigns()` coverage. | Pauses enabled entities in selector and applies schedule label. | Re-enables schedule-labeled entities when schedule opens; includes `shoppingCampaigns()` coverage for account/campaign scope. |
| Campaign | Uses each campaign's own spend (`getStatsFor(dateRange).getCost()`); only over-limit campaigns are paused/labeled. | Re-enables budget-labeled campaigns if reset guard passes; includes `shoppingCampaigns()`. | Pauses enabled campaigns and applies schedule label. | Re-enables schedule-labeled campaigns if schedule allows today; includes `shoppingCampaigns()`. |
| Ad Group | Uses each ad group's own spend; only over-limit ad groups are paused/labeled. | Re-enables budget-labeled ad groups if reset guard passes; includes `shoppingAdGroups()`. | Pauses enabled ad groups and applies schedule label. | Re-enables schedule-labeled ad groups if schedule allows today; includes `shoppingAdGroups()`. |
| Ad Text | Uses each ad's own spend; only over-limit ads are paused/labeled. | Re-enables budget-labeled ads if reset guard passes. | Pauses enabled ads and applies schedule label. | Re-enables schedule-labeled ads if schedule allows today. |
| Keyword | Uses each keyword's own spend; only over-limit keywords are paused/labeled. | Re-enables budget-labeled keywords if reset guard passes. | Pauses enabled keywords and applies schedule label. | Re-enables schedule-labeled keywords if schedule allows today. |

## Re-enable Guard: Why It Is Stricter Than Legacy

Current budget reset re-enable requires all of these to be true:

1. It is the first run window of a new budget period (`isNewBudgetPeriod`).
2. Budget is not currently exceeded (`!budgetExceeded`).
3. Schedule allows today (`scheduleAllowsToday`), including forced-closed date checks.

Legacy behavior only required #1.

### Practical Effects

- Prevents immediate "thrash" re-enable:
  - Example: Monthly reset at 00:00, account still above threshold due to late posting/lag.
  - Legacy: re-enable then likely pause again next run.
  - Current: stays paused until budget condition is healthy.

- Respects office closure logic on reset boundaries:
  - Example: first day of month is also a forced-closed holiday.
  - Legacy: would re-enable despite closure.
  - Current: keeps schedule-paused entities closed until next open day.

- Produces cleaner state transitions:
  - No temporary open window during closed schedule periods.
  - Fewer contradictory emails (enable then pause shortly after).

## Email Behavior

- Emails include per-entity item lists for pause/re-enable actions.
- Preview mode sends email with a prepended banner:
  - `This script ran in preview mode. No changes were made to your account.`

## Label Existence Check Behavior

- Label creation lookup uses `Name CONTAINS` (legacy parity behavior).
