var DEBUG = 0;
var currentSetting = {};

/*
========================================================
GOOGLE ADS SCRIPT - BUDGET + PER-DAY SCHEDULE CONTROL
========================================================

WHAT THIS SCRIPT DOES
---------------------
1) Budget control:
   - Checks account spend for the chosen budgetPeriod.
   - Pauses campaigns when spend exceeds maxCost.
   - Labels those campaigns with budgetLabelToAdd.

2) Schedule control:
   - Supports independent weekday cycles using per-day anchors.
   - Example:
     - Wednesday open every 2 weeks anchored to 2026-04-22
     - Thursday open every 2 weeks anchored to 2026-04-29
   - Pauses campaigns on days/weeks that are not open.
   - Labels those campaigns with scheduleLabelToAdd.
   - Also supports forced-closed dates (holidays, office closures).

WHY PER-DAY ANCHORS
-------------------
Use this when weekdays do NOT share the same open weeks.
If all days share one cycle, this still works.

VALID WEEKDAY NAMES
-------------------
Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday

SETUP EXAMPLES
--------------
1) Default simple setup: every other Friday
   daySchedules = {
     Friday: { anchorOpenDate: "2026-04-17", repeatEveryWeeks: 2 }
   }

2) Every other Thursday + every 3rd Wednesday
   daySchedules = {
     Thursday: { anchorOpenDate: "2026-04-16", repeatEveryWeeks: 2 },
     Wednesday: { anchorOpenDate: "2026-04-22", repeatEveryWeeks: 3 }
   }

3) Add holidays / forced closures (yyyy-MM-dd)
   forcedClosedDates = [
     "2026-11-26",
     "2026-12-25"
   ];
   Any date in forcedClosedDates is treated as CLOSED, even if schedule says open.

GUI NOTE
--------
Google Ads Scripts does not provide a rich custom GUI inside the script editor.
For easier non-technical management, we could potentially move settings to a Google Sheet
and have this script read configuration from the sheet to make easier for non-technical users to manage.

REPOSITORY
----------
Primary repo for this script:
https://github.com/BmoandShiro/Budget-Script

If this local copy differs from GitHub, treat GitHub main branch as canonical.

MAINTENANCE RULE
----------------
IF IT ISN'T BROKE, DON'T FIX IT.

RUN SCHEDULE
------------
Run hourly in Google Ads Scripts for best behavior.
*/

function main() {
  Logger.log("");

  // ==============================
  // SCOPE
  // ==============================
  // Campaign | Account | Ad Group | Ad Text | Keyword
  currentSetting.scope = "Campaign";

  // ==============================
  // BUDGET SETTINGS
  // ==============================
  currentSetting.maxCost = getFloat("9999999");
  currentSetting.budgetPeriod = "Monthly"; // Daily | Weekly Sun-Sat | Weekly Mon-Sun | Monthly
  currentSetting.pauseItems = "yes";
  currentSetting.reEnableItems = "yes";

  // ==============================
  // SCHEDULE SETTINGS (PER-DAY)
  // ==============================
  currentSetting.schedulePauseItems = "yes";
  currentSetting.scheduleReEnableItems = "yes";

  // Configure each weekday independently.
  // Each day can have its own anchor and repeat cadence.
  // repeatEveryWeeks: 1=weekly, 2=every other week, 3=every 3rd week, etc.
  // Leave empty to disable weekday cycle overrides.
  // If at least one weekday rule is provided, schedule overrides are enabled.
  currentSetting.daySchedules = {};
  // Example: every other Friday (anchored on an OPEN Friday)
  // currentSetting.daySchedules = {
  //   Friday: { anchorOpenDate: "2026-04-17", repeatEveryWeeks: 2 }
  // };
  // Example: every Thursday + every 3rd Wednesday
  // currentSetting.daySchedules = {
  //   Thursday: { anchorOpenDate: "2026-04-16", repeatEveryWeeks: 1 },
  //   Wednesday: { anchorOpenDate: "2026-04-22", repeatEveryWeeks: 3 }
  // };

  // Forced closures (holidays, office events, etc).
  // Format: yyyy-MM-dd in account timezone date terms.
  currentSetting.forcedClosedDates = [];
  // Example:
  // currentSetting.forcedClosedDates = ["2026-11-26", "2026-12-25"];

  // ==============================
  // FILTERING / LABEL SETTINGS
  // ==============================
  currentSetting.labelName = "";
  currentSetting.campaignNameContains = "";

  currentSetting.budgetLabelToAdd = "stopped by budget script";
  currentSetting.scheduleLabelToAdd = "stopped by office schedule script";

  currentSetting.email = "alec@risedds.com";
  currentSetting.currencyCode = AdWordsApp.currentAccount().getCurrencyCode();

  // ==============================
  // FLAGS
  // ==============================
  currentSetting.pauseWhenExceeds = lower(currentSetting.pauseItems) === "yes";
  currentSetting.reEnableAtStartOfNewPeriod = lower(currentSetting.reEnableItems) === "yes";
  currentSetting.pauseWhenClosed = lower(currentSetting.schedulePauseItems) === "yes";
  currentSetting.reEnableOnScheduledOpenDay = lower(currentSetting.scheduleReEnableItems) === "yes";
  currentSetting.officeScheduleEnabled =
    hasAnyDayScheduleRules() ||
    (currentSetting.forcedClosedDates && currentSetting.forcedClosedDates.length > 0);

  switch (currentSetting.budgetPeriod) {
    case "Daily":
      currentSetting.dateRange = "TODAY";
      break;
    case "Weekly Sun-Sat":
      currentSetting.dateRange = "THIS_WEEK_SUN_TODAY";
      break;
    case "Weekly Mon-Sun":
      currentSetting.dateRange = "THIS_WEEK_MON_TODAY";
      break;
    case "Monthly":
      currentSetting.dateRange = "THIS_MONTH";
      break;
    default:
      throw new Error("Unsupported budgetPeriod: " + currentSetting.budgetPeriod);
  }

  currentSetting.budgetLabelToAdd += " (" + currentSetting.budgetPeriod + ")";
  currentSetting.scheduleLabelToAdd += " (Office Schedule)";

  createLabel(currentSetting.budgetLabelToAdd);
  createLabel(currentSetting.scheduleLabelToAdd);

  if (hasAnyDayScheduleRules()) {
    validateDaySchedules();
  }
  validateForcedClosedDates();
  validateScope();

  if (currentSetting.labelName && !checkIfLabelIsUsed(currentSetting.scope, currentSetting.labelName)) {
    Logger.log("No entities in scope use label '" + currentSetting.labelName + "'. Script will take no action.");
    return;
  }

  var now = getTimeInThisAccount();
  var budgetExceeded = isBudgetExceeded();
  var isNewBudgetPeriod = isStartOfNewBudgetPeriod(now.HH, now.dayOfWeek, now.dd);
  var isForcedClosed = isForcedClosedDate(now.yyyyMMdd);
  var scheduleAllowsToday = hasAnyDayScheduleRules()
    ? doesScheduleAllowToday(now.weekday, now.yyyyMMdd)
    : true;
  if (isForcedClosed) scheduleAllowsToday = false;

  Logger.log("=== SCHEDULE DEBUG ===");
  Logger.log("Today: " + now.yyyyMMdd + " (" + now.weekday + ")");
  Logger.log("Forced-closed date: " + isForcedClosed);
  Logger.log("Schedule allows today: " + scheduleAllowsToday);
  Logger.log("=== BUDGET DEBUG ===");
  Logger.log("Budget exceeded: " + budgetExceeded);
  Logger.log("New budget period: " + isNewBudgetPeriod);

  // Re-enable budget-paused campaigns only when period resets,
  // budget is currently healthy, and schedule allows being open.
  if (currentSetting.reEnableAtStartOfNewPeriod && isNewBudgetPeriod && !budgetExceeded && scheduleAllowsToday) {
    var reEnabledBudget = reEnableBudgetItems();
    maybeSendEmail(
      "Budget Period Reset",
      appendEntityDetailsToBody(
        "Re-enabled " + reEnabledBudget.count + " " + getScopeDisplayNamePlural(reEnabledBudget.count) +
        " at start of new " + currentSetting.budgetPeriod + " period.",
        reEnabledBudget.items
      ),
      "notification"
    );
  }

  // Re-enable schedule-paused campaigns on open schedule days
  // as long as budget has not been exceeded.
  if (currentSetting.reEnableOnScheduledOpenDay && scheduleAllowsToday && !budgetExceeded) {
    var reEnabledSchedule = reEnableScheduleItems();
    maybeSendEmail(
      "Schedule Open Day Re-Enable",
      appendEntityDetailsToBody(
        "Re-enabled " + reEnabledSchedule.count + " " + getScopeDisplayNamePlural(reEnabledSchedule.count) +
        " due to open schedule day.",
        reEnabledSchedule.items
      ),
      "notification"
    );
  }

  // Budget pause has priority and can happen any day.
  if (budgetExceeded && currentSetting.pauseWhenExceeds) {
    var pausedForBudget = pauseForBudget();
    maybeSendEmail(
      "Budget Exceeded",
      appendEntityDetailsToBody(
        "Paused " + pausedForBudget.count + " " + getScopeDisplayNamePlural(pausedForBudget.count) +
        " because " + currentSetting.budgetPeriod + " cost exceeded " +
        currentSetting.currencyCode + " " + currentSetting.maxCost.toFixed(2) + ".",
        pausedForBudget.items
      ),
      "warning"
    );
  }

  if (!scheduleAllowsToday && currentSetting.pauseWhenClosed) {
    var pausedForSchedule = pauseForSchedule();
    var scheduleReason = isForcedClosed ? "forced-closed date" : "closed office schedule";
    maybeSendEmail(
      "Schedule Closed Pause",
      appendEntityDetailsToBody(
        "Paused " + pausedForSchedule.count + " " + getScopeDisplayNamePlural(pausedForSchedule.count) +
        " because today is " + scheduleReason + ".",
        pausedForSchedule.items
      ),
      "notification"
    );
  }
}

function pauseForBudget() {
  var scope = lower(currentSetting.scope);
  if (scope.indexOf("account") !== -1) {
    return pauseScopedItems(currentSetting.budgetLabelToAdd, "Paused for budget");
  }

  var exceeded = getBudgetExceededScopedItems();
  var count = 0;
  var details = [];
  for (var i = 0; i < exceeded.length; i++) {
    var row = exceeded[i];
    row.item.pause();
    row.item.applyLabel(currentSetting.budgetLabelToAdd);
    Logger.log("Paused for budget: " + row.name + " | Cost: " + currentSetting.currencyCode + " " + row.cost.toFixed(2));
    details.push(row.name + " | Cost: " + currentSetting.currencyCode + " " + row.cost.toFixed(2));
    count++;
  }

  return { count: count, items: details };
}

function pauseForSchedule() {
  return pauseScopedItems(currentSetting.scheduleLabelToAdd, "Paused for schedule");
}

function reEnableBudgetItems() {
  return reEnableScopedItems(currentSetting.budgetLabelToAdd, "Re-enabled (budget)");
}

function reEnableScheduleItems() {
  return reEnableScopedItems(currentSetting.scheduleLabelToAdd, "Re-enabled (schedule)");
}

function isBudgetExceeded() {
  var scope = lower(currentSetting.scope);
  if (scope.indexOf("account") === -1) {
    return getBudgetExceededScopedItems().length > 0;
  }

  var rows = AdWordsApp.report(
    "SELECT Cost FROM ACCOUNT_PERFORMANCE_REPORT DURING " + currentSetting.dateRange
  ).rows();

  var cost = 0;
  while (rows.hasNext()) {
    cost = getFloat(rows.next()["Cost"]);
  }

  return cost > currentSetting.maxCost;
}

function doesScheduleAllowToday(weekday, yyyyMMdd) {
  var dayRule = currentSetting.daySchedules[weekday];
  if (!dayRule) return false;
  return isDayRuleOpenForDate(dayRule, yyyyMMdd);
}

function isForcedClosedDate(yyyyMMdd) {
  if (!currentSetting.forcedClosedDates || currentSetting.forcedClosedDates.length === 0) {
    return false;
  }

  for (var i = 0; i < currentSetting.forcedClosedDates.length; i++) {
    if (currentSetting.forcedClosedDates[i] === yyyyMMdd) return true;
  }
  return false;
}

function isDayRuleOpenForDate(dayRule, yyyyMMdd) {
  var weeks = getWeeksSinceReference(yyyyMMdd, dayRule.anchorOpenDate);
  if (weeks < 0) return false;
  return weeks % dayRule.repeatEveryWeeks === 0;
}

function getWeeksSinceReference(todayString, refString) {
  var t = parseDateUTC(todayString);
  var r = parseDateUTC(refString);
  var diffDays = Math.floor((t - r) / 86400000);
  return Math.floor(diffDays / 7);
}

function parseDateUTC(s) {
  var p = s.split("-");
  return Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}

function isStartOfNewBudgetPeriod(hour, day, dd) {
  if (currentSetting.budgetPeriod === "Daily") return hour === 0;
  if (currentSetting.budgetPeriod === "Weekly Mon-Sun") return day === 1 && hour === 0; // Monday=1
  if (currentSetting.budgetPeriod === "Weekly Sun-Sat") return day === 7 && hour === 0; // Sunday=7
  if (currentSetting.budgetPeriod === "Monthly") return dd === 1 && hour === 0;
  return false;
}

function buildScopedSelector() {
  var scope = lower(currentSetting.scope);
  var selector;

  if (scope.indexOf("account") !== -1 || scope.indexOf("campaign") !== -1) selector = AdWordsApp.campaigns();
  else if (scope.indexOf("ad group") !== -1) selector = AdWordsApp.adGroups();
  else if (scope.indexOf("ad text") !== -1) selector = AdWordsApp.ads();
  else if (scope.indexOf("keyword") !== -1) selector = AdWordsApp.keywords();
  else throw new Error("Unsupported scope: " + currentSetting.scope);

  if (currentSetting.campaignNameContains) {
    if (scope.indexOf("campaign") !== -1 || scope.indexOf("account") !== -1) {
      selector = selector.withCondition(
        "Name CONTAINS_IGNORE_CASE '" + currentSetting.campaignNameContains + "'"
      );
    } else {
      Logger.log("campaignNameContains filter is only applied to Campaign/Account scope.");
    }
  }

  if (currentSetting.labelName) {
    selector = selector.withCondition(
      "LabelNames CONTAINS_ANY ['" + currentSetting.labelName + "']"
    );
  }

  return selector;
}

function getTimeInThisAccount() {
  var tz = AdWordsApp.currentAccount().getTimeZone();
  var d = new Date();

  return {
    dayOfWeek: parseInt(Utilities.formatDate(d, tz, "u"), 10), // Mon=1 ... Sun=7
    dd: parseInt(Utilities.formatDate(d, tz, "dd"), 10),
    weekday: Utilities.formatDate(d, tz, "EEEE"),
    HH: parseInt(Utilities.formatDate(d, tz, "HH"), 10),
    yyyyMMdd: Utilities.formatDate(d, tz, "yyyy-MM-dd")
  };
}

function createLabel(name) {
  var it = AdWordsApp.labels().withCondition("Name = '" + name + "'").get();
  if (!it.hasNext()) {
    AdWordsApp.createLabel(name);
    Logger.log("Created label: " + name);
  }
}

function getFloat(input) {
  return parseFloat((input || "0").toString().replace(/,/g, ""));
}

function lower(v) {
  return (v || "").toString().toLowerCase();
}

function hasAnyDayScheduleRules() {
  if (!currentSetting.daySchedules) return false;
  for (var day in currentSetting.daySchedules) {
    if (currentSetting.daySchedules.hasOwnProperty(day)) return true;
  }
  return false;
}

function validateDaySchedules() {
  var validDays = {
    Monday: true,
    Tuesday: true,
    Wednesday: true,
    Thursday: true,
    Friday: true,
    Saturday: true,
    Sunday: true
  };

  var dayCount = 0;
  for (var day in currentSetting.daySchedules) {
    if (!currentSetting.daySchedules.hasOwnProperty(day)) continue;
    dayCount++;
    if (!validDays[day]) {
      throw new Error("Invalid weekday in daySchedules: " + day);
    }

    var rule = currentSetting.daySchedules[day];
    if (!rule.anchorOpenDate || !/^\d{4}-\d{2}-\d{2}$/.test(rule.anchorOpenDate)) {
      throw new Error("Invalid anchorOpenDate for " + day + ": " + rule.anchorOpenDate);
    }
    if (!rule.repeatEveryWeeks || rule.repeatEveryWeeks < 1) {
      throw new Error("repeatEveryWeeks must be >= 1 for " + day);
    }

    // Sanity check: warn if anchor date weekday doesn't match the configured key day.
    var actualAnchorDay = getWeekdayNameFromUTC(rule.anchorOpenDate);
    if (actualAnchorDay !== day) {
      Logger.log(
        "WARNING: " + day + " anchorOpenDate " + rule.anchorOpenDate +
        " is actually " + actualAnchorDay + "."
      );
    }
  }

  if (dayCount === 0) {
    throw new Error("daySchedules is empty. Add at least one weekday rule.");
  }
}

function validateForcedClosedDates() {
  if (!currentSetting.forcedClosedDates) return;
  for (var i = 0; i < currentSetting.forcedClosedDates.length; i++) {
    var dt = currentSetting.forcedClosedDates[i];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
      throw new Error("Invalid forcedClosedDates entry: " + dt + ". Use yyyy-MM-dd.");
    }
  }
}

function getWeekdayNameFromUTC(yyyyMMdd) {
  var dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var utc = parseDateUTC(yyyyMMdd);
  var d = new Date(utc);
  return dayNames[d.getUTCDay()];
}

function pauseScopedItems(labelToApply, logPrefix) {
  var iterator = buildScopedSelector().withCondition("Status = ENABLED").get();
  var count = 0;
  var details = [];
  while (iterator.hasNext()) {
    var item = iterator.next();
    item.pause();
    item.applyLabel(labelToApply);
    var entityName = getEntityName(item);
    Logger.log(logPrefix + ": " + entityName);
    details.push(entityName);
    count++;
  }
  return { count: count, items: details };
}

function reEnableScopedItems(labelToRemove, logPrefix) {
  var scope = lower(currentSetting.scope);
  var details = [];
  var count = 0;

  var iterator = buildScopedSelector()
    .withCondition("LabelNames CONTAINS_ANY ['" + labelToRemove + "']")
    .get();
  while (iterator.hasNext()) {
    var item = iterator.next();
    item.enable();
    item.removeLabel(labelToRemove);
    var entityName = getEntityName(item);
    Logger.log(logPrefix + ": " + entityName);
    details.push(entityName);
    count++;
  }

  // Restore old behavior: include shopping entities when scope is campaign/account or ad group.
  if (scope.indexOf("account") !== -1 || scope.indexOf("campaign") !== -1) {
    var shoppingCampaigns = AdWordsApp.shoppingCampaigns()
      .withCondition("LabelNames CONTAINS_ANY ['" + labelToRemove + "']")
      .get();
    while (shoppingCampaigns.hasNext()) {
      var shoppingCampaign = shoppingCampaigns.next();
      shoppingCampaign.enable();
      shoppingCampaign.removeLabel(labelToRemove);
      var shoppingCampaignName = shoppingCampaign.getName();
      Logger.log(logPrefix + ": " + shoppingCampaignName);
      details.push(shoppingCampaignName);
      count++;
    }
  } else if (scope.indexOf("ad group") !== -1) {
    var shoppingAdGroups = AdWordsApp.shoppingAdGroups()
      .withCondition("LabelNames CONTAINS_ANY ['" + labelToRemove + "']")
      .get();
    while (shoppingAdGroups.hasNext()) {
      var shoppingAdGroup = shoppingAdGroups.next();
      shoppingAdGroup.enable();
      shoppingAdGroup.removeLabel(labelToRemove);
      var shoppingAdGroupName = shoppingAdGroup.getCampaign().getName() + " / " + shoppingAdGroup.getName();
      Logger.log(logPrefix + ": " + shoppingAdGroupName);
      details.push(shoppingAdGroupName);
      count++;
    }
  }

  return { count: count, items: details };
}

function getEntityName(item) {
  if (item.getName) return item.getName();
  if (item.getText) return item.getText();
  if (item.getHeadline) return item.getHeadline();
  return "(unknown entity)";
}

function validateScope() {
  var s = lower(currentSetting.scope);
  if (
    s.indexOf("account") === -1 &&
    s.indexOf("campaign") === -1 &&
    s.indexOf("ad group") === -1 &&
    s.indexOf("ad text") === -1 &&
    s.indexOf("keyword") === -1
  ) {
    throw new Error("Invalid scope: " + currentSetting.scope);
  }
}

function checkIfLabelIsUsed(scope, labelName) {
  var labelIterator = AdWordsApp.labels().withCondition("Name = '" + labelName + "'").get();
  if (!labelIterator.hasNext()) return false;

  var label = labelIterator.next();
  var s = lower(scope);
  if (s.indexOf("account") !== -1 || s.indexOf("campaign") !== -1) return label.campaigns().get().totalNumEntities() > 0;
  if (s.indexOf("ad group") !== -1) return label.adGroups().get().totalNumEntities() > 0;
  if (s.indexOf("ad text") !== -1) return label.ads().get().totalNumEntities() > 0;
  if (s.indexOf("keyword") !== -1) return label.keywords().get().totalNumEntities() > 0;
  return false;
}

function maybeSendEmail(subject, body, emailType) {
  if (!currentSetting.email) return;
  if (AdWordsApp.getExecutionInfo().isPreview()) {
    Logger.log("Preview mode: email not sent. Subject: " + subject);
    return;
  }
  sendEmailNotifications(currentSetting.email, subject, body, emailType);
}

function sendEmailNotifications(emailAddresses, subject, body, emailType) {
  var prefix = lower(emailType).indexOf("warning") !== -1 ? "[Warning] " : "[Notification] ";
  var finalSubject = prefix + subject + " - " + AdWordsApp.currentAccount().getName() +
    " (" + AdWordsApp.currentAccount().getCustomerId() + ")";
  MailApp.sendEmail({
    to: emailAddresses,
    subject: finalSubject,
    htmlBody: body
  });
  Logger.log("Email sent to " + emailAddresses + ": " + finalSubject);
}

function getScopeDisplayNamePlural(count) {
  var s = lower(currentSetting.scope);
  var base = "items";
  if (s.indexOf("campaign") !== -1 || s.indexOf("account") !== -1) base = "campaign";
  else if (s.indexOf("ad group") !== -1) base = "ad group";
  else if (s.indexOf("ad text") !== -1) base = "ad";
  else if (s.indexOf("keyword") !== -1) base = "keyword";
  return count === 1 ? base : base + "s";
}

function getBudgetExceededScopedItems() {
  var iterator = buildScopedSelector().withCondition("Status = ENABLED").get();
  var exceeded = [];
  while (iterator.hasNext()) {
    var item = iterator.next();
    var cost = getFloat(item.getStatsFor(currentSetting.dateRange).getCost());
    if (cost > currentSetting.maxCost) {
      exceeded.push({
        item: item,
        cost: cost,
        name: getEntityName(item)
      });
    }
  }
  return exceeded;
}

function appendEntityDetailsToBody(baseBody, entityNames) {
  if (!entityNames || entityNames.length === 0) return baseBody;
  var body = baseBody + "<br/><br/>Items:<br/><ul>";
  for (var i = 0; i < entityNames.length; i++) {
    body += "<li>" + entityNames[i] + "</li>";
  }
  body += "</ul>";
  return body;
}
