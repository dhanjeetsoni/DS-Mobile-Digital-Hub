// Full owner navigation taxonomy. Permissions are still enforced by the caller.
export const WORKSPACE_GROUPS = [
  {
    "id": "overview",
    "label": "Overview",
    "keys": [
      "dashboard",
      "statusDashboard"
    ]
  },
  {
    "id": "pos",
    "label": "Smart POS",
    "keys": [
      "sell",
      "xeroxGrid",
      "invoices",
      "returns",
      "salesToday"
    ]
  },
  {
    "id": "inventory",
    "label": "Inventory",
    "keys": [
      "products",
      "stockadjust",
      "lowstock",
      "labels",
      "stockAudit",
      "stockReview",
      "downloadArea"
    ]
  },
  {
    "id": "purchases",
    "label": "Purchases",
    "keys": [
      "purchases",
      "supplierKhata"
    ]
  },
  {
    "id": "customers",
    "label": "Customers",
    "keys": [
      "khata",
      "customerDirectory",
      "loyalty"
    ]
  },
  {
    "id": "repairs",
    "label": "Repairs & devices",
    "keys": [
      "jobs",
      "imeiTracker",
      "warrantyLookup",
      "secondHandKyc"
    ]
  },
  {
    "id": "finance",
    "label": "Finance",
    "keys": [
      "gallaClosing",
      "loanTracker",
      "financeLedger",
      "simTracker",
      "expShop",
      "extraIncome",
      "expPersonal"
    ]
  },
  {
    "id": "analytics",
    "label": "Analytics",
    "keys": [
      "saleshistory",
      "plDashboard",
      "dailyreview",
      "monthlyreview",
      "ownerreports",
      "exportClear"
    ]
  },
  {
    "id": "staff",
    "label": "Staff",
    "keys": [
      "staffAccess",
      "staffPerformance",
      "staffIncentives",
      "staffAttendance"
    ]
  },
  {
    "id": "ai",
    "label": "AI Studio",
    "keys": [
      "modelsearch",
      "photoFinder",
      "smartRestock",
      "deadStock"
    ]
  },
  {
    "id": "security",
    "label": "Security & sync",
    "keys": [
      "securityAudit",
      "auditLog",
      "offlineSync",
      "backup"
    ]
  },
  {
    "id": "settings",
    "label": "Settings",
    "keys": [
      "setupWizard",
      "appVersions",
      "settings",
      "appearanceStudio"
    ]
  }
] as const;
