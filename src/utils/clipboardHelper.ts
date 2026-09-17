// Smart clipboard read & text cleaning utilities
// Built for fast 1-click workflows in retail mobile stores

/**
 * Safely reads plain text from the clipboard.
 * Gracefully handles permission issues, browser restrictions, or iframe environments.
 */
export async function readClipboardText(): Promise<{ text: string; error?: string }> {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      return { text: (text || "").trim() };
    }
  } catch (err: any) {
    // If permission was denied or browser blocked clipboard API
    console.warn("Direct clipboard read blocked:", err);
    return { text: "", error: "Clipboard permission not granted or blocked by browser." };
  }

  return { text: "", error: "Clipboard API not supported on this device." };
}

/**
 * Cleans an IMEI or Serial Number string pasted from WhatsApp, SMS, or supplier forwards.
 * e.g. "IMEI1: 869402058192847 (Slot 1)" -> "869402058192847"
 * e.g. "S/N: r58nb02fgh" -> "R58NB02FGH"
 */
export function cleanImeiOrSerial(raw: string): string {
  if (!raw) return "";
  let clean = raw.trim();

  // Strip common label prefixes like "IMEI:", "IMEI 1:", "IMEI1 -", "S/N:", "SN:", "Serial:"
  clean = clean.replace(/^(imei\s*[12]?|s\/?n|serial\s*(?:no|num)?|model)\s*[:=-]\s*/i, "");

  // If it contains a 15-digit numeric sequence (typical IMEI), extract it
  const imeiMatch = clean.match(/\b\d{15}\b/);
  if (imeiMatch) {
    return imeiMatch[0];
  }

  // If it contains a 14-16 digit sequence
  const longNumMatch = clean.match(/\b\d{14,16}\b/);
  if (longNumMatch) {
    return longNumMatch[0];
  }

  // Remove trailing parenthetical remarks like "(Main)" or "(Slot 1)"
  clean = clean.replace(/\s*\([^)]*\)$/, "");

  // Convert to uppercase and strip invalid non-alphanumeric/hyphen chars
  return clean.toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

/**
 * Extracts a clean 10-digit Indian mobile number from raw WhatsApp / SMS / text snippet.
 * e.g. "Customer: +91 98765-43210 (Rajesh)" -> "9876543210"
 * e.g. "Mob: 09876543210" -> "9876543210"
 */
export function cleanCustomerPhone(raw: string): string {
  if (!raw) return "";
  let text = raw.trim();

  // Search for any 10-digit mobile number starting with 6, 7, 8, or 9
  // (accounting for +91, 91, or 0 prefixes)
  const indianMobileMatch = text.match(/(?:\+?91|0)?\s*([6-9]\d{9})\b/);
  if (indianMobileMatch && indianMobileMatch[1]) {
    return indianMobileMatch[1];
  }

  // Fallback: extract any consecutive 10 digits
  const any10Digits = text.match(/\b\d{10}\b/);
  if (any10Digits) {
    return any10Digits[0];
  }

  // Otherwise strip non-digits and strip leading +91 or 0 if length is 12 or 11
  let digits = text.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits.slice(0, 10);
}

// Alias for cleanCustomerPhone
export const cleanIndianPhoneNumber = cleanCustomerPhone;

/**
 * Cleans phone model name pasted from messages.
 * Strips common prefixes like "Model:", "Phone:", "Device:"
 */
export function cleanModelOrText(raw: string): string {
  if (!raw) return "";
  let clean = raw.trim();
  clean = clean.replace(/^(model|phone|device|item|product)\s*[:=-]\s*/i, "");
  // Replace multiple whitespace/newlines with single space
  clean = clean.replace(/\s+/g, " ").trim();
  return clean;
}

/**
 * Simple async helper to get string directly from clipboard
 */
export async function readFromClipboard(): Promise<string> {
  const res = await readClipboardText();
  if (res.text) return res.text;
  
  // Fallback: If clipboard read fails (e.g. in iframe or permission blocked), prompt user
  if (typeof window !== "undefined" && typeof window.prompt === "function") {
    const input = window.prompt("Paste your text / WhatsApp message here:");
    return (input || "").trim();
  }
  return "";
}

/**
 * Quick Contact Picker API (Supported on Android Chrome, Edge, and PWAs)
 * Allows selecting customer contact directly from device phonebook.
 */
export async function pickContactFromPhone(): Promise<{ name?: string; phone?: string; success: boolean; error?: string }> {
  try {
    if ("contacts" in navigator && "ContactsManager" in window) {
      const props = ["name", "tel"];
      const opts = { multiple: false };
      const contacts = await (navigator as any).contacts.select(props, opts);
      if (contacts && contacts.length > 0) {
        const contact = contacts[0];
        const name = Array.isArray(contact.name) ? contact.name[0] : contact.name || "";
        const tel = Array.isArray(contact.tel) ? contact.tel[0] : contact.tel || "";
        return {
          name: name ? name.trim() : "",
          phone: cleanCustomerPhone(tel),
          success: true,
        };
      }
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Contact selection cancelled" };
  }

  return { success: false, error: "Contact picker not available on this browser/OS." };
}

export function isContactPickerSupported(): boolean {
  return typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in window;
}
