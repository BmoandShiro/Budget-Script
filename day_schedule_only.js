var DEBUG = 0;
// Version: v1.0.3
// Created by BMOandShiro
// GitHub: https://github.com/BmoandShiro/Budget-Script

/*
Day Schedule Only Script
========================
Runs alongside the legacy budget script. Pauses on closed weekdays per rules; re-enables
only items this script labeled. Skips re-enable if legacy budget pause label is still present.

Non-technical users: edit ONLY the CONFIG section below (between the banner lines).

--- How anchorOpenDate works (plain English) ---

Think of anchorOpenDate as the calendar day you pin the pattern to. The script counts how
many full weeks have passed between anchorOpenDate and "today", then uses repeatEveryWeeks
to decide if this week is an OPEN week or a CLOSED week for that weekday.

Why you need it:
Without an anchor, "every other Friday" would be ambiguous — you could mean different
Fridays depending when you started. The anchor fixes the pattern in time.

How to pick a good anchorOpenDate (3 simple rules):

1) It MUST be the same weekday as the rule key.
   Example: Friday: { ... }  -> anchorOpenDate must be a Friday (like 2026-04-17).

2) Choose a date on a week you want treated as OPEN for that pattern.
   Example for "every other Friday": pick a Friday in a week you want ads ON.
   If you pick the wrong Friday, your open/closed weeks will be shifted — still every
   two weeks, but on the opposite weeks from what you intended.

3) The date can be in the past or the future; it is only used as a reference point.
   Many teams pick a known Friday in the near past that was definitely an OPEN week.

repeatEveryWeeks (what the number means):
- 1 = weekly (that weekday is open every week, as long as the weekday is configured)
- 2 = every other week (open one week, closed the next, repeating)
- 3 = every third week (open, then two off-weeks pattern — still anchored to your date)

Valid weekday keys: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
*/

// =============================================================================
// CONFIG — edit only this block
// =============================================================================
var DAY_SCHEDULE_CONFIG = {
  // Comma-separated list (Google Ads MailApp accepts "a@x.com,b@y.com")
  emailTo: "alec@risedds.com,nic@risedds.com",

  // Campaign | Account | Ad Group | Ad Text | Keyword
  scope: "Account",

  labelName: "",

  // Optional (Campaign / Account scope only): only campaigns whose name contains this text
  // (case-insensitive). Leave campaignNameContains: "", normally — Only use when you want an extra filter in code, e.g.
  // campaignNameContains: "Search - "   or   campaignNameContains: "Brand"
  campaignNameContains: "",

  legacyBudgetLabelContains: "stopped by budget script",

  scheduleLabelToAdd: "stopped by day schedule script",

  // --- daySchedules (what to put in anchorOpenDate) ---
  //
  // For each weekday you list below:
  // - anchorOpenDate = yyyy-MM-dd on THAT weekday = "week 0" of your pattern for this rule
  // - repeatEveryWeeks = how many weeks between open weeks for this weekday
  //
  // Quick check before saving: open a calendar, find anchorOpenDate, confirm it matches
  // the weekday name on the left (Friday rule -> must land on Friday).
  //
  // Weekday rules. Omitted weekdays are treated as closed for schedule purposes.
  // Example A — every other Friday (anchor must be a Friday):
  // daySchedules: {
  //   Friday: { anchorOpenDate: "2026-04-17", repeatEveryWeeks: 2 }
  // },
  //
  // Example B — open every Monday and Thursday (weekly):
  // daySchedules: {
  //   Monday: { anchorOpenDate: "2026-04-13", repeatEveryWeeks: 1 },
  //   Thursday: { anchorOpenDate: "2026-04-16", repeatEveryWeeks: 1 }
  // },
  //
  // Example C — Wednesday every 3 weeks from anchor:
  // daySchedules: {
  //   Wednesday: { anchorOpenDate: "2026-04-22", repeatEveryWeeks: 3 }
  // },
  //
  // Example D — different cadence per day (Thu weekly + Wed every 3rd week):
  // daySchedules: {
  //   Thursday: { anchorOpenDate: "2026-04-16", repeatEveryWeeks: 1 },
  //   Wednesday: { anchorOpenDate: "2026-04-22", repeatEveryWeeks: 3 }
  // },

  daySchedules: {}
};

// ================================================================================================
// SCRIPT LOGIC — do not make edits below this line unless you are comfortable with code changes
// ================================================================================================

function main() {
  var setting = applyDayScheduleConfig(DAY_SCHEDULE_CONFIG);

  createLabel(setting.scheduleLabelToAdd);
  validateScope(setting.scope);

  if (!setting.daySchedules || !hasAnyDayScheduleRules(setting.daySchedules)) {
    Logger.log("daySchedules is empty. Day schedule script will take no action.");
    return;
  }
  validateDaySchedules(setting.daySchedules);

  var now = getTimeInThisAccount();
  var openToday = doesScheduleAllowToday(setting.daySchedules, now.weekday, now.yyyyMMdd);

  if (!openToday) {
    var paused = pauseScopedItems(setting, setting.scheduleLabelToAdd, "Paused for day schedule");
    maybeSendEmail(
      setting.email,
      "Day Schedule - Closed Day",
      appendEntityDetailsToBody(
        "Paused " + paused.count + " " + getScopeDisplayNamePlural(setting.scope, paused.count) +
        " because today's day schedule is closed.",
        paused.items
      ),
      "notification"
    );
  } else {
    var enabled = reEnableScopedItems(setting, setting.scheduleLabelToAdd, "Re-enabled (day schedule)");
    maybeSendEmail(
      setting.email,
      "Day Schedule - Open Day",
      appendEntityDetailsToBody(
        "Re-enabled " + enabled.count + " " + getScopeDisplayNamePlural(setting.scope, enabled.count) +
        " because today's day schedule is open.",
        enabled.items
      ),
      "notification"
    );
  }
}

function applyDayScheduleConfig(cfg) {
  var daySchedules = {};
  if (cfg.daySchedules) {
    for (var d in cfg.daySchedules) {
      if (cfg.daySchedules.hasOwnProperty(d)) {
        daySchedules[d] = cfg.daySchedules[d];
      }
    }
  }
  return {
    scope: cfg.scope,
    labelName: cfg.labelName || "",
    campaignNameContains: cfg.campaignNameContains || "",
    legacyBudgetLabelContains: cfg.legacyBudgetLabelContains || "",
    scheduleLabelToAdd: cfg.scheduleLabelToAdd,
    email: (cfg.emailTo || "").replace(/\s+/g, ""),
    daySchedules: daySchedules
  };
}

function doesScheduleAllowToday(daySchedules, weekday, yyyyMMdd) {
  var dayRule = daySchedules[weekday];
  if (!dayRule) return false;
  return isDayRuleOpenForDate(dayRule, yyyyMMdd);
}

function hasAnyDayScheduleRules(daySchedules) {
  for (var day in daySchedules) {
    if (daySchedules.hasOwnProperty(day)) return true;
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

function validateDaySchedules(daySchedules) {
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
  for (var day in daySchedules) {
    if (!daySchedules.hasOwnProperty(day)) continue;
    dayCount++;

    if (!validDays[day]) throw new Error("Invalid weekday in daySchedules: " + day);

    var rule = daySchedules[day];
    if (!rule.anchorOpenDate || !/^\d{4}-\d{2}-\d{2}$/.test(rule.anchorOpenDate)) {
      throw new Error("Invalid anchorOpenDate for " + day + ": " + rule.anchorOpenDate);
    }
    if (!rule.repeatEveryWeeks || rule.repeatEveryWeeks < 1) {
      throw new Error("repeatEveryWeeks must be >= 1 for " + day);
    }
  }

  if (dayCount === 0) {
    throw new Error("daySchedules is empty. Add at least one weekday rule.");
  }
}

function buildScopedSelector(setting) {
  var scope = lower(setting.scope);
  var selector;

  if (scope.indexOf("account") !== -1 || scope.indexOf("campaign") !== -1) selector = AdWordsApp.campaigns();
  else if (scope.indexOf("ad group") !== -1) selector = AdWordsApp.adGroups();
  else if (scope.indexOf("ad text") !== -1) selector = AdWordsApp.ads();
  else if (scope.indexOf("keyword") !== -1) selector = AdWordsApp.keywords();
  else throw new Error("Unsupported scope: " + setting.scope);

  if (setting.campaignNameContains) {
    if (scope.indexOf("campaign") !== -1 || scope.indexOf("account") !== -1) {
      selector = selector.withCondition(
        "Name CONTAINS_IGNORE_CASE '" + setting.campaignNameContains + "'"
      );
    }
  }

  if (setting.labelName) {
    selector = selector.withCondition("LabelNames CONTAINS_ANY ['" + setting.labelName + "']");
  }

  return selector;
}

function pauseScopedItems(setting, labelToApply, logPrefix) {
  var iterator = buildScopedSelector(setting).withCondition("Status = ENABLED").get();
  var count = 0;
  var details = [];
  while (iterator.hasNext()) {
    var item = iterator.next();
    item.pause();
    item.applyLabel(labelToApply);
    var name = getEntityName(item);
    Logger.log(logPrefix + ": " + name);
    details.push(name);
    count++;
  }
  return { count: count, items: details };
}

function reEnableScopedItems(setting, labelToRemove, logPrefix) {
  var scope = lower(setting.scope);
  var iterator = buildScopedSelector(setting)
    .withCondition("LabelNames CONTAINS_ANY ['" + labelToRemove + "']")
    .get();
  var count = 0;
  var details = [];

  while (iterator.hasNext()) {
    var item = iterator.next();
    if (entityHasLabelNameContaining(item, setting.legacyBudgetLabelContains)) {
      Logger.log(
        logPrefix + " skipped (legacy budget label still present): " + getEntityName(item)
      );
      continue;
    }
    item.enable();
    item.removeLabel(labelToRemove);
    var name = getEntityName(item);
    Logger.log(logPrefix + ": " + name);
    details.push(name);
    count++;
  }

  if (scope.indexOf("account") !== -1 || scope.indexOf("campaign") !== -1) {
    var shoppingCampaigns = AdWordsApp.shoppingCampaigns()
      .withCondition("LabelNames CONTAINS_ANY ['" + labelToRemove + "']")
      .get();
    while (shoppingCampaigns.hasNext()) {
      var shoppingCampaign = shoppingCampaigns.next();
      if (entityHasLabelNameContaining(shoppingCampaign, setting.legacyBudgetLabelContains)) {
        Logger.log(
          logPrefix + " skipped (legacy budget label still present): " + shoppingCampaign.getName()
        );
        continue;
      }
      shoppingCampaign.enable();
      shoppingCampaign.removeLabel(labelToRemove);
      var scName = shoppingCampaign.getName();
      Logger.log(logPrefix + ": " + scName);
      details.push(scName);
      count++;
    }
  } else if (scope.indexOf("ad group") !== -1) {
    var shoppingAdGroups = AdWordsApp.shoppingAdGroups()
      .withCondition("LabelNames CONTAINS_ANY ['" + labelToRemove + "']")
      .get();
    while (shoppingAdGroups.hasNext()) {
      var shoppingAdGroup = shoppingAdGroups.next();
      if (entityHasLabelNameContaining(shoppingAdGroup, setting.legacyBudgetLabelContains)) {
        Logger.log(
          logPrefix + " skipped (legacy budget label still present): " +
          shoppingAdGroup.getCampaign().getName() + " / " + shoppingAdGroup.getName()
        );
        continue;
      }
      shoppingAdGroup.enable();
      shoppingAdGroup.removeLabel(labelToRemove);
      var sagName = shoppingAdGroup.getCampaign().getName() + " / " + shoppingAdGroup.getName();
      Logger.log(logPrefix + ": " + sagName);
      details.push(sagName);
      count++;
    }
  }

  return { count: count, items: details };
}

function entityHasLabelNameContaining(item, needle) {
  if (!needle) return false;
  var n = lower(needle);
  try {
    var it = item.labels().get();
    while (it.hasNext()) {
      if (lower(it.next().getName()).indexOf(n) !== -1) return true;
    }
  } catch (e) {
    Logger.log("Could not read labels for entity; assuming no legacy budget label match.");
  }
  return false;
}

function validateScope(scope) {
  var s = lower(scope);
  if (
    s.indexOf("account") === -1 &&
    s.indexOf("campaign") === -1 &&
    s.indexOf("ad group") === -1 &&
    s.indexOf("ad text") === -1 &&
    s.indexOf("keyword") === -1
  ) {
    throw new Error("Invalid scope: " + scope);
  }
}

function createLabel(name) {
  var it = AdWordsApp.labels().withCondition("Name CONTAINS '" + name + "'").get();
  if (!it.hasNext()) {
    AdWordsApp.createLabel(name);
    Logger.log("Created label: " + name);
  }
}

function getTimeInThisAccount() {
  var tz = AdWordsApp.currentAccount().getTimeZone();
  var d = new Date();
  return {
    weekday: Utilities.formatDate(d, tz, "EEEE"),
    yyyyMMdd: Utilities.formatDate(d, tz, "yyyy-MM-dd")
  };
}

function getEntityName(item) {
  if (item.getName) return item.getName();
  if (item.getText) return item.getText();
  if (item.getHeadline) return item.getHeadline();
  return "(unknown entity)";
}

function getScopeDisplayNamePlural(scope, count) {
  var s = lower(scope);
  var base = "items";
  if (s.indexOf("campaign") !== -1 || s.indexOf("account") !== -1) base = "campaign";
  else if (s.indexOf("ad group") !== -1) base = "ad group";
  else if (s.indexOf("ad text") !== -1) base = "ad";
  else if (s.indexOf("keyword") !== -1) base = "keyword";
  return count === 1 ? base : base + "s";
}

function maybeSendEmail(email, subject, body, emailType) {
  if (!email) return;
  var prefix = lower(emailType).indexOf("warning") !== -1 ? "[Warning] " : "[Notification] ";
  var finalSubject = prefix + subject + " - " + AdWordsApp.currentAccount().getName() +
    " (" + AdWordsApp.currentAccount().getCustomerId() + ")";
  var finalBody = body;
  if (AdWordsApp.getExecutionInfo().isPreview()) {
    finalBody = "<b>This script ran in preview mode. No changes were made to your account.</b><br/>" + body;
  }
  MailApp.sendEmail({
    to: email,
    subject: finalSubject,
    htmlBody: finalBody
  });
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

function lower(v) {
  return (v || "").toString().toLowerCase();
}
