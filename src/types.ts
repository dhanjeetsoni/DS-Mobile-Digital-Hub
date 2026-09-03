export interface Settings {
  shopName: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  invoicePrefix: string;
  ownerPasscode: string;
  lowStockDefault: number;
  invoiceFooter: string;
  currency: string;
  logo: string;
  gstEnabled: boolean;
  gstPercent: number;
  upiId: string;
  invoiceTerms: string;
  thermalDefault: boolean;
  theme: string;
  jobPrefix: string;
  staffReturnLimit: number;
  openingCashDefault: number;
  loyaltyEnabled?: boolean;
  loyaltyEarnPer100?: number; // points earned per ₹100 spent
  loyaltyRedeemValue?: number; // ₹ value of 1 point when redeemed
  reorderMultiplier?: number; // suggested reorder qty = minStock * multiplier
  textScale?: "sm" | "md" | "lg" | "xl"; // global UI text size preference
  fontStyle?: "system" | "rounded" | "mono"; // global UI font style preference
  // Part 3: how many days after a sale is created the owner can still
  // edit/delete it. After this window the sale is permanently locked.
  // Owner-configurable in Settings; defaults to 10 when unset.
  saleCorrectionWindowDays?: number;
  // ISO timestamp of the last auto-sent weekly Telegram report. Checked on
  // app load so the report goes out roughly once every 7 days without
  // needing a separate always-on server — see utils/weeklyReport.ts.
  lastWeeklyReportSentAt?: string;
  // Step 7.2 — Delete Policy. ISO timestamp of the last time the app
  // checked for out-of-stock-for-3+-months product photos to clean up.
  // Checked on owner app load (at most once/day) — see
  // utils/outOfStockTracker.ts + services/photoStorage.ts.
  lastPhotoCleanupAt?: string;
  // Step 7.3 — Storage Usage Meter. Owner-editable plan limits (MB), used
  // only to compute the used% for the Warning/Critical meter — defaults to
  // common free-tier sizes (Supabase 500MB DB, Cloudflare R2 10GB/month
  // free) when unset, but Owner can correct these if they're on a paid plan.
  storageLimitSupabaseMb?: number;
  storageLimitCloudflareMb?: number;
  // Step 11 — Day-Zero Setup Wizard. Owner can permanently dismiss the
  // first-launch checklist (either by finishing it or explicitly skipping);
  // once true the wizard never auto-opens again, though it stays reachable
  // from the sidebar (⚙️ System) any time.
  setupWizardDismissed?: boolean;
  // Step 11.7 — Pricing tutorial popup. Can't be derived from real data like
  // the other 7 checklist items (there's no natural "pricing understood"
  // signal), so this is the one explicit owner-acknowledged flag.
  pricingTutorialSeen?: boolean;
}

export interface StockBatch {
  id: string;
  productId: string;
  qty: number;
  remainingQty: number;
  purchasePrice: number;
  date: string;
  supplier: string;
  source: string;
  ref: string;
  createdAt: string;
}

export interface IMEIUnit {
  id: string;
  productId: string;
  imei1: string;
  imei2?: string;
  serialNo?: string;
  color?: string;
  ramStorage?: string;
  batteryHealth?: string;
  condition?: "Brand New" | "Flawless" | "Good" | "Fair" | "Needs Repair";
  status: "In Stock" | "Sold" | "Returned" | "Under Repair";
  soldInvoiceNo?: string;
  soldDate?: string;
  costPrice?: number;
  isSecondHand?: boolean;
  sellerKycId?: string;
  notes?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  brand: string;
  sku: string;
  // Scannable barcode value. Generated once (AddProductModal "Generate
  // Barcode") and saved with the product; later camera/handheld scans of
  // this exact value auto-fill the product into the POS cart.
  barcode?: string;
  photo: string;
  // ---- Step 3.3: 4-Tier Pricing System ----
  // 1. Original (Kharidari) Price — `purchasePrice` below. Owner-only,
  //    everywhere (UI, API, exports, reports) — never shown to staff.
  purchasePrice: number | null;
  pendingCost: boolean;
  // 2. Confidential Price — the real floor. Owner always sees/sets it;
  //    staff can NEVER see this value directly — only a per-request
  //    Telegram-approved sale is allowed to go this low (Step 4.3, not yet
  //    built). Optional/nullable so existing pre-3.3 products (which have
  //    no confidential tier) keep loading without a migration step — the
  //    sale-floor check falls back to `purchasePrice` when this is unset.
  confidentialPrice?: number | null;
  // 3. Selling Price — the normal listed price. Visible to everyone
  //    (Owner + Staff). Staff may sell at or below this down to
  //    `confidentialPrice`, never below it.
  sellingPrice: number;
  // 4. MRP — visible to everyone, display/discount-calculation only; not
  //    used in any profit math. Optional/nullable for the same back-compat
  //    reason as confidentialPrice (also true for every already-saved
  //    product from before this field existed).
  mrp?: number | null;
  stock: number;
  minStock: number;
  warrantyEnabled: boolean;
  warrantyMonths: number;
  requireCustomerDetails: boolean;
  supplier: string;
  notes: string;
  compatibleModels: string[];
  // Screen size in inches this accessory (Tempered Glass / Curved Glass /
  // Back Cover) fits. Used as a fallback match when a customer's exact
  // phone model isn't in compatibleModels — see ModelSearchView's AI
  // screen-size search. Step 3.4: when the pack fits a RANGE of screen
  // sizes (common for universal-fit / curved glass), this holds the
  // MINIMUM of that range and `screenSizeMaxInches` holds the maximum.
  // For a single-size item, `screenSizeMaxInches` is left unset and
  // `screenSizeInches` alone is treated as an exact size (min === max).
  screenSizeInches?: number;
  // Step 3.4b: maximum inches of the compatibility range, only set when
  // different from `screenSizeInches` (i.e. only for genuine ranges like
  // "6.5–6.7 inch"). Optional/nullable so pre-3.4 products (single value
  // or none at all) keep loading without a migration step.
  screenSizeMaxInches?: number;
  isMobilePhone?: boolean;
  isSparePart?: boolean;
  units?: IMEIUnit[];
  createdAt: string;
  // Step 7.2 — Delete Policy. Set the moment `stock` first drops to 0 (and
  // cleared the moment it goes back above 0) by
  // utils/outOfStockTracker.ts's syncOutOfStockTimestamps(), which runs on
  // every save so no individual stock-changing screen has to remember to
  // set this itself. Once a product has been continuously out of stock for
  // 90+ days its photo (not the product record) is auto-cleaned from
  // Cloudflare R2 to save storage — see
  // photoStorage.ts's cleanupStaleOutOfStockPhotos(). Undefined/null means
  // "currently in stock" or "never tracked yet" (pre-7.2 products).
  outOfStockSince?: string | null;
}

export interface CartItem {
  productId: string;
  name: string;
  category: string;
  qty: number;
  price: number;
  purchasePrice: number | null;
  warrantyEnabled: boolean;
  warrantyMonths: number;
  requireCustomerDetails: boolean;
  selectedImeis?: string[];
  isMobilePhone?: boolean;
  // Step 5.1 — snapshot of the product's MRP at the moment this line was
  // added, so the auto-calculated discount % shown on the invoice/report
  // reflects what MRP actually was at sale time even if it's edited later.
  mrp?: number | null;
  // Step 5.2 — Gifts System. A gift line is a completely ordinary cart line
  // (same FIFO stock consumption, same profit-engine cost accounting) with
  // `price` fixed at 0 and `isGift: true`; nothing else in the checkout
  // pipeline needs to special-case it. `giftSellingPrice` is a separate
  // snapshot of the product's normal Selling Price (not MRP) at gift-time —
  // used only by Owner Reports 5.3's "Selling-price-basis" gift value total,
  // which the plan explicitly defines as a different number from both MRP
  // and the Original-cost-basis total (the latter already falls out of the
  // existing `cost`/`purchasePrice` fields for free).
  isGift?: boolean;
  giftSellingPrice?: number | null;
}

export interface SaleItem {
  productId: string;
  name: string;
  category: string;
  qty: number;
  price: number;
  purchasePrice: number;
  cost: number;
  batchConsumption?: { batchId: string | null; qty: number; purchasePrice: number }[];
  warrantyEnabled: boolean;
  warrantyMonths: number;
  warrantyStart?: string | null;
  warrantyEnd?: string | null;
  returnedQty?: number;
  selectedImeis?: string[];
  // Step 5.1 / 5.2 — see the matching comment on CartItem; these are just
  // the permanent, post-sale copies of the same snapshot fields.
  mrp?: number | null;
  isGift?: boolean;
  giftSellingPrice?: number | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  email?: string;
  totalDue: number;
  payments?: { date: string; amount: number; note: string; method?: string }[];
  createdAt: string;
  loyaltyPoints?: number;
  loyaltyHistory?: { date: string; points: number; reason: string; invoiceNo?: string }[];
}

export interface MobileFinanceDetails {
  company: "Bajaj Finserv" | "TVS Credit" | "Home Credit" | "HDB Financial" | "Samsung Finance+" | "DMI Finance" | "Other";
  loanAccountNo: string;
  downPayment: number;
  loanAmount: number;
  processingFee: number;
  dbdAmount: number; // Dealer Subvention / DBD
  netBankReceivable: number;
  payoutStatus: "Pending Bank Settlement" | "Settled in Bank" | "Disputed / Clawback";
  settlementDate?: string;
  utrRef?: string;
}

export interface Sale {
  id: string;
  invoiceNo: string;
  date: string;
  time: string;
  customer: { name: string; phone: string; address?: string; email?: string } | null;
  customerId: string | null;
  payment: string;
  isFinance?: boolean;
  financeDetails?: MobileFinanceDetails;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  taxAmount?: number;
  total: number;
  amountPaid: number;
  dueAmount: number;
  status: "Paid" | "Partial" | "Due" | "Cancelled";
  // Part 3: owner correction trail. Editing/cancelling is only allowed
  // inside the store's `saleCorrectionWindowDays` window (from `createdAt`);
  // once that passes the sale is permanently locked.
  createdAt?: string;
  editedAt?: string;
  editedBy?: string;
  editHistory?: { at: string; by: string; note: string }[];
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
}

export interface ReturnItem {
  productId: string;
  name: string;
  category: string;
  qty: number;
  price: number;
  purchasePrice: number;
  refund: number;
  imei?: string;
}

export interface ReturnRecord {
  id: string;
  returnNo: string;
  saleId: string;
  invoiceNo: string;
  date: string;
  time: string;
  type: "full" | "partial";
  items: ReturnItem[];
  reason: string;
  refundMethod: string;
  notes: string;
  subtotalRefund: number;
  dueOffset: number;
  settlementAmount: number;
  customerId: string | null;
  customer: { name: string; phone: string; address?: string } | null;
  createdAt: string;
}

export interface ExchangeRecord {
  id: string;
  exchangeNo: string;
  saleId: string;
  invoiceNo: string;
  date: string;
  time: string;
  returnedItems: { productId: string; name: string; category: string; qty: number; price: number; purchasePrice: number; imei?: string }[];
  replacementItems: SaleItem[];
  returnedValue: number;
  replacementValue: number;
  differenceAmount: number;
  settlementMethod: string;
  reason: string;
  customer: { name: string; phone: string } | null;
  customerId: string | null;
  createdAt: string;
}

export interface WarrantyClaim {
  id: string;
  claimNo: string;
  saleId: string;
  invoiceNo: string;
  productId: string;
  productName: string;
  category: string;
  date: string;
  time: string;
  issueDescription: string;
  status: "Open" | "In Progress" | "Resolved" | "Rejected";
  resolution?: string;
  resolvedAt?: string;
  customerId: string | null;
  customer: { name: string; phone: string } | null;
  warrantyEnd?: string | null;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  category: "Mobile Distributor" | "SIM & LAPU DLR" | "Spare Parts" | "Accessories" | "General";
  address?: string;
  gstin?: string;
  totalPayable: number;
  createdAt: string;
  // Repayment plan for the outstanding baaki (udhaar) on goods ordered from this supplier.
  repaymentFrequency?: "Weekly" | "Half-Monthly" | "Monthly" | "One-Time";
  nextRepaymentDueDate?: string;
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  supplierName: string;
  date: string;
  amount: number;
  method: "Cash" | "UPI" | "Bank Transfer" | "Cheque";
  invoiceRef?: string;
  notes?: string;
}

export interface SecondHandKYC {
  id: string;
  voucherNo: string;
  date: string;
  sellerName: string;
  sellerPhone: string;
  sellerAddress: string;
  aadhaarNumber: string;
  idProofType: "Aadhaar Card" | "Voter ID" | "Driving License" | "PAN Card";
  brand: string;
  modelName: string;
  imei1: string;
  imei2?: string;
  serialNo?: string;
  color?: string;
  ramStorage?: string;
  conditionGrade: "Flawless" | "Good" | "Fair" | "Defective";
  purchaseAmountPaid: number;
  paymentMethod: "Cash" | "UPI" | "Bank Transfer";
  frpRemoved: boolean;
  legalDeclarationConfirmed: boolean;
  docPhoto?: string;
  sellerPhoto?: string;
  registeredProductId?: string;
  createdAt: string;
}

export interface RepairSpareDeducted {
  productId: string;
  name: string;
  qty: number;
  costPrice: number;
  sellingRate: number;
}

export interface RepairJob {
  id: string;
  jobNo: string;
  receivedDate: string;
  customerName: string;
  phone: string;
  device: string;
  imei?: string;
  patternLock?: string;
  accessories: string;
  issue: string;
  // Set when this ticket came from the Mobile Unlock / Lock Services quick-picker
  // (see mobileLockServices.ts) — used to badge and filter these jobs separately
  // from regular hardware repairs in the Jobs board and reports.
  serviceType?: string;
  status: "Received" | "In Progress" | "Ready" | "Delivered" | "Cancelled / Returned";
  estCost: number;
  advance: number;
  finalCharge?: number;
  sparePartsDeducted?: RepairSpareDeducted[];
  partsCostTotal?: number;
  // Owner-only, optional. Any extra real cost paid to actually complete this
  // job that ISN'T an inventory spare part — e.g. an FRP/unlock tool credit,
  // an outsourced flashing charge, a paid online unlock server fee. Maan lo
  // FRP bypass mein ₹350 laga aur customer se ₹500 liya to yahan 350 daalne
  // se profit apne aap ₹150 nikal ke aayega. Optional — chhod dene par
  // (jaisa pehle tha) poora estCost hi profit maana jaata hai.
  otherCost?: number;
  otherCostNote?: string;
  laborProfit?: number;
  costEditedAt?: string;
  deliveredDate?: string;
  deliveryPaymentMethod?: string;
  deliveryNotes?: string;
}

export interface SIMActivation {
  id: string;
  actNo: string;
  date: string;
  customerName: string;
  customerPhone: string;
  simNumber: string;
  operator: "Jio" | "Airtel" | "Vi" | "BSNL";
  type: "New SIM" | "MNP (Port)";
  frcPlan: string; // e.g. ₹299 / ₹239
  frcAmount: number;
  targetCommission: number;
  distributorName: string;
  commissionStatus: "Pending from DLR" | "Received" | "Deducted / Settled";
  commissionReceivedDate?: string;
  notes?: string;
}

export interface LapuWalletRecord {
  id: string;
  date: string;
  operator: "Airtel Mitra" | "JioPOS Plus" | "Vi Smart" | "BSNL Pay";
  openingBalance: number;
  topupAdded: number;
  rechargesDone: number;
  expectedBalance: number;
  actualBalance: number;
  difference: number;
  notes?: string;
}

export interface XeroxEntry {
  id: string;
  date: string;
  time: string;
  // Free text so owner-added custom cyber cafe services (Manage Rates → Add
  // New Service) aren't limited to the original built-in category names.
  serviceType: string;
  copies: number;
  ratePerUnit: number;
  totalAmount: number;
  paymentMethod: "Cash" | "UPI";
  // Owner-only, optional. What this particular transaction actually cost the
  // shop (paper/ink/toner, a paid unlock/FRP tool, an SMS/portal fee, etc).
  // Left unset/0 when the owner doesn't know or doesn't care to track it —
  // profit then simply equals totalAmount, same as before this field existed.
  // Staff never see or set this; only ownerMode can enter/edit it, and it can
  // always be corrected later from the Xerox/Cyber log.
  costAmount?: number;
  costEditedAt?: string;
}

export interface DailyGallaClosing {
  id: string;
  date: string;
  closedAt: string;
  openingCash: number;
  cashSales: number;
  cashKhataCollected: number;
  cashXeroxTotal: number;
  cashRepairCollected: number;
  cashExtraIncome?: number;
  cashExpensesPaid: number;
  cashSupplierPaid: number;
  cashRefundsPaid: number;
  expectedCash: number;
  actualCashCounted: number;
  overageOrShortage: number;
  onlinePaymentReceived: number;
  expectedOnlinePayment: number;
  onlineDiff: number;
  denominations?: { [key: string]: number };
  status: "Closed & Verified";
  notes?: string;
}

export interface PurchaseRecord {
  id: string;
  productId: string;
  productName: string;
  qty: number;
  purchasePrice: number;
  total: number;
  supplier: string;
  supplierId?: string;
  date: string;
  notes: string;
  invoiceRef: string;
  // How this specific inward bill was settled at the time of entry.
  paymentStatus?: "Paid Cash" | "Paid Online" | "Purchased on Credit (Udhaar)";
}

// ---- Byaj / Interest-Bearing Money Lender Tracker (Owner-only) ----
// Tracks principal (muldhan) borrowed from private lenders against monthly interest (byaj),
// separate from supplier/distributor trade credit above.
export interface MoneyLender {
  id: string;
  name: string;
  phone?: string;
  principalAmount: number; // current outstanding muldhan owed to this lender
  monthlyInterestAmount: number; // fixed ₹ interest due each month (as told by lender, not a %)
  interestDueDay: number; // day of month interest is due, e.g. 1
  startDate: string;
  status: "Active" | "Closed";
  notes?: string;
  createdAt: string;
}

export interface LenderTransaction {
  id: string;
  lenderId: string;
  lenderName: string;
  date: string;
  type: "Interest Paid" | "Principal Repayment" | "Additional Principal Taken";
  amount: number;
  method: "Cash" | "UPI" | "Bank Transfer";
  forMonth?: string; // e.g. "2026-08" — which month's interest this payment covers
  notes?: string;
}

export interface CybercafeService {
  id: string;
  // Free text — owner can add entirely new product/service categories in
  // Manage Rates, not just the built-in Xerox/Photo/Lamination presets.
  serviceType: string;
  rate: number;
  label: string;
  icon: string;
  color: string;
  // Owner-only, optional. Default per-unit cost for this service/product
  // (e.g. paper+ink cost per Xerox copy). Auto-fills the cost box on the
  // 1-Tap counter so the owner doesn't have to type it every single time;
  // it can still be overridden per-transaction (e.g. a variable-cost job
  // like FRP bypass where the tool/portal cost changes each time).
  defaultCost?: number;
}

export interface Expense {
  id: string;
  date: string;
  description: string;
  amount: number;
  method: string;
  category?: string;
}

export interface Database {
  settings: Settings;
  categories: string[];
  products: Product[];
  imeiRegistry: IMEIUnit[];
  purchases: PurchaseRecord[];
  sales: Sale[];
  expenses: {
    shop: Expense[];
    personal: Expense[];
    other: Expense[];
  };
  // Extra / miscellaneous income not tied to a POS sale (old scrap sold,
  // commission received, rent from a shelf, etc.) — adds to the daily galla
  // cash-in-hand total when method is Cash.
  extraIncome: Expense[];
  customers: Customer[];
  suppliers: Supplier[];
  supplierPayments: SupplierPayment[];
  jobs: RepairJob[];
  simActivations: SIMActivation[];
  lapuWallets: LapuWalletRecord[];
  secondHandKYCs: SecondHandKYC[];
  xeroxEntries: XeroxEntry[];
  // Owner-editable Cyber Cafe / Xerox rate list. Falls back to built-in
  // defaults (DEFAULT_CYBERCAFE_SERVICES in XeroxGrid.tsx) when empty/undefined
  // so old saved databases keep working without a migration step.
  cybercafeServices?: CybercafeService[];
  gallaClosings: DailyGallaClosing[];
  stockBatches: StockBatch[];
  stockAdjustments: any[];
  returns: ReturnRecord[];
  exchanges: ExchangeRecord[];
  // Optional so old saved states (pre-warranty-tracking) keep loading without
  // a migration step — see App.tsx defaultDB() and ReturnsExchangesView's
  // `db.warrantyClaims || []` fallback, same pattern as stockAdjustments.
  warrantyClaims?: WarrantyClaim[];
  moneyLenders: MoneyLender[];
  lenderTransactions: LenderTransaction[];
  invoiceSeq: number;
  jobSeq: number;
  returnSeq: number;
  exchangeSeq: number;
  warrantyClaimSeq?: number;
  simSeq: number;
  kycSeq: number;
}
