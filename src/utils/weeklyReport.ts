// Builds the weekly owner report entirely from the app's already-loaded
// Database state — the same numbers the Profit & Loss Dashboard / Owner
// Reports screens show. No separate database query, no assumption about
// normalized table columns — so this can never drift from what the app
// itself displays, and never breaks if the cloud schema changes.
import { Database, Sale, PurchaseRecord, Expense, Product } from "../types";
import { round2 } from "./indianCurrency";
import { saleCost, saleProfit } from "./profitEngine";
import { todayStr } from "./fifoEngine";

export interface WeeklyPaymentBreakdown {
  method: string;
  total: number;
  count: number;
}

export interface WeeklyReportData {
  periodStart: string; // YYYY-MM-DD, inclusive
  periodEnd: string;   // YYYY-MM-DD, inclusive (today)
  generatedAt: string; // ISO timestamp

  // Sales
  invoiceCount: number;
  totalSales: number;
  totalDiscount: number;
  paymentBreakdown: WeeklyPaymentBreakdown[];

  // Profit
  totalCost: number;
  grossProfit: number;

  // Purchases & expenses (this week)
  totalPurchases: number;
  purchaseCount: number;
  totalShopExpenses: number;
  totalPersonalDrawings: number;
  totalOtherExpenses: number;

  // Stock snapshot (current, not date-filtered — "abhi ka stock")
  totalProducts: number;
  totalStockUnits: number;
  stockValuation: number;
  lowStockItems: { name: string; category: string; stock: number; minStock: number }[];

  shopName: string;
}

function last7DaysStart(endDateStr: string): string {
  const end = new Date(`${endDateStr}T00:00:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - 6); // inclusive 7-day window
  return start.toISOString().slice(0, 10);
}

function inRange(dateStr: string | undefined, start: string, end: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= start && d <= end;
}

export function buildWeeklyReport(db: Database): WeeklyReportData {
  const periodEnd = todayStr();
  const periodStart = last7DaysStart(periodEnd);

  const weekSales: Sale[] = (db.sales || []).filter(
    (s) => s.status !== "Cancelled" && inRange(s.date, periodStart, periodEnd)
  );

  const paymentMap = new Map<string, WeeklyPaymentBreakdown>();
  let totalSales = 0;
  let totalDiscount = 0;
  let totalCost = 0;

  for (const s of weekSales) {
    totalSales += s.total || 0;
    totalDiscount += s.discount || 0;
    totalCost += saleCost(s);
    const method = s.payment || "Cash";
    const existing = paymentMap.get(method) || { method, total: 0, count: 0 };
    existing.total += s.total || 0;
    existing.count += 1;
    paymentMap.set(method, existing);
  }

  const grossProfit = round2(
    weekSales.reduce((sum, s) => sum + saleProfit(s), 0)
  );

  const weekPurchases: PurchaseRecord[] = (db.purchases || []).filter((p) =>
    inRange(p.date, periodStart, periodEnd)
  );
  const totalPurchases = round2(weekPurchases.reduce((a, p) => a + (p.total || 0), 0));

  const weekShopExpenses: Expense[] = (db.expenses?.shop || []).filter((e) =>
    inRange(e.date, periodStart, periodEnd)
  );
  const weekPersonal: Expense[] = (db.expenses?.personal || []).filter((e) =>
    inRange(e.date, periodStart, periodEnd)
  );
  const weekOther: Expense[] = (db.expenses?.other || []).filter((e) =>
    inRange(e.date, periodStart, periodEnd)
  );

  const products: Product[] = db.products || [];
  const lowStockItems = products
    .filter((p) => p.stock <= p.minStock)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 40) // keep the PDF a sane length even for a huge catalog
    .map((p) => ({ name: p.name, category: p.category, stock: p.stock, minStock: p.minStock }));

  return {
    periodStart,
    periodEnd,
    generatedAt: new Date().toISOString(),
    invoiceCount: weekSales.length,
    totalSales: round2(totalSales),
    totalDiscount: round2(totalDiscount),
    paymentBreakdown: Array.from(paymentMap.values()).sort((a, b) => b.total - a.total),
    totalCost: round2(totalCost),
    grossProfit,
    totalPurchases,
    purchaseCount: weekPurchases.length,
    totalShopExpenses: round2(weekShopExpenses.reduce((a, e) => a + (e.amount || 0), 0)),
    totalPersonalDrawings: round2(weekPersonal.reduce((a, e) => a + (e.amount || 0), 0)),
    totalOtherExpenses: round2(weekOther.reduce((a, e) => a + (e.amount || 0), 0)),
    totalProducts: products.length,
    totalStockUnits: products.reduce((a, p) => a + (p.stock || 0), 0),
    stockValuation: round2(products.reduce((a, p) => a + (p.purchasePrice || 0) * p.stock, 0)),
    lowStockItems,
    shopName: db.settings?.shopName || "My Shop",
  };
}

// Whether it's been >= 7 days since the last auto-send (or it's never been
// sent). Used to fire the report once/week purely from app usage — see
// App.tsx's startup effect — without needing an always-on server cron.
export function isWeeklyReportDue(db: Database): boolean {
  const last = db.settings?.lastWeeklyReportSentAt;
  if (!last) return true;
  const lastDate = new Date(last).getTime();
  if (Number.isNaN(lastDate)) return true;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - lastDate >= sevenDaysMs;
}
