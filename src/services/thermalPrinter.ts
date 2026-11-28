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
      .replace(/[^\x20-\x7E]/g, " ");
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
    if(right.length>=this.width){this.line(left.slice(0,this.width));this.line(right);return this;}
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
  terms?: string[];
  quote?: string;
}

function money(n: number): string {
  return "Rs." + n.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
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
  if (sale.dueAmount > 0.005) r.bold(true).twoCol("BALANCE DUE", money(sale.dueAmount)).bold(false);
  r.rule();

  if (sale.quote) {
    r.align("center");
    wrapText(sale.quote, cols).forEach((ln) => r.line(ln));
    r.rule();
  }

  if (sale.terms && sale.terms.length > 0) {
    r.align("left").bold(true).line("TERMS & CONDITIONS:").bold(false);
    sale.terms.forEach((term, idx) => {
      const clean = term.replace(/^\d+[.)]\s*/, "");
      const wrapped = wrapText(`${idx + 1}. ${clean}`, cols);
      wrapped.forEach((ln) => r.line(ln));
    });
    r.rule();
  }

  r.align("center").line("Thank you for shopping with us!");
  r.feed(4).cut();
  return r.build();
}

function wrapText(s: string, width: number): string[] {
  if (s.length <= width) return [s];
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    let w=word;
    if(w.length>width){if(cur){lines.push(cur.trim());cur="";}while(w.length>width){lines.push(w.slice(0,width));w=w.slice(width);}if(!w)continue;}
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
// so compatible models can be discovered without relying on device names.
const KNOWN_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];

let cachedBleDevice: any = null;
let cachedBleChar: any = null;
let bleBusy = false;

export function isBluetoothPrintSupported(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator as any).bluetooth?.requestDevice === "function";
}

async function findWritableCharacteristic(server: any): Promise<any> {
  // Only known printer services: do not select an arbitrary writable GATT
  // characteristic on another peripheral.
  for (const serviceId of KNOWN_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceId);
      const chars = await service.getCharacteristics();
      const selected = chars.find((ch: any) => ch.properties?.write && (typeof ch.writeValueWithResponse === "function" || typeof ch.writeValue === "function"))
        || chars.find((ch: any) => ch.properties?.writeWithoutResponse && typeof ch.writeValueWithoutResponse === "function");
      if (selected) return selected;
    } catch { /* this device may expose a different known printer service */ }
  }
  return null;
}

async function openBluetoothPrinter(): Promise<{ deviceName: string }> {
  if (!isBluetoothPrintSupported()) throw new Error("Is browser/device mein Bluetooth printing support nahi hai.");
  disconnectBluetoothPrinter();
  const device = await (navigator as any).bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: KNOWN_PRINTER_SERVICES,
  });
  try {
    if (!device.gatt) throw new Error("Printer has no Bluetooth GATT connection");
    const server = await device.gatt.connect();
    const char = await findWritableCharacteristic(server);
    if (!char) throw new Error("No supported writable printer channel found.");
    cachedBleDevice = device;
    cachedBleChar = char;
    device.addEventListener?.("gattserverdisconnected", () => {
      if (cachedBleDevice === device && !device.gatt?.connected) {
        cachedBleDevice = null;
        cachedBleChar = null;
      }
    });
    return { deviceName: device.name || "Printer" };
  } catch (error) {
    try { device.gatt?.disconnect(); } catch {}
    throw error;
  }
}

export async function connectBluetoothPrinter(): Promise<{ deviceName: string }> {
  if (bleBusy) throw new Error("Bluetooth printer is busy. Wait for the current receipt.");
  bleBusy = true;
  try { return await openBluetoothPrinter(); } finally { bleBusy = false; }
}

export function isBluetoothPrinterConnected(): boolean {
  return !!(cachedBleDevice?.gatt?.connected && cachedBleChar);
}

export function disconnectBluetoothPrinter() {
  const device = cachedBleDevice;
  cachedBleDevice = null;
  cachedBleChar = null;
  try { device?.gatt?.disconnect(); } catch { /* best effort */ }
}

/** Never interleave two receipts or retry an uncertain partial print. */
export async function printViaBluetooth(bytes: Uint8Array): Promise<void> {
  if (bleBusy) throw new Error("Bluetooth printer is busy. Wait for the current receipt.");
  bleBusy = true;
  try {
    if (!isBluetoothPrinterConnected()) await openBluetoothPrinter();
    const char = cachedBleChar, device = cachedBleDevice;
    const write = char.properties?.write && typeof char.writeValueWithResponse === "function"
      ? (b: Uint8Array) => char.writeValueWithResponse(b)
      : char.properties?.write && typeof char.writeValue === "function"
        ? (b: Uint8Array) => char.writeValue(b)
        : (b: Uint8Array) => char.writeValueWithoutResponse(b);
    // 20-byte chunks fit the default BLE ATT payload without MTU negotiation.
    for (let i = 0; i < bytes.length; i += 20) {
      if (device !== cachedBleDevice || !device.gatt?.connected) throw new Error("Printer disconnected");
      await write(bytes.slice(i, i + 20));
      await new Promise(res => setTimeout(res, 20));
    }
  } catch {
    disconnectBluetoothPrinter();
    throw new Error("Bluetooth print not confirmed. Check the paper before retrying; the receipt may be partially printed.");
  } finally { bleBusy = false; }
}

// ---------------------------------------------------------------------------
// Transport: Web Serial (USB) — desktop/Windows only (Android Chrome does
// not implement navigator.serial). Covers a USB-connected thermal printer
// that isn't installed as a Windows print driver.
// ---------------------------------------------------------------------------
let cachedSerialPort: any = null;
let serialBusy = false;

export function isSerialPrintSupported(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator as any).serial?.requestPort === "function";
}

export async function printViaSerial(bytes: Uint8Array): Promise<void> {
  if (!isSerialPrintSupported()) throw new Error("Ye browser/OS USB serial printing support nahi karta (sirf Windows desktop par).");
  if (serialBusy) throw new Error("USB printer is busy. Wait for the current receipt.");
  serialBusy = true;
  try {
    if (!cachedSerialPort) {
      const port = await (navigator as any).serial.requestPort();
      try { await port.open({ baudRate: 9600 }); } catch (error) { try { await port.close(); } catch {} throw error; }
      cachedSerialPort = port;
    }
    const port = cachedSerialPort;
    if (!port.writable) throw new Error("USB printer disconnected");
    const writer = port.writable.getWriter();
    try { await writer.write(bytes); } finally { writer.releaseLock(); }
  } catch {
    const port = cachedSerialPort;
    cachedSerialPort = null;
    try { await port?.close(); } catch {}
    throw new Error("USB print not confirmed. Check the paper before retrying; the receipt may be partially printed.");
  } finally { serialBusy = false; }
}

export function disconnectSerialPrinter() {
  if (serialBusy) return; // Do not close a stream while it is locked by a receipt.
  const port = cachedSerialPort;
  cachedSerialPort = null;
  if (port) void Promise.resolve().then(() => port.close()).catch(() => {});
}
