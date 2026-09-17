// Quick Contact Picker helper using the native Contact Picker API
// Supported on Android Chrome, Edge, and PWA environments

export interface PickedContact {
  name?: string;
  phone?: string;
  address?: string;
  email?: string;
}

export function isContactPickerSupported(): boolean {
  return typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in window;
}

export async function pickContactFromPhone(): Promise<PickedContact | null> {
  if (!isContactPickerSupported()) {
    throw new Error("Contact Picker API is not supported on this device/browser");
  }

  try {
    const props = ["name", "tel", "address", "email"];
    const contacts = await (navigator as any).contacts.select(props, { multiple: false });

    if (!contacts || contacts.length === 0) {
      return null;
    }

    const first = contacts[0];
    const rawPhone = Array.isArray(first.tel) ? first.tel[0] : first.tel;
    const cleanPhone = (rawPhone || "")
      .replace(/^\+91[\s-]*/, "")
      .replace(/^91(?=\d{10})/, "")
      .replace(/\D/g, "")
      .slice(-10);

    const rawName = Array.isArray(first.name) ? first.name[0] : first.name;
    const rawEmail = Array.isArray(first.email) ? first.email[0] : first.email;
    const rawAddress = Array.isArray(first.address) ? first.address[0]?.addressLine?.[0] || first.address[0] : first.address;

    return {
      name: rawName || "",
      phone: cleanPhone || rawPhone || "",
      email: rawEmail || "",
      address: typeof rawAddress === "string" ? rawAddress : "",
    };
  } catch (err: any) {
    if (err.name === "AbortError" || err.message?.includes("canceled")) {
      return null;
    }
    throw err;
  }
}
