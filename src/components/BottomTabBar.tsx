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
}

// Phase 4.1 — bottom tab bar for Android/narrow-window layouts. Shown only
// under the same ~900px breakpoint the off-canvas sidebar drawer already
// uses (see index.css); desktop/Windows keeps the full sidebar, unaffected.
// 5 tabs per the plan: Home / Sell / Inventory / Reports / More. The first
// 4 map straight onto existing pages; "More" opens the existing Sidebar as
// an off-canvas drawer (it already has every other page in it) instead of
// duplicating that whole list into a second menu.
const TABS: { key: string; page: string; label: string; icon: React.ComponentType<{ size?: number | string }> }[] = [
  { key: "home", page: "dashboard", label: "Home", icon: LayoutDashboard },
  { key: "sell", page: "sell", label: "Sell", icon: ShoppingCart },
  { key: "inventory", page: "products", label: "Inventory", icon: Package },
  { key: "reports", page: "saleshistory", label: "Reports", icon: TrendingUp },
];

export default function BottomTabBar({ currentPage, onNavigate, onOpenMore }: BottomTabBarProps) {
  return (
    <nav className="bottom-tab-bar" aria-label="Primary navigation">
      {TABS.map((tab) => {
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
