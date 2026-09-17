/**
 * DS Mobile & Digital Hub Pro — Invoice Rules & Quotes Engine (Phase 10)
 * 
 * Implements product- and category-specific invoice terms, conditions, and feel-good
 * customer quotes. Invoices render ONLY the rules and quotes relevant to what was
 * actually sold on that invoice — eliminating generic boilerplate and providing
 * clear, professional, legally protective clauses for Indian mobile & cyber retail.
 */

import { Database, Sale, SaleItem, CartItem, Product } from "../types";

export interface CategoryRuleDefinition {
  id: string;
  categoryName: string;
  badge: string;
  icon: string;
  priority: number; // Higher priority wins for quote selection when multiple categories sold
  terms: string[];
  quote: string;
}

export const DEFAULT_CATEGORY_INVOICE_RULES: Record<string, CategoryRuleDefinition> = {
  tempered_glass: {
    id: "tempered_glass",
    categoryName: "Tempered Glass & Screen Guards",
    badge: "Screen Protection Policy",
    icon: "🛡️",
    priority: 30,
    terms: [
      "Tempered Glass / Screen Guards are sold and fitted strictly on an 'as-applied' basis.",
      "NO warranty, exchange or guarantee against breakage, cracks, bubbles or scratches once fitted and inspected at counter.",
      "UV / Curved Glass: Store is not liable for pre-existing display hairline scratches or blocked speaker meshes.",
    ],
    quote: "Crystal clear protection! Keep your screen looking brand new every day. 📱🛡️",
  },
  new_mobile: {
    id: "new_mobile",
    categoryName: "Mobile Phones (Brand New)",
    badge: "Brand Warranty & DOA Policy",
    icon: "📱",
    priority: 100,
    terms: [
      "1-Year handset and 6-months in-box accessories warranty honoured exclusively via respective Brand Authorized Service Centers.",
      "Physical impact, display/glass cracks, water/liquid ingress, or unauthorized opening void warranty entirely.",
      "In event of Dead On Arrival (DOA) within 7 days, exchange/service requires official Brand Authorized Service Center DOA Certificate.",
      "Please preserve original box, packing, IMEI stickers and this invoice for warranty verification.",
    ],
    quote: "Congratulations on your new smartphone! Wishing you great connectivity, joy, and success. 🌟📱",
  },
  second_hand_mobile: {
    id: "second_hand_mobile",
    categoryName: "Second-Hand / Certified Pre-Owned Phones",
    badge: "Store Testing Warranty & KYC Policy",
    icon: "♻️",
    priority: 95,
    terms: [
      "Store testing warranty of 30 days covers internal motherboard & hardware functions only.",
      "Excludes battery wear, screen lines, touch failure, physical drop impact, or water/liquid damage.",
      "Eligible return/exchange within 7 days is subject to ₹500 inspection & restocking charge.",
      "Device IMEI and legal KYC record verified. All returns require matched IMEI and original purchase invoice.",
    ],
    quote: "Smart value, verified quality! Thank you for choosing a certified pre-owned smartphone. ♻️✨",
  },
  chargers_power: {
    id: "chargers_power",
    categoryName: "Chargers & Power Adapters",
    badge: "Charger & Power Policy",
    icon: "⚡",
    priority: 50,
    terms: [
      "Power adapters and chargers are tested live at counter before handover.",
      "7-Day replacement guarantee applies strictly to manufacturer defects; original box required.",
      "Burnout from high voltage, broken pins, damaged cords, or physical tampering void replacement.",
    ],
    quote: "Power up without limits! Thank you for choosing genuine charging accessories. ⚡🔌",
  },
  cables_connectors: {
    id: "cables_connectors",
    categoryName: "Cables, OTG & Data Cords",
    badge: "Cable Testing Policy",
    icon: "🔌",
    priority: 40,
    terms: [
      "Data cables and OTG connectors are tested for fast-charging and data transfer before delivery.",
      "Replacement within 7 days valid only for internal wire fault with undamaged outer jacket and pins.",
      "Cables with cuts, excessive bends, pulled connectors, or burn marks will not be replaced.",
    ],
    quote: "High-speed connections guaranteed! Handle cords gently for lasting performance. 🔗✨",
  },
  audio_sound: {
    id: "audio_sound",
    categoryName: "Audio (TWS, Neckbands, Earphones, Speakers)",
    badge: "Audio Warranty & Hygiene Policy",
    icon: "🎧",
    priority: 60,
    terms: [
      "Sound quality, mic and charging case functionality tested with customer at counter.",
      "Brand warranty (if applicable) is honoured through brand service channels as per brand policy.",
      "In-ear silicone tips and unsealed earbuds are non-returnable due to hygiene regulations.",
    ],
    quote: "Immerse in pure sound and great beats! Enjoy every call and tune. 🎧🎶",
  },
  covers_cases: {
    id: "covers_cases",
    categoryName: "Back Covers, Cases & Pouches",
    badge: "Cover Fitting & Exchange Policy",
    icon: "✨",
    priority: 35,
    terms: [
      "Please verify cover fitting, camera cutout, and button alignment before leaving store.",
      "Exchange permitted within 24 hours only if completely unused, unscratched, and in original pack.",
      "Normal yellowing/discoloration of clear TPU cases due to UV/sweat is natural and not covered.",
    ],
    quote: "Style meets solid protection! Keep your phone looking fresh and stylish. 🛡️✨",
  },
  smartwatches: {
    id: "smartwatches",
    categoryName: "Smartwatches & Wearables",
    badge: "Smartwatch Warranty Policy",
    icon: "⌚",
    priority: 70,
    terms: [
      "Brand warranty (6 months / 1 year) serviced via brand service center with invoice.",
      "Water resistance (IP67/IP68/5ATM) does not cover hot showers, sauna, swimming, or chemical exposure.",
      "Health sensor metrics (heart rate/SpO2) are for reference only and not for medical diagnosis.",
    ],
    quote: "Stay active, stay connected! Track your fitness and notifications in style. ⌚🏃‍♂️",
  },
  repair_services: {
    id: "repair_services",
    categoryName: "Mobile Repair & Spare Parts",
    badge: "Repair Service Guarantee",
    icon: "🔧",
    priority: 90,
    terms: [
      "30-Day service warranty applies strictly to the specific replaced component or IC work performed.",
      "No warranty on display screen lines, blank out, internal cracks, or liquid damage after delivery.",
      "Customer must inspect touch, camera, mic and call functions before taking device delivery.",
    ],
    quote: "Restored with precision! Handled with professional technician care and testing. 🔧⚙️",
  },
  sim_telecom: {
    id: "sim_telecom",
    categoryName: "SIM Activations & Recharges",
    badge: "Telecom & KYC Compliance",
    icon: "📶",
    priority: 25,
    terms: [
      "SIM activations processed as per Telecom Regulatory guidelines against valid Aadhaar KYC.",
      "Recharges and bill payments once processed to the specified mobile number cannot be refunded.",
      "Telecommunication network coverage and speed depend on the respective service provider.",
    ],
    quote: "Seamless connectivity! Thank you for trusting us with your telecom and recharge needs. 📶💬",
  },
  cyber_xerox: {
    id: "cyber_xerox",
    categoryName: "Xerox, Print, Lamination & Cyber Hub",
    badge: "Documentation & Digital Service Policy",
    icon: "🖨️",
    priority: 20,
    terms: [
      "Customer must inspect print quantity, document clarity, and spellings before counter departure.",
      "Store is not responsible for external government portal downtime or server transmission delays.",
      "Original documents handled with utmost care; customer requested to take back all originals.",
    ],
    quote: "Digital tasks made simple and fast! Thank you for using our cyber and print services. 🖨️📄",
  },
  general_store: {
    id: "general_store",
    categoryName: "General Store Policy",
    badge: "Store Purchase Conditions",
    icon: "🏪",
    priority: 10,
    terms: [
      "Goods once sold are exchanged only as per store policy and strictly against this original invoice.",
      "Please preserve this invoice safely — mandatory for all warranty claims, returns, or technical support.",
      "All disputes are subject to local shop jurisdiction. E. & O. E.",
    ],
    quote: "Thank you for shopping local with us! Your trust is our greatest motivation. 🤝✨",
  },
};

/**
 * Normalizes an item's category/name into one of the canonical rule keys.
 */
export function normalizeCategoryKey(
  categoryOrName: string,
  options?: { isMobilePhone?: boolean; isSecondHand?: boolean; isSparePart?: boolean }
): string {
  if (options?.isSecondHand) return "second_hand_mobile";
  if (options?.isSparePart) return "repair_services";

  const text = (categoryOrName || "").toLowerCase().trim();

  // Second hand detection
  if (/\b(second\s*hand|2nd\s*hand|used\s*phone|refurbished|pre-?owned|old\s*phone)\b/i.test(text)) {
    return "second_hand_mobile";
  }

  // Tempered / Curved Glass
  if (/\b(glass|tempered|screen guard|screen protector|curved glass|uv glass|d\+|super x|anti-?static)\b/i.test(text)) {
    return "tempered_glass";
  }

  // Mobile Phones
  if (
    options?.isMobilePhone ||
    /\b(smartphone|mobile phone|android phone|iphone|galaxy|realme phone|redmi phone|vivo phone|oppo phone)\b/i.test(text) ||
    /^(apple|samsung|xiaomi|redmi|realme|vivo|oppo|oneplus|motorola|iqoo|poco|nokia|infinix|tecno)\s+(iphone|\w+\s*\d+)/i.test(text)
  ) {
    return "new_mobile";
  }

  // Chargers
  if (/\b(charger|adapter|adaptor|power\s*bank|dock|pd\s*20w|gan\s*charger|fast\s*charger)\b/i.test(text)) {
    return "chargers_power";
  }

  // Cables
  if (/\b(cable|wire|cord|type-?c|lightning|micro-?usb|otg|data\s*cable)\b/i.test(text)) {
    return "cables_connectors";
  }

  // Audio
  if (/\b(earphone|earbud|airpod|headphone|tws|neckband|bluetooth\s*speaker|handsfree|audio|soundbar)\b/i.test(text)) {
    return "audio_sound";
  }

  // Covers / Cases
  if (/\b(cover|case|pouch|flip\s*cover|back\s*cover|skin|bumper)\b/i.test(text)) {
    return "covers_cases";
  }

  // Smartwatches
  if (/\b(watch|smartwatch|fitbit|fitness\s*band|wearable)\b/i.test(text)) {
    return "smartwatches";
  }

  // Repairs / Spares
  if (/\b(repair|spare|folder|display\s*combo|touch\s*screen|battery\s*replacement|charging\s*jack|ic\s*repair|camera\s*glass)\b/i.test(text)) {
    return "repair_services";
  }

  // SIM / Telecom
  if (/\b(sim|activation|recharge|top-?up|jio|airtel|vi\s*telecom|bsnl)\b/i.test(text)) {
    return "sim_telecom";
  }

  // Cyber / Xerox
  if (/\b(xerox|photocopy|print|lamination|cyber|online\s*form|pan\s*card|passport\s*photo|aadhaar)\b/i.test(text)) {
    return "cyber_xerox";
  }

  return "general_store";
}

export interface GroupedInvoiceRules {
  categoryKey: string;
  categoryName: string;
  badge: string;
  icon: string;
  rules: string[];
}

export interface ResolvedInvoiceRulesResult {
  groupedRules: GroupedInvoiceRules[];
  flatTerms: string[];
  matchedCategories: string[];
  feelGoodQuote: string;
  feelGoodCategory: string;
}

/**
 * Resolves the precise, relevant terms & conditions and feel-good quote for an invoice.
 * ONLY includes terms applicable to the products/services actually sold on this bill!
 */
export function resolveInvoiceRules(
  sale: Sale | { items?: (SaleItem | CartItem)[]; invoiceNo?: string; isFinance?: boolean },
  db: Database
): ResolvedInvoiceRulesResult {
  const items = sale.items || [];
  const customRulesFromSettings = db.settings?.categoryInvoiceRules || {};

  // Track product-specific terms and matched category keys
  const productCustomTerms: string[] = [];
  const matchedCatKeys = new Set<string>();
  const customQuotes: { quote: string; priority: number }[] = [];

  // Inspect each item in the sale
  for (const item of items) {
    // Check if the item has explicit product-level custom terms
    if (item.customTerms && Array.isArray(item.customTerms) && item.customTerms.length > 0) {
      item.customTerms.forEach((t) => {
        if (t && typeof t === "string" && t.trim()) {
          productCustomTerms.push(t.trim());
        }
      });
    }

    if (item.customQuote && typeof item.customQuote === "string" && item.customQuote.trim()) {
      customQuotes.push({ quote: item.customQuote.trim(), priority: 200 });
    }

    // Try finding product in catalog to check its customTerms if not captured on snapshot
    if (item.productId && db.products) {
      const prod = db.products.find((p) => p.id === item.productId || p.sku === (item as any).sku);
      if (prod) {
        if (prod.customTerms && Array.isArray(prod.customTerms)) {
          prod.customTerms.forEach((t) => {
            if (t && typeof t === "string" && t.trim() && !productCustomTerms.includes(t.trim())) {
              productCustomTerms.push(t.trim());
            }
          });
        }
        if (prod.customQuote && !customQuotes.some((q) => q.quote === prod.customQuote)) {
          customQuotes.push({ quote: prod.customQuote.trim(), priority: 150 });
        }
      }
    }

    // Classify category
    const isMobile = (item as any).isMobilePhone;
    const isSecondHand =
      /\b(second\s*hand|2nd\s*hand|used|refurbished)\b/i.test(item.name || "") ||
      /\b(second\s*hand|2nd\s*hand)\b/i.test(item.category || "");
    const isSpare = (item as any).isSparePart;

    const catKey = normalizeCategoryKey(item.category || item.name || "", {
      isMobilePhone: isMobile,
      isSecondHand,
      isSparePart: isSpare,
    });

    matchedCatKeys.add(catKey);
  }

  // If sale was mobile finance, add finance clause
  if (sale.isFinance) {
    productCustomTerms.push(
      "Mobile Finance Sale: Device EMI financed through lending partner. Timely installment payment is mandatory to maintain device active status."
    );
  }

  // If no items or unrecognized, fallback to general store
  if (matchedCatKeys.size === 0) {
    matchedCatKeys.add("general_store");
  }

  // Build grouped rules
  const groupedRules: GroupedInvoiceRules[] = [];
  const allTermsSeen = new Set<string>();

  // If there are product-specific custom terms, add them first
  if (productCustomTerms.length > 0) {
    const uniqueCustom = productCustomTerms.filter((t) => {
      if (allTermsSeen.has(t)) return false;
      allTermsSeen.add(t);
      return true;
    });
    if (uniqueCustom.length > 0) {
      groupedRules.push({
        categoryKey: "custom_product",
        categoryName: "Product-Specific Warranty & Rules",
        badge: "Special Product Terms",
        icon: "⭐",
        rules: uniqueCustom,
      });
    }
  }

  // Add rules for each matched category
  const sortedCatKeys = Array.from(matchedCatKeys).sort((a, b) => {
    const pA = DEFAULT_CATEGORY_INVOICE_RULES[a]?.priority || 0;
    const pB = DEFAULT_CATEGORY_INVOICE_RULES[b]?.priority || 0;
    return pB - pA; // Highest priority first
  });

  for (const catKey of sortedCatKeys) {
    // Skip general_store if we already have specific product categories
    if (catKey === "general_store" && matchedCatKeys.size > 1) {
      continue;
    }

    const defaultDef = DEFAULT_CATEGORY_INVOICE_RULES[catKey] || DEFAULT_CATEGORY_INVOICE_RULES.general_store;
    const customConfig = customRulesFromSettings[catKey];

    const categoryTerms = customConfig?.terms && customConfig.terms.length > 0
      ? customConfig.terms
      : defaultDef.terms;

    const filteredTerms = categoryTerms.filter((term) => {
      const clean = term.trim();
      if (!clean || allTermsSeen.has(clean)) return false;
      allTermsSeen.add(clean);
      return true;
    });

    if (filteredTerms.length > 0) {
      groupedRules.push({
        categoryKey: catKey,
        categoryName: defaultDef.categoryName,
        badge: defaultDef.badge,
        icon: defaultDef.icon,
        rules: filteredTerms,
      });
    }
  }

  // Always append the standard general invoice safe-guard rule if not already present
  const generalRule = "Goods once sold are exchanged only as per store policy strictly against this original invoice.";
  if (!allTermsSeen.has(generalRule)) {
    allTermsSeen.add(generalRule);
    // Find general group or append
    let genGroup = groupedRules.find((g) => g.categoryKey === "general_store");
    if (!genGroup) {
      genGroup = {
        categoryKey: "general_store",
        categoryName: "Store Policy",
        badge: "General Terms",
        icon: "🏪",
        rules: [],
      };
      groupedRules.push(genGroup);
    }
    genGroup.rules.push(generalRule);
  }

  // Build flat terms list (numbered strings)
  const flatTerms: string[] = [];
  let termIndex = 1;
  for (const group of groupedRules) {
    for (const rule of group.rules) {
      flatTerms.push(`${termIndex}. ${group.badge ? `[${group.badge}] ` : ""}${rule}`);
      termIndex++;
    }
  }

  // Resolve Feel-Good Quote
  let feelGoodQuote = "";
  let feelGoodCategory = "";

  if (customQuotes.length > 0) {
    // Highest priority custom quote
    customQuotes.sort((a, b) => b.priority - a.priority);
    feelGoodQuote = customQuotes[0].quote;
    feelGoodCategory = "custom";
  } else {
    // Pick the quote from the highest-priority category matched
    const topCatKey = sortedCatKeys[0] || "general_store";
    const customConfig = customRulesFromSettings[topCatKey];
    const defaultDef = DEFAULT_CATEGORY_INVOICE_RULES[topCatKey] || DEFAULT_CATEGORY_INVOICE_RULES.general_store;

    feelGoodQuote = customConfig?.quote || defaultDef.quote;
    feelGoodCategory = defaultDef.categoryName;
  }

  return {
    groupedRules,
    flatTerms,
    matchedCategories: Array.from(matchedCatKeys),
    feelGoodQuote,
    feelGoodCategory,
  };
}

/**
 * Resolves just the customer-facing feel-good quote for an invoice.
 */
export function resolveInvoiceQuote(
  sale: Sale | { items?: (SaleItem | CartItem)[]; invoiceNo?: string },
  db: Database
): string {
  const result = resolveInvoiceRules(sale, db);
  return result.feelGoodQuote;
}

/**
 * Generates/synthesizes product-specific invoice rules & quote instantly on-device
 * (Offline-first / AI fallback) based on product attributes.
 */
export function synthesizeProductRules(product: Partial<Product>): {
  terms: string[];
  quote: string;
  categoryKey: string;
} {
  const catKey = normalizeCategoryKey(product.category || product.name || "", {
    isMobilePhone: product.isMobilePhone,
    isSecondHand: product.units?.some((u) => u.isSecondHand),
    isSparePart: product.isSparePart,
  });

  const base = DEFAULT_CATEGORY_INVOICE_RULES[catKey] || DEFAULT_CATEGORY_INVOICE_RULES.general_store;
  const terms = [...base.terms];
  let quote = base.quote;

  const brand = (product.brand || "").trim();
  const model = (product.name || "").trim();

  // Customize if brand is known
  if (brand && catKey === "new_mobile") {
    terms[0] = `1-Year ${brand} handset warranty serviced via official ${brand} Authorized Service Centers.`;
    quote = `Congratulations on your new ${brand} ${model ? model : "smartphone"}! Wishing you great connectivity & success. 🌟📱`;
  } else if (brand && catKey === "audio_sound") {
    quote = `Enjoy premium sound with your ${brand} ${model || "audio device"}! 🎧🎶`;
  } else if (catKey === "tempered_glass" && /curved|uv/i.test(model)) {
    terms[1] = "UV / 3D Curved Glass applied with professional precision. No replacement against bubbles or cracks once fitted.";
    quote = "Edge-to-edge curved screen armor! Protected with utmost craftsmanship. 🛡️✨";
  }

  // Adjust for explicit warranty months
  if (product.warrantyEnabled && product.warrantyMonths && product.warrantyMonths > 0) {
    const wMonths = product.warrantyMonths;
    const wText = wMonths >= 12 ? `${Math.round(wMonths / 12)} Year` : `${wMonths} Months`;
    terms.unshift(`Warranty Period: ${wText} valid from purchase date with this invoice.`);
  }

  return {
    terms,
    quote,
    categoryKey: catKey,
  };
}
