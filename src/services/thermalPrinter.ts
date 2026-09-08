// Phase 4 — Bluetooth/USB thermal printer support.
//
// WHY THIS EXISTS: the app already had a browser `window.print()` "thermal"
// CSS layout (58mm/80mm styled receipt) — that works fine on Windows when
// the Bluetooth/USB printer is paired as a normal OS printer with a driver.
// It does NOT work on Android: a WebView's window.print() needs a
// registered Android Print Service, and the cheap Bluetooth 58mm thermal
// printers actually used at mobile-shop counters almost never ship one.
// This module bypasses the OS print pipeline entirely and talks straight to
// the printer over Bluetooth Low Energy (Web Bluetooth) or USB serial (Web
// Serial, desktop-only) using the ESC/POS command set every one of these
// printers understands, regardless of whether Android has a driver for it.
//
// Kept deliberately dependency-free (no ESC/POS npm library) — the command
// set actually used here is small and stable, and pulling in a library adds
// weight for something this contained.

export type PaperWidth = "58mm" | "80mm";

// Default font is ~12 dots/mm on virtually every cheap ESC/POS thermal
// printer at normal (non-condensed) size — this is the same assumption the
// existing thermal CSS print layout already makes for character count.
const CHARS_PER_LINE: Record<PaperWidth, number> = { "58mm": 32, "80mm": 48 };

// ---------------------------------------------------------------------------
// ESC/POS byte building
// ---------------------------------------------------------------------------
const ESC = 0x1b;
const GS = 0x1d;

class ReceiptBuilder {
  private chunks: number[][] = [];
  constructor(private width: number) {
    this.chunks.push([ESC, 0x40]); // ESC @ — initialize
  }

  private push(bytes: number[]) {
    this.chunks.push(bytes);
  }

  private text(s: string) {
    // Cheap thermal printers are almost universally single-byte codepages
    // (no real UTF-8/₹ support) — transliterate the couple of symbols this
    // app's receipts actually use, and strip anything else non-ASCII rather
    // than risk it printing as garbage/mojibake.
    const ascii = s
      .replace(/₹/g, "Rs.")
      .replace(/•/g, "-")
      .replace(/✔/g, "")
      .replace(/◐/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x00-\x7E]/g, "");
    this.chunks.push(Array.from(new TextEncoder().encode(ascii)));
  }

  align(a: "left" | "center" | "right") {
    this.push([ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2]);
    return this;
  }

  bold(on: boolean) {
    this.push([ESC, 0x45, on ? 1 : 0]);
    return this;
  }

  doubleSize(on: boolean) {
    this.push([GS, 0x21, on ? 0x11 : 0x00]); // width x2, height x2
    return this;
  }

  line(s = "") {
    this.text(s);
    this.push([0x0a]);
    return this;
  }

  rule(char = "-") {
    this.line(char.repeat(this.width));
    return this;
  }

  /** Left-aligned label, right-aligned value, on one line, padded/truncated to the paper width. */
  twoCol(left: string, right: string) {
    const room = Math.max(1, this.width - right.length);
    const l = left.length > room ? left.slice(0, Math.max(0, room - 1)) + "." : left.padEnd(room, " ");
    this.line(l + right);
    return this;
  }

  feed(lines = 3) {
    this.push(Array(lines).fill(0x0a));
    return this;
  }

  cut() {
    this.push([GS, 0x56, 0x00]); // full cut
    return this;
  }

  build(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

export interface ReceiptShop {
  shopName?: string;
  address?: string;
  phone?: string;
  gstin?: string;
}

export interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
  isGift?: boolean;
}

export interface ReceiptSale {
  invoiceNo: string;
  date: string;
  time: string;
  payment: string;
  customerName?: string;
  customerPhone?: string;
  items: ReceiptItem[];
  subtotal: number;
  discount?: number;
  taxAmount?: number;
  total: number;
  amountPaid: number;
  dueAmount: number;
}

function money(n: number): string {
  return "Rs." + Math.round(n).toLocaleString("en-IN");
}

/** Builds the full ESC/POS byte stream for one sale's receipt — mirrors the fields the existing "thermal" print CSS layout already shows. */
export function buildEscPosReceipt(shop: ReceiptShop, sale: ReceiptSale, width: PaperWidth = "58mm"): Uint8Array {
  const cols = CHARS_PER_LINE[width];
  const r = new ReceiptBuilder(cols);

  r.align("center").doubleSize(true).bold(true).line(shop.shopName || "Shop").doubleSize(false).bold(false);
  if (shop.address) r.line(shop.address);
  if (shop.phone) r.line(`Ph: ${shop.phone}`);
  if (shop.gstin) r.line(`GSTIN: ${shop.gstin}`);
  r.rule();

  r.align("left");
  r.line(`Invoice: ${sale.invoiceNo}`);
  r.line(`${sale.date}  ${sale.time}`);
  r.line(`Payment: ${sale.payment}`);
  if (sale.customerName) r.line(`Customer: ${sale.customerName}`);
  if (sale.customerPhone) r.line(`Mobile: ${sale.customerPhone}`);
  r.rule();

  for (const item of sale.items) {
    const nameLines = wrapText(item.name, cols);
    nameLines.forEach((ln, i) => r.line(i === 0 ? ln : "  " + ln));
    const lineTotal = item.isGift ? "FREE" : money(item.price * item.qty);
    r.twoCol(`  ${item.qty} x ${item.isGift ? "FREE" : money(item.price)}`, lineTotal);
  }
  r.rule();

  r.twoCol("Subtotal", money(sale.subtotal));
  if (sale.discount) r.twoCol("Discount", "-" + money(sale.discount));
  if (sale.taxAmount) r.twoCol("GST", money(sale.taxAmount));
  r.bold(true).twoCol("GRAND TOTAL", money(sale.total)).bold(false);
  r.twoCol("Received", money(sale.amountPaid));
  if (sale.dueAmount > 0.5) r.bold(true).twoCol("BALANCE DUE", money(sale.dueAmount)).bold(false);
  r.rule();

  r.align("center").line("Thank you for shopping with us!");
  r.feed(4).cut();
  return r.build();
}

function wrapText(s: string, width: number): string[] {
  if (s.length <= width) return [s];
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines;
}

// ---------------------------------------------------------------------------
// Transport: Web Bluetooth (BLE) — the realistic path on Android, where the
// cheap counter thermal printers almost never have an OS print driver.
// ---------------------------------------------------------------------------

// Common write-service/characteristic UUIDs seen across generic "58mm BLE
// thermal printer" modules sold in India (mostly UART-bridge chips wearing
// a printer's plastic shell). Listed as optionalServices so the browser's
// GATT connection can see them; NOT relied on exclusively — after
// connecting we scan every advertised service for a writable characteristic
// so an unlisted model still has a real chance of working.
const KNOWN_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];

let cachedBleDevice: any = null;
let cachedBleChar: any = null;

export function isBluetoothPrintSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

async function findWritableCharacteristic(server: any): Promise<any> {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const chars = await service.getCharacteristics();
    for (const ch of chars) {
      if (ch.properties?.write || ch.properties?.writeWithoutResponse) return ch;
    }
  }
  return null;
}

/** Opens the browser's Bluetooth device picker, connects, and locates a writable characteristic. Must be called from a real user click/tap (browser requirement) — caches the result so a second print in the same session can skip the picker. */
export async function connectBluetoothPrinter(): Promise<{ deviceName: string }> {
  if (!isBluetoothPrintSupported()) throw new Error("Is browser/device mein Bluetooth printing support nahi hai.");
  const device = await (navigator as any).bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: KNOWN_PRINTER_SERVICES,
  });
  const server = await device.gatt.connect();
  const char = await findWritableCharacteristic(server);
  if (!char) throw new Error("Printer se connect toh hua, lekin koi writable channel nahi mila. Ye printer shayad supported nahi hai.");
  cachedBleDevice = device;
  cachedBleChar = char;
  return { deviceName: device.name || "Printer" };
}

export function isBluetoothPrinterConnected(): boolean {
  return !!(cachedBleDevice?.gatt?.connected && cachedBleChar);
}

export function disconnectBluetoothPrinter() {
  try { cachedBleDevice?.gatt?.disconnect(); } catch { /* best-effort */ }
  cachedBleDevice = null;
  cachedBleChar = null;
}

/** Sends the receipt bytes to the already-connected BLE printer, chunked — flooding a BLE write queue drops bytes on most of these modules. */
export async function printViaBluetooth(bytes: Uint8Array): Promise<void> {
  if (!cachedBleChar || !cachedBleDevice?.gatt?.connected) {
    await connectBluetoothPrinter();
  }
  const CHUNK = 100;
  const write = cachedBleChar.properties?.writeWithoutResponse
    ? (b: Uint8Array) => cachedBleChar.writeValueWithoutResponse(b)
    : (b: Uint8Array) => cachedBleChar.writeValue(b);
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await write(bytes.slice(i, i + CHUNK));
    await new Promise((res) => setTimeout(res, 20));
  }
}

// ---------------------------------------------------------------------------
// Transport: Web Serial (USB) — desktop/Windows only (Android Chrome does
// not implement navigator.serial). Covers a USB-connected thermal printer
// that isn't installed as a Windows print driver.
// ---------------------------------------------------------------------------
let cachedSerialPort: any = null;

export function isSerialPrintSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export async function printViaSerial(bytes: Uint8Array): Promise<void> {
  if (!isSerialPrintSupported()) throw new Error("Ye browser/OS USB serial printing support nahi karta (sirf Windows desktop par).");
  if (!cachedSerialPort) {
    cachedSerialPort = await (navigator as any).serial.requestPort();
    await cachedSerialPort.open({ baudRate: 9600 });
  }
  const writer = cachedSerialPort.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

export function disconnectSerialPrinter() {
  try { cachedSerialPort?.close(); } catch { /* best-effort */ }
  cachedSerialPort = null;
}
