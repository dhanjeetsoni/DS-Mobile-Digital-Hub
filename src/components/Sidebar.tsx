import React, { useState, useEffect } from "react";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Wrench,
  Search,
  Receipt,
  FileText,
  RotateCcw,
  BookOpen,
  Tag,
  Calendar,
  TrendingUp,
  DollarSign,
  User,
  Shield,
  Save,
  Settings as SettingsIcon,
  Smartphone,
  Layers,
  Radio,
  Landmark,
  CreditCard,
  Camera,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Monitor,
  Percent,
  Users,
  DownloadCloud,
  Archive,
  Activity,
  Rocket,
} from "lucide-react";
import { Database } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr } from "../utils/fifoEngine";

interface SidebarProps {
  db: Database;
  currentPage: string;
  onNavigate: (page: string) => void;
  ownerMode: boolean;
  onToggleOwnerMode: () => void;
  onOpenQuickScan: () => void;
  onOpenWindowsModal?: () => void;
}

// 6 Core Daily Counter Items for Ultra-Easy Counter Work
export const PRIMARY_NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard ()", icon: LayoutDashboard },
  { key: "sell", label: "Sales / New Bill", icon: ShoppingCart },
  { key: "imeiTracker", label: "Mobile & IMEI", icon: Smartphone },
  { key: "xeroxGrid", label: "Xerox / Cyber 1-Tap ()", icon: Layers },
  { key: "gallaClosing", label: "Daily Galla", icon: DollarSign },
  { key: "jobs", label: "Repairs & Service ()", icon: Wrench },
  { key: "khata", label: "Customer Khata", icon: CreditCard },
  { key: "modelsearch", label: "Glass & Cover", icon: Search },
  { key: "photoFinder", label: "Photo Stock Finder", icon: Camera },
];

// Advanced & Secondary Tools
export const SECONDARY_NAV_ITEMS = [
  { key: "downloadArea", label: "Download Area (Offline Mode)", icon: DownloadCloud, ownerOnly: false },
  { key: "products", label: "All Products", icon: Package, ownerOnly: false },
  { key: "customerDirectory", label: "Customer Directory", icon: Users, ownerOnly: true },
  { key: "secondHandKyc", label: "2nd-Hand Buyback KYC", icon: Shield, ownerOnly: true },
  { key: "simTracker", label: "SIM & Lapu Wallet", icon: Radio, ownerOnly: false },
  { key: "financeLedger", label: "Mobile Finance (Bajaj/TVS)", icon: Landmark, ownerOnly: false },
  { key: "supplierKhata", label: "Supplier / DLR Khata", icon: BookOpen, ownerOnly: true },
  { key: "labels", label: "Barcode & Price Tags", icon: Tag, ownerOnly: false },
  { key: "invoices", label: "Invoices & Receipts", icon: FileText, ownerOnly: false },
  // Step 7.2 — Delete Policy: manual "combined PDF then clear old records"
  // tool. Owner-only (it permanently deletes sale history), separate from
  // the always-visible "Invoices & Receipts" list above it.
  { key: "exportClear", label: "Export & Clear Old Invoices", icon: Archive, ownerOnly: true },
  { key: "returns", label: "Returns & Exchanges", icon: RotateCcw, ownerOnly: false },
  { key: "stockadjust", label: "Stock Adjustment", icon: Wrench, ownerOnly: true },
  { key: "purchases", label: "Purchase History", icon: Receipt, ownerOnly: true },
  { key: "loanTracker", label: "Loan / Byaj Khata", icon: Percent, ownerOnly: true },
  { key: "saleshistory", label: "Sales Breakdown & P&L", icon: TrendingUp, ownerOnly: true },
  { key: "plDashboard", label: "Profit & Loss Dashboard", icon: TrendingUp, ownerOnly: true },
  { key: "lowstock", label: "Low Stock & Reorder Alerts", icon: Shield, ownerOnly: false },
  { key: "loyalty", label: "Loyalty & Rewards", icon: Sparkles, ownerOnly: false },
  { key: "dailyreview", label: "Daily Review", icon: Calendar, ownerOnly: true },
  { key: "monthlyreview", label: "Monthly Review", icon: TrendingUp, ownerOnly: true },
  { key: "expShop", label: "Shop Expenses", icon: DollarSign, ownerOnly: true },
  { key: "extraIncome", label: "Extra Income", icon: TrendingUp, ownerOnly: true },
  { key: "expPersonal", label: "Personal Drawings", icon: User, ownerOnly: true },
  { key: "ownerreports", label: "Owner Financial Reports", icon: Shield, ownerOnly: true },
  { key: "staffAccess", label: "Staff Access Manager", icon: Users, ownerOnly: true },
  { key: "statusDashboard", label: "System Status Dashboard", icon: Activity, ownerOnly: true },
  { key: "setupWizard", label: "🚀 Shuruaati Setup Checklist", icon: Rocket, ownerOnly: true },
  { key: "appVersions", label: "🚀 App Versions (Update Push)", icon: Rocket, ownerOnly: true },
  { key: "backup", label: "Backup & Restore", icon: Save, ownerOnly: true },
  { key: "settings", label: "Shop Settings", icon: SettingsIcon, ownerOnly: true },
  { key: "appearanceStudio", label: "🎨 Appearance Studio (New)", icon: Sparkles, ownerOnly: false },
];

// Step 9.2 — Grouping Logic. Every SECONDARY_NAV_ITEMS key belongs to exactly
// one group below (checked at runtime in dev — see the console.assert further
// down) so nothing from the flat list above silently goes missing inside the
// grouped view. Groups + membership follow the plan's own example almost
// verbatim; a couple of items not named in the plan's example were placed by
// nearest-fit (e.g. "Download Area" holds offline *stock* data → Inventory;
// Invoices/Returns/Export&Clear didn't fit any of the plan's 5 named groups,
// so they got their own "Invoices & Documents" group rather than being forced
// into one that doesn't really describe them).
export interface NavGroup {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  itemKeys: string[];
}

export const SECONDARY_NAV_GROUPS: NavGroup[] = [
  {
    id: "money",
    label: "💰 Money & Expenses",
    icon: DollarSign,
    itemKeys: [
      "expShop",
      "extraIncome",
      "expPersonal",
      "supplierKhata",
      "loanTracker",
      "financeLedger",
      "simTracker",
    ],
  },
  {
    id: "inventory",
    label: "📦 Inventory",
    icon: Package,
    itemKeys: ["products", "stockadjust", "purchases", "lowstock", "labels", "secondHandKyc", "downloadArea"],
  },
  {
    id: "people",
    label: "👥 People",
    icon: Users,
    itemKeys: ["staffAccess", "customerDirectory", "loyalty"],
  },
  {
    id: "documents",
    label: "🧾 Invoices & Documents",
    icon: FileText,
    itemKeys: ["invoices", "exportClear", "returns"],
  },
  {
    id: "reports",
    label: "📊 Reports",
    icon: TrendingUp,
    itemKeys: ["ownerreports", "monthlyreview", "dailyreview", "plDashboard", "saleshistory"],
  },
  {
    id: "system",
    label: "⚙️ System",
    icon: Activity,
    itemKeys: ["statusDashboard", "setupWizard", "appVersions", "backup", "settings", "appearanceStudio"],
  },
];

if (import.meta.env.DEV) {
  const grouped = new Set(SECONDARY_NAV_GROUPS.flatMap((g) => g.itemKeys));
  const all = SECONDARY_NAV_ITEMS.map((i) => i.key);
  const missing = all.filter((k) => !grouped.has(k));
  const extra = [...grouped].filter((k) => !all.includes(k));
  console.assert(missing.length === 0, "Sidebar 9.2: SECONDARY_NAV_ITEMS keys missing from a group ->", missing);
  console.assert(extra.length === 0, "Sidebar 9.2: SECONDARY_NAV_GROUPS references unknown keys ->", extra);
}

export const Sidebar: React.FC<SidebarProps> = ({
  db,
  currentPage,
  onNavigate,
  ownerMode,
  onToggleOwnerMode,
  onOpenQuickScan,
  onOpenWindowsModal,
}) => {
  const [showAllTools, setShowAllTools] = useState<boolean>(false);
  const [easyMode, setEasyMode] = useState<boolean>(false);

  // Step 9.2 — which group card(s) are expanded. Whichever group holds the
  // currently active page always starts (and stays, on navigation) open, so
  // you're never left staring at a collapsed card hiding the screen you're
  // already on. Multiple groups can be open at once — collapsing one doesn't
  // auto-close another (that behaviour got annoying while testing: closing
  // "Reports" to peek at "Inventory" shouldn't lose your place in Reports).
  const groupForPage = (page: string) => SECONDARY_NAV_GROUPS.find((g) => g.itemKeys.includes(page))?.id;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    const activeGroup = groupForPage(currentPage);
    if (activeGroup) initial[activeGroup] = true;
    return initial;
  });

  useEffect(() => {
    const activeGroup = groupForPage(currentPage);
    if (activeGroup && !openGroups[activeGroup]) {
      setOpenGroups((prev) => ({ ...prev, [activeGroup]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  const toggleGroup = (id: string) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  const lowStockCount = db.products.filter((p) => p.stock <= p.minStock).length;
  const dueCount = db.customers.filter((c) => (c.totalDue || 0) > 0).length;
  const openJobs = db.jobs.filter((j) => j.status !== "Delivered").length;
  const pendingSimComm = (db.simActivations || []).filter(
    (s) => s.commissionStatus === "Pending from DLR"
  ).length;
  const pendingFinance = db.sales.filter(
    (s) => s.isFinance && s.financeDetails?.payoutStatus === "Pending Bank Settlement"
  ).length;

  // Calculate live daily cash estimated in galla
  const todaySales = db.sales.filter((s) => s.date === todayStr() && !s.isFinance && s.payment === "Cash");
  const todaySalesCash = todaySales.reduce((a, s) => a + s.amountPaid, 0);
  const todayXeroxCash = (db.xeroxEntries || [])
    .filter((x) => x.date === todayStr() && x.paymentMethod === "Cash")
    .reduce((a, x) => a + x.totalAmount, 0);
  const todayGallaCash = (db.settings.openingCashDefault || 5000) + todaySalesCash + todayXeroxCash;

  const isCurrentSecondary = SECONDARY_NAV_ITEMS.some((s) => s.key === currentPage);

  return (
    <aside id="sidebar">
      {/* Brand Header */}
      <div className="brand" style={{ cursor: "pointer" }} onClick={() => onNavigate("dashboard")}>
        <div className="logo-badge fx-flip-3d" id="brandLogoBadge">
          {db.settings.logo ? (
            <img src={db.settings.logo} alt="Logo" />
          ) : (
            (db.settings.shopName || "DS").trim().slice(0, 2).toUpperCase()
          )}
        </div>
        <div>
          <div className="name" id="brandNameText">
            {db.settings.shopName || "DS MOBILE"}
          </div>
          <div className="tag" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span>Digital Retail OS</span>
            {easyMode && (
              <span style={{ background: "var(--green)", color: "#fff", padding: "1px 5px", borderRadius: "4px", fontSize: "8.5px" }}>
                
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Quick Camera Barcode & AI Scan Button */}
      <div style={{ padding: "10px 14px 4px 14px" }}>
        <button
          className="btn primary sm"
          style={{
            width: "100%",
            justifyContent: "center",
            background: "var(--accent)",
            padding: "9px",
            fontSize: "12.5px",
            fontWeight: 800,
          }}
          onClick={onOpenQuickScan}
        >
          <Camera size={15} /> 1-Tap Barcode / Box Scan
        </button>
      </div>

      {/* Navigation List */}
      <nav className="nav" id="navList">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px 2px" }}>
          <span className="grp-label" style={{ padding: 0 }}>
            {easyMode ? "⚡ Daily Counter ()" : "📌 Main Tasks"}
          </span>
          <button
            onClick={() => setEasyMode(!easyMode)}
            style={{
              background: easyMode ? "var(--green-light)" : "transparent",
              color: easyMode ? "var(--green)" : "var(--sidebar-text)",
              border: "1px solid",
              borderColor: easyMode ? "var(--green-border)" : "var(--sidebar-border)",
              fontSize: "10px",
              padding: "2px 7px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {easyMode ? "✓ Easy Mode ON" : " "}
          </button>
        </div>

        {/* Primary Counter Navigation — Staff view is restricted to Sales +
            Photo Stock Finder (Step 6.1/6.2 — this is a staff sales tool by
            design: snap a photo of what's in front of them, find it in
            stock, add straight to the bill; it must stay reachable without
            switching to Owner mode). */}
        {(ownerMode ? PRIMARY_NAV_ITEMS : PRIMARY_NAV_ITEMS.filter((i) => i.key === "sell" || i.key === "photoFinder")).map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.key;
          let badgeCount = 0;
          if (item.key === "khata" && dueCount > 0) badgeCount = dueCount;
          if (item.key === "jobs" && openJobs > 0) badgeCount = openJobs;

          return (
            <button
              key={item.key}
              className={`navitem ${isActive ? "active" : ""}`}
              onClick={() => onNavigate(item.key)}
            >
              <span className="ic">
                <Icon size={16} />
              </span>
              <span style={{ fontSize: "13px" }}>{item.label}</span>
              {badgeCount > 0 && <span className="badge-dot">{badgeCount}</span>}
            </button>
          );
        })}

        {/* Secondary / Advanced Section — Owner only */}
        {!easyMode && ownerMode && (
          <div style={{ marginTop: "6px", borderTop: "1px solid var(--sidebar-border)", paddingTop: "6px" }}>
            <button
              onClick={() => setShowAllTools(!showAllTools || isCurrentSecondary)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "rgba(255,255,255,0.03)",
                border: "none",
                color: "var(--sidebar-text)",
                padding: "8px 10px",
                borderRadius: "6px",
                fontSize: "11px",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                cursor: "pointer",
              }}
            >
              <span>More Tools &amp; Reports ({SECONDARY_NAV_ITEMS.length})</span>
              {showAllTools || isCurrentSecondary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {(showAllTools || isCurrentSecondary) && (
              <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "4px" }}>
                {SECONDARY_NAV_GROUPS.map((group) => {
                  const visibleItems = group.itemKeys
                    .map((key) => SECONDARY_NAV_ITEMS.find((n) => n.key === key))
                    .filter((n): n is (typeof SECONDARY_NAV_ITEMS)[number] => !!n && (!n.ownerOnly || ownerMode));

                  if (visibleItems.length === 0) return null;

                  const GroupIcon = group.icon;
                  const isOpen = !!openGroups[group.id] || visibleItems.some((n) => n.key === currentPage);
                  let groupBadgeCount = 0;
                  visibleItems.forEach((item) => {
                    if (item.key === "products") groupBadgeCount += lowStockCount;
                    if (item.key === "simTracker") groupBadgeCount += pendingSimComm;
                    if (item.key === "financeLedger") groupBadgeCount += pendingFinance;
                  });

                  return (
                    <div className="nav-group" key={group.id}>
                      <button
                        type="button"
                        className="nav-group-header"
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={isOpen}
                      >
                        <span className="grp-title">
                          <GroupIcon size={13} />
                          {group.label}
                          <span className="nav-group-count">({visibleItems.length})</span>
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {groupBadgeCount > 0 && <span className="badge-dot">{groupBadgeCount}</span>}
                          {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </span>
                      </button>

                      <div className={`nav-group-body-wrap ${isOpen ? "open" : ""}`}>
                        <div className="nav-group-body">
                          {visibleItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = currentPage === item.key;
                            let badgeCount = 0;
                            if (item.key === "products" && lowStockCount > 0) badgeCount = lowStockCount;
                            if (item.key === "simTracker" && pendingSimComm > 0) badgeCount = pendingSimComm;
                            if (item.key === "financeLedger" && pendingFinance > 0) badgeCount = pendingFinance;

                            return (
                              <button
                                key={item.key}
                                className={`navitem ${isActive ? "active" : ""}`}
                                onClick={() => onNavigate(item.key)}
                                style={{ fontSize: "12px", padding: "7px 10px" }}
                              >
                                <span className="ic">
                                  <Icon size={14} />
                                </span>
                                <span>{item.label}</span>
                                {badgeCount > 0 && <span className="badge-dot">{badgeCount}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Daily Galla Status Meter — Owner only */}
      {ownerMode && (
      <div
        style={{
          padding: "10px 14px",
          background: "var(--sidebar-footer-bg)",
          borderTop: "1px solid var(--sidebar-border)",
          cursor: "pointer",
        }}
        onClick={() => onNavigate("gallaClosing")}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
          <span style={{ fontSize: "10px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--sidebar-text)" }}>
            Daily Galla ()
          </span>
          <span style={{ color: "var(--green)", fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 800 }}>
            {inr(todayGallaCash)}
          </span>
        </div>
        <div style={{ height: "4px", width: "100%", background: "#1e293b", borderRadius: "999px", overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.min(100, Math.max(15, (todayGallaCash / 50000) * 100))}%`,
              height: "100%",
              background: "var(--green)",
              borderRadius: "999px",
            }}
          />
        </div>
      </div>
      )}

      {/* Footer Controls */}
      <div className="mode-box" style={{ padding: "10px 14px" }}>
        {false && (
          <button
            className="btn sm"
            style={{
              width: "100%",
              marginBottom: "8px",
              justifyContent: "center",
              background: "var(--card)",
              color: "var(--ink)",
              border: "1px solid var(--sidebar-border)",
              padding: "6px 8px",
              fontSize: "11px",
              fontWeight: 800,
            }}
            onClick={onOpenWindowsModal}
          >
            <Monitor size={13} style={{ color: "var(--accent)" }} /> 💻 Windows Desktop App
          </button>
        )}

        <button
          type="button"
          id="btnThemeToggle"
          onClick={() => onNavigate("appearanceStudio")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            marginBottom: "6px",
            background: "transparent",
            border: "1px solid var(--sidebar-border)",
            borderRadius: "8px",
            padding: "6px 8px",
            color: "var(--sidebar-text)",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: 700,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Sparkles size={12} /> Theme
          </span>
          <span style={{ opacity: 0.7 }}>Appearance Studio →</span>
        </button>

        <div className="mode-pill">
          <button
            id="btnStaffMode"
            className={!ownerMode ? "on" : ""}
            onClick={() => {
              if (ownerMode) onToggleOwnerMode();
            }}
          >
            Staff ()
          </button>
          <button
            id="btnOwnerMode"
            className={ownerMode ? "on" : ""}
            onClick={() => {
              if (!ownerMode) onToggleOwnerMode();
            }}
          >
            Owner ()
          </button>
        </div>
      </div>
    </aside>
  );
};
