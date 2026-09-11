import React from "react";
import { LayoutDashboard, ShoppingCart, Package, TrendingUp, Menu } from "lucide-react";

interface BottomTabBarProps {
  currentPage: string;
  /** Same navigate function passed to <Sidebar> — reusing it (rather than a
   * raw setCurrentPage) means the "Reports" tab automatically gets the same
   * owner-passcode gate that every other owner-only page already goes
   * through, with zero duplicated logic. */
  onNavigate: (page: string) => void;
  onOpenMore: () => void;
  /** Staff must never even see a route to an owner-only page — "Reports"
   * (Sales Breakdown & P&L) is owner-only, so it's dropped from the bar
   * entirely for staff rather than relying solely on onNavigate's gate. */
  isStaffIdentity?: boolean;
  /** Phase 6: same per-staff-member section policy as Sidebar's identically-
   * named prop — see its comment for the fallback behaviour when null. Only
   * "Sell"/"Inventory" are filterable here (mapped via each tab's `page`,
   * which matches Sidebar's section `key` naming); "Home" stays a fixed
   * anchor tab regardless of policy, and "Reports" is already hard-gated by
   * ownerOnly above. */
  allowedSections?: string[] | null;
}

// Phase 4.1 — bottom tab bar for Android/narrow-window layouts. Shown only
// under the same ~900px breakpoint the off-canvas sidebar drawer already
// uses (see index.css); desktop/Windows keeps the full sidebar, unaffected.
// 5 tabs per the plan: Home / Sell / Inventory / Reports / More. The first
// 4 map straight onto existing pages; "More" opens the existing Sidebar as
// an off-canvas drawer (it already has every other page in it) instead of
// duplicating that whole list into a second menu.
const TABS: { key: string; page: string; label: string; icon: React.ComponentType<{ size?: number | string }>; ownerOnly?: boolean }[] = [
  { key: "home", page: "dashboard", label: "Home", icon: LayoutDashboard },
  { key: "sell", page: "sell", label: "Sell", icon: ShoppingCart },
  { key: "inventory", page: "products", label: "Inventory", icon: Package },
  { key: "reports", page: "saleshistory", label: "Reports", icon: TrendingUp, ownerOnly: true },
];

export default function BottomTabBar({ currentPage, onNavigate, onOpenMore, isStaffIdentity = false, allowedSections = null }: BottomTabBarProps) {
  const hasPolicy = isStaffIdentity && Array.isArray(allowedSections) && allowedSections.length > 0;
  const visibleTabs = TABS.filter((tab) => {
    if (tab.ownerOnly && isStaffIdentity) return false;
    if (hasPolicy && (tab.page === "sell" || tab.page === "products") && !allowedSections!.includes(tab.page)) return false;
    return true;
  });
  return (
    <nav className="bottom-tab-bar" aria-label="Primary navigation">
      {visibleTabs.map((tab) => {
        const Icon = tab.icon;
        const active = currentPage === tab.page;
        return (
          <button
            key={tab.key}
            type="button"
            className={`bottom-tab-btn${active ? " active" : ""}`}
            onClick={() => onNavigate(tab.page)}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={20} />
            <span>{tab.label}</span>
          </button>
        );
      })}
      <button type="button" className="bottom-tab-btn" onClick={onOpenMore}>
        <Menu size={20} />
        <span>More</span>
      </button>
    </nav>
  );
}
