// Customer Intelligence, VIP Tier Badges, and Device/Repair History Aggregation

import { Customer, Sale, Database, RepairJob, IMEIUnit } from "../types";

export type CustomerTierType = "gold" | "silver" | "regular" | "new";

export interface CustomerTierInfo {
  tier: CustomerTierType;
  badgeLabel: string;
  badgeEmoji: string;
  badgeColor: string;
  badgeBg: string;
  badgeBorder: string;
  totalSpent: number;
  visitCount: number;
  avgOrderValue: number;
  discountEligiblePercent: number; // e.g. 5% for Gold VIP, 2% for Silver
  suggestedDiscountAmt: number;
  dueAmount: number;
}

export function getCustomerTier(
  customer?: { name?: string; phone?: string; totalDue?: number } | null,
  sales: Sale[] = []
): CustomerTierInfo {
  if (!customer || !customer.phone) {
    return {
      tier: "new",
      badgeLabel: "New Customer",
      badgeEmoji: "👤",
      badgeColor: "#4b5563",
      badgeBg: "#f3f4f6",
      badgeBorder: "#e5e7eb",
      totalSpent: 0,
      visitCount: 0,
      avgOrderValue: 0,
      discountEligiblePercent: 0,
      suggestedDiscountAmt: 0,
      dueAmount: customer?.totalDue || 0,
    };
  }

  const cleanPhone = customer.phone.trim();
  const customerSales = sales.filter(
    (s) => s.customer?.phone?.trim() === cleanPhone
  );

  const totalSpent = customerSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const visitCount = customerSales.length;
  const avgOrderValue = visitCount > 0 ? Math.round(totalSpent / visitCount) : 0;
  const dueAmount = customer.totalDue || 0;

  if (totalSpent >= 20000 || visitCount >= 5) {
    return {
      tier: "gold",
      badgeLabel: "GOLD VIP",
      badgeEmoji: "🌟",
      badgeColor: "#92400e",
      badgeBg: "linear-gradient(135deg, #fef3c7, #fde68a)",
      badgeBorder: "#f59e0b",
      totalSpent,
      visitCount,
      avgOrderValue,
      discountEligiblePercent: 5,
      suggestedDiscountAmt: 0,
      dueAmount,
    };
  }

  if (totalSpent >= 5000 || visitCount >= 2) {
    return {
      tier: "silver",
      badgeLabel: "SILVER REGULAR",
      badgeEmoji: "🥈",
      badgeColor: "#1e3a8a",
      badgeBg: "linear-gradient(135deg, #e0e7ff, #c7d2fe)",
      badgeBorder: "#6366f1",
      totalSpent,
      visitCount,
      avgOrderValue,
      discountEligiblePercent: 2,
      suggestedDiscountAmt: 0,
      dueAmount,
    };
  }

  return {
    tier: "regular",
    badgeLabel: "REGULAR",
    badgeEmoji: "🥉",
    badgeColor: "#374151",
    badgeBg: "#f3f4f6",
    badgeBorder: "#d1d5db",
    totalSpent,
    visitCount,
    avgOrderValue,
    discountEligiblePercent: 0,
    suggestedDiscountAmt: 0,
    dueAmount,
  };
}

export interface CustomerDeviceRecord {
  deviceName: string;
  brand?: string;
  imei1?: string;
  imei2?: string;
  serialNo?: string;
  purchaseDate: string;
  invoiceNo: string;
  price: number;
  warrantyEnd?: string;
  isSecondHand?: boolean;
}

/**
 * Aggregates all mobile phones and devices bought by a customer across all sales invoices & IMEI records.
 */
export function getCustomerPurchasedDevices(
  customerPhone: string,
  db: Database
): CustomerDeviceRecord[] {
  if (!customerPhone) return [];
  const cleanPhone = customerPhone.trim();
  const devices: CustomerDeviceRecord[] = [];

  const customerSales = (db.sales || []).filter(
    (s) => s.customer?.phone?.trim() === cleanPhone
  );

  customerSales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      const isPhone =
        item.category?.includes("Mobile") ||
        (item.selectedImeis && item.selectedImeis.length > 0) ||
        (item.warrantyMonths && item.warrantyMonths >= 6);

      if (isPhone) {
        // Try to match with registered IMEI units
        const imeis = item.selectedImeis || [];
        if (imeis.length > 0) {
          imeis.forEach((im) => {
            const unit = (db.imeiRegistry || []).find((u) => u.imei1 === im || u.imei2 === im);
            const prod = unit ? (db.products || []).find((p) => p.id === unit.productId) : null;
            devices.push({
              deviceName: prod?.name || item.name,
              brand: prod?.brand,
              imei1: im,
              imei2: unit?.imei2,
              serialNo: unit?.serialNo,
              purchaseDate: sale.date,
              invoiceNo: sale.invoiceNo,
              price: item.price,
              warrantyEnd: item.warrantyEnd || undefined,
              isSecondHand: unit?.isSecondHand,
            });
          });
        } else {
          devices.push({
            deviceName: item.name,
            purchaseDate: sale.date,
            invoiceNo: sale.invoiceNo,
            price: item.price,
            warrantyEnd: item.warrantyEnd || undefined,
          });
        }
      }
    });
  });

  return devices;
}

/**
 * Aggregates all repair jobs & service tickets for a given customer phone number.
 */
export function getCustomerRepairHistory(
  customerPhone: string,
  db: Database
): RepairJob[] {
  if (!customerPhone) return [];
  const cleanPhone = customerPhone.trim();
  return (db.jobs || []).filter(
    (job) => (job.phone || "").trim() === cleanPhone
  );
}
