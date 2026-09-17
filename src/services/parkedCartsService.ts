import { CartItem } from "../types";

export interface ParkedCart {
  id: string;
  timestamp: number;
  customerName?: string;
  customerPhone?: string;
  note?: string;
  items: CartItem[];
  discount: number;
  total: number;
}

const STORAGE_KEY = "ds_parked_carts_v1";

export function getParkedCarts(): ParkedCart[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function parkCart(params: {
  items: CartItem[];
  customerName?: string;
  customerPhone?: string;
  note?: string;
  discount?: number;
}): ParkedCart {
  const carts = getParkedCarts();
  const subtotal = params.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const discount = params.discount || 0;
  const total = Math.max(0, subtotal - discount);

  const newParked: ParkedCart = {
    id: `hold_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    customerName: params.customerName?.trim(),
    customerPhone: params.customerPhone?.trim(),
    note: params.note?.trim(),
    items: params.items,
    discount,
    total,
  };

  const updated = [newParked, ...carts];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn("Failed to persist parked cart", e);
  }
  return newParked;
}

export function deleteParkedCart(id: string): ParkedCart[] {
  const carts = getParkedCarts().filter((c) => c.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(carts));
  } catch {}
  return carts;
}

export function clearAllParkedCarts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
