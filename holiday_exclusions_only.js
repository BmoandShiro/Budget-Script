var DEBUG = 0;
// Version: v1.0.8
// Created by BMOandShiro
// GitHub: https://github.com/BmoandShiro/Budget-Script

/*
Holiday Exclusions Only Script
==============================
Runs alongside the legacy budget script. Pauses on listed dates; re-enables only items
this script labeled. Skips re-enable if legacy budget pause label is still present.

Non-technical users: edit ONLY the CONFIG section below (between the banner lines).
*/

// =============================================================================
// CONFIG — edit only this block
// =============================================================================
var HOLIDAY_CONFIG = {
  // Comma-separated list (Google Ads MailApp accepts "a@x.com,b@y.com")
  emailTo: "alec@risedds.com,nic@risedds.com",

  // Campaign | Account | Ad Group | Ad Text | Keyword
  scope: "Account",

  // Optional: only affect entities that already have this label (empty = all in scope)
  labelName: "",

  // Optional (Campaign / Account scope only): only campaigns whose name contains this text
  // (case-insensitive). Leave campaignNameContains: "", normally — Only use when you want an extra filter in code, e.g.
  // campaignNameContains: "Search - "   or   campaignNameContains: "Brand"
  campaignNameContains: "",

  // Substring that appears in the legacy budget pause label, e.g. "stopped by budget script (Monthly)"
  legacyBudgetLabelContains: "stopped by budget script",

  // Label this script applies when pausing for a holiday / forced closure
  holidayLabelToAdd: "stopped by holiday exclusions script",

  // Dates (yyyy-MM-dd, account timezone) when ads should stay OFF.
  // Leave [] to disable this script entirely (it will log and exit).
  forcedClosedDates: [
    // "2026-11-26",
    // "2026-12-25",
    // "2026-07-03",
    // "2026-07-04"
  ]

  // More examples (uncomment and merge into the array above):
  // - US Thanksgiving + day after:
  //   "2026-11-26", "2026-11-27"
  // - Long weekend (Fri–Mon):
  //   "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"
  // - Company retreat (single week, list each date):
  //   "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"
};

//  ================================================================================================
// SCRIPT LOGIC — do not make edits below this line unless you are comfortable with code changes
// ================================================================================================

function main() {
  var setting = applyHolidayConfig(HOLIDAY_CONFIG);
  setting.currencyCode = AdWordsApp.currentAccount().getCurrencyCode();

  createLabel(setting.holidayLabelToAdd);
  validateScope(setting.scope);
  validateForcedClosedDates(setting.forcedClosedDates);

  if (!setting.forcedClosedDates || setting.forcedClosedDates.length === 0) {
    Logger.log("forcedClosedDates is empty. Holiday exclusions script will take no action.");
    return;
  }

  var now = getTimeInThisAccount();
  var isClosed = isForcedClosedDate(setting.forcedClosedDates, now.yyyyMMdd);

  if (isClosed) {
    var paused = pauseScopedItems(setting, setting.holidayLabelToAdd, "Paused for holiday exclusion");
    if (paused.count > 0) {
      maybeSendEmail(
        setting.email,
        "Holiday Exclusion - Closed Day",
        appendEntityDetailsToBody(
          "Paused " + paused.count + " " + getScopeDisplayNamePlural(setting.scope, paused.count) +
          " because today is listed in forcedClosedDates.",
          paused.items
        ),
        "notification"
      );
    }
  } else {
    var enabled = reEnableScopedItems(setting, setting.holidayLabelToAdd, "Re-enabled (holiday exclusions)");
    if (enabled.count > 0) {
      maybeSendEmail(
        setting.email,
        "Holiday Exclusion - Open Day",
        appendEntityDetailsToBody(
          "Re-enabled " + enabled.count + " " + getScopeDisplayNamePlural(setting.scope, enabled.count) +
          " because today is not in forcedClosedDates.",
          enabled.items
        ),
        "notification"
      );
    }
  }
}

function applyHolidayConfig(cfg) {
  return {
    scope: cfg.scope,
    labelName: cfg.labelName || "",
    campaignNameContains: cfg.campaignNameContains || "",
    legacyBudgetLabelContains: cfg.legacyBudgetLabelContains || "",
    holidayLabelToAdd: cfg.holidayLabelToAdd,
    email: (cfg.emailTo || "").replace(/\s+/g, ""),
    forcedClosedDates: cfg.forcedClosedDates ? cfg.forcedClosedDates.slice() : []
  };
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

// AWQL LabelNames CONTAINS_ANY throws if that label name does not exist on the account yet.
function scopedIteratorForReEnableLabel(baseSelector, labelToRemove, logPrefix) {
  try {
    return {
      iterator: baseSelector
        .withCondition("LabelNames CONTAINS_ANY ['" + labelToRemove + "']")
        .get(),
      requireExactLabelOnEntity: false
    };
  } catch (e) {
    Logger.log(
      logPrefix +
        " label filter unavailable; using scoped iterator + in-script label check: " +
        e
    );
    return { iterator: baseSelector.get(), requireExactLabelOnEntity: true };
  }
}

function shoppingIteratorForReEnableLabel(isCampaigns, labelToRemove, logPrefix) {
  var base = isCampaigns ? AdWordsApp.shoppingCampaigns() : AdWordsApp.shoppingAdGroups();
  var kind = isCampaigns ? "shopping campaigns" : "shopping ad groups";
  try {
    return {
      iterator: base.withCondition("LabelNames CONTAINS_ANY ['" + labelToRemove + "']").get(),
      requireExactLabelOnEntity: false
    };
  } catch (e) {
    Logger.log(
      logPrefix + " " + kind + ": label filter unavailable; full iterator + label check: " + e
    );
    return { iterator: base.get(), requireExactLabelOnEntity: true };
  }
}

function pauseScopedItems(setting, labelToApply, logPrefix) {
  var iterator = buildScopedSelector(setting).withCondition("Status = ENABLED").get();
  var count = 0;
  var details = [];
  while (iterator.hasNext()) {
    var item = iterator.next();
    var labelNewlyApplied = !entityHasExactLabelName(item, labelToApply);
    item.pause();
    item.applyLabel(labelToApply);
    if (labelNewlyApplied) {
      var name = getEntityName(item);
      Logger.log(logPrefix + ": " + name);
      details.push(name);
      count++;
    } else {
      Logger.log(logPrefix + " (already had pause label, omitted from notification): " + getEntityName(item));
    }
  }
  return { count: count, items: details };
}

function reEnableScopedItems(setting, labelToRemove, logPrefix) {
  var scope = lower(setting.scope);
  var labelIterPack = scopedIteratorForReEnableLabel(
    buildScopedSelector(setting),
    labelToRemove,
    logPrefix
  );
  var iterator = labelIterPack.iterator;
  var requireExactLabelOnEntity = labelIterPack.requireExactLabelOnEntity;
  var count = 0;
  var details = [];

  while (iterator.hasNext()) {
    var item = iterator.next();
    if (requireExactLabelOnEntity && !entityHasExactLabelName(item, labelToRemove)) {
      continue;
    }
    if (entityHasLabelNameContaining(item, setting.legacyBudgetLabelContains)) {
      Logger.log(
        logPrefix + " skipped (legacy budget label still present): " + getEntityName(item)
      );
      continue;
    }
    var hadPauseLabel = entityHasExactLabelName(item, labelToRemove);
    removeLabelIfPresent(item, labelToRemove, logPrefix);
    item.enable();
    if (hadPauseLabel) {
      var name = getEntityName(item);
      Logger.log(logPrefix + ": " + name);
      details.push(name);
      count++;
    } else {
      Logger.log(
        logPrefix + " (no exact pause label before re-enable, omitted from notification): " +
        getEntityName(item)
      );
    }
  }

  if (scope.indexOf("account") !== -1 || scope.indexOf("campaign") !== -1) {
    var scPack = shoppingIteratorForReEnableLabel(true, labelToRemove, logPrefix);
    var shoppingCampaigns = scPack.iterator;
    var scRequireLabel = scPack.requireExactLabelOnEntity;
    while (shoppingCampaigns.hasNext()) {
      var shoppingCampaign = shoppingCampaigns.next();
      if (scRequireLabel && !entityHasExactLabelName(shoppingCampaign, labelToRemove)) {
        continue;
      }
      if (entityHasLabelNameContaining(shoppingCampaign, setting.legacyBudgetLabelContains)) {
        Logger.log(
          logPrefix + " skipped (legacy budget label still present): " + shoppingCampaign.getName()
        );
        continue;
      }
      var scHadPauseLabel = entityHasExactLabelName(shoppingCampaign, labelToRemove);
      removeLabelIfPresent(shoppingCampaign, labelToRemove, logPrefix);
      shoppingCampaign.enable();
      if (scHadPauseLabel) {
        var scName = shoppingCampaign.getName();
        Logger.log(logPrefix + ": " + scName);
        details.push(scName);
        count++;
      } else {
        Logger.log(
          logPrefix + " (no exact pause label before re-enable, omitted from notification): " +
          shoppingCampaign.getName()
        );
      }
    }
  } else if (scope.indexOf("ad group") !== -1) {
    var sagPack = shoppingIteratorForReEnableLabel(false, labelToRemove, logPrefix);
    var shoppingAdGroups = sagPack.iterator;
    var sagRequireLabel = sagPack.requireExactLabelOnEntity;
    while (shoppingAdGroups.hasNext()) {
      var shoppingAdGroup = shoppingAdGroups.next();
      if (sagRequireLabel && !entityHasExactLabelName(shoppingAdGroup, labelToRemove)) {
        continue;
      }
      if (entityHasLabelNameContaining(shoppingAdGroup, setting.legacyBudgetLabelContains)) {
        Logger.log(
          logPrefix + " skipped (legacy budget label still present): " +
          shoppingAdGroup.getCampaign().getName() + " / " + shoppingAdGroup.getName()
        );
        continue;
      }
      var sagHadPauseLabel = entityHasExactLabelName(shoppingAdGroup, labelToRemove);
      removeLabelIfPresent(shoppingAdGroup, labelToRemove, logPrefix);
      shoppingAdGroup.enable();
      if (sagHadPauseLabel) {
        var sagName = shoppingAdGroup.getCampaign().getName() + " / " + shoppingAdGroup.getName();
        Logger.log(logPrefix + ": " + sagName);
        details.push(sagName);
        count++;
      } else {
        Logger.log(
          logPrefix + " (no exact pause label before re-enable, omitted from notification): " +
          shoppingAdGroup.getCampaign().getName() + " / " + shoppingAdGroup.getName()
        );
      }
    }
  }

  return { count: count, items: details };
}

function removeLabelIfPresent(item, labelName, logPrefix) {
  if (!labelName) return;
  if (!entityHasExactLabelName(item, labelName)) {
    Logger.log(
      logPrefix + " skip removeLabel (label not on entity): " +
      getEntityName(item) + " | expected label: " + labelName
    );
    return;
  }
  try {
    item.removeLabel(labelName);
  } catch (e) {
    Logger.log(
      logPrefix + " removeLabel failed (ignored): " + getEntityName(item) +
      " | label: " + labelName + " | " + e
    );
  }
}

function entityHasExactLabelName(item, labelName) {
  if (!labelName) return false;
  try {
    var it = item.labels().get();
    while (it.hasNext()) {
      if (it.next().getName() === labelName) return true;
    }
  } catch (e) {
    Logger.log("Could not read labels for entity; cannot confirm label presence.");
  }
  return false;
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

function isForcedClosedDate(dates, yyyyMMdd) {
  for (var i = 0; i < dates.length; i++) {
    if (dates[i] === yyyyMMdd) return true;
  }
  return false;
}

function validateForcedClosedDates(dates) {
  for (var i = 0; i < dates.length; i++) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dates[i])) {
      throw new Error("Invalid forcedClosedDates entry: " + dates[i] + ". Use yyyy-MM-dd.");
    }
  }
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
