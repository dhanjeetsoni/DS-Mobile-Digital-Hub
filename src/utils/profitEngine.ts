// Shared profit math so every report (Profit & Loss Dashboard, Daily Review,
// Monthly Review, Owner Reports) agrees on exactly one definition of
// "profit" for each revenue stream. Before this file, product-sale profit,
// Xerox/Cyber Cafe income and Repair Job income were each computed slightly
// differently (and Xerox/Job income wasn't cost-aware at all — the whole
// amount was being treated as pure profit). Centralizing it here means a
// fix/tweak in one place is a fix everywhere, and new revenue streams can be
// added the same way in future.
import { Database, Sale, XeroxEntry, RepairJob } from "../types";
import { round2 } from "./indianCurrency";

// ---- Product / POS sales ----
export function saleCost(s: Sale): number {
  return s.items.reduce((sum, i) => sum + (i.cost || (i.purchasePrice || 0) * i.qty || 0), 0);
}
export function saleProfit(s: Sale): number {
  return round2(s.total - saleCost(s));
}

// ---- Cybercafe / Xerox / Digital Hub quick services ----
// costAmount is optional & owner-only. Unset/blank means "cost not tracked
// for this entry" — profit falls back to the full amount, matching legacy
// behaviour for every entry logged before this feature existed.
export function xeroxCost(x: XeroxEntry): number {
  return Number(x.costAmount) || 0;
}
export function xeroxProfit(x: XeroxEntry): number {
  return round2(x.totalAmount - xeroxCost(x));
}

// ---- Repair / Mobile Unlock jobs (incl. FRP bypass, software flash etc) ----
// Total cost = inventory spare parts consumed + any manually entered
// "other cost" (unlock tool/portal fee, outsourced work, etc).
export function jobCost(j: RepairJob): number {
  return (j.partsCostTotal || 0) + (Number(j.otherCost) || 0);
}
export function jobCharge(j: RepairJob): number {
  // What the shop actually billed for this job. finalCharge (set at
  // delivery) overrides the earlier estimate when present.
  return Number(j.finalCharge ?? j.estCost) || 0;
}
export function jobProfit(j: RepairJob): number {
  return round2(jobCharge(j) - jobCost(j));
}

export interface DaySourceTotals {
  date: string;
  productRevenue: number;
  productCost: number;
  productProfit: number;
  xeroxRevenue: number;
  xeroxCost: number;
  xeroxProfit: number;
  jobRevenue: number;
  jobCost: number;
  jobProfit: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
}

// Builds one combined profit row per calendar date across sales, xerox
// entries and repair jobs (jobs are counted on their receivedDate — the day
// the money/ticket actually landed at the counter). Handy for both a single
// day's card (filter to one date) and a trend chart (pass the whole map).
export function combineDailyTotals(
  db: Pick<Database, "sales" | "xeroxEntries" | "jobs">,
  dates: string[]
): DaySourceTotals[] {
  const byDate: { [d: string]: DaySourceTotals } = {};
  const ensure = (d: string): DaySourceTotals => {
    if (!byDate[d]) {
      byDate[d] = {
        date: d,
        productRevenue: 0,
        productCost: 0,
        productProfit: 0,
        xeroxRevenue: 0,
        xeroxCost: 0,
        xeroxProfit: 0,
        jobRevenue: 0,
        jobCost: 0,
        jobProfit: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
      };
    }
    return byDate[d];
  };
  dates.forEach(ensure);
  const dateSet = new Set(dates);

  (db.sales || []).forEach((s) => {
    if (!dateSet.has(s.date)) return;
    const row = ensure(s.date);
    const cost = saleCost(s);
    row.productRevenue += s.total;
    row.productCost += cost;
    row.productProfit = round2(row.productProfit + (s.total - cost));
  });

  (db.xeroxEntries || []).forEach((x) => {
    if (!dateSet.has(x.date)) return;
    const row = ensure(x.date);
    const cost = xeroxCost(x);
    row.xeroxRevenue += x.totalAmount;
    row.xeroxCost += cost;
    row.xeroxProfit = round2(row.xeroxProfit + (x.totalAmount - cost));
  });

  (db.jobs || []).forEach((j) => {
    if (!dateSet.has(j.receivedDate)) return;
    const row = ensure(j.receivedDate);
    const charge = jobCharge(j);
    const cost = jobCost(j);
    row.jobRevenue += charge;
    row.jobCost += cost;
    row.jobProfit = round2(row.jobProfit + (charge - cost));
  });

  return dates.map((d) => {
    const row = ensure(d);
    row.totalRevenue = round2(row.productRevenue + row.xeroxRevenue + row.jobRevenue);
    row.totalCost = round2(row.productCost + row.xeroxCost + row.jobCost);
    row.totalProfit = round2(row.productProfit + row.xeroxProfit + row.jobProfit);
    return row;
  });
}

export function lastNDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(d);
    dt.setDate(d.getDate() - i);
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}
