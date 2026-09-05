import React, { useState, useEffect, useRef } from "react";
import {
  Database,
  Product,
  CartItem,
  Sale,
  ReturnRecord,
  ExchangeRecord,
  Customer,
  Supplier,
  RepairJob,
  SecondHandKYC,
  DailyGallaClosing,
  MobileFinanceDetails,
} from "./types";
import { inr, round2, numberToWordsIndian, computeSaleTotals, computeDiscountPercent } from "./utils/indianCurrency";
import { uid, todayStr, nowTimeStr, genSku, backfillMissingSkus, addStockBatch, consumeFIFO, fifoCostTotal, getAvailableStock } from "./utils/fifoEngine";
import { naturalMatch } from "./utils/naturalSearch";
import { Sidebar, SECONDARY_NAV_ITEMS } from "./components/Sidebar";
import AppearanceStudioView from "./components/AppearanceStudioView";
import { LoanTrackerView } from "./components/LoanTrackerView";
import { CameraScannerModal } from "./components/CameraScannerModal";
import { AddProductModal } from "./components/AddProductModal";
import { EditProductModal } from "./components/EditProductModal";
import { ProductThumb } from "./components/ProductThumb";
import { SecondHandKycModal } from "./components/SecondHandKycModal";
import { SupplierKhataView } from "./components/SupplierKhataView";
import { XeroxGrid, DEFAULT_CYBERCAFE_SERVICES } from "./components/XeroxGrid";
import { SimTrackerView } from "./components/SimTrackerView";
import { FinanceTrackerView } from "./components/FinanceTrackerView";
import { DailyGallaModal } from "./components/DailyGallaModal";
import { BarcodeTagStudio } from "./components/BarcodeTagStudio";
import { ImeiAuditView } from "./components/ImeiAuditView";
import { InvoiceViewerModal } from "./components/InvoiceViewerModal";
import { ModelSearchView } from "./components/ModelSearchView";
import { PhotoStockFinderView } from "./components/PhotoStockFinderView";
import { AiAdviceCard } from "./components/AiAdviceCard";
import { ReturnsExchangesView } from "./components/ReturnsExchangesView";
import { StockAdjustView } from "./components/StockAdjustView";
import { PurchasesView } from "./components/PurchasesView";
import { SalesHistoryView } from "./components/SalesHistoryView";
import { DailyReviewView } from "./components/DailyReviewView";
import { MonthlyReviewView } from "./components/MonthlyReviewView";
import { ShopExpensesView } from "./components/ShopExpensesView";
import { ExtraIncomeView } from "./components/ExtraIncomeView";
import { PersonalDrawingsView } from "./components/PersonalDrawingsView";
import { OwnerReportsView } from "./components/OwnerReportsView";
import { WindowsAppModal } from "./components/WindowsAppModal";
import { LowStockAlertsView } from "./components/LowStockAlertsView";
import { LoyaltyRewardsView } from "./components/LoyaltyRewardsView";
import { DownloadAreaView } from "./components/DownloadAreaView";
import { ProfitLossDashboardView } from "./components/ProfitLossDashboardView";
import { CloudAuthPanel } from "./components/CloudAuthPanel";
import { AiKeyPoolPanel } from "./components/AiKeyPoolPanel";
import { StatusDashboardView } from "./components/StatusDashboardView";
import { AppVersionsPanel } from "./components/AppVersionsPanel";
import { UpdateAvailablePill } from "./components/UpdateAvailablePill";
import { useAppUpdateCheck } from "./hooks/useAppUpdateCheck";
import { MoneyAnimation } from "./components/MoneyAnimation";
import { CustomerDirectoryView } from "./components/CustomerDirectoryView";
import { StaffAccessView } from "./components/StaffAccessView";
import { SetupWizardView } from "./components/SetupWizardView";
import { ConfidentialPriceModal } from "./components/ConfidentialPriceModal";
import { ConnectionStatusBadge } from "./components/ConnectionStatusBadge";
import { AddGiftModal } from "./components/AddGiftModal";
import { staffSignIn, isAccessWindowExpired, cacheStaffSession, readCachedStaffSession, clearCachedStaffSession } from "./services/staffAuth";
import { MOBILE_LOCK_SERVICES } from "./utils/mobileLockServices";
import { supabase, getCurrentProfile, isCloudConfigured } from "./services/supabaseClient";
import { loadCloudState, saveCloudState, queueOfflineOperation, flushOfflineQueue, persistLocalState, startConnectivitySync } from "./services/repository";
import { backfillLegacyProductPhotos, deleteProductPhotoByUrl, cleanupStaleOutOfStockPhotos } from "./services/photoStorage";
import { syncOutOfStockTimestamps } from "./utils/outOfStockTracker";
import { ExportClearInvoicesView } from "./components/ExportClearInvoicesView";
import { sqliteList } from "./services/localSqlite";
import { openTelegramConnection, pollTelegramConnection, sendTelegramTest, sendTelegramSecurityAlert, sendWeeklyReportToTelegram } from "./services/telegram";
import { getRepairDiagnosis } from "./services/aiOps";
import { buildWeeklyReport, isWeeklyReportDue } from "./utils/weeklyReport";
import { openWhatsApp, buildInvoiceMessage, buildDueReminderMessage } from "./services/whatsapp";
import { exportStandaloneHtml } from "./utils/exportStandaloneHtml";
import { celebrate } from "./utils/celebrate";
import {
  Search,
  Plus,
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Printer,
  FileText,
  DollarSign,
  Wrench,
  Camera,
  Trash2,
  ArrowRight,
  Shield,
  Download,
  Upload,
  Monitor,
  Users,
  Lock,
  LogIn,
  Pencil,
  ShieldAlert,
  ArrowRight as ArrowRightIcon,
  Loader2,
  Barcode,
  Gift,
  Menu,
} from "lucide-react";

const LS_KEY = "dsmdh_db_v2";

const CATS_DEFAULT = [
  "New Mobile",
  "Second-Hand Mobile",
  "Tempered Glass",
  "Curved Glass",
  "Cover",
  "Charger",
  "Cable",
  "Earphone/TWS",
  "Speaker",
  "Power Bank",
  "Accessory",
  "Repair Service",
  "Repair Spare Part",
  "Cyber Cafe",
  "Electronics",
  "Other",
];

function defaultDB(): Database {
  const initialProducts: Product[] = [];
  return {
    settings: {
      shopName: "DS MOBILE & DIGITAL HUB",
      address: "",
      phone: "",
      email: "",
      gstin: "",
      invoicePrefix: "DSM",
      ownerPasscode: "",
      lowStockDefault: 5,
      invoiceFooter: "Thank you for shopping with us! Visit again for genuine accessories & mobile repairs.",
      currency: "INR",
      logo: "",
      gstEnabled: false,
      gstPercent: 18,
      upiId: "",
      invoiceTerms: "1. TEMPERED GLASS / SCREEN GUARD: Sold strictly on an \"as-applied\" basis — NO warranty or guarantee against breakage, cracks or scratches once fitted.\n2. SECOND-HAND MOBILE RETURN: A minimum handling charge of ₹500 applies on any return, and increases proportionally for higher-value devices. Device must be free of scratches, physical damage, water damage or missing accessories to be eligible.\n3. Brand warranty (if any) is honoured only via the respective Brand Service Center as per manufacturer policy — not by this store directly.\n4. Goods once sold are exchanged only as per store policy and strictly against this original invoice.\n5. Please preserve this invoice safely — required for any warranty, return or exchange claim.",
      thermalDefault: false,
      theme: "obsidian-orange",
      jobPrefix: "JOB",
      staffReturnLimit: 500,
      openingCashDefault: 0,
      textScale: "md",
      fontStyle: "system",
      saleCorrectionWindowDays: 10,
    },
    categories: CATS_DEFAULT.slice(),
    products: initialProducts,
    imeiRegistry: initialProducts.flatMap((p) => p.units || []),
    purchases: [],
    sales: [],
    expenses: { shop: [], personal: [], other: [] },
    extraIncome: [],
    customers: [],
    suppliers: [],
    supplierPayments: [],
    jobs: [],
    simActivations: [],
    lapuWallets: [],
    secondHandKYCs: [],
    xeroxEntries: [],
    cybercafeServices: DEFAULT_CYBERCAFE_SERVICES.map((s) => ({ ...s })),
    gallaClosings: [],
    stockBatches: [],
    stockAdjustments: [],
    returns: [],
    exchanges: [],
    warrantyClaims: [],
    moneyLenders: [],
    lenderTransactions: [],
    invoiceSeq: 1,
    jobSeq: 1,
    returnSeq: 1,
    exchangeSeq: 1,
    warrantyClaimSeq: 1,
    simSeq: 1,
    kycSeq: 1,
  };
}

export default function App() {
  // Start from an empty safe state. Local business cache is loaded only after
  // authentication is known, preventing a previous owner's data flashing on a staff device.
  const [db, setDb] = useState<Database>(() => defaultDB());

  const [ownerMode, setOwnerMode] = useState(false);
  const initialRoutePage = (() => {
    const page = new URLSearchParams(window.location.search).get("page");
    return page || "dashboard";
  })();
  const [currentPage, setCurrentPage] = useState(initialRoutePage);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toasts, setToasts] = useState<{ id: string; msg: string; kind?: string }[]>([]);
  const [cloudUser, setCloudUser] = useState<any>(null);
  const [cloudProfile, setCloudProfile] = useState<any>(null);
  const [cloudVersion, setCloudVersion] = useState(0);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("offline");
  const [showCloudAuth, setShowCloudAuth] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<any>(null);

  // Modals
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  // 2026-09-04 — Android/narrow-screen nav drawer. Sidebar is fixed-width and
  // always in the document flow at desktop widths (unchanged); below the
  // 900px breakpoint (see index.css) it becomes an off-canvas drawer that
  // this state toggles, closing itself automatically on every navigation so
  // it never lingers open over the page like a modal would.
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [confidentialPriceProduct, setConfidentialPriceProduct] = useState<Product | null>(null);
  const [isAddGiftOpen, setIsAddGiftOpen] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isEditProductOpen, setIsEditProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isKycModalOpen, setIsKycModalOpen] = useState(false);
  const [viewingKyc, setViewingKyc] = useState<SecondHandKYC | null>(null);
  const [isGallaModalOpen, setIsGallaModalOpen] = useState(false);
  const [isInvoiceViewerOpen, setIsInvoiceViewerOpen] = useState(false);
  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [viewingCreditNote, setViewingCreditNote] = useState<ReturnRecord | null>(null);
  const [viewingExchange, setViewingExchange] = useState<ExchangeRecord | null>(null);
  const [isOwnerLoginOpen, setIsOwnerLoginOpen] = useState(false);
  const [isWindowsModalOpen, setIsWindowsModalOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // ---- Access Gate: shown every time the app opens. Staff vs Owner Confidential ----
  const GATE_ATTEMPTS_KEY = "dsmdh_owner_gate_state_v1";
  const [gateUnlocked, setGateUnlocked] = useState(false);
  // Step 1.5/1.8: the *same* codebase is packaged three ways —
  //   VITE_APP_VARIANT unset/"full"  -> Windows desktop app (today's behaviour, both tiles)
  //   VITE_APP_VARIANT="staff"       -> dedicated Staff Android app: skips the
  //                                      chooser entirely, no Owner tile ever shown/reachable.
  //   VITE_APP_VARIANT="owner"       -> dedicated Owner Android app: skips straight to the
  //                                      Owner gate, no Staff Area tile (Owner still gets full access).
  // See src-tauri/tauri.staff-android.conf.json / tauri.owner-android.conf.json and
  // BUILD-ANDROID.md for how these get built into two separate installable APKs.
  const APP_VARIANT = (import.meta as any).env?.VITE_APP_VARIANT || "full";
  const [gateStage, setGateStage] = useState<"choose" | "ownerAuth" | "staffAuth" | "staffDenied">(
    APP_VARIANT === "staff" ? "staffAuth" : APP_VARIANT === "owner" ? "ownerAuth" : "choose"
  );
  // In a dedicated Staff/Owner build there is no "choose" screen to go back
  // to (and it must never become reachable — that's the whole point of a
  // separate app). "Back" on those builds just resets the current form.
  const gateBackStage = APP_VARIANT === "staff" ? "staffAuth" : APP_VARIANT === "owner" ? "ownerAuth" : "choose";
  const [gatePassInput, setGatePassInput] = useState("");
  // Staff Access Manager (Part 1): staff sign in with an owner-issued Login ID
  // + password instead of walking straight into Staff Area. If cloud sync
  // isn't configured on this device, no staff accounts can exist yet, so we
  // fall back to the old instant "Staff Area" entry.
  const [staffLoginId, setStaffLoginId] = useState("");
  const [staffLoginPassword, setStaffLoginPassword] = useState("");
  const [staffLoginBusy, setStaffLoginBusy] = useState(false);
  const [staffLoginError, setStaffLoginError] = useState("");
  const [staffDeniedReason, setStaffDeniedReason] = useState<"disabled" | "expired" | null>(null);
  const [gateShakeError, setGateShakeError] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateAttempts, setGateAttempts] = useState<{ count: number; lockUntil: number }>(() => {
    try {
      const raw = localStorage.getItem(GATE_ATTEMPTS_KEY);
      return raw ? JSON.parse(raw) : { count: 0, lockUntil: 0 };
    } catch {
      return { count: 0, lockUntil: 0 };
    }
  });
  const [gateLockRemaining, setGateLockRemaining] = useState(0);

  const persistGateAttempts = (next: { count: number; lockUntil: number }) => {
    setGateAttempts(next);
    try {
      localStorage.setItem(GATE_ATTEMPTS_KEY, JSON.stringify(next));
    } catch {}
  };

  useEffect(() => {
    if (!gateAttempts.lockUntil) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((gateAttempts.lockUntil - Date.now()) / 1000));
      setGateLockRemaining(remain);
      if (remain <= 0) persistGateAttempts({ count: 0, lockUntil: 0 });
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [gateAttempts.lockUntil]);

  const handleGateStaffEntry = () => {
    setOwnerMode(false);
    setGateUnlocked(true);
  };

  // "Staff Area" tap: if the owner has cloud sync set up, staff must sign in
  // with their owner-issued Login ID + password (so access on/off actually
  // means something). Without cloud sync configured, no staff accounts can
  // exist, so keep the old instant local entry — nothing to check against.
  const handleGateStaffAreaTap = () => {
    if (isCloudConfigured) {
      setStaffLoginId("");
      setStaffLoginPassword("");
      setStaffLoginError("");
      setGateStage("staffAuth");
    } else {
      handleGateStaffEntry();
    }
  };

  const handleStaffLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffLoginId.trim() || !staffLoginPassword) {
      setStaffLoginError("Login ID aur Password dono bharo.");
      return;
    }
    setStaffLoginBusy(true);
    setStaffLoginError("");
    try {
      const result = await staffSignIn(staffLoginId.trim(), staffLoginPassword);
      if (result.status === "ok") {
        showToast(`Welcome, ${result.profile?.staff_name || staffLoginId}!`, "green");
        // The Supabase session is now persisted to local storage by
        // supabase-js itself; reloading lets the existing bootstrap effect
        // (cloud profile load, realtime channel, offline queue flush) pick
        // it up the normal way instead of duplicating that logic here.
        window.location.reload();
        return;
      }
      if (result.status === "disabled") {
        setStaffDeniedReason("disabled");
        setGateStage("staffDenied");
        return;
      }
      if (result.status === "expired") {
        setStaffDeniedReason("expired");
        setGateStage("staffDenied");
        return;
      }
      setStaffLoginError(result.message);
    } finally {
      setStaffLoginBusy(false);
    }
  };

  const handleGateOwnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (gateAttempts.lockUntil > Date.now()) return;
    const configuredPass = db.settings.ownerPasscode || "";
    // If the shop hasn't set a custom owner passcode yet, fall back to the
    // documented default "1234" so a fresh/local install is never locked
    // out. Once the owner sets a real passcode in Settings, that becomes
    // the only accepted value (the "1234" fallback stops applying).
    //
    // IMPORTANT: this PIN must ALWAYS be checked on its own merits. It is
    // documented to the user (see the hint text on this screen) as a
    // separate, device-only security layer from the Cloud account — it
    // must never be silently bypassed just because a Supabase cloud
    // session happens to already be authenticated as owner/manager (e.g.
    // a persisted login from an earlier session on this device). A prior
    // version of this check did exactly that, letting ANY typed value
    // unlock Owner mode whenever a cloud-owner session was active.
    const correct =
      (configuredPass && gatePassInput === configuredPass) ||
      (!configuredPass && gatePassInput === "1234");

    if (correct) {
      persistGateAttempts({ count: 0, lockUntil: 0 });
      setOwnerMode(true);
      setGateUnlocked(true);
      setGatePassInput("");
      setIsOwnerLoginOpen(false);
      showToast("Owner access unlocked.", "green");
      return;
    }

    const nextCount = gateAttempts.count + 1;
    setGateShakeError(true);
    setTimeout(() => setGateShakeError(false), 500);
    setGatePassInput("");

    if (nextCount >= 3) {
      persistGateAttempts({ count: 0, lockUntil: Date.now() + 2 * 60 * 1000 });
      showToast("3 incorrect attempts. Owner area locked for 2 minutes.", "red");
      setGateBusy(true);
      try {
        await sendTelegramSecurityAlert(
          `3 incorrect Owner passcode attempts on ${db.settings.shopName || "your shop"}'s counter device. If this wasn't you, check your shop immediately.`
        );
      } catch (err) {
        console.warn("Security alert failed to send", err);
      } finally {
        setGateBusy(false);
      }
    } else {
      persistGateAttempts({ count: nextCount, lockUntil: 0 });
      showToast(`Incorrect passcode. ${3 - nextCount} attempt(s) left.`, "red");
    }
  };

  // Catch PWA Install Prompt for Windows App
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleTriggerPwaInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        showToast("DS Mobile App installed on Windows!", "green");
      }
      setDeferredPrompt(null);
    } else {
      showToast("To install on Windows: In Chrome/Edge click (App ⊕ icon in address bar) or Settings > Apps > Install.", "blue");
    }
  };

  // Global Windows Counter Keyboard Shortcuts (F2-F9 & Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in a textarea or text input unless it's an F-key or Escape
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(
        (document.activeElement?.tagName || "")
      );

      if (e.key === "Escape") {
        setIsCameraScannerOpen(false);
        setIsKycModalOpen(false);
        setIsGallaModalOpen(false);
        setIsInvoiceViewerOpen(false);
        setIsOwnerLoginOpen(false);
        setIsWindowsModalOpen(false);
        setIsJobModalOpen(false);
        setJobAiDiagnosis({ loading: false, text: "", error: "" });
        return;
      }

      if (e.key === "F2") {
        e.preventDefault();
        setCurrentPage("sell");
        showToast("Keyboard Shortcut: F2 -> New Bill (POS)", "green");
      } else if (e.key === "F3") {
        e.preventDefault();
        setCurrentPage("modelsearch");
        showToast("Keyboard Shortcut: F3 -> Glass & Cover Finder", "green");
      } else if (e.key === "F4") {
        e.preventDefault();
        setIsCameraScannerOpen(true);
        showToast("Keyboard Shortcut: F4 -> Quick Barcode/Box Scan", "green");
      } else if (e.key === "F6") {
        e.preventDefault();
        setCurrentPage("xeroxGrid");
        showToast("Keyboard Shortcut: F6 -> 1-Tap Xerox / Cyber", "green");
      } else if (e.key === "F7") {
        e.preventDefault();
        requireOwner(() => {
          setViewingKyc(null);
          setIsKycModalOpen(true);
        });
        showToast("Keyboard Shortcut: F7 -> 2nd-Hand Buyback KYC", "green");
      } else if (e.key === "F8") {
        e.preventDefault();
        setIsJobModalOpen(true);
        showToast("Keyboard Shortcut: F8 -> Repair Service Ticket", "green");
      } else if (e.key === "F9") {
        e.preventDefault();
        setIsGallaModalOpen(true);
        showToast("Keyboard Shortcut: F9 -> Daily Galla Closing", "green");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // ownerMode is a dependency here too: this listener closes over
    // requireOwner(), which reads ownerMode — without re-binding on every
    // ownerMode change, F7 would keep judging owner status from whatever it
    // was when the app first mounted (always "false"), even after login.
  }, [ownerMode]);

  // New Sale POS states
  const [sellSearchQuery, setSellSearchQuery] = useState("");
  const [sellCategoryFilter, setSellCategoryFilter] = useState<string>("ALL");
  // Step 4.2: the old flat, unconstrained "Discount (₹)" cart field has been
  // removed entirely — there is no manual discount override anywhere in the
  // app anymore. Whatever final price staff/owner types into a cart line IS
  // the price the customer pays; nothing further is subtracted at checkout.
  // `cartDiscount` therefore always stays 0 (kept only so computeSaleTotals'
  // existing signature and the Sale record's `discount` field don't need to
  // change — Step 5.1 will later derive a real, auto-calculated discount %
  // from MRP vs. actual sold price for reporting/invoice display).
  const cartDiscount = 0;
  const [paymentMode, setPaymentMode] = useState<string>("Cash");
  const [isFinanceMode, setIsFinanceMode] = useState<boolean>(false);
  const [financeForm, setFinanceForm] = useState({
    company: "Bajaj Finserv" as const,
    loanAccountNo: "",
    downPayment: 0,
    loanAmount: 0,
    processingFee: 0,
    dbdAmount: 0,
  });

  // Repair ticket states
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  // 2026-09-04: AI first-look diagnosis for the "Reported Issue" text — a
  // suggestion only, never a substitute for the technician actually
  // opening the device (the AI prompt itself says this explicitly too).
  const [jobAiDiagnosis, setJobAiDiagnosis] = useState<{ loading: boolean; text: string; error: string }>({ loading: false, text: "", error: "" });
  const [jobForm, setJobForm] = useState({
    customerName: "",
    phone: "",
    device: "",
    accessories: "",
    issue: "",
    estCost: 0,
    advance: 0,
    selectedSparePartId: "",
    serviceType: "",
    otherCost: 0,
  });

  // Owner-only: correcting cost/profit on an already-created job ticket
  // (e.g. adding the FRP/unlock tool cost after the fact).
  const [editingJobCostId, setEditingJobCostId] = useState<string | null>(null);
  const [jobCostDraft, setJobCostDraft] = useState({ estCost: 0, otherCost: 0 });

  // Supabase bootstrap, realtime sync, offline queue replay, and Telegram retry pump.
  useEffect(() => {
    let active = true;
    let channel: any = null;
    const bootstrap = async () => {
      try {
        setCloudStatus("connecting");
        const { data } = await supabase.auth.getUser();
        if (!active) return;
        setCloudUser(data.user ?? null);
        if (!data.user) {
          try {
            const raw = localStorage.getItem("dsmdh_cache_v4") || localStorage.getItem("dsmdh_db_v2");
            if (raw) {
              const parsed = JSON.parse(raw);
              const empty = defaultDB();
              setDb({ ...empty, ...parsed, settings: { ...empty.settings, ...(parsed.settings || {}) } });
            }
          } catch (error) {
            console.warn("Local cache bootstrap failed", error);
          }
        }
        const profile = await getCurrentProfile();
        setCloudProfile(profile);
        if (profile?.role === "owner" || profile?.role === "manager") setOwnerMode(true);
        if (profile?.role === "staff") {
          // A staff session survives a page reload (supabase-js persists it),
          // but the access gate itself does not — re-check ON/OFF + the
          // access window fresh from the server before letting them straight
          // back into the app the app remembers they logged into.
          if (!profile.access_enabled || isAccessWindowExpired(profile)) {
            clearCachedStaffSession();
            await supabase.auth.signOut().catch(() => {});
            setCloudUser(null);
            setCloudProfile(null);
            setStaffDeniedReason(!profile.access_enabled ? "disabled" : "expired");
            setGateStage("staffDenied");
            setGateUnlocked(false);
            setCloudStatus("offline");
            setCloudReady(true);
            return;
          } else {
            cacheStaffSession({
              staffId: profile.id,
              staffName: profile.staff_name,
              accessMode: profile.access_mode,
              accessExpiresAt: profile.access_expires_at,
              visibilityFrom: profile.visibility_from,
            });
            setOwnerMode(false);
            setGateUnlocked(true);
          }
        }
        if (!profile?.store_id) { setCloudStatus("offline"); setCloudReady(true); return; }
        const remote = await loadCloudState();
        if (remote?.state) {
          setDb(prev => ({ ...prev, ...remote.state, settings: { ...prev.settings, ...(remote.state.settings || {}) } }));
          setCloudVersion(remote.version);
        }
        setCloudStatus("online");
        setCloudReady(true);
        if (profile.role !== "staff") {
          channel = supabase.channel(`store-state-${profile.store_id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'store_state', filter: `store_id=eq.${profile.store_id}` }, (payload: any) => {
            const row = payload.new;
            if (row?.state) {
              setCloudVersion(Number(row.version || 0));
              setDb(prev => ({ ...prev, ...row.state, settings: { ...prev.settings, ...(row.state.settings || {}) } }));
            }
          }).subscribe();
        }
        await flushOfflineQueue();
      } catch (e) { console.warn("Cloud bootstrap failed", e); setCloudStatus("error"); setCloudReady(true); }
    };
    bootstrap();
    return () => { active = false; if (channel) supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!cloudReady || !cloudProfile?.store_id) return;
    const timer = window.setTimeout(async () => {
      try { const v = await saveCloudState(db, cloudVersion); setCloudVersion(v); setCloudStatus("online"); }
      catch (error: any) {
        const isVersionConflict = String(error?.message || error || "").includes("VERSION_CONFLICT");
        if (isVersionConflict) {
          // Another device (owner/staff) already saved a newer version.
          // Re-queuing OUR stale copy with the old version number would just
          // fail the same way forever (this was the bug behind the
          // permanent red "Sync Issue" badge and a growing pile of stuck
          // sync_queue rows). Instead, pull the latest state so the local
          // copy — and the version number used by the *next* autosave — is
          // correct again.
          console.warn("Cloud save hit a version conflict; refreshing from server instead of re-queuing stale data", error);
          try {
            const remote = await loadCloudState();
            if (remote?.state) {
              // BUG FIX (2026-09-04): this used to overwrite local `db`
              // with `remote.state` unconditionally, discarding whatever
              // hadn't been saved yet — e.g. the stock decrement from a
              // sale that was still in-flight when the conflict hit. With
              // two+ devices autosaving the whole store every ~650ms, this
              // collided constantly (live sync_queue showed 8+ conflicts in
              // under a minute), which is exactly what looked like "stock
              // shows the new number for a moment, then reverts" — the sale
              // itself always succeeded (it's committed atomically in
              // Postgres separately), but the display-facing snapshot kept
              // losing the local edit that would have shown it.
              // Retrying the save against the now-current version resolves
              // a single momentary race (the overwhelmingly common case)
              // instead of throwing the local edit away immediately; only
              // fall back to accepting the remote copy if that retry also
              // collides.
              try {
                const retryVersion = await saveCloudState(db, remote.version);
                setCloudVersion(retryVersion);
                setCloudStatus("online");
                return;
              } catch (retryError) {
                console.warn("Retry after version conflict also failed; accepting remote state instead", retryError);
                setCloudVersion(remote.version);
                setDb(prev => ({ ...prev, ...remote.state, settings: { ...prev.settings, ...(remote.state.settings || {}) } }));
              }
            }
            setCloudStatus("online");
          } catch (refetchError) {
            console.warn("Refetching latest state after version conflict failed", refetchError);
            setCloudStatus("error");
          }
        } else {
          console.warn("Cloud state save failed; queueing an idempotent snapshot bridge operation", error);
          setCloudStatus("error");
          try { await queueOfflineOperation("snapshot", "store_state", db); }
          catch (queueError) { console.warn("Snapshot queue failed", queueError); }
        }
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [db, cloudReady, cloudProfile?.store_id]);

  // Stock-flicker fix: product.stock inside the shared JSON snapshot is
  // fought over by every device that autosaves (owner + staff can each
  // overwrite the other's copy of the *entire* inventory blob within
  // seconds of each other — that's what caused stock to visibly bounce
  // between values). atomic_complete_sale / atomic_apply_stock_adjustment
  // already maintain a race-free stock_qty in the relational products
  // table (row-locked, one writer at a time). Treat that as the one source
  // of truth for the stock *number* and periodically pull it into the local
  // copy (matched by sku) instead of letting devices race each other.
  useEffect(() => {
    if (!cloudUser || !cloudProfile?.store_id) return;
    let cancelled = false;
    const reconcileStock = async () => {
      try {
        const { data, error } = await supabase
          .from("products")
          .select("sku, stock_qty")
          .eq("store_id", cloudProfile.store_id);
        if (error || !data || cancelled) return;
        const bySku = new Map<string, number>();
        for (const row of data) if (row.sku) bySku.set(row.sku, Number(row.stock_qty));
        if (bySku.size === 0) return;
        setDb((prev) => {
          let changed = false;
          const products = prev.products.map((p) => {
            if (p.sku && bySku.has(p.sku)) {
              const real = bySku.get(p.sku)!;
              if (real !== p.stock) { changed = true; return { ...p, stock: real }; }
            }
            return p;
          });
          return changed ? { ...prev, products } : prev;
        });
      } catch (error) {
        console.warn("Stock reconciliation pull failed", error);
      }
    };
    reconcileStock();
    const t = window.setInterval(reconcileStock, 20000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [cloudUser, cloudProfile?.store_id]);

  useEffect(() => {
    if (!cloudUser) return;
    const timer = window.setInterval(async () => {
      try {
        await flushOfflineQueue();
        if (!document.hidden) await supabase.functions.invoke("telegram-outbox-worker", { body: { trigger: "client-pump" } });
      } catch (error) {
        console.warn("Background worker pump failed", error);
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [cloudUser]);

  // Part 3: "X sales pending sync" — counts operations still sitting in the
  // local offline queue (sql.js, on-device) that haven't been replayed to
  // Postgres yet. Reading the local queue (not the server) means this works
  // even fully offline, which is exactly when the number matters most.
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const rows = await sqliteList();
        if (active) setPendingSyncCount(rows.length);
      } catch {
        // sql.js not ready yet on first paint — ignore, next tick retries.
      }
    };
    check();
    const t = window.setInterval(check, 4000);
    return () => { active = false; window.clearInterval(t); };
  }, [db]);

  useEffect(() => {
    // Owner-only (Master Plan 1.4): the connect-status poll backs the
    // owner-only Telegram button above. Staff sessions have no reason to
    // hit this every 15s — the edge function would just 403 them anyway
    // (only owner/manager roles are authorized), so skip it for staff
    // instead of quietly failing in the background on a timer.
    if (!cloudUser || !ownerMode) return;
    const timer = window.setInterval(async () => {
      if (document.hidden || telegramStatus?.connected) return;
      try { setTelegramStatus(await pollTelegramConnection()); }
      catch (error) { console.warn("Telegram polling failed", error); }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [cloudUser, ownerMode, telegramStatus?.connected]);

  useEffect(() => {
    if (cloudProfile?.role === "staff") setOwnerMode(false);
    if (cloudProfile?.role === "owner" || cloudProfile?.role === "manager") setOwnerMode(true);
  }, [cloudProfile?.role]);

  // Step 11 — Day-Zero Setup Wizard: auto-open once for a genuinely fresh
  // store (no shop name set yet, no products added yet — i.e. nothing an
  // existing/returning owner would already have). Only fires while the
  // owner is still sitting on the default "dashboard" landing page (so it
  // never yanks them away mid-task if they'd already navigated somewhere),
  // and never again once dismissed (finished or skipped).
  const setupWizardAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (setupWizardAutoOpenedRef.current) return;
    if (!ownerMode || !cloudReady) return;
    if (db.settings.setupWizardDismissed) return;
    if (db.settings.shopName?.trim() || db.products.length > 0) return;
    if (currentPage !== "dashboard") return;
    setupWizardAutoOpenedRef.current = true;
    setCurrentPage("setupWizard");
  }, [ownerMode, cloudReady, db.settings.setupWizardDismissed, db.settings.shopName, db.products.length, currentPage]);

  // Step 12.1/12.2 — App Update & OTA Push check. Runs for everyone (Owner
  // AND Staff, on every platform) since Staff's Android device needs the
  // same "Update Available" pill as Owner's — only *publishing* a new
  // version (AppVersionsPanel) is Owner-only, the check itself isn't.
  const { updateInfo: appUpdateInfo, dismiss: dismissAppUpdate } = useAppUpdateCheck(true);

  // Part 2: enforce a staff member's access window (hours/minutes, full-day,
  // or the owner turning access OFF from the Staff Access Manager) while
  // they're mid-session — checked purely against the device's own clock
  // against a value cached at login time, so it fires even if this device
  // has no internet connection right now. Runs every 5s; also once
  // immediately when a staff session starts.
  useEffect(() => {
    if (!gateUnlocked || cloudProfile?.role !== "staff") return;
    const forceStaffLogout = async (reason: "disabled" | "expired") => {
      clearCachedStaffSession();
      await supabase.auth.signOut().catch(() => {});
      setCloudUser(null);
      setCloudProfile(null);
      setOwnerMode(false);
      setStaffDeniedReason(reason);
      setGateStage("staffDenied");
      setGateUnlocked(false);
      showToast(reason === "expired" ? "Aapka access time khatam ho gaya." : "Owner ne aapka access band kar diya.", "amber");
    };
    const check = () => {
      const cached = readCachedStaffSession();
      if (!cached) return;
      if (cached.accessMode !== "no_restriction" && cached.accessExpiresAt && new Date(cached.accessExpiresAt).getTime() <= Date.now()) {
        forceStaffLogout("expired");
      }
    };
    check();
    const t = window.setInterval(check, 5000);
    return () => window.clearInterval(t);
  }, [gateUnlocked, cloudProfile?.role]);

  // Same access window, but pushed live from the owner's side: if the shop
  // is online, an owner turning access OFF (or changing the window) reaches
  // an already-logged-in staff device immediately instead of waiting for
  // their next 5s local-clock check or their next app open.
  useEffect(() => {
    if (!gateUnlocked || cloudProfile?.role !== "staff" || !cloudProfile?.id) return;
    const forceKickDeleted = () => {
      // Step 1.7: Delete must kick an already-open session just as
      // instantly as Pause does — not only block the *next* login attempt.
      clearCachedStaffSession();
      supabase.auth.signOut().catch(() => {});
      setCloudUser(null);
      setCloudProfile(null);
      setOwnerMode(false);
      setStaffDeniedReason("disabled");
      setGateStage("staffDenied");
      setGateUnlocked(false);
      showToast("Owner ne aapka account delete kar diya.", "amber");
    };
    const channel = supabase
      .channel(`staff-access-${cloudProfile.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${cloudProfile.id}` },
        (payload: any) => {
          const row = payload.new;
          if (!row) return;
          if (!row.access_enabled) {
            clearCachedStaffSession();
            supabase.auth.signOut().catch(() => {});
            setCloudUser(null);
            setCloudProfile(null);
            setOwnerMode(false);
            setStaffDeniedReason("disabled");
            setGateStage("staffDenied");
            setGateUnlocked(false);
            showToast("Owner ne aapka access band kar diya.", "amber");
            return;
          }
          // Access window changed (new grant / new expiry / new visibility_from) — refresh the cache the offline timer reads from.
          cacheStaffSession({
            staffId: row.id,
            staffName: row.staff_name,
            accessMode: row.access_mode,
            accessExpiresAt: row.access_expires_at,
            visibilityFrom: row.visibility_from,
          });
          setCloudProfile((prev: any) => (prev ? { ...prev, ...row } : prev));
        }
      )
      // Delete (Owner: "Delete" in Staff Access Manager) removes the profiles
      // row outright rather than updating it — needs its own event, the
      // UPDATE handler above never fires for this case.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "profiles", filter: `id=eq.${cloudProfile.id}` },
        () => forceKickDeleted()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gateUnlocked, cloudProfile?.role, cloudProfile?.id]);

  // Guard against a direct/deep-link route (e.g. ?page=loanTracker) landing on an
  // owner-only screen before the owner passcode has been entered this session.
  useEffect(() => {
    const isOwnerOnlyPage = SECONDARY_NAV_ITEMS.some((item) => item.key === currentPage && item.ownerOnly);
    if (isOwnerOnlyPage && !ownerMode) {
      setCurrentPage("dashboard");
    }
  }, [currentPage, ownerMode]);

  // Automatic reconnect/background sync. Non-essential polling is paused while the tab is hidden.
  useEffect(() => {
    if (!cloudUser) return;
    return startConnectivitySync(async (result) => {
      if (result.processed > 0 || result.failed > 0) {
        setCloudStatus(result.failed ? "sync-error" : "online");
        if (result.processed > 0) {
          try {
            const fresh = await loadCloudState();
            if (fresh?.state) {
              setDb(fresh.state);
              setCloudVersion(fresh.version);
              persistLocalState(fresh.state);
            }
          } catch (error) {
            console.warn("Cloud state refresh after sync failed", error);
          }
        }
      }
    });
  }, [cloudUser]);

  // Background photo backfill: any product photo still stored as a data:
  // URL (saved before the Storage migration, or saved once while offline)
  // gets quietly uploaded to Supabase Storage and swapped for its URL, one
  // at a time, whenever the app is online with a known store. Runs at most
  // once per store/db-load pair and never blocks or shows a spinner —
  // see services/photoStorage.ts.
  useEffect(() => {
    if (!cloudUser || !cloudProfile?.store_id) return;
    backfillLegacyProductPhotos(cloudProfile.store_id, db, (productId, url) => {
      const product = db.products.find((p) => p.id === productId);
      if (product) {
        product.photo = url;
        saveState({ ...db });
      }
    });
    // Deliberately not re-running on every db change — that would fight
    // with in-progress uploads. It re-checks on reconnect/store change,
    // which is enough to eventually catch every legacy photo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudUser, cloudProfile?.store_id, cloudStatus]);

  // One-time legacy-sku backfill: resolve_product_for_sale() (used by both
  // the sale flow and stock adjustments) refuses to resolve a product that
  // has no sku, since minting one there could create an untraceable
  // duplicate row — by design, that's the server's job to guard, not to fix
  // silently. Instead, give every legacy product a sku locally, the same
  // way AddProductModal generates one for a brand-new product, so it stops
  // hitting that guard entirely. Purely local (no network call); the
  // regular autosave picks up the change afterwards.
  useEffect(() => {
    const { products, changed } = backfillMissingSkus(db.products);
    if (changed) saveState({ ...db, products });
    // Deliberately only depends on the product count, not the whole `db` —
    // this only needs to run again when a new legacy-shaped product could
    // have appeared (e.g. right after the cloud state loads), not on every
    // keystroke elsewhere in the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.products.length]);

  // Automatic weekly report → Telegram. There is no always-on server here,
  // so this runs the check whenever an owner/manager opens the app (at most
  // once per app load) — if 7+ days have passed since the last send (or it
  // has never been sent) and Telegram is connected, it sends silently. If
  // Telegram isn't connected yet, it fails quietly — the owner can always
  // send it manually from Owner Reports.
  const weeklyReportCheckedRef = useRef(false);
  useEffect(() => {
    if (!cloudUser || !ownerMode || weeklyReportCheckedRef.current) return;
    if (!isWeeklyReportDue(db)) return;
    weeklyReportCheckedRef.current = true;
    (async () => {
      try {
        const report = buildWeeklyReport(db);
        await sendWeeklyReportToTelegram(report);
        db.settings.lastWeeklyReportSentAt = new Date().toISOString();
        saveState({ ...db });
        showToast("Is hafte ki report Telegram par bhej di gayi", "green");
      } catch {
        // Telegram not connected yet, or offline right now — silently skip.
        // Owner can always send it manually from Owner Reports.
      }
    })();
  }, [cloudUser, ownerMode, db]);

  // Step 7.2 — Delete Policy: "3 mahine out-of-stock ho jaaye to photo
  // auto-cleanup" (storage bharne se bachega). Runs at most once per app
  // load (ref guard) and at most once per real day (settings timestamp
  // guard, same pattern as the weekly-report check above) so it never
  // spams R2/Supabase on every render. Owner-only — this both mutates
  // shared settings state and issues delete calls, same trust level as the
  // weekly report send just above it. Never touches a product record,
  // only its `photo` field, per the plan's own wording.
  const photoCleanupCheckedRef = useRef(false);
  useEffect(() => {
    if (!cloudUser || !ownerMode || !cloudProfile?.store_id || photoCleanupCheckedRef.current) return;
    const lastMs = db.settings.lastPhotoCleanupAt ? new Date(db.settings.lastPhotoCleanupAt).getTime() : 0;
    if (Date.now() - lastMs < 24 * 60 * 60 * 1000) return;
    photoCleanupCheckedRef.current = true;
    (async () => {
      try {
        const cleanedIds = await cleanupStaleOutOfStockPhotos(cloudProfile.store_id, db.products);
        const updated: Database = structuredClone(db);
        if (cleanedIds.length) {
          const idSet = new Set(cleanedIds);
          updated.products.forEach((p) => {
            if (idSet.has(p.id)) p.photo = "";
          });
        }
        updated.settings.lastPhotoCleanupAt = new Date().toISOString();
        saveState(updated);
        if (cleanedIds.length) {
          showToast(`${cleanedIds.length} purani out-of-stock product photo(s) cleanup ho gayi (3+ mahine se stock mein nahi thi).`, "green");
        }
      } catch {
        // offline or transient failure — will retry tomorrow, never blocks the app
      }
    })();
  }, [cloudUser, ownerMode, cloudProfile?.store_id, db]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      void flushOfflineQueue().catch((error) => console.warn("Resume sync failed", error));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Save DB
  const saveState = (updated: Database) => {
    // Step 7.2 — Delete Policy: keep every product's out-of-stock clock
    // correct on every single save, no matter which screen changed the
    // stock number. Cheap (plain array loop, no network), so safe to run
    // unconditionally here rather than trying to remember it at each of
    // the many stock-changing call sites.
    syncOutOfStockTimestamps(updated.products);
    setDb(updated);
    try {
      persistLocalState(updated);
    } catch (e) {
      console.error("Local cache save error", e);
    }
  };

  const showToast = (msg: string, kind?: string) => {
    const id = uid("t");
    setToasts((prev) => [...prev, { id, msg, kind }]);
    if (kind === "green") celebrate();
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  };

  const handleRedeemLoyaltyPoints = (customerId: string, points: number) => {
    const updated: Database = structuredClone(db);
    const cust = updated.customers.find((c) => c.id === customerId);
    if (!cust || (cust.loyaltyPoints || 0) < points) {
      showToast("Unable to redeem: insufficient points.", "red");
      return;
    }
    cust.loyaltyPoints = round2((cust.loyaltyPoints || 0) - points);
    cust.loyaltyHistory = [
      ...(cust.loyaltyHistory || []),
      { date: todayStr(), points: -points, reason: "Redeemed" },
    ];
    saveState(updated);
  };

  const handleUpdateLoyaltySettings = (settings: { loyaltyEnabled: boolean; loyaltyEarnPer100: number; loyaltyRedeemValue: number }) => {
    saveState({ ...db, settings: { ...db.settings, ...settings } });
  };

  // Step 7.2 — Delete Policy: "Product Photos safe rahegi jab tak product
  // manually delete na ho..." — this is the "manually delete" half of that
  // sentence. There was no way to delete a product at all before this;
  // owners could only edit price fields. Owner-only, confirms first
  // (double-confirms if stock is still non-zero, since that also silently
  // discards remaining inventory), best-effort deletes the R2 photo file
  // (never blocks the product-record delete if that fails — an orphaned
  // photo costs a few KB, a product an owner can't delete costs trust),
  // then removes the product from state like every other mutation here.
  const handleDeleteProduct = async (p: Product) => {
    if (!ownerMode) return;
    if (p.stock > 0) {
      const proceed = window.confirm(
        `"${p.name}" mein abhi ${p.stock} stock hai. Delete karne se yeh stock bhi permanently hat jayega (sirf photo nahi, poora product record). Pakka delete karna hai?`
      );
      if (!proceed) return;
    } else {
      const proceed = window.confirm(
        `"${p.name}" ko permanently delete karein? Iski photo bhi cloud storage se hat jayegi. Yeh undo nahi ho sakta.`
      );
      if (!proceed) return;
    }
    try {
      await deleteProductPhotoByUrl(p.photo);
    } catch {
      // best-effort — proceed with deleting the record either way
    }
    const updated: Database = structuredClone(db);
    updated.products = updated.products.filter((x) => x.id !== p.id);
    saveState(updated);
    showToast(`"${p.name}" delete kar diya gaya`, "green");
  };

  // Step 7.2 — Delete Policy: "Invoices/PDFs kabhi auto-delete nahi. Owner
  // ke paas Export & Clear tool — combined PDF banao, phir purane individual
  // records delete karo. Yeh sirf Owner kar sakta hai, manually." The PDF
  // side (print/save) happens entirely inside ExportClearInvoicesView; this
  // is only ever called after the owner has already triggered that print
  // and explicitly confirmed, so this function's only job is the deletion.
  const handleExportClearSales = (saleIds: string[]) => {
    if (!ownerMode || !saleIds.length) return;
    const idSet = new Set(saleIds);
    const updated: Database = structuredClone(db);
    updated.sales = updated.sales.filter((s) => !idSet.has(s.id));
    saveState(updated);
    showToast(`${saleIds.length} purane invoice record${saleIds.length > 1 ? "s" : ""} clear kar diye gaye (PDF export ke baad).`, "green");
  };

  // NOTE (theme system): html[data-theme] is owned entirely by the
  // Appearance Studio theme system (theme/applyAppearance.ts, started once
  // in main.tsx via startAppearanceSync()). The old settings-driven write
  // that used to live here, the old 22-theme CSS, and the Sidebar's old
  // "Theme" dropdown have all been retired (Part 2) — Appearance Studio
  // (owner section) is now the only theme control, and it applies app-wide.
  // db.settings.theme is still in the data model, but nothing reads or writes
  // it anymore as of Part 3: exportStandaloneHtml.ts now derives its export
  // palette live from the Appearance Studio store (useAppearance) instead,
  // so the offline export follows whichever theme is active automatically.
  // The field is kept only as a legacy fallback inside exportStandaloneHtml.ts
  // for the unlikely case the appearance store isn't available.

  // Apply text size + font style preference to html element (item: "text change options")
  useEffect(() => {
    document.documentElement.setAttribute("data-text-scale", db.settings.textScale || "md");
    document.documentElement.setAttribute("data-font-style", db.settings.fontStyle || "system");
  }, [db.settings.textScale, db.settings.fontStyle]);

  // Gate for actions that must always be owner-only, no matter which button,
  // shortcut key, or OCR-result callback tried to trigger them. Runs the
  // action immediately if already in owner mode, otherwise asks for the
  // owner passcode first and does NOT run the action (the owner can retry
  // the same button after logging in).
  const requireOwner = (action: () => void) => {
    if (!ownerMode) {
      setIsOwnerLoginOpen(true);
      showToast("Sirf owner ye kaam kar sakte hain — pehle owner passcode dalein", "amber");
      return;
    }
    action();
  };

  const handleTextScaleChange = (scale: "sm" | "md" | "lg" | "xl") => {
    saveState({ ...db, settings: { ...db.settings, textScale: scale } });
    showToast("Text size updated", "green");
  };

  const handleFontStyleChange = (style: "system" | "rounded" | "mono") => {
    saveState({ ...db, settings: { ...db.settings, fontStyle: style } });
    showToast("Font style updated", "green");
  };

  const handleCameraScan = (scannedValue: string) => {
    showToast(`Scanned: ${scannedValue}`, "green");
    const clean = scannedValue.trim();
    // Search in products by generated Barcode, SKU, or IMEI/Serial
    const prodBySku = db.products.find(
      (p) =>
        (p.barcode && p.barcode === clean) ||
        p.sku.toLowerCase() === clean.toLowerCase() ||
        (p.units || []).some((u) => u.imei1 === clean || u.serialNo === clean)
    );

    if (prodBySku) {
      addToCart(prodBySku, clean);
      setCurrentPage("sell");
      showToast(`Added ${prodBySku.name} to cart!`, "green");
    } else {
      setSellSearchQuery(clean);
      setCurrentPage("sell");
    }
  };

  // Cart operations
  const addToCart = (product: Product, specificImei?: string) => {
    if (product.stock <= 0) {
      showToast("Product is out of stock!", "red");
      return;
    }

    const existingIdx = cart.findIndex((c) => c.productId === product.id && !c.isGift);
    if (existingIdx >= 0) {
      const existing = cart[existingIdx];
      if (existing.qty + 1 > product.stock) {
        showToast("Not enough stock available!", "red");
        return;
      }
      const updatedImeis = existing.selectedImeis ? [...existing.selectedImeis] : [];
      if (specificImei && !updatedImeis.includes(specificImei)) {
        updatedImeis.push(specificImei);
      }
      const newCart = [...cart];
      newCart[existingIdx] = {
        ...existing,
        qty: existing.qty + 1,
        selectedImeis: updatedImeis,
      };
      setCart(newCart);
    } else {
      // Find an available IMEI if mobile phone
      const availableImei =
        specificImei ||
        (product.units || []).find((u) => u.status === "In Stock")?.imei1;

      setCart([
        ...cart,
        {
          productId: product.id,
          name: product.name,
          category: product.category,
          qty: 1,
          price: product.sellingPrice,
          purchasePrice: product.purchasePrice,
          warrantyEnabled: product.warrantyEnabled,
          warrantyMonths: product.warrantyMonths,
          requireCustomerDetails: product.requireCustomerDetails,
          isMobilePhone: product.isMobilePhone,
          selectedImeis: availableImei ? [availableImei] : [],
          mrp: product.mrp ?? null,
        },
      ]);
    }
    showToast(`Added to cart: ${product.name}`, "green");
  };

  // Step 5.2 — Gifts System. Adds a product to the cart as a free (₹0),
  // always-its-own-line gift — reuses the exact same cart shape and
  // checkout pipeline (FIFO stock consumption, cost accounting) as a paid
  // line, so nothing downstream needs a special case for "how do gifts get
  // deducted from stock". `giftSellingPrice` snapshots the product's normal
  // Selling Price at gift-time — this is the number Owner Reports 5.3 uses
  // for the "Selling-price-basis total gift value", deliberately separate
  // from `mrp` (shown on the invoice) and from the Original-cost-basis
  // total (which the profit engine already derives for free from the
  // line's FIFO `cost`).
  const addGiftToCart = (product: Product) => {
    if (product.stock <= 0) {
      showToast("Yeh gift product abhi out of stock hai!", "red");
      return;
    }
    if (cart.some((c) => c.productId === product.id && c.isGift)) {
      showToast("Yeh product pehle se hi gift ke roop mein add hai.", "amber");
      return;
    }
    const availableImei = (product.units || []).find((u) => u.status === "In Stock")?.imei1;
    setCart([
      ...cart,
      {
        productId: product.id,
        name: product.name,
        category: product.category,
        qty: 1,
        price: 0,
        purchasePrice: product.purchasePrice,
        warrantyEnabled: false,
        warrantyMonths: 0,
        requireCustomerDetails: false,
        isMobilePhone: product.isMobilePhone,
        selectedImeis: availableImei ? [availableImei] : [],
        isGift: true,
        mrp: product.mrp ?? null,
        giftSellingPrice: product.sellingPrice,
      },
    ]);
    showToast(`🎁 Gift add ho gaya: ${product.name}`, "green");
  };

  // Step 4.3 — applies an Owner-approved Confidential Price to the cart.
  // Deliberately separate from addToCart (rather than addToCart() followed
  // by a price update) to avoid a stale-closure race: addToCart's setCart
  // call and a follow-up setCart call in the same tick would both close
  // over the same pre-update `cart` value, and the second call would win,
  // silently discarding the add. Mirrors addToCart's own stock/IMEI logic.
  const applyConfidentialPrice = (product: Product, price: number) => {
    const existingIdx = cart.findIndex((c) => c.productId === product.id && !c.isGift);
    if (existingIdx >= 0) {
      const newCart = [...cart];
      newCart[existingIdx] = { ...newCart[existingIdx], price };
      setCart(newCart);
    } else {
      if (product.stock <= 0) {
        showToast("Product is out of stock!", "red");
        return;
      }
      const availableImei = (product.units || []).find((u) => u.status === "In Stock")?.imei1;
      setCart([
        ...cart,
        {
          productId: product.id,
          name: product.name,
          category: product.category,
          qty: 1,
          price,
          purchasePrice: product.purchasePrice,
          warrantyEnabled: product.warrantyEnabled,
          warrantyMonths: product.warrantyMonths,
          requireCustomerDetails: product.requireCustomerDetails,
          isMobilePhone: product.isMobilePhone,
          selectedImeis: availableImei ? [availableImei] : [],
          mrp: product.mrp ?? null,
        },
      ]);
    }
    showToast(`Confidential price ${inr(price)} cart mein apply ho gaya — ${product.name}`, "green");
  };

  const updateCartQty = (idx: number, delta: number) => {
    const item = cart[idx];
    const prod = db.products.find((p) => p.id === item.productId);
    const newQty = item.qty + delta;
    if (newQty <= 0) {
      setCart(cart.filter((_, i) => i !== idx));
      return;
    }
    if (prod && newQty > prod.stock) {
      showToast("Cannot exceed available stock!", "red");
      return;
    }
    const newCart = [...cart];
    newCart[idx] = { ...item, qty: newQty };
    setCart(newCart);
  };

  // Step 4.2: this is the *only* way a cart line's amount can change now —
  // there is no separate "Discount" field anywhere. Whatever final price
  // staff/owner types here is exactly what the customer pays for that item
  // ("120 ka glass staff ne 80 mein becha, bas baat khatam"). The hard floor
  // (never below Confidential Price for staff) is still enforced for real at
  // checkout in handleFinalizeSale — this just lets the field be edited
  // freely while typing (so e.g. typing "8" then "80" toward a target of 80
  // isn't fought mid-keystroke) and the cart UI shows a live warning below
  // the field if the current value would currently fail that check.
  const updateCartPrice = (idx: number, rawValue: string) => {
    if (cart[idx]?.isGift) return; // gift price is always ₹0 — see addGiftToCart
    const parsed = Number(rawValue);
    const newPrice = rawValue === "" ? 0 : Number.isFinite(parsed) ? Math.max(0, parsed) : cart[idx].price;
    const newCart = [...cart];
    newCart[idx] = { ...cart[idx], price: newPrice };
    setCart(newCart);
  };

  // Complete Sale
  const handleFinalizeSale = async (customerData: {
    name: string;
    phone: string;
    address?: string;
  }) => {
    if (cart.length === 0) return;
    const subtotal = cart.reduce((a, i) => a + i.price * i.qty, 0);
    const { taxAmount, total } = computeSaleTotals(subtotal, cartDiscount, db.settings.gstEnabled, db.settings.gstPercent);
    const workingDb: Database = structuredClone(db);
    const idempotencyKey = crypto.randomUUID();
    // Online: the server reserves the authoritative invoice number atomically.
    // Offline: use a temporary number; sync replaces it with the server number.
    let invoiceNo = `OFF-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${idempotencyKey.slice(0, 8).toUpperCase()}`;
    workingDb.invoiceSeq = (workingDb.invoiceSeq || 1) + 1;

    let customerId: string | null = null;
    let dueAmount = 0;
    let amountPaid = total;

    if (paymentMode === "Credit / Udhaar") {
      dueAmount = total;
      amountPaid = 0;
    } else if (isFinanceMode) {
      amountPaid = financeForm.downPayment;
      dueAmount = 0; // The loan amount is receivable from Bajaj/TVS
    }

    if (customerData.phone) {
      let cust = workingDb.customers.find((c) => c.phone === customerData.phone);
      if (!cust) {
        cust = {
          id: uid("cust"),
          name: customerData.name || "Customer",
          phone: customerData.phone,
          address: customerData.address || "",
          totalDue: dueAmount,
          createdAt: new Date().toISOString(),
        };
        workingDb.customers.push(cust);
        // Cloud mirror (find-or-create by phone) — fire-and-forget, never
        // blocks checkout. See supplier_customer_normalization_v18.sql.
        queueOfflineOperation("customer", "customers", {
          kind: "upsert",
          customer: { id: cust.id, name: cust.name, phone: cust.phone, address: cust.address, openingDue: dueAmount },
        }).catch(() => {});
      } else {
        if (dueAmount > 0) cust.totalDue = round2((cust.totalDue || 0) + dueAmount);
        if (customerData.name) cust.name = customerData.name;
      }
      customerId = cust.id;

      // Loyalty points: earned on the final sale total, independent of payment method.
      if (workingDb.settings.loyaltyEnabled) {
        const earnRate = workingDb.settings.loyaltyEarnPer100 || 0;
        const pointsEarned = Math.floor((total / 100) * earnRate);
        if (pointsEarned > 0) {
          cust.loyaltyPoints = (cust.loyaltyPoints || 0) + pointsEarned;
          cust.loyaltyHistory = [
            ...(cust.loyaltyHistory || []),
            { date: todayStr(), points: pointsEarned, reason: "Sale", invoiceNo },
          ];
        }
      }
    }

    // Validate every line before mutating local state. Staff cannot bypass this rule.
    for (const item of cart) {
      const prod = workingDb.products.find((p) => p.id === item.productId);
      if (!prod) { showToast("Product not found.", "red"); return; }
      // Step 4.1 fix: gate on the real FIFO batch total, not the denormalized
      // `product.stock` counter. The two can drift (see getAvailableStock's
      // comment) — trusting `stock` directly is exactly what used to cause a
      // sale to get blocked ("insufficient stock") even while the product
      // card showed plenty available, because the batches actually backing
      // that sale were short of what the counter claimed. Deriving straight
      // from stockBatches means the check and the actual FIFO consumption a
      // few lines below always agree.
      const availableStock = getAvailableStock(workingDb, item.productId);
      if (item.qty <= 0 || availableStock < item.qty) {
        showToast("Insufficient stock / inventory mismatch.", "red");
        return;
      }
      // Step 3.3 — 4-Tier Pricing floor: staff can never sell below the
      // Confidential Price. Falls back to Original (purchase) price for
      // products that don't have a Confidential Price set yet, so this
      // stays at least as strict as the old check for pre-3.3 products.
      // Step 4.2 made the cart line's price directly editable (replacing
      // the old flat, unconstrained "Discount (₹)" field) — the Sell screen
      // already shows a live warning below the price input when a staff
      // member types something below this floor, but this is the real,
      // unbypassable enforcement point: checkout is blocked server-side
      // (via this check) regardless of what the UI did or didn't warn
      // about. Going below this floor on purpose is Step 4.3's job
      // (per-product Telegram approval request), not a free edit here.
      const priceFloor = prod.confidentialPrice ?? prod.purchasePrice ?? 0;
      if (!item.isGift && item.price < priceFloor && cloudProfile?.role !== "owner") {
        showToast("SELLING PRICE CONFIDENTIAL PRICE SE KAM NAHI HO SAKTI.", "red");
        return;
      }
    }

    // Process items on a cloned working state. FIFO can throw if local stock/batches
    // drift; never let that become an unhandled promise rejection.
    let saleItems: any[];
    try {
      saleItems = cart.map((item) => {
      const prod = workingDb.products.find((p) => p.id === item.productId);
      let consumed: any[] = [];
      let costTotal = (item.purchasePrice || 0) * item.qty;
      let avgCost = item.purchasePrice || 0;

      if (prod) {
        consumed = consumeFIFO(workingDb, prod.id, item.qty);
        costTotal = fifoCostTotal(consumed);
        avgCost = item.qty > 0 ? round2(costTotal / item.qty) : 0;
        prod.stock -= item.qty;

        // Mark assigned IMEIs as sold
        if (item.selectedImeis && item.selectedImeis.length > 0) {
          item.selectedImeis.forEach((imeiStr) => {
            const unit = (prod.units || []).find((u) => u.imei1 === imeiStr);
            if (unit) {
              unit.status = "Sold";
              unit.soldInvoiceNo = invoiceNo;
              unit.soldDate = todayStr();
            }
            const regUnit = (workingDb.imeiRegistry || []).find((u) => u.imei1 === imeiStr);
            if (regUnit) {
              regUnit.status = "Sold";
              regUnit.soldInvoiceNo = invoiceNo;
              regUnit.soldDate = todayStr();
            }
          });
        }
      }

      let warrantyStart = null;
      let warrantyEnd = null;
      if (item.warrantyEnabled) {
        const start = new Date();
        warrantyStart = start.toISOString().slice(0, 10);
        const end = new Date(start);
        end.setMonth(end.getMonth() + Number(item.warrantyMonths || 0));
        warrantyEnd = end.toISOString().slice(0, 10);
      }

      return {
        productId: item.productId,
        name: item.name,
        category: item.category,
        qty: item.qty,
        price: item.price,
        purchasePrice: avgCost,
        cost: costTotal,
        batchConsumption: consumed,
        warrantyEnabled: item.warrantyEnabled,
        warrantyMonths: item.warrantyMonths,
        warrantyStart,
        warrantyEnd,
        selectedImeis: item.selectedImeis,
        mrp: item.mrp ?? null,
        isGift: item.isGift || false,
        giftSellingPrice: item.giftSellingPrice ?? null,
        // Reconciliation fields for the relational public.products table —
        // see resolve_product_for_sale(). Locally-created products only ever
        // get a client id like "p_<uuid>", never a row in public.products,
        // so the cloud sale RPC needs enough info to find-or-create the real
        // row by SKU before it can attach the sale to a real product uuid.
        sku: prod?.sku ?? null,
        brand: prod?.brand ?? null,
        minStock: prod?.minStock ?? 0,
        costPrice: prod?.purchasePrice ?? avgCost,
        stockAtSale: prod ? prod.stock + item.qty : item.qty,
      };
    });
    } catch (error) {
      console.error("FIFO sale preparation failed", error);
      showToast(error instanceof Error ? error.message : "Inventory batches are inconsistent. Please refresh stock and retry.", "red");
      return;
    }

    let financeDetails: MobileFinanceDetails | undefined = undefined;
    if (isFinanceMode) {
      const loanAmt = Math.max(0, total - financeForm.downPayment);
      const netBank = Math.max(0, loanAmt - financeForm.dbdAmount);
      financeDetails = {
        company: financeForm.company,
        loanAccountNo: financeForm.loanAccountNo || `LAN-${Date.now().toString().slice(-6)}`,
        downPayment: financeForm.downPayment,
        loanAmount: loanAmt,
        processingFee: financeForm.processingFee,
        dbdAmount: financeForm.dbdAmount,
        netBankReceivable: netBank,
        payoutStatus: "Pending Bank Settlement",
      };
    }

    // When signed in, commit the stock/sale mutation atomically in PostgreSQL as a second ledger.
    // The existing local state remains the UI cache and offline fallback.
    if (cloudProfile?.store_id && cloudUser) {
      try {
        const { data: reservedInvoice, error: reserveError } = await supabase.rpc("reserve_invoice_number", {
          p_store_id: cloudProfile.store_id,
          p_prefix: workingDb.settings.invoicePrefix || "DSM",
          p_idempotency_key: idempotencyKey,
        });
        if (reserveError) throw reserveError;
        invoiceNo = String(reservedInvoice);

        // Local products only ever carry a client-generated id (e.g. "p_<uuid>")
        // — atomic_complete_sale needs a real row in public.products. Resolve
        // (find-or-create) each item's real product id before selling, or
        // every sale of a locally-created product fails with an invalid-uuid
        // error and never reaches the server (see resolve_product_for_sale()).
        const resolvedItems = await Promise.all(saleItems.map(async (i) => {
          const { data: realId, error: resolveError } = await supabase.rpc("resolve_product_for_sale", {
            p_store_id: cloudProfile.store_id,
            p_local_id: String(i.productId),
            p_sku: i.sku,
            p_model: i.name,
            p_brand: i.brand,
            p_category: i.category,
            p_cost_price: i.costPrice,
            p_selling_price: i.price,
            p_stock_qty: i.stockAtSale,
            p_min_stock: i.minStock,
          });
          if (resolveError) throw resolveError;
          return { product_id: realId, quantity: i.qty, unit_price: i.price };
        }));

        const { data: atomicSaleId, error: atomicError } = await supabase.rpc("atomic_complete_sale", {
          p_store_id: cloudProfile.store_id,
          p_invoice_no: invoiceNo,
          p_customer_name: customerData.name || null,
          p_customer_phone: customerData.phone || null,
          p_payment_method: isFinanceMode ? `Finance (${financeForm.company})` : paymentMode,
          p_discount: cartDiscount,
          p_tax: taxAmount,
          p_idempotency_key: idempotencyKey,
          p_items: resolvedItems,
        });
        if (atomicError) throw atomicError;
        if (atomicSaleId) showToast("Cloud transaction committed atomically", "green");
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        const businessFailure = /insufficient|inventory mismatch|selling price|not authorized|invoice number already exists|invalid quantity/i.test(msg);
        if (businessFailure) {
          showToast(msg || "Sale rejected by server.", "red");
          return;
        }
        console.warn("Cloud sale unavailable; queuing offline transaction", e);
        try {
          await queueOfflineOperation("sale", "sales", { invoiceNo, items: saleItems, total, payment: isFinanceMode ? `Finance (${financeForm.company})` : paymentMode, customer: customerData, discount: cartDiscount, taxAmount }, idempotencyKey);
        } catch (queueError) {
          showToast("Sale could not be safely queued. Please retry.", "red");
          return;
        }
      }
    }

    const saleRecord: Sale = {
      id: uid("s"),
      invoiceNo,
      date: todayStr(),
      time: nowTimeStr(),
      customer: customerData.phone ? customerData : null,
      customerId,
      payment: isFinanceMode ? `Finance (${financeForm.company})` : paymentMode,
      isFinance: isFinanceMode,
      financeDetails,
      items: saleItems,
      subtotal,
      discount: cartDiscount,
      taxAmount,
      total,
      amountPaid,
      dueAmount,
      status: dueAmount <= 0.005 ? "Paid" : amountPaid > 0 ? "Partial" : "Due",
      createdAt: new Date().toISOString(),
    };

    workingDb.sales.push(saleRecord);
    saveState({ ...workingDb });
    setCart([]);
    setIsFinanceMode(false);

    showToast(`Invoice ${invoiceNo} generated!`, "green");
    setViewingSale(saleRecord);
    setIsInvoiceViewerOpen(true);

    // NOTE (2026-09-04): invoice delivery to the owner's Telegram bot is
    // handled entirely server-side now — see the `enqueue_invoice_telegram`
    // trigger on `public.invoices` (supabase/migrations) which enqueues into
    // `telegram_outbox`, and the `telegram-outbox-worker` function which a
    // pg_cron job sweeps every 2 minutes regardless of whether any device's
    // app is open. That path always resolves the shop's Owner/Manager chat
    // (not the specific signed-in user), includes "Sold By", and works for
    // staff sales made while fully offline, once the sale syncs to cloud.
    //
    // A previous version of this function also fired an *immediate*
    // client-side send via the `telegram-connect` Edge Function's
    // `send_report` action. That action is intentionally Owner/Manager-only
    // (Telegram connect/send is "sirf Owner ka kaam" — see App.tsx comment
    // near the Telegram Connect button), so for a Staff-made sale it always
    // failed silently with 403, and for an Owner-made sale it produced a
    // *second, duplicate* invoice message a couple of minutes later once the
    // outbox trigger also delivered it. It has been removed — the reliable
    // trigger+outbox path already covers every case, without duplicates.
  };

  // Quick POS Customer Checkout Modal State
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [checkoutCustomer, setCheckoutCustomer] = useState({
    name: "",
    phone: "",
    address: "",
  });

  const handleStartCheckout = () => {
    if (cart.length === 0) {
      showToast("Cart is empty!", "red");
      return;
    }
    const needsCustomer =
      cart.some((i) => i.requireCustomerDetails || i.isMobilePhone) ||
      paymentMode === "Credit / Udhaar" ||
      isFinanceMode;

    if (isFinanceMode) {
      const subtotal = cart.reduce((a, i) => a + i.price * i.qty, 0);
      const { total } = computeSaleTotals(subtotal, cartDiscount, db.settings.gstEnabled, db.settings.gstPercent);
      setFinanceForm((prev) => ({
        ...prev,
        loanAmount: Math.max(0, total - prev.downPayment),
      }));
    }

    setIsCustomerModalOpen(true);
  };

  // Repair Job Creation
  const handleCreateJobTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobForm.customerName.trim() || !jobForm.phone.trim() || !jobForm.device.trim()) {
      showToast("Customer name, phone & device model are required", "red");
      return;
    }

    const jobNo = `${db.settings.jobPrefix || "JOB"}-${String(db.jobSeq || 1).padStart(4, "0")}`;
    db.jobSeq = (db.jobSeq || 1) + 1;

    let partsDeducted: any[] = [];
    let partsCost = 0;

    // If spare part is selected, auto-deduct from stock.
    // BUG FIX: this used to call consumeFIFO() directly on the live `db` with no
    // try/catch. If a batch/stock drift made FIFO throw, it threw after already
    // decrementing some batches' remainingQty in place (db is mutated by reference),
    // AND as an unhandled exception inside a form submit handler — silently
    // corrupting stock batches while also failing to create the job ticket.
    // The sale checkout path already guards this the same way; repairs did not.
    if (jobForm.selectedSparePartId) {
      const spare = db.products.find((p) => p.id === jobForm.selectedSparePartId);
      if (spare && spare.stock > 0) {
        try {
          consumeFIFO(db, spare.id, 1);
          spare.stock -= 1;
          partsCost = spare.purchasePrice || 0;
          partsDeducted.push({
            productId: spare.id,
            name: spare.name,
            qty: 1,
            costPrice: spare.purchasePrice || 0,
            sellingRate: spare.sellingPrice,
          });
        } catch (error) {
          console.error("Spare part FIFO deduction failed", error);
          showToast("Spare part stock batches are inconsistent — job ticket created without auto-deducting the part. Please adjust stock manually.", "amber");
        }
      }
    }

    const newJob: RepairJob = {
      id: uid("job"),
      jobNo,
      receivedDate: todayStr(),
      customerName: jobForm.customerName.trim(),
      phone: jobForm.phone.trim(),
      device: jobForm.device.trim(),
      accessories: jobForm.accessories.trim(),
      issue: jobForm.issue.trim(),
      serviceType: jobForm.serviceType || undefined,
      status: "Received",
      estCost: Number(jobForm.estCost) || 0,
      advance: Number(jobForm.advance) || 0,
      sparePartsDeducted: partsDeducted,
      partsCostTotal: partsCost,
      // Owner-only extra cost — e.g. FRP/unlock tool credit, an outsourced
      // flashing charge — that isn't an inventory spare part. Optional;
      // defaults to 0 same as before this field existed.
      otherCost: ownerMode ? Number(jobForm.otherCost) || 0 : 0,
      laborProfit: Math.max(0, (Number(jobForm.estCost) || 0) - partsCost - (ownerMode ? Number(jobForm.otherCost) || 0 : 0)),
    };

    db.jobs.push(newJob);
    saveState({ ...db });
    setIsJobModalOpen(false);
    setJobAiDiagnosis({ loading: false, text: "", error: "" });
    setJobForm({
      customerName: "",
      phone: "",
      device: "",
      accessories: "",
      issue: "",
      estCost: 0,
      advance: 0,
      selectedSparePartId: "",
      serviceType: "",
      otherCost: 0,
    });
    showToast(`Repair Ticket ${jobNo} created!`, "green");
  };

  // Owner-only: correct a job's charge/other-cost after it was created
  // (e.g. an FRP bypass ticket where the actual tool cost wasn't known yet
  // at intake). Spare-part cost stays as-is since that stock was already
  // physically deducted.
  const openJobCostEditor = (j: RepairJob) => {
    setEditingJobCostId(j.id);
    setJobCostDraft({ estCost: j.estCost || 0, otherCost: j.otherCost || 0 });
  };

  const saveJobCostEdit = () => {
    const j = db.jobs.find((x) => x.id === editingJobCostId);
    if (!j) return;
    const partsCost = j.partsCostTotal || 0;
    j.estCost = Math.max(0, Number(jobCostDraft.estCost) || 0);
    j.otherCost = Math.max(0, Number(jobCostDraft.otherCost) || 0);
    j.laborProfit = Math.max(0, j.estCost - partsCost - j.otherCost);
    j.costEditedAt = new Date().toISOString();
    saveState({ ...db });
    setEditingJobCostId(null);
    showToast(`${j.jobNo} cost updated — profit ${inr(j.laborProfit)}`, "green");
  };

  const handleUpdateJobStatus = (jobId: string, newStatus: any) => {
    const j = db.jobs.find((x) => x.id === jobId);
    if (!j) return;
    j.status = newStatus;
    if (newStatus === "Delivered") {
      j.deliveredDate = todayStr();
      j.deliveryPaymentMethod = "Cash";
    }
    saveState({ ...db });
    showToast(`Job ${j.jobNo} updated to ${newStatus}`, "green");
  };

  // Part 2: hide galla/sales history recorded before the staff member's
  // current access grant. Product catalog (A-Z) is intentionally never
  // filtered — only sales/returns/cash entries. Owner/manager always see
  // everything, regardless of `visibility_from`.
  const staffVisibilityFrom =
    cloudProfile?.role === "staff" && cloudProfile?.visibility_from ? new Date(cloudProfile.visibility_from).getTime() : null;
  const saleTimestamp = (s: Sale) => new Date(`${s.date}T${s.time || "00:00"}:00`).getTime();
  const isVisibleToCurrentUser = (ts: number) => staffVisibilityFrom === null || ts >= staffVisibilityFrom;
  const visibleSales = staffVisibilityFrom === null ? db.sales : db.sales.filter((s) => isVisibleToCurrentUser(saleTimestamp(s)));
  const visibleReturns =
    staffVisibilityFrom === null ? db.returns : db.returns.filter((r) => isVisibleToCurrentUser(new Date(`${r.date}T${r.time || "00:00"}:00`).getTime()));
  const visibleXeroxEntries =
    staffVisibilityFrom === null
      ? db.xeroxEntries || []
      : (db.xeroxEntries || []).filter((x) => isVisibleToCurrentUser(new Date(`${x.date}T${x.time || "00:00"}:00`).getTime()));

  // Part 3: owner correction window. A sale can be cancelled/corrected only
  // within `saleCorrectionWindowDays` days of when it was created; after
  // that it is permanently locked (no edits, no cancellation) so historic
  // accounts never silently change.
  const correctionWindowMs = (db.settings.saleCorrectionWindowDays ?? 10) * 24 * 60 * 60 * 1000;
  const isSaleWithinCorrectionWindow = (s: Sale) => {
    const createdMs = s.createdAt ? new Date(s.createdAt).getTime() : saleTimestamp(s);
    return Date.now() - createdMs <= correctionWindowMs;
  };

  const handleCancelSale = (s: Sale) => {
    if (!ownerMode) return;
    if (s.status === "Cancelled") return;
    if (!isSaleWithinCorrectionWindow(s)) {
      showToast("Correction window khatam ho chuka hai — ye sale ab permanently locked hai.", "red");
      return;
    }
    const reason = window.prompt(`Invoice ${s.invoiceNo} cancel karne ki wajah likho (galat item, galat rate, duplicate, etc.):`);
    if (reason === null) return; // user cancelled the prompt
    const updated: Database = structuredClone(db);
    const sale = updated.sales.find((x) => x.id === s.id);
    if (!sale) return;

    // Reverse stock for every line item.
    sale.items.forEach((item) => {
      const prod = updated.products.find((p) => p.id === item.productId);
      if (prod) {
        prod.stock += item.qty;
        (item.selectedImeis || []).forEach((imeiStr: string) => {
          const unit = (prod.units || []).find((u) => u.imei1 === imeiStr);
          if (unit && unit.status === "Sold") unit.status = "In Stock";
          const regUnit = (updated.imeiRegistry || []).find((u) => u.imei1 === imeiStr);
          if (regUnit && regUnit.status === "Sold") regUnit.status = "In Stock";
        });
      }
    });

    // Reverse the customer's outstanding due, if this sale had added any.
    if (sale.customerId && sale.dueAmount > 0) {
      const cust = updated.customers.find((c) => c.id === sale.customerId);
      if (cust) cust.totalDue = round2(Math.max(0, (cust.totalDue || 0) - sale.dueAmount));
    }
    // Reverse loyalty points this sale had earned.
    if (sale.customerId) {
      const cust = updated.customers.find((c) => c.id === sale.customerId);
      const earned = (cust?.loyaltyHistory || []).find((h: any) => h.invoiceNo === sale.invoiceNo && h.reason === "Sale");
      if (cust && earned) {
        cust.loyaltyPoints = Math.max(0, (cust.loyaltyPoints || 0) - earned.points);
        cust.loyaltyHistory = (cust.loyaltyHistory || []).filter((h: any) => !(h.invoiceNo === sale.invoiceNo && h.reason === "Sale"));
      }
    }

    sale.status = "Cancelled";
    sale.cancelledAt = new Date().toISOString();
    sale.cancelledBy = cloudProfile?.full_name || cloudProfile?.staff_name || "Owner";
    sale.cancelReason = reason || "(no reason given)";
    saveState(updated);
    showToast(`Invoice ${s.invoiceNo} cancel kar diya — stock wapas add ho gaya.`, "amber");
  };

  const [correctionTarget, setCorrectionTarget] = useState<Sale | null>(null);
  const [correctionForm, setCorrectionForm] = useState({ payment: "", amountPaid: 0, dueAmount: 0, note: "" });

  // Customer khata (udhaar) payment collection — previously there was no way
  // to record a partial payment against a customer's due outside of editing
  // a specific sale's payment fields. This writes straight to db.customers
  // (same trust model as everywhere else: local write is instant/authoritative)
  // and mirrors the payment to the customer_payments cloud table in the
  // background so it isn't lost if the device is lost/reinstalled.
  const [khataPaymentTarget, setKhataPaymentTarget] = useState<Customer | null>(null);
  const [khataPaymentForm, setKhataPaymentForm] = useState({ amount: 0, method: "Cash" as "Cash" | "UPI" | "Bank Transfer", note: "" });

  const handleRecordKhataPayment = () => {
    if (!khataPaymentTarget) return;
    const amt = Number(khataPaymentForm.amount);
    if (!amt || amt <= 0) {
      showToast("Sahi payment amount daalein", "red");
      return;
    }
    const updated: Database = structuredClone(db);
    const cust = updated.customers.find((c) => c.id === khataPaymentTarget.id);
    if (!cust) return;
    cust.totalDue = round2(Math.max(0, (cust.totalDue || 0) - amt));
    if (!cust.payments) cust.payments = [];
    cust.payments.push({ date: todayStr(), amount: amt, note: khataPaymentForm.note, method: khataPaymentForm.method });
    saveState(updated);
    queueOfflineOperation("customer", "customer_payments", {
      kind: "payment",
      payment: { customerId: cust.id, customerName: cust.name, customerPhone: cust.phone, amount: amt, method: khataPaymentForm.method, note: khataPaymentForm.note },
    }).catch(() => {});
    showToast(`${inr(amt)} payment ${cust.name} se record ho gayi`, "green");
    setKhataPaymentTarget(null);
    setKhataPaymentForm({ amount: 0, method: "Cash", note: "" });
  };

  const openCorrectionModal = (s: Sale) => {
    setCorrectionTarget(s);
    setCorrectionForm({ payment: s.payment, amountPaid: s.amountPaid, dueAmount: s.dueAmount, note: "" });
  };

  const handleSaveCorrection = () => {
    if (!correctionTarget) return;
    if (!isSaleWithinCorrectionWindow(correctionTarget)) {
      showToast("Correction window khatam ho chuka hai — ye sale ab permanently locked hai.", "red");
      setCorrectionTarget(null);
      return;
    }
    const updated: Database = structuredClone(db);
    const sale = updated.sales.find((x) => x.id === correctionTarget.id);
    if (!sale) return;
    const dueDelta = round2(correctionForm.dueAmount - sale.dueAmount);
    if (sale.customerId && dueDelta !== 0) {
      const cust = updated.customers.find((c) => c.id === sale.customerId);
      if (cust) cust.totalDue = round2(Math.max(0, (cust.totalDue || 0) + dueDelta));
    }
    sale.payment = correctionForm.payment;
    sale.amountPaid = correctionForm.amountPaid;
    sale.dueAmount = correctionForm.dueAmount;
    sale.status = sale.dueAmount <= 0.005 ? "Paid" : sale.amountPaid > 0 ? "Partial" : "Due";
    sale.editedAt = new Date().toISOString();
    sale.editedBy = cloudProfile?.full_name || cloudProfile?.staff_name || "Owner";
    sale.editHistory = [
      ...(sale.editHistory || []),
      { at: sale.editedAt, by: sale.editedBy, note: correctionForm.note || "Payment/amount correction" },
    ];
    saveState(updated);
    showToast(`Invoice ${sale.invoiceNo} correct kar diya.`, "green");
    setCorrectionTarget(null);
  };

  // Render main page
  const renderCurrentPage = () => {
    switch (currentPage) {
      case "dashboard": {
        const todaySales = visibleSales.filter((s) => s.date === todayStr());
        const grossSalesRev = todaySales.reduce((a, s) => a + s.total, 0);
        const grossSalesCost = todaySales.reduce((a, s) => a + s.items.reduce((x, i) => x + i.cost, 0), 0);
        const returnsToday = visibleReturns.filter((r) => r.date === todayStr());
        const refundAmtToday = returnsToday.reduce((a, r) => a + r.subtotalRefund, 0);
        const todayNetSales = round2(grossSalesRev - refundAmtToday);
        const lowStock = db.products.filter((p) => p.stock <= p.minStock);
        const totalDue = db.customers.reduce((a, c) => a + (c.totalDue || 0), 0);
        const openJobs = db.jobs.filter((j) => j.status !== "Delivered").length;
        const totalPayables = db.suppliers.reduce((a, s) => a + (s.totalPayable || 0), 0);

        // Daily Galla Cash
        const todayCashSales = todaySales.filter((s) => !s.isFinance && s.payment === "Cash").reduce((a, s) => a + s.amountPaid, 0);
        const todayCashXerox = visibleXeroxEntries.filter((x) => x.date === todayStr() && x.paymentMethod === "Cash").reduce((a, x) => a + x.totalAmount, 0);
        const currentGallaEst = (db.settings.openingCashDefault || 5000) + todayCashSales + todayCashXerox;

        return (
          <div>
            {/* 4 Core Essential Metrics */}
            <div className="grid cols-4" style={{ marginBottom: "16px" }}>
              <div className="card accent fx-tilt">
                <h3>Today's Total Sales</h3>
                <div className="big blue">{inr(todayNetSales)}</div>
                <div className="foot">{todaySales.length} Bill(s) Generated Today</div>
              </div>
              <div className="card fx-tilt">
                <h3>Estimated Cash in Galla</h3>
                <div className="big green">{inr(currentGallaEst)}</div>
                <div className="foot">Opening + Cash Sales + Xerox</div>
              </div>
              <div className="card fx-tilt">
                <h3>Customer Udhaar</h3>
                <div className="big red">{inr(totalDue)}</div>
                <div className="foot">{db.customers.filter((c) => (c.totalDue || 0) > 0).length} Customers Pending</div>
              </div>
              <div className="card fx-tilt">
                <h3>Active Repairs</h3>
                <div className="big purple">{openJobs}</div>
                <div className="foot">Pending Delivery</div>
              </div>
            </div>

            <AiAdviceCard db={db} ownerMode={ownerMode} />

            {/* Simple 1-Touch Fast Counter Hub */}
            <div className="section" style={{ marginBottom: "16px" }}>
              <div className="section-head">
                <h2>⚡ 1-Tap Counter Actions</h2>
                <span style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 600 }}>Click any button to open instantly</span>
              </div>
              <div className="grid cols-4" style={{ gap: "12px" }}>
                {/* Step 6.2: Photo Stock Finder now sits immediately LEFT of
                    "New Bill" (POS) in this row, per the plan's explicit
                    "Dashboard, POS ke left mein" placement — it used to be
                    two tiles to the right of POS, which didn't satisfy that. */}
                <button
                  className="card fx-tilt"
                  onClick={() => setCurrentPage("photoFinder")}
                  style={{
                    padding: "16px",
                    background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span className="fx-icon-bounce" style={{ fontSize: "24px" }}>📷</span>
                    <span style={{ background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 800 }}>
                      Snap &amp; Sell
                    </span>
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 800 }}>Photo Stock Finder</div>
                  <div style={{ fontSize: "11px", opacity: 0.85, marginTop: "2px" }}>Snap any item, find it in stock, add to bill</div>
                </button>

                <button
                  className="card fx-tilt"
                  onClick={() => setCurrentPage("sell")}
                  style={{
                    padding: "16px",
                    background: "linear-gradient(135deg, var(--blue), var(--navy))",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span className="fx-icon-bounce" style={{ fontSize: "24px" }}>🛒</span>
                    <span style={{ background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 800 }}>
                      Fast POS
                    </span>
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 800 }}>New Bill</div>
                  <div style={{ fontSize: "11px", opacity: 0.85, marginTop: "2px" }}>Make customer invoice &amp; print</div>
                </button>

                <button
                  className="card fx-tilt"
                  onClick={() => setCurrentPage("xeroxGrid")}
                  style={{
                    padding: "16px",
                    background: "linear-gradient(135deg, #10b981, #047857)",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span className="fx-icon-bounce" style={{ fontSize: "24px" }}>🖨️</span>
                    <span style={{ background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 800 }}>
                      1-Tap
                    </span>
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 800 }}>Xerox &amp; Cyber ()</div>
                  <div style={{ fontSize: "11px", opacity: 0.85, marginTop: "2px" }}>Quick Xerox, Prints, PAN, Photos</div>
                </button>

                <button
                  className="card fx-tilt"
                  onClick={() => setIsGallaModalOpen(true)}
                  style={{
                    padding: "16px",
                    background: "linear-gradient(135deg, #f59e0b, #d97706)",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span className="fx-icon-bounce" style={{ fontSize: "24px" }}>💰</span>
                    <span style={{ background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 800 }}>
                      Day-End
                    </span>
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 800 }}>Galla Closing</div>
                  <div style={{ fontSize: "11px", opacity: 0.85, marginTop: "2px" }}>Cash note counter &amp; slips</div>
                </button>

                <button
                  className="card"
                  onClick={() => setCurrentPage("modelsearch")}
                  style={{ padding: "14px", cursor: "pointer", textAlign: "left" }}
                >
                  <div style={{ fontSize: "20px", marginBottom: "6px" }}>🔍</div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--ink)" }}>Glass &amp; Cover Finder</div>
                  <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Search tempered glass / cover rack</div>
                </button>

                <button
                  className="card"
                  onClick={() => requireOwner(() => setIsKycModalOpen(true))}
                  style={{ padding: "14px", cursor: "pointer", textAlign: "left" }}
                >
                  <div style={{ fontSize: "20px", marginBottom: "6px" }}>📱</div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--ink)" }}>2nd-Hand Buyback KYC</div>
                  <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Purchase old phone with legal proof</div>
                </button>

                <button
                  className="card"
                  onClick={() => setIsJobModalOpen(true)}
                  style={{ padding: "14px", cursor: "pointer", textAlign: "left" }}
                >
                  <div style={{ fontSize: "20px", marginBottom: "6px" }}>🔧</div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--ink)" }}>New Repair Ticket</div>
                  <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Create job card &amp; customer token</div>
                </button>

                <button
                  className="card"
                  onClick={() => setCurrentPage("khata")}
                  style={{ padding: "14px", cursor: "pointer", textAlign: "left" }}
                >
                  <div style={{ fontSize: "20px", marginBottom: "6px" }}>📒</div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--ink)" }}>Customer Khata ()</div>
                  <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>View pending balances &amp; WhatsApp</div>
                </button>

                {/* Dashboard "Add Stock" shortcut — opens the Add New Product
                    modal directly from here, so a new item/stock entry never
                    needs a detour through the Products page first. */}
                {ownerMode && (
                  <button
                    className="card fx-tilt"
                    onClick={() => requireOwner(() => setIsAddProductOpen(true))}
                    style={{
                      padding: "16px",
                      background: "linear-gradient(135deg, #ec4899, #be185d)",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span className="fx-icon-bounce" style={{ fontSize: "24px" }}>📦</span>
                      <span style={{ background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 800 }}>
                        1-Tap
                      </span>
                    </div>
                    <div style={{ fontSize: "15px", fontWeight: 800 }}>Add Stock / Product</div>
                    <div style={{ fontSize: "11px", opacity: 0.85, marginTop: "2px" }}>Naya glass, cover ya item seedha yahin se add karein</div>
                  </button>
                )}
              </div>
            </div>

            {/* Low Stock Alerts & Recent Invoices */}
            <div className="grid cols-2" style={{ alignItems: "flex-start" }}>
              <div className="section">
                <div className="section-head">
                  <h2>Low Stock Alerts ({lowStock.length})</h2>
                  <button className="btn sm" onClick={() => setCurrentPage("products")}>Manage Stock</button>
                </div>
                {lowStock.length === 0 ? (
                  <div className="empty">All inventory levels are healthy! 👍</div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Product</th><th>Category</th><th>Stock</th><th>Alert</th></tr>
                      </thead>
                      <tbody>
                        {lowStock.map((p) => (
                          <tr key={p.id}>
                            <td><b>{p.name}</b></td>
                            <td>{p.category}</td>
                            <td style={{ color: "var(--red)", fontWeight: 800 }}>{p.stock}</td>
                            <td><span className="badge low">Min: {p.minStock}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="section">
                <div className="section-head">
                  <h2>Recent Invoices</h2>
                  <button className="btn sm" onClick={() => setCurrentPage("invoices")}>View All</button>
                </div>
                {visibleSales.length === 0 ? (
                  <div className="empty">No sales recorded yet.</div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Invoice</th><th>Customer</th><th>Total</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {visibleSales.slice(-6).reverse().map((s) => (
                          <tr key={s.id}>
                            <td>
                              <button
                                className="btn sm ghost"
                                style={{ fontWeight: 800, padding: "2px 6px" }}
                                onClick={() => {
                                  setViewingSale(s);
                                  setIsInvoiceViewerOpen(true);
                                }}
                              >
                                {s.invoiceNo}
                              </button>
                            </td>
                            <td>{s.customer?.name || "Walk-in"}</td>
                            <td><b>{inr(s.total)}</b></td>
                            <td><span className={`badge ${s.dueAmount > 0.005 ? "due" : "paid"}`}>{s.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      }

      case "sell": {
        const subtotal = cart.reduce((a, i) => a + i.price * i.qty, 0);
        const { taxAmount, total } = computeSaleTotals(subtotal, cartDiscount, db.settings.gstEnabled, db.settings.gstPercent);
        // Step 5.2 — "Add Gift" only makes sense once a Mobile (New) or
        // Second-Hand Mobile is actually in the bill, per the plan's own
        // scoping ("Mobile (New) aur Second-Hand Phone sale screens mein
        // 'Add Gift' button").
        const cartHasPhone = cart.some(
          (i) => i.isMobilePhone || i.category === "New Mobile" || i.category === "Second-Hand Mobile"
        );

        const CATEGORY_TABS = [
          { id: "ALL", label: "All Items ()" },
          { id: "Smartphones", label: "📱 Mobiles" },
          { id: "Tempered Glass", label: "🛡️ Glass" },
          { id: "Curved Glass", label: "🛡️✨ Curved Glass" },
          { id: "Back Covers", label: "📱 Covers" },
          { id: "Chargers & Cables", label: "🔌 Chargers" },
          { id: "Earphones & Audio", label: "🎧 Audio" },
          { id: "Cyber & Xerox", label: "🖨️ Cyber/Xerox" },
        ];

        const filteredProds = db.products.filter((p) => {
          if (p.stock <= 0) return false;
          if (sellCategoryFilter !== "ALL") {
            if (sellCategoryFilter === "Cyber & Xerox") {
              if (p.category !== "Cyber & Xerox" && p.category !== "Services") return false;
            } else if (p.category !== sellCategoryFilter) {
              return false;
            }
          }
          if (sellSearchQuery) {
            const q = sellSearchQuery.toLowerCase();
            return (
              naturalMatch(p.name, sellSearchQuery) ||
              naturalMatch(p.brand, sellSearchQuery) ||
              naturalMatch(p.category, sellSearchQuery) ||
              p.sku.toLowerCase().includes(q) ||
              (p.barcode || "").toLowerCase().includes(q) ||
              (p.units || []).some((u) => u.imei1.includes(q))
            );
          }
          return true;
        });

        return (
          <div className="grid cols-2" style={{ alignItems: "flex-start", gap: "16px" }}>
            {/* Catalog Selection */}
            <div className="section">
              <div className="section-head">
                <h2>Product Catalog</h2>
                <button className="btn sm" onClick={() => setIsCameraScannerOpen(true)}>
                  <Camera size={14} /> Scan Barcode / IMEI
                </button>
              </div>

              {/* 1-Tap Category Filter Chips */}
              <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "8px", marginBottom: "8px" }}>
                {CATEGORY_TABS.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSellCategoryFilter(cat.id)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "999px",
                      fontSize: "11.5px",
                      fontWeight: 700,
                      border: "1px solid",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      background: sellCategoryFilter === cat.id ? "var(--accent)" : "var(--paper)",
                      color: sellCategoryFilter === cat.id ? "#ffffff" : "var(--ink)",
                      borderColor: sellCategoryFilter === cat.id ? "var(--accent)" : "var(--line)",
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="searchbar">
                <input
                  placeholder="🔍 Type product name, brand, model, SKU or scan IMEI..."
                  value={sellSearchQuery}
                  onChange={(e) => setSellSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>

              <div style={{ maxHeight: "420px", overflowY: "auto" }}>
                {filteredProds.length === 0 ? (
                  <div className="empty">No in-stock products found matching query.</div>
                ) : (
                  filteredProds.map((p) => (
                    <div key={p.id} className="cart-line">
                      <div className="nm">
                        <b>{p.name}</b> <span className="hint">({p.category})</span>
                        <div className="hint">
                          Stock: <b style={{ color: p.stock <= p.minStock ? "var(--red)" : "inherit" }}>{p.stock}</b> • {inr(p.sellingPrice)}
                          {p.warrantyEnabled ? ` • ${p.warrantyMonths}m Warranty` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        {!ownerMode && (
                          <button
                            className="btn sm ghost"
                            title="Confidential Price maangein (Owner approval zaroori)"
                            onClick={() => setConfidentialPriceProduct(p)}
                          >
                            🔒
                          </button>
                        )}
                        <button className="btn sm primary" onClick={() => addToCart(p)}>
                          + Add to Bill
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Current Cart */}
            <div className="section">
              <div className="section-head">
                <h2>Current Bill Cart ({cart.reduce((a, i) => a + i.qty, 0)} Items)</h2>
                <div style={{ display: "flex", gap: "8px" }}>
                  {cartHasPhone && (
                    <button className="btn sm" onClick={() => setIsAddGiftOpen(true)} title="Poore stock mein se koi bhi product search karke customer ko free gift ke roop mein add karein">
                      <Gift size={13} /> Add Gift
                    </button>
                  )}
                  {cart.length > 0 && (
                    <button className="btn sm ghost" onClick={() => setCart([])}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {cart.length === 0 ? (
                <div className="empty">Cart is empty. Click "+ Add" on items to create an invoice.</div>
              ) : (
                <div>
                  <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                    {cart.map((item, idx) => {
                      const prod = db.products.find((p) => p.id === item.productId);
                      const priceFloor = prod?.confidentialPrice ?? prod?.purchasePrice ?? 0;
                      const belowFloor = !item.isGift && !ownerMode && priceFloor > 0 && item.price < priceFloor;
                      return (
                        <div key={idx} className="cart-line">
                          <div className="nm">
                            <b>{item.name}</b>
                            {item.isGift && (
                              <div style={{ fontSize: "11px", fontWeight: 800, color: "var(--green)" }}>
                                🎁 Complimentary Gift{item.mrp ? ` — MRP ${inr(item.mrp)}` : ""}
                              </div>
                            )}
                            {item.selectedImeis && item.selectedImeis.length > 0 && (
                              <div style={{ fontSize: "11px", color: "var(--navy)" }}>
                                IMEI: <b>{item.selectedImeis.join(", ")}</b>
                              </div>
                            )}
                          </div>
                          {item.isGift ? (
                            <div style={{ width: "100px" }}>
                              <div
                                style={{
                                  padding: "6px 8px",
                                  fontSize: "13px",
                                  fontWeight: 800,
                                  color: "var(--green)",
                                  border: "1px solid var(--green-border, var(--line))",
                                  background: "var(--green-light)",
                                  borderRadius: "6px",
                                  textAlign: "center",
                                }}
                              >
                                FREE
                              </div>
                              <div className="hint" style={{ fontSize: "10px", marginTop: "2px" }}>gift — ₹0</div>
                            </div>
                          ) : (
                            <div style={{ width: "100px" }}>
                              <input
                                type="number"
                                min="0"
                                value={item.price}
                                onChange={(e) => updateCartPrice(idx, e.target.value)}
                                style={{
                                  width: "100%",
                                  padding: "6px 8px",
                                  fontSize: "13px",
                                  fontWeight: 700,
                                  borderRadius: "6px",
                                  border: `1px solid ${belowFloor ? "var(--red)" : "var(--line)"}`,
                                }}
                              />
                              {belowFloor ? (
                                <div style={{ fontSize: "10px", color: "var(--red)", marginTop: "2px" }}>
                                  Min {inr(priceFloor)}
                                </div>
                              ) : (
                                <div className="hint" style={{ fontSize: "10px", marginTop: "2px" }}>each</div>
                              )}
                            </div>
                          )}
                          <button className="qtybtn" onClick={() => updateCartQty(idx, -1)}>-</button>
                          <span className="qtyval">{item.qty}</span>
                          <button className="qtybtn" onClick={() => updateCartQty(idx, 1)}>+</button>
                          <button className="btn sm danger" onClick={() => setCart(cart.filter((_, i) => i !== idx))}>
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: "14px", background: "var(--paper)", padding: "12px", borderRadius: "8px" }}>
                    <div className="kv"><span>Subtotal</span><b>{inr(subtotal)}</b></div>
                    {db.settings.gstEnabled && (
                      <div className="kv">
                        <span>GST ({db.settings.gstPercent}%)</span>
                        <b>{inr(taxAmount)}</b>
                      </div>
                    )}
                    <div className="kv" style={{ fontSize: "16px", fontWeight: 800 }}>
                      <span>Net Grand Total:</span>
                      <b style={{ color: "var(--blue)" }}>{inr(total)}</b>
                    </div>

                    <div className="field" style={{ marginTop: "10px" }}>
                      <label>Payment Mode</label>
                      <select
                        value={paymentMode}
                        onChange={(e) => {
                          setPaymentMode(e.target.value);
                          setIsFinanceMode(e.target.value === "Mobile Finance / EMI");
                        }}
                      >
                        <option>Cash</option>
                        <option>UPI</option>
                        <option>Card</option>
                        <option>Bank Transfer</option>
                        <option>Credit / Udhaar</option>
                        <option>Mobile Finance / EMI</option>
                      </select>
                    </div>

                    {isFinanceMode && (
                      <div style={{ background: "var(--blue-light)", padding: "10px", borderRadius: "6px", marginTop: "10px" }}>
                        <div style={{ fontWeight: 800, fontSize: "12.5px", marginBottom: "6px", color: "var(--navy)" }}>
                          💳 Mobile Finance (0% EMI) Breakdown
                        </div>
                        <div className="formgrid">
                          <div className="field">
                            <label>Finance Company</label>
                            <select
                              value={financeForm.company}
                              onChange={(e) => setFinanceForm({ ...financeForm, company: e.target.value as any })}
                            >
                              <option>Bajaj Finserv</option>
                              <option>TVS Credit</option>
                              <option>Home Credit</option>
                              <option>HDB Financial</option>
                              <option>Samsung Finance+</option>
                              <option>DMI Finance</option>
                            </select>
                          </div>
                          <div className="field">
                            <label>Down Payment (Collected at Counter)</label>
                            <input
                              type="number"
                              min="0"
                              value={financeForm.downPayment || ""}
                              onChange={(e) => setFinanceForm({ ...financeForm, downPayment: Number(e.target.value) })}
                              placeholder="e.g. 2000"
                            />
                          </div>
                          <div className="field">
                            <label>Loan Account No / Deal ID</label>
                            <input
                              placeholder="e.g. BFL8920194"
                              value={financeForm.loanAccountNo}
                              onChange={(e) => setFinanceForm({ ...financeForm, loanAccountNo: e.target.value })}
                            />
                          </div>
                          <div className="field">
                            <label>DBD / Dealer Subvention (₹)</label>
                            <input
                              type="number"
                              min="0"
                              value={financeForm.dbdAmount || ""}
                              onChange={(e) => setFinanceForm({ ...financeForm, dbdAmount: Number(e.target.value) })}
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <button
                      className="btn primary"
                      style={{ width: "100%", marginTop: "14px", padding: "12px", fontSize: "14.5px" }}
                      onClick={handleStartCheckout}
                    >
                      <CheckCircle2 size={16} /> Complete Checkout &amp; Print Bill ({inr(total)})
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

      case "imeiTracker":
        return <ImeiAuditView db={db} onUpdate={() => saveState({ ...db })} toast={showToast} ownerMode={ownerMode} onViewInvoiceByNo={(invNo) => {
          const s = db.sales.find((x) => x.invoiceNo === invNo);
          if (s) {
            setViewingSale(s);
            setIsInvoiceViewerOpen(true);
          }
        }} />;

      case "secondHandKyc":
        return (
          <div className="section">
            <div className="section-head">
              <h2>2nd-Hand Phone Buyback &amp; Legal KYC Studio</h2>
              <button className="btn primary sm" onClick={() => { setViewingKyc(null); setIsKycModalOpen(true); }}>
                <Plus size={14} /> Buy Used Phone from Customer (New KYC)
              </button>
            </div>
            <p className="hint" style={{ marginBottom: "14px" }}>
              Log genuine used phone purchases with Seller ID proof, IMEI tracking, and generate printable Legal Undertaking vouchers.
            </p>

            <div className="table-wrap">
              {db.secondHandKYCs.length === 0 ? (
                <div className="empty">No 2nd-hand buyback vouchers recorded yet. Click above to register one.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Voucher #</th>
                      <th>Date</th>
                      <th>Seller Name</th>
                      <th>Seller Phone</th>
                      <th>Device Model</th>
                      <th>IMEI 1</th>
                      <th>Condition</th>
                      <th>Amount Paid</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {db.secondHandKYCs.slice().reverse().map((k) => (
                      <tr key={k.id}>
                        <td><b>{k.voucherNo}</b></td>
                        <td>{k.date}</td>
                        <td><b>{k.sellerName}</b></td>
                        <td>{k.sellerPhone}</td>
                        <td>{k.brand} {k.modelName}</td>
                        <td><b style={{ color: "var(--navy)" }}>{k.imei1}</b></td>
                        <td><span className="badge ok">{k.conditionGrade}</span></td>
                        <td style={{ fontWeight: 800 }}>{inr(k.purchaseAmountPaid)}</td>
                        <td>
                          <button
                            className="btn sm"
                            onClick={() => {
                              setViewingKyc(k);
                              setIsKycModalOpen(true);
                            }}
                          >
                            <FileText size={12} /> View / Print Voucher
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );

      case "xeroxGrid":
        return <XeroxGrid db={db} onUpdate={() => saveState({ ...db })} toast={showToast} ownerMode={ownerMode} />;

      case "simTracker":
        return <SimTrackerView db={db} onUpdate={() => saveState({ ...db })} toast={showToast} />;

      case "financeLedger":
        return (
          <FinanceTrackerView
            db={db}
            onUpdate={() => saveState({ ...db })}
            toast={showToast}
            onViewInvoice={(s) => {
              setViewingSale(s);
              setIsInvoiceViewerOpen(true);
            }}
          />
        );

      case "supplierKhata":
        return <SupplierKhataView db={db} onUpdate={() => saveState({ ...db })} toast={showToast} />;

      case "labels":
        return <BarcodeTagStudio db={db} />;

      case "products":
        return (
          <div>
            <div className="section">
              <div className="section-head">
                <h2>Product Catalog &amp; Inventory ({db.products.length})</h2>
                <div style={{ display: "flex", gap: "8px" }}>
                  {ownerMode ? (
                    <>
                      <button className="btn primary sm" onClick={() => setIsAddProductOpen(true)}>
                        <Sparkles size={14} /> + Add New Item (AI Photo Scan)
                      </button>
                      <button className="btn sm" onClick={() => setCurrentPage("photoFinder")}>
                        <Camera size={14} /> Photo Stock Finder — Snap &amp; Sell
                      </button>
                    </>
                  ) : (
                    <span className="hint" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <Lock size={12} /> Naya product / price sirf owner add-edit kar sakte hain
                    </span>
                  )}
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Product Name</th>
                      <th>Category</th>
                      <th>Brand</th>
                      <th>SKU</th>
                      <th>Barcode</th>
                      {ownerMode && <th>Cost</th>}
                      {ownerMode && <th>Confidential</th>}
                      <th>Selling Price</th>
                      <th>MRP</th>
                      <th>Discount %</th>
                      <th>Stock</th>
                      <th>Warranty</th>
                      {ownerMode && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {db.products.map((p) => (
                      <tr key={p.id}>
                        <td><ProductThumb photo={p.photo} name={p.name} /></td>
                        <td><b>{p.name}</b></td>
                        <td>{p.category}</td>
                        <td>{p.brand || "—"}</td>
                        <td className="hint">{p.sku}</td>
                        <td className="hint">{p.barcode || "—"}</td>
                        {ownerMode && <td>{inr(p.purchasePrice)}</td>}
                        {ownerMode && <td className="hint">{p.confidentialPrice ? inr(p.confidentialPrice) : "—"}</td>}
                        <td><b>{inr(p.sellingPrice)}</b></td>
                      <td className="hint">{p.mrp ? inr(p.mrp) : "—"}</td>
                      <td>
                        {(() => {
                          if (p.category === "Cyber Cafe") return <span className="hint">—</span>;
                          const pct = computeDiscountPercent(p.mrp, p.sellingPrice);
                          if (pct === null) return <span className="hint">—</span>;
                          return <span className="badge ok">{pct}%</span>;
                        })()}
                      </td>
                        <td>
                          <b style={{ color: p.stock <= p.minStock ? "var(--red)" : "var(--green)" }}>
                            {p.stock}
                          </b>
                        </td>
                        <td>{p.warrantyEnabled ? `${p.warrantyMonths}m` : "None"}</td>
                        {ownerMode && (
                          <td>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              <button
                                className="btn sm"
                                onClick={() => { setEditingProduct(p); setIsEditProductOpen(true); }}
                              >
                                <Pencil size={12} /> Edit Price
                              </button>
                              <button
                                className="btn sm danger"
                                onClick={() => void handleDeleteProduct(p)}
                                title="Product permanently delete karo (photo bhi cloud se hat jayegi)"
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );

      case "invoices":
        return (
          <div className="section">
            <div className="section-head">
              <h2>All Invoices ({visibleSales.length})</h2>
            </div>
            <div className="table-wrap">
              {visibleSales.length === 0 ? (
                <div className="empty">No invoices recorded yet.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Items</th>
                      <th>Payment</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSales.slice().reverse().map((s) => (
                      <tr key={s.id}>
                        <td><b>{s.invoiceNo}</b></td>
                        <td>{s.date}</td>
                        <td>{s.customer?.name || "Walk-in"}</td>
                        <td>{s.items.length}</td>
                        <td>{s.payment}</td>
                        <td><b>{inr(s.total)}</b></td>
                        <td>
                          <span className={`badge ${s.status === "Cancelled" ? "red" : s.dueAmount > 0.005 ? "due" : "paid"}`}>{s.status}</span>
                          {s.status !== "Cancelled" && (
                            <div className="hint">
                              {isSaleWithinCorrectionWindow(s) ? "Editable" : "🔒 Locked"}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            <button
                              className="btn sm primary"
                              onClick={() => {
                                setViewingSale(s);
                                setIsInvoiceViewerOpen(true);
                              }}
                            >
                              View / Print
                            </button>
                            {s.customer?.phone && (
                              <button
                                className="btn sm blue"
                                onClick={() => {
                                  const ok = openWhatsApp(s.customer!.phone, buildInvoiceMessage(s, db.settings));
                                  if (!ok) showToast("Invalid customer phone number.", "red");
                                }}
                              >
                                WhatsApp
                              </button>
                            )}
                            {ownerMode && s.status !== "Cancelled" && isSaleWithinCorrectionWindow(s) && (
                              <>
                                <button className="btn sm" onClick={() => openCorrectionModal(s)}>Correct Amount</button>
                                <button className="btn sm danger" onClick={() => handleCancelSale(s)}>Cancel Sale</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );

      case "khata":
        return (
          <div className="section">
            <div className="section-head">
              <h2>Customer Udhaar (Khata) Ledger</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer Name</th>
                    <th>Phone</th>
                    <th>Address</th>
                    <th>Outstanding Due</th>
                    <th>Status</th>
                    <th>Collect Payment</th>
                    <th>Remind</th>
                  </tr>
                </thead>
                <tbody>
                  {db.customers.map((c) => (
                    <tr key={c.id}>
                      <td><b>{c.name}</b></td>
                      <td>{c.phone}</td>
                      <td>{c.address || "—"}</td>
                      <td style={{ fontWeight: 800, color: c.totalDue > 0 ? "var(--red)" : "var(--green)" }}>
                        {inr(c.totalDue)}
                      </td>
                      <td><span className={`badge ${c.totalDue > 0 ? "due" : "paid"}`}>{c.totalDue > 0 ? "DUE" : "CLEAR"}</span></td>
                      <td>
                        {c.totalDue > 0 && (
                          <button
                            className="btn sm primary"
                            onClick={() => {
                              setKhataPaymentTarget(c);
                              setKhataPaymentForm({ amount: c.totalDue, method: "Cash", note: "" });
                            }}
                          >
                            Collect
                          </button>
                        )}
                      </td>
                      <td>
                        {c.totalDue > 0 && (
                          <button
                            className="btn sm blue"
                            onClick={() => {
                              const ok = openWhatsApp(c.phone, buildDueReminderMessage(c, db.settings));
                              if (!ok) showToast("Invalid phone number for this customer.", "red");
                            }}
                          >
                            WhatsApp
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {khataPaymentTarget && (
              <div className="overlay show">
                <div className="modal">
                  <div className="modal-head">
                    <h3>Record Payment — {khataPaymentTarget.name}</h3>
                    <button onClick={() => setKhataPaymentTarget(null)}>&times;</button>
                  </div>
                  <div className="kv" style={{ marginBottom: "14px" }}>
                    <span>Current Outstanding Due</span>
                    <b style={{ color: "var(--red)", fontSize: "16px" }}>{inr(khataPaymentTarget.totalDue || 0)}</b>
                  </div>
                  <div className="formgrid">
                    <div className="field">
                      <label>Payment Amount (₹) <span className="req">*</span></label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={khataPaymentForm.amount || ""}
                        onChange={(e) => setKhataPaymentForm({ ...khataPaymentForm, amount: Number(e.target.value) })}
                        required
                      />
                    </div>
                    <div className="field">
                      <label>Payment Method</label>
                      <select
                        value={khataPaymentForm.method}
                        onChange={(e) => setKhataPaymentForm({ ...khataPaymentForm, method: e.target.value as any })}
                      >
                        <option>Cash</option>
                        <option>UPI</option>
                        <option>Bank Transfer</option>
                      </select>
                    </div>
                    <div className="field full">
                      <label>Note (optional)</label>
                      <input
                        value={khataPaymentForm.note}
                        onChange={(e) => setKhataPaymentForm({ ...khataPaymentForm, note: e.target.value })}
                        placeholder="e.g. Paid via Google Pay"
                      />
                    </div>
                  </div>
                  <div className="modal-actions" style={{ marginTop: "16px" }}>
                    <button className="btn" onClick={() => setKhataPaymentTarget(null)}>Cancel</button>
                    <button className="btn success" onClick={handleRecordKhataPayment}>
                      Confirm &amp; Save Payment
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case "customerDirectory":
        return <CustomerDirectoryView db={db} toast={showToast} />;

      case "jobs":
        return (
          <div>
            <div className="section">
              <div className="section-head">
                <h2>Repair &amp; Service Jobs</h2>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    className="btn sm"
                    onClick={() => { setJobForm({ ...jobForm, serviceType: "pattern_pin", issue: MOBILE_LOCK_SERVICES[0].label, estCost: MOBILE_LOCK_SERVICES[0].defaultPrice }); setIsJobModalOpen(true); }}
                  >
                    🔓 Unlock / FRP Job
                  </button>
                  <button className="btn primary sm" onClick={() => setIsJobModalOpen(true)}>
                    <Plus size={14} /> New Repair Ticket
                  </button>
                </div>
              </div>

              <div className="grid cols-3" style={{ gap: "12px" }}>
                {db.jobs.map((j) => (
                  <div key={j.id} className="job-card">
                    <div className="jc-head">
                      <div>
                        <div className="jc-num">{j.jobNo}</div>
                        <div className="hint">{j.receivedDate}</div>
                      </div>
                      <span className={`badge ${j.status === "Delivered" ? "ok" : "partial"}`}>{j.status}</span>
                    </div>
                    {j.serviceType && (
                      <span className="badge" style={{ background: "var(--red-light, #fee2e2)", color: "var(--red, #dc2626)", marginTop: "6px", display: "inline-block" }}>
                        🔓 {MOBILE_LOCK_SERVICES.find((s) => s.key === j.serviceType)?.label || "Unlock Service"}
                      </span>
                    )}
                    <div style={{ marginTop: "8px" }}>
                      <b>{j.customerName}</b> • {j.phone}
                    </div>
                    <div className="hint">{j.device}</div>
                    <div style={{ fontSize: "12.5px", marginTop: "4px" }}>{j.issue}</div>
                    <div className="hint" style={{ marginTop: "6px" }}>
                      Est: {inr(j.estCost)} • Advance: {inr(j.advance)}
                    </div>
                    {ownerMode && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 800, color: (j.laborProfit || 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                          Profit: {inr(j.laborProfit || 0)}
                          {(j.otherCost || 0) > 0 && <span className="hint" style={{ fontWeight: 500 }}> (other cost {inr(j.otherCost)})</span>}
                        </span>
                        <button
                          className="btn sm ghost"
                          type="button"
                          onClick={() => openJobCostEditor(j)}
                          title="Charge / cost edit karein"
                          style={{ display: "flex", alignItems: "center", gap: "4px" }}
                        >
                          <Pencil size={11} /> Edit Cost
                        </button>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                      <select
                        className="job-status-select"
                        value={j.status}
                        onChange={(e) => handleUpdateJobStatus(j.id, e.target.value)}
                      >
                        <option>Received</option>
                        <option>In Progress</option>
                        <option>Ready</option>
                        <option>Delivered</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case "gallaClosing":
        return (
          <div>
            <div className="section">
              <div className="section-head">
                <h2>Daily Galla (Cash Drawer) Closings</h2>
                <button className="btn primary sm" onClick={() => setIsGallaModalOpen(true)}>
                  <DollarSign size={14} /> Close &amp; Count Today's Galla
                </button>
              </div>
              <div className="table-wrap">
                {(!db.gallaClosings || db.gallaClosings.length === 0) ? (
                  <div className="empty">No daily galla closings logged yet. Click above to close today's cash drawer.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Closed At</th>
                        <th>Opening Cash</th>
                        <th>Cash Sales &amp; Xerox</th>
                        <th>Cash Expenses</th>
                        <th>Expected Cash</th>
                        <th>Actual Cash</th>
                        <th>Overage / Shortage</th>
                        <th>Online Received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {db.gallaClosings.slice().reverse().map((g) => (
                        <tr key={g.id}>
                          <td><b>{g.date}</b></td>
                          <td>{g.closedAt}</td>
                          <td>{inr(g.openingCash)}</td>
                          <td>+{inr(g.cashSales + g.cashXeroxTotal + g.cashKhataCollected)}</td>
                          <td>-{inr(g.cashExpensesPaid + g.cashSupplierPaid)}</td>
                          <td><b>{inr(g.expectedCash)}</b></td>
                          <td style={{ fontWeight: 800 }}>{inr(g.actualCashCounted)}</td>
                          <td style={{ fontWeight: 800, color: g.overageOrShortage === 0 ? "var(--green)" : "var(--red)" }}>
                            {g.overageOrShortage === 0 ? "✔ Exact Match" : `${g.overageOrShortage > 0 ? "+" : ""}${inr(g.overageOrShortage)}`}
                          </td>
                          <td>{g.onlinePaymentReceived !== undefined ? inr(g.onlinePaymentReceived) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );

      case "ownerreports":
        return <OwnerReportsView db={db} onUpdate={() => saveState({ ...db })} toast={showToast} />;

      case "exportClear":
        return (
          <ExportClearInvoicesView
            db={db}
            isSaleWithinCorrectionWindow={isSaleWithinCorrectionWindow}
            onClear={handleExportClearSales}
            toast={showToast}
          />
        );

      case "modelsearch":
        return (
          <ModelSearchView
            db={db}
            onAddToCart={(p) => {
              addToCart(p);
              showToast(`Added ${p.name} to cart!`, "green");
            }}
            onNavigateToPOS={() => setCurrentPage("sell")}
          />
        );

      case "photoFinder":
        return (
          <PhotoStockFinderView
            db={db}
            onAddToCart={(p) => {
              addToCart(p);
              showToast(`Added ${p.name} to cart!`, "green");
            }}
            onNavigateToPOS={() => setCurrentPage("sell")}
          />
        );

      case "returns":
        return (
          <ReturnsExchangesView
            db={db}
            storeId={cloudProfile?.store_id}
            onUpdate={() => saveState({ ...db })}
            toast={showToast}
          />
        );

      case "stockadjust":
        return (
          <StockAdjustView
            db={db}
            storeId={cloudProfile?.store_id}
            onUpdate={() => saveState({ ...db })}
            toast={showToast}
          />
        );

      case "purchases":
        return (
          <PurchasesView
            db={db}
            storeId={cloudProfile?.store_id}
            onUpdate={() => saveState({ ...db })}
            toast={showToast}
          />
        );

      case "saleshistory":
        return (
          <SalesHistoryView
            db={db}
            onViewInvoice={(s) => {
              setViewingSale(s);
              setIsInvoiceViewerOpen(true);
            }}
          />
        );

      case "dailyreview":
        return <DailyReviewView db={db} />;

      case "monthlyreview":
        return <MonthlyReviewView db={db} />;

      case "expShop":
        return (
          <ShopExpensesView
            db={db}
            onUpdate={() => saveState({ ...db })}
            toast={showToast}
          />
        );

      case "extraIncome":
        return (
          <ExtraIncomeView
            db={db}
            onUpdate={() => saveState({ ...db })}
            toast={showToast}
          />
        );

      case "expPersonal":
        return (
          <PersonalDrawingsView
            db={db}
            onUpdate={() => saveState({ ...db })}
            toast={showToast}
          />
        );



      case "staffAccess":
        return <StaffAccessView storeId={cloudProfile?.store_id} storeLoading={!cloudReady} toast={showToast} />;

      case "loanTracker":
        return (
          <LoanTrackerView
            db={db}
            onUpdate={() => saveState({ ...db })}
            toast={showToast}
          />
        );

      case "plDashboard":
        return <ProfitLossDashboardView db={db} />;

      case "lowstock":
        return <LowStockAlertsView db={db} showToast={showToast} />;

      case "downloadArea":
        return <DownloadAreaView db={db} isStaff={cloudProfile?.role === "staff"} showToast={showToast} />;

      case "loyalty":
        return (
          <LoyaltyRewardsView
            db={db}
            onRedeemPoints={handleRedeemLoyaltyPoints}
            onUpdateLoyaltySettings={handleUpdateLoyaltySettings}
            showToast={showToast}
          />
        );

      case "backup":
        return (
          <div className="section">
            <div className="section-head">
              <h2>Backup, Restore &amp; Standalone HTML Export</h2>
            </div>
            <p className="hint">
              You can export your database as JSON, restore backups, or download the self-contained Standalone HTML file that runs locally in any browser offline!
            </p>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "16px" }}>
              <button
                className="btn primary"
                onClick={() => exportStandaloneHtml(db)}
              >
                <Download size={16} /> ⬇ Export Standalone Production HTML (.html)
              </button>

              <button
                className="btn"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `dsmdh-backup-${todayStr()}.json`;
                  a.click();
                }}
              >
                <Download size={14} /> Download JSON Backup
              </button>
            </div>

            <div style={{ marginTop: "24px" }}>
              <label className="hint">Restore from JSON backup:</label>
              <br />
              <input
                type="file"
                accept="application/json"
                style={{ marginTop: "6px" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const r = new FileReader();
                  r.onload = () => {
                    try {
                      const parsed = JSON.parse(r.result as string);
                      saveState(parsed);
                      showToast("Database restored successfully!", "green");
                    } catch (err) {
                      showToast("Invalid JSON file", "red");
                    }
                  };
                  r.readAsText(file);
                }}
              />
            </div>
          </div>
        );

      case "statusDashboard":
        return (
          <StatusDashboardView
            storeId={cloudProfile?.store_id}
            storageLimitSupabaseMb={db.settings.storageLimitSupabaseMb}
            storageLimitCloudflareMb={db.settings.storageLimitCloudflareMb}
            onSaveStorageLimits={(supabaseLimitMb, cloudflareLimitMb) => {
              setDb({ ...db, settings: { ...db.settings, storageLimitSupabaseMb: supabaseLimitMb, storageLimitCloudflareMb: cloudflareLimitMb } });
              saveState({ ...db, settings: { ...db.settings, storageLimitSupabaseMb: supabaseLimitMb, storageLimitCloudflareMb: cloudflareLimitMb } });
              showToast("Storage plan limits saved.", "green");
            }}
          />
        );

      case "appearanceStudio":
        return <AppearanceStudioView />;

      case "setupWizard":
        return (
          <SetupWizardView
            db={db}
            storeId={cloudProfile?.store_id}
            telegramConnected={Boolean(telegramStatus?.connected)}
            onConnectTelegram={async () => {
              try {
                const d = await openTelegramConnection();
                showToast(`Open Telegram to connect @${d.username}`, "green");
                const started = Date.now();
                const timer = window.setInterval(async () => {
                  const st = await pollTelegramConnection();
                  setTelegramStatus(st);
                  if (st.connected || Date.now() - started > 620000) window.clearInterval(timer);
                }, 3000);
              } catch (e) {
                showToast(e instanceof Error ? e.message : String(e), "red");
              }
            }}
            onNavigate={(page) => setCurrentPage(page)}
            onOpenAddProduct={() => setIsAddProductOpen(true)}
            onMarkPricingUnderstood={() => {
              const updated = { ...db, settings: { ...db.settings, pricingTutorialSeen: true } };
              setDb(updated);
              saveState(updated);
            }}
            onDismiss={() => {
              const updated = { ...db, settings: { ...db.settings, setupWizardDismissed: true } };
              setDb(updated);
              saveState(updated);
              setCurrentPage("dashboard");
            }}
          />
        );

      case "appVersions":
        return <AppVersionsPanel storeId={cloudProfile?.store_id} storeLoading={!cloudReady} toast={showToast} />;

      case "settings":
        return (
          <div className="section">
            <div className="section-head">
              <h2>Store &amp; Security Settings</h2>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveState({ ...db });
                showToast("Settings saved successfully!", "green");
              }}
            >
              <div className="formgrid">
                <div className="field">
                  <label>Store Name</label>
                  <input
                    value={db.settings.shopName}
                    onChange={(e) => setDb({ ...db, settings: { ...db.settings, shopName: e.target.value } })}
                  />
                </div>
                <div className="field">
                  <label>Phone Number</label>
                  <input
                    value={db.settings.phone}
                    onChange={(e) => setDb({ ...db, settings: { ...db.settings, phone: e.target.value } })}
                  />
                </div>
                <div className="field full">
                  <label>Store Address</label>
                  <input
                    value={db.settings.address}
                    onChange={(e) => setDb({ ...db, settings: { ...db.settings, address: e.target.value } })}
                  />
                </div>
                <div className="field">
                  <label>UPI ID (For Instant QR Code on Bills)</label>
                  <input
                    value={db.settings.upiId}
                    onChange={(e) => setDb({ ...db, settings: { ...db.settings, upiId: e.target.value } })}
                    placeholder="e.g. storename@upi"
                  />
                </div>
                <div className="field">
                  <label>Owner Device PIN (Passcode)</label>
                  <input
                    type="password"
                    value={db.settings.ownerPasscode}
                    onChange={(e) => setDb({ ...db, settings: { ...db.settings, ownerPasscode: e.target.value } })}
                    placeholder="Khali chhodne par default 1234 chalega"
                  />
                  <span className="hint">
                    Ye sirf is counter/device par "Owner Confidential Area" jaldi kholne ka chhota PIN hai — aapka
                    Cloud account email/password isse bilkul alag cheez hai (neeche "Cloud Sign In" dekho, wahi
                    aapke data ko doosre devices ke saath sync karta hai). Shop shuru karte hi isko 1234 se badalke
                    apna khud ka PIN set kar lena chahiye.
                  </span>
                </div>
                <div className="field full">
                  <label>Invoice Terms &amp; Rules (printed on every bill)</label>
                  <textarea
                    rows={6}
                    value={db.settings.invoiceTerms}
                    onChange={(e) => setDb({ ...db, settings: { ...db.settings, invoiceTerms: e.target.value } })}
                    placeholder="One rule per line, e.g. No warranty on tempered glass..."
                  />
                </div>
                <div className="field full">
                  <label>Invoice Footer Message</label>
                  <input
                    value={db.settings.invoiceFooter}
                    onChange={(e) => setDb({ ...db, settings: { ...db.settings, invoiceFooter: e.target.value } })}
                  />
                </div>
                <div className="field">
                  <label>Sale Correction Window (days)</label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={db.settings.saleCorrectionWindowDays ?? 10}
                    onChange={(e) => setDb({ ...db, settings: { ...db.settings, saleCorrectionWindowDays: Math.max(0, Number(e.target.value)) } })}
                  />
                  <span className="hint">
                    Kitne din tak owner ek sale ko edit/cancel kar sakta hai (galti se galat sale hone par). Iske baad
                    wo sale permanently lock ho jaati hai. Default 10 din.
                  </span>
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px", justifyContent: "flex-start" }}>
                <button type="submit" className="btn primary">Save Settings</button>
              </div>
            </form>

            <div className="section-head" style={{ marginTop: "28px" }}>
              <h2>Display &amp; Text Options</h2>
            </div>
            <div className="field full" style={{ marginBottom: "14px" }}>
              <label>Text Size</label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                {([
                  { key: "sm", label: "Small" },
                  { key: "md", label: "Medium (Default)" },
                  { key: "lg", label: "Large" },
                  { key: "xl", label: "Extra Large" },
                ] as const).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`btn ${(db.settings.textScale || "md") === opt.key ? "primary" : ""}`}
                    onClick={() => handleTextScaleChange(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field full">
              <label>Font Style</label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                {([
                  { key: "system", label: "Standard" },
                  { key: "rounded", label: "Rounded" },
                  { key: "mono", label: "Mono / Digital" },
                ] as const).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`btn ${(db.settings.fontStyle || "system") === opt.key ? "primary" : ""}`}
                    onClick={() => handleFontStyleChange(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <AiKeyPoolPanel />

            <p className="hint" style={{ marginTop: "20px" }}>
              Storage Usage Meter ab "System Status Dashboard" (Owner-only, sidebar mein) ke andar milega — poore
              system health ke saath ek hi jagah.
            </p>
          </div>
        );

      default:
        return (
          <div className="section">
            <h2>Welcome to {db.settings.shopName || "Mobile Store Pro"}</h2>
            <p>Please choose a section from the sidebar or click below to start a sale:</p>
            <button className="btn primary" onClick={() => setCurrentPage("sell")}>
              Go to POS / New Bill
            </button>
          </div>
        );
    }
  };

  if (!gateUnlocked) {
    const shopInitials = (db.settings.shopName || "DS").trim().slice(0, 2).toUpperCase();
    const locked = gateAttempts.lockUntil > Date.now();
    return (
      <div className="gate-screen">
        <div className="gate-orb" style={{ width: 340, height: 340, top: "-8%", left: "-6%", background: "#2563eb" }} />
        <div className="gate-orb" style={{ width: 300, height: 300, bottom: "-10%", right: "-6%", background: "#ef4444", animationDelay: "-4s" }} />
        {gateStage === "choose" && (
          <div className="gate-card">
            <div className="gate-brand">
              <div className="badge">{shopInitials}</div>
              <h1>{db.settings.shopName || "DS MOBILE & DIGITAL HUB"}</h1>
              <p>Select how you're signing in</p>
            </div>
            <div className="gate-options">
              <div className="gate-option staff" onClick={handleGateStaffAreaTap}>
                <div className="icon-wrap"><Users size={24} /></div>
                <h3>Staff Area</h3>
                <p>Quick access for daily sales &amp; billing. Selling prices only — no financial reports.</p>
                <ArrowRightIcon size={18} className="go-arrow" color="#60a5fa" />
              </div>
              <div className="gate-option owner" onClick={() => setGateStage("ownerAuth")}>
                <div className="icon-wrap"><ShieldAlert size={24} /></div>
                <h3>Owner Confidential Area</h3>
                <p>Full access — purchase cost, reports, settings &amp; backups. Passcode protected.</p>
                <p className="hint" style={{ marginTop: 4 }}>Yeh ek chhota device PIN hai (Settings mein set hota hai) — aapke Cloud account password se alag.</p>
                <div className="gate-warning-strip"><Lock size={12} /> Restricted &amp; Monitored</div>
                <ArrowRightIcon size={18} className="go-arrow" color="#f87171" />
              </div>
            </div>
          </div>
        )}

        {gateStage === "ownerAuth" && (
          <div className={`gate-auth-card ${gateShakeError ? "shake" : ""}`}>
            <div className="gate-auth-head">
              <div className="warn-badge"><ShieldAlert size={22} /></div>
              <div>
                <h3>Owner Confidential Area</h3>
                <p>Authorized personnel only</p>
              </div>
            </div>

            {locked ? (
              <div className="gate-lock-banner">
                🔒 Too many incorrect attempts.<br />
                Try again in {Math.floor(gateLockRemaining / 60)}:{String(gateLockRemaining % 60).padStart(2, "0")}
                <br />A Telegram security alert has been sent to the owner.
              </div>
            ) : (
              <form onSubmit={handleGateOwnerSubmit}>
                <input
                  className="gate-pass-input"
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  placeholder="Enter Owner Device PIN"
                  value={gatePassInput}
                  onChange={(e) => setGatePassInput(e.target.value)}
                />
                <div className="hint" style={{ marginTop: 6 }}>Ye aapka Cloud account password nahi hai — sirf is device ka chhota PIN hai (Owner Settings mein set/badal sakte ho).</div>
                <div className="gate-attempts-row">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={`gate-attempt-dot ${i < gateAttempts.count ? "used" : ""}`} />
                  ))}
                </div>
                <div className="modal-actions" style={{ marginTop: 18 }}>
                  <button type="submit" className="btn primary" style={{ width: "100%", justifyContent: "center", background: "#dc2626" }} disabled={gateBusy}>
                    {gateBusy ? <Loader2 size={15} className="spin" /> : <Lock size={15} />} {gateBusy ? "Sending alert…" : "Unlock Owner Access"}
                  </button>
                </div>
              </form>
            )}

            <button
              className="gate-back-link"
              onClick={() => {
                setGateStage(gateBackStage);
                setGatePassInput("");
              }}
            >
              ← Back to selection
            </button>
          </div>
        )}

        {gateStage === "staffAuth" && (
          <div className="gate-auth-card">
            <div className="gate-auth-head">
              <div className="warn-badge" style={{ background: "#1d4ed8" }}><Users size={22} /></div>
              <div>
                <h3>Staff Login</h3>
                <p>Apni shop se mila Login ID &amp; Password daalo</p>
              </div>
            </div>

            <form onSubmit={handleStaffLoginSubmit}>
              <div className="field">
                <label>Login ID</label>
                <input
                  autoFocus
                  value={staffLoginId}
                  onChange={(e) => setStaffLoginId(e.target.value)}
                  placeholder="e.g. rahul01"
                />
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Password</label>
                <input
                  type="password"
                  value={staffLoginPassword}
                  onChange={(e) => setStaffLoginPassword(e.target.value)}
                  placeholder="Password"
                />
              </div>
              {staffLoginError && (
                <div className="notice" style={{ marginTop: 10, color: "var(--red)" }}>{staffLoginError}</div>
              )}
              <div className="modal-actions" style={{ marginTop: 18 }}>
                <button type="submit" className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={staffLoginBusy}>
                  {staffLoginBusy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />} {staffLoginBusy ? "Checking…" : "Login"}
                </button>
              </div>
            </form>

            <button
              className="gate-back-link"
              onClick={() => {
                setGateStage(gateBackStage);
                setStaffLoginId("");
                setStaffLoginPassword("");
                setStaffLoginError("");
              }}
            >
              ← Back to selection
            </button>
          </div>
        )}

        {gateStage === "staffDenied" && (
          <div className="gate-auth-card">
            <div className="gate-auth-head">
              <div className="warn-badge"><ShieldAlert size={22} /></div>
              <div>
                <h3>{staffDeniedReason === "expired" ? "Access Time Khatam Ho Gaya" : "Access Disabled"}</h3>
                <p>Contact Shop Owner for Access</p>
              </div>
            </div>
            <div className="notice" style={{ marginTop: 8 }}>
              {staffDeniedReason === "expired"
                ? "Owner ne aapko jitna time diya tha wo poora ho chuka hai. Dobara access ke liye shop owner se baat karo."
                : "Owner ne aapka access is waqt band kar rakha hai. Dobara access ke liye shop owner se baat karo."}
            </div>
            <button
              className="gate-back-link"
              style={{ marginTop: 16 }}
              onClick={() => {
                setGateStage(gateBackStage);
                setStaffDeniedReason(null);
                setStaffLoginId("");
                setStaffLoginPassword("");
              }}
            >
              ← Back to selection
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="app">
      <MoneyAnimation />
      <Sidebar
        db={db}
        currentPage={currentPage}
        onNavigate={(page) => {
          // Any owner-only tool (financial reports, loan/byaj tracker, purchases, expenses, etc.)
          // must re-prompt for the owner passcode even if reached via a direct route change,
          // not just when clicked from the (already-filtered) sidebar list.
          const isOwnerOnlyPage = SECONDARY_NAV_ITEMS.some((item) => item.key === page && item.ownerOnly);
          if (isOwnerOnlyPage && !ownerMode) {
            setIsOwnerLoginOpen(true);
            return;
          }
          setCurrentPage(page);
          setIsMobileNavOpen(false);
        }}
        ownerMode={ownerMode}
        onToggleOwnerMode={() => {
          if (!ownerMode) setIsOwnerLoginOpen(true);
          else setOwnerMode(false);
        }}
        onOpenQuickScan={() => setIsCameraScannerOpen(true)}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      <div id="main">
        <div id="topbar">
          <button
            className="mobile-hamburger"
            aria-label="Menu kholo"
            onClick={() => setIsMobileNavOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "20px" }} className="topbar-title">
            <div>
              <h1 style={{ fontSize: "17px", margin: 0, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--ink)" }}>
                {db.settings.shopName || "MOBILE HUB"} <span style={{ color: "var(--accent)" }}>PRO</span>
              </h1>
              <div className="sub" style={{ fontSize: "11px", color: "var(--ink-soft)", fontWeight: 600 }}>
                {currentPage === "sell"
                  ? "POS & Billing Terminal"
                  : currentPage === "imeiTracker"
                  ? "IMEI & Phone Inventory"
                  : currentPage === "secondHandKyc"
                  ? "2nd-Hand Buyback KYC"
                  : currentPage === "xeroxGrid"
                  ? "Digital Hub & Xerox 1-Tap"
                  : currentPage === "simTracker"
                  ? "SIM & Lapu Reconciler"
                  : currentPage === "financeLedger"
                  ? "Mobile Finance & EMI Ledger"
                  : "Digital Retail OS"}
              </div>
            </div>

            {/* Live Lapu Wallet Telemetry */}
            <div style={{ display: "none", alignItems: "center", gap: "16px", marginLeft: "12px", borderLeft: "1px solid var(--line)", paddingLeft: "16px" }} className="md:flex">
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "10px", color: "var(--ink-soft)", textTransform: "uppercase", fontWeight: 800, letterSpacing: "-0.02em" }}>
                  Airtel Mitra
                </span>
                <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--ink)" }}>
                  {inr((db.lapuWallets?.find(w => w.operator === "Airtel Mitra")?.actualBalance) || 12450.20)}
                </span>
              </div>
              <div style={{ width: "1px", height: "24px", background: "var(--line)" }}></div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "10px", color: "var(--ink-soft)", textTransform: "uppercase", fontWeight: 800, letterSpacing: "-0.02em" }}>
                  JioPOS Plus
                </span>
                <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--ink)" }}>
                  {inr((db.lapuWallets?.find(w => w.operator === "JioPOS Plus")?.actualBalance) || 8920.00)}
                </span>
              </div>
            </div>
          </div>

          <div className="top-actions">
            {appUpdateInfo && (
              <UpdateAvailablePill
                info={appUpdateInfo}
                isAndroid={/Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "")}
                onDismiss={dismissAppUpdate}
              />
            )}
            {db.products.filter(p => p.stock <= p.minStock).length > 0 && (
              <div
                style={{
                  padding: "4px 10px",
                  background: "var(--amber-light)",
                  color: "var(--amber)",
                  border: "1px solid var(--amber-border)",
                  borderRadius: "999px",
                  fontSize: "10.5px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
                onClick={() => setCurrentPage("products")}
              >
                LOW STOCK: {db.products.filter(p => p.stock <= p.minStock).length} SKUs
              </div>
            )}

            <button
              className="btn sm"
              style={{
                background: "var(--paper)",
                border: "1px solid var(--line)",
                fontWeight: 700,
                fontSize: "11.5px",
                display: "none",
              }}
              onClick={() => setIsWindowsModalOpen(true)}
              title="Windows packaging tools"
            >
              <Monitor size={13} style={{ color: "var(--accent)" }} /> 💻 Windows App
            </button>

            {/* Owner-only: this opens the shared Cloud Account panel (email/password
                sign-in AND sign-out). Staff must never see or be able to trigger
                cloud sign-in/sign-out — it's a different, shared account from their
                own staffAuth login, and signing it out would break sync for everyone. */}
            {ownerMode && cloudProfile?.role !== "staff" && (
              <button className="btn sm" onClick={() => setShowCloudAuth(true)} title="Cloud account — email/password, syncs data across all devices (alag hai Owner Device PIN se)"><span className={`status-dot ${cloudStatus}`}></span> {cloudUser ? "Cloud Online" : "Cloud Sign In"}</button>
            )}
            {/* Step 4.4 — chhota, hamesha visible connection badge (Owner + Staff dono ko
                dikhta hai). Owner-only bade Status Dashboard (Step 9) se alag purpose:
                yahan sirf "abhi online hai ya offline" + zaroorat pade to Retry Sync.
                Background auto-retry already startConnectivitySync() (repository.ts) se
                chalta rehta hai, chahe koi button na dabaye. */}
            <ConnectionStatusBadge
              cloudStatus={cloudStatus as any}
              pendingSyncCount={pendingSyncCount}
              onRetry={async () => {
                try {
                  const r = await flushOfflineQueue();
                  showToast(`${r.processed} sync ho gaye${r.failed ? `, ${r.failed} retry hongi` : ""}.`, r.failed ? "amber" : "green");
                  return r;
                } catch {
                  showToast("Abhi sync nahi ho paaya — internet check karo.", "red");
                  return { processed: 0, failed: 0 };
                }
              }}
            />
            {/* Telegram connect/test is an owner-only concern (Master Plan 1.4) — only
                the owner's own Telegram account is ever linked, and its bot is what
                sends everyone's invoices/reports/alerts. Staff have no reason to see
                or touch this, so it's gated on ownerMode, not just cloudUser. */}
            {cloudUser && ownerMode && <button className="btn sm" onClick={async () => { try { const d = await openTelegramConnection(); showToast(`Open Telegram to connect @${d.username}`, "green"); const started=Date.now(); const timer=window.setInterval(async()=>{ const st=await pollTelegramConnection(); setTelegramStatus(st); if(st.connected || Date.now()-started>620000) window.clearInterval(timer); },3000); } catch(e) { showToast(e instanceof Error ? e.message : String(e), "red"); } }}>Telegram {telegramStatus?.connected ? "Connected" : "Connect"}</button>}
            {cloudUser && ownerMode && telegramStatus?.connected && <button className="btn sm" onClick={async()=>{ try { const r=await sendTelegramTest(); showToast(r?.worker?.sent ? "Telegram test delivered" : "Telegram test queued", "green"); } catch(e) { showToast(e instanceof Error ? e.message : String(e), "red"); } }}>Test Telegram</button>}
            <button className="btn sm" onClick={() => setCurrentPage("photoFinder")}>
              <Camera size={13} /> Photo Stock Finder
            </button>
            <button className="btn primary sm" onClick={() => setCurrentPage("sell")}>
              + POS Sale (F2)
            </button>
            <button className="btn primary sm" onClick={() => { setCurrentPage("sell"); setIsCameraScannerOpen(true); }} title="Scan a barcode to sell instantly">
              <Barcode size={13} /> Barcode Sale
            </button>

            {/* Store / role badge */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", borderLeft: "1px solid var(--line)", paddingLeft: "12px" }}>
              <div style={{ textAlign: "right", display: "none" }} className="sm:block">
                <p style={{ fontSize: "12px", fontWeight: 800, margin: 0, lineHeight: 1.2, color: "var(--ink)" }}>
                  {ownerMode ? "Store Owner" : "Staff"}
                </p>
                <p style={{ fontSize: "10px", color: "var(--ink-soft)", margin: 0 }}>
                  {ownerMode ? "Full Admin Access" : "Counter Staff Access"}
                </p>
              </div>
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "8px",
                  background: "var(--accent)",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: "13px",
                  boxShadow: "0 1px 3px rgba(37,99,235,0.3)",
                }}
                title={ownerMode ? "Store Owner" : "Counter Staff"}
              >
                {ownerMode ? <Shield size={16} /> : <Users size={16} />}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Counter Strip for 1-Tap Counter Task Switching */}
        <div
          style={{
            background: "var(--card)",
            borderBottom: "1px solid var(--line)",
            padding: "8px 24px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: "4px" }}>
            ⚡ Counter:
          </span>
          {[
            { key: "dashboard", label: "🏠 Dashboard", color: "var(--navy)" },
            { key: "sell", label: "🛒 New Bill ()", color: "var(--blue)" },
            { key: "xeroxGrid", label: "🖨️ 1-Tap Xerox ()", color: "var(--green)" },
            { key: "imeiTracker", label: "📱 Mobiles / IMEI", color: "var(--purple)" },
            { key: "gallaClosing", label: "💰 Galla ()", color: "var(--amber)" },
            { key: "jobs", label: "🔧 Repairs ()", color: "var(--purple)" },
            { key: "khata", label: "📒 Khata ()", color: "var(--red)" },
            { key: "modelsearch", label: "🔍 Glass/Cover Finder", color: "var(--navy)" },
          ].map((tab) => {
            const isActive = currentPage === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setCurrentPage(tab.key)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 700,
                  border: "1px solid",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                  background: isActive ? tab.color : "var(--paper)",
                  color: isActive ? "#ffffff" : "var(--ink)",
                  borderColor: isActive ? tab.color : "var(--line)",
                  boxShadow: isActive ? "0 2px 4px rgba(0,0,0,0.12)" : "none",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div id="page">{renderCurrentPage()}</div>
      </div>

      {/* Toasts */}
      <div id="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind || ""}`}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* Modals */}
      {isCameraScannerOpen && (
        <CameraScannerModal
          isOpen={isCameraScannerOpen}
          onClose={() => setIsCameraScannerOpen(false)}
          onScan={handleCameraScan}
        />
      )}

      {confidentialPriceProduct && (
        <ConfidentialPriceModal
          productId={confidentialPriceProduct.id}
          productName={confidentialPriceProduct.name}
          productCategory={confidentialPriceProduct.category}
          requesterName={cloudProfile?.full_name || cloudProfile?.staff_name || "Staff"}
          onApply={(price) => applyConfidentialPrice(confidentialPriceProduct, price)}
          onClose={() => setConfidentialPriceProduct(null)}
        />
      )}

      {isAddGiftOpen && (
        <AddGiftModal
          db={db}
          excludeGiftedProductIds={cart.filter((c) => c.isGift).map((c) => c.productId)}
          onSelect={(product) => {
            addGiftToCart(product);
            setIsAddGiftOpen(false);
          }}
          onClose={() => setIsAddGiftOpen(false)}
        />
      )}

      {isAddProductOpen && ownerMode && (
        <AddProductModal
          isOpen={isAddProductOpen}
          onClose={() => setIsAddProductOpen(false)}
          db={db}
          storeId={cloudProfile?.store_id}
          onCreated={() => saveState({ ...db })}
          toast={showToast}
        />
      )}

      <EditProductModal
        isOpen={isEditProductOpen}
        product={editingProduct}
        ownerMode={ownerMode}
        db={db}
        storeId={cloudProfile?.store_id}
        onClose={() => { setIsEditProductOpen(false); setEditingProduct(null); }}
        onSaved={() => saveState({ ...db })}
        toast={showToast}
      />

      {isKycModalOpen && ownerMode && (
        <SecondHandKycModal
          db={db}
          viewingKyc={viewingKyc}
          storeId={cloudProfile?.store_id}
          toast={showToast}
          onClose={() => {
            setIsKycModalOpen(false);
            setViewingKyc(null);
          }}
          onSave={(kyc) => {
            if (!db.secondHandKYCs) db.secondHandKYCs = [];
            db.secondHandKYCs.push(kyc);
            saveState({ ...db });
            setIsKycModalOpen(false);
            showToast(`KYC Voucher ${kyc.voucherNo} saved & IMEI added to inventory!`, "green");
          }}
        />
      )}

      {isGallaModalOpen && (
        <DailyGallaModal
          db={db}
          onClose={() => setIsGallaModalOpen(false)}
          onSaveGalla={(g) => {
            saveState({ ...db });
            showToast("Daily Galla verified and closed!", "green");
          }}
        />
      )}

      {isInvoiceViewerOpen && (
        <InvoiceViewerModal
          db={db}
          sale={viewingSale}
          creditNote={viewingCreditNote}
          exchange={viewingExchange}
          onClose={() => {
            setIsInvoiceViewerOpen(false);
            setViewingSale(null);
            setViewingCreditNote(null);
            setViewingExchange(null);
          }}
        />
      )}

      {/* Part 3: owner-only "Correct Amount" modal — payment mode / amount paid / due, inside the correction window only. */}
      {correctionTarget && (
        <div className="modal-backdrop" onMouseDown={() => setCorrectionTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 style={{ margin: 0 }}>Correct Invoice {correctionTarget.invoiceNo}</h3>
              <button className="icon-btn" onClick={() => setCorrectionTarget(null)}>&times;</button>
            </div>
            <div className="field">
              <label>Payment Mode</label>
              <input value={correctionForm.payment} onChange={(e) => setCorrectionForm({ ...correctionForm, payment: e.target.value })} />
            </div>
            <div className="field" style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>Amount Paid</label>
                <input type="number" value={correctionForm.amountPaid} onChange={(e) => setCorrectionForm({ ...correctionForm, amountPaid: Number(e.target.value) })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Due Amount</label>
                <input type="number" value={correctionForm.dueAmount} onChange={(e) => setCorrectionForm({ ...correctionForm, dueAmount: Number(e.target.value) })} />
              </div>
            </div>
            <div className="field">
              <label>Note (kyun correct kiya)</label>
              <input value={correctionForm.note} onChange={(e) => setCorrectionForm({ ...correctionForm, note: e.target.value })} placeholder="e.g. Galat payment mode select ho gaya tha" />
            </div>
            <div className="notice" style={{ marginTop: 8 }}>
              Ye sirf payment/amount theek karta hai — items/stock change nahi hota. Galat item/rate ho to "Cancel
              Sale" karke naya sahi sale banao.
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setCorrectionTarget(null)}>Cancel</button>
              <button type="button" className="btn primary" onClick={handleSaveCorrection}>Save Correction</button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Info Modal for Sale Checkout */}
      {isCustomerModalOpen && (
        <div className="overlay show">
          <div className="modal">
            <div className="modal-head">
              <h3>Customer Details for Invoice</h3>
              <button onClick={() => setIsCustomerModalOpen(false)}>&times;</button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleFinalizeSale(checkoutCustomer);
                setIsCustomerModalOpen(false);
              }}
            >
              <div className="formgrid">
                <div className="field">
                  <label>Customer Name</label>
                  <input
                    value={checkoutCustomer.name}
                    onChange={(e) => setCheckoutCustomer({ ...checkoutCustomer, name: e.target.value })}
                    placeholder="Customer name"
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>Mobile Number (For WhatsApp Bill &amp; Warranty)</label>
                  <input
                    value={checkoutCustomer.phone}
                    onChange={(e) => setCheckoutCustomer({ ...checkoutCustomer, phone: e.target.value })}
                    placeholder="10-digit mobile"
                  />
                </div>
                <div className="field full">
                  <label>Customer Address</label>
                  <input
                    value={checkoutCustomer.address}
                    onChange={(e) => setCheckoutCustomer({ ...checkoutCustomer, address: e.target.value })}
                    placeholder="Village / Town / City"
                  />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setIsCustomerModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  <CheckCircle2 size={14} /> Generate &amp; Print Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Repair Ticket Modal */}
      {isJobModalOpen && (
        <div className="overlay show">
          <div className="modal wide">
            <div className="modal-head">
              <h3>Create Repair / Service Ticket</h3>
              <button onClick={() => { setIsJobModalOpen(false); setJobAiDiagnosis({ loading: false, text: "", error: "" }); }}>&times;</button>
            </div>
            <form onSubmit={handleCreateJobTicket}>
              <div className="formgrid">
                <div className="field">
                  <label>Customer Full Name <span className="req">*</span></label>
                  <input
                    value={jobForm.customerName}
                    onChange={(e) => setJobForm({ ...jobForm, customerName: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Mobile Number <span className="req">*</span></label>
                  <input
                    value={jobForm.phone}
                    onChange={(e) => setJobForm({ ...jobForm, phone: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Device Model <span className="req">*</span></label>
                  <input
                    value={jobForm.device}
                    onChange={(e) => setJobForm({ ...jobForm, device: e.target.value })}
                    placeholder="e.g. Redmi Note 10 / iPhone 11"
                    required
                  />
                </div>
                <div className="field">
                  <label>Accessories Received</label>
                  <input
                    value={jobForm.accessories}
                    onChange={(e) => setJobForm({ ...jobForm, accessories: e.target.value })}
                    placeholder="e.g. SIM tray, back cover"
                  />
                </div>
                <div className="field full" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                  <label>🔓 Mobile Unlock / Lock Service (Optional Quick-Fill)</label>
                  <select
                    value={jobForm.serviceType}
                    onChange={(e) => {
                      const key = e.target.value;
                      const preset = MOBILE_LOCK_SERVICES.find((s) => s.key === key);
                      setJobForm({
                        ...jobForm,
                        serviceType: key,
                        issue: preset ? preset.label : jobForm.issue,
                        estCost: preset ? preset.defaultPrice : jobForm.estCost,
                      });
                    }}
                  >
                    <option value="">-- Normal repair (not a lock/unlock job) --</option>
                    {MOBILE_LOCK_SERVICES.map((s) => (
                      <option key={s.key} value={s.key}>{s.label} (₹{s.defaultPrice})</option>
                    ))}
                  </select>
                  <div className="hint" style={{ marginTop: "4px" }}>Select karne se issue &amp; price khud fill ho jayenge — neeche edit kar sakte hain.</div>
                </div>

                <div className="field full">
                  <label>Reported Issue <span className="req">*</span></label>
                  <textarea
                    rows={2}
                    value={jobForm.issue}
                    onChange={(e) => setJobForm({ ...jobForm, issue: e.target.value })}
                    placeholder="e.g. Display glass broken, touch working partially"
                    required
                  />
                  <div style={{ marginTop: "6px" }}>
                    {!jobAiDiagnosis.loading && !jobAiDiagnosis.text && (
                      <button
                        type="button"
                        className="btn sm"
                        disabled={jobForm.issue.trim().length < 3}
                        onClick={async () => {
                          setJobAiDiagnosis({ loading: true, text: "", error: "" });
                          try {
                            const diagnosis = await getRepairDiagnosis({ device: jobForm.device, issue: jobForm.issue });
                            setJobAiDiagnosis({ loading: false, text: diagnosis, error: "" });
                          } catch (e) {
                            setJobAiDiagnosis({ loading: false, text: "", error: e instanceof Error ? e.message : "AI diagnosis failed." });
                          }
                        }}
                      >
                        <Sparkles size={13} /> AI Diagnosis Suggest karo
                      </button>
                    )}
                    {jobAiDiagnosis.loading && (
                      <span className="hint">AI issue soch raha hai...</span>
                    )}
                    {jobAiDiagnosis.error && (
                      <div className="hint" style={{ color: "var(--red)" }}>{jobAiDiagnosis.error}</div>
                    )}
                    {jobAiDiagnosis.text && (
                      <div className="notice" style={{ marginTop: "4px", fontSize: "12px", whiteSpace: "pre-line" }}>
                        🤖 {jobAiDiagnosis.text}
                      </div>
                    )}
                  </div>
                </div>
                <div className="field">
                  <label>Spare Part to Auto-Deduct (Optional)</label>
                  <select
                    value={jobForm.selectedSparePartId}
                    onChange={(e) => setJobForm({ ...jobForm, selectedSparePartId: e.target.value })}
                  >
                    <option value="">-- No spare part used --</option>
                    {db.products
                      .filter((p) => p.isSparePart || p.category.includes("Repair"))
                      .map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name} (Stock: {sp.stock}) - Cost: {inr(sp.purchasePrice)}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <label>Estimated Total Charge (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={jobForm.estCost || ""}
                    onChange={(e) => setJobForm({ ...jobForm, estCost: Number(e.target.value) })}
                    placeholder="e.g. 1800"
                  />
                </div>
                <div className="field">
                  <label>Advance Received (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={jobForm.advance || ""}
                    onChange={(e) => setJobForm({ ...jobForm, advance: Number(e.target.value) })}
                    placeholder="0"
                  />
                </div>
                {ownerMode && (
                  <div className="field full" style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px" }}>
                    <label>💰 Actual Cost to Complete this Job (₹, Optional — Owner Only)</label>
                    <input
                      type="number"
                      min="0"
                      value={jobForm.otherCost || ""}
                      onChange={(e) => setJobForm({ ...jobForm, otherCost: Number(e.target.value) })}
                      placeholder="e.g. 350 for FRP unlock tool / outsourced flashing"
                    />
                    <div className="hint" style={{ marginTop: "4px" }}>
                      Spare part cost apne aap add ho jaata hai (agar upar select kiya ho). Yahan sirf extra cost dalein — jaise FRP bypass/unlock tool ka charge, ya bahar se karwaya gaya kaam. Profit = Charge − Spare Part Cost − yeh amount.
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => { setIsJobModalOpen(false); setJobAiDiagnosis({ loading: false, text: "", error: "" }); }}>Cancel</button>
                <button type="submit" className="btn primary">Create Ticket</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Owner-only: correct a job's charge / extra cost after creation —
          e.g. adding the FRP/unlock tool cost once it's actually known. */}
      {editingJobCostId && ownerMode && (() => {
        const j = db.jobs.find((x) => x.id === editingJobCostId);
        if (!j) return null;
        const previewProfit = Math.max(0, (Number(jobCostDraft.estCost) || 0) - (j.partsCostTotal || 0) - (Number(jobCostDraft.otherCost) || 0));
        return (
          <div className="overlay show">
            <div className="modal">
              <div className="modal-head">
                <h3>Edit Charge &amp; Cost — {j.jobNo}</h3>
                <button onClick={() => setEditingJobCostId(null)}>&times;</button>
              </div>
              <div className="formgrid">
                <div className="field">
                  <label>Total Charge to Customer (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={jobCostDraft.estCost || ""}
                    onChange={(e) => setJobCostDraft({ ...jobCostDraft, estCost: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Extra Cost (₹, e.g. FRP/unlock tool)</label>
                  <input
                    type="number"
                    min="0"
                    value={jobCostDraft.otherCost || ""}
                    onChange={(e) => setJobCostDraft({ ...jobCostDraft, otherCost: Number(e.target.value) })}
                  />
                </div>
                <div className="field full hint">
                  Spare part cost ({inr(j.partsCostTotal || 0)}) already deducted from stock — is amount ko edit nahi kiya ja sakta yahan se.
                </div>
                <div className="field full" style={{ fontWeight: 800, fontSize: "14px", color: previewProfit >= 0 ? "var(--green)" : "var(--red)" }}>
                  Naya Profit: {inr(previewProfit)}
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn" onClick={() => setEditingJobCostId(null)}>Cancel</button>
                <button type="button" className="btn primary" onClick={saveJobCostEdit}>
                  <CheckCircle2 size={14} /> Save
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Owner Re-Auth Modal (mid-session switch from Staff view) */}
      {isOwnerLoginOpen && (
        <div className="overlay show">
          <div className={`modal ${gateShakeError ? "shake" : ""}`} style={{ border: "1px solid rgba(239,68,68,.4)", boxShadow: "0 20px 50px -12px rgba(239,68,68,.25)" }}>
            <div className="modal-head">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}><ShieldAlert size={18} color="#ef4444" /> Owner Confidential Access</h3>
              <button onClick={() => { setIsOwnerLoginOpen(false); setGatePassInput(""); }}>&times;</button>
            </div>
            <div className="gate-warning-strip" style={{ marginBottom: 14, marginTop: -6 }}>
              <Lock size={12} /> Restricted &amp; Monitored
            </div>
            {gateAttempts.lockUntil > Date.now() ? (
              <div className="gate-lock-banner">
                🔒 Too many incorrect attempts. Try again in {Math.floor(gateLockRemaining / 60)}:{String(gateLockRemaining % 60).padStart(2, "0")}
                <br />A Telegram security alert has been sent to the owner.
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  await handleGateOwnerSubmit(e);
                }}
              >
                <div className="field">
                  <label>Enter Owner Passcode</label>
                  <input
                    type="password"
                    placeholder="Owner authentication required"
                    autoFocus
                    value={gatePassInput}
                    onChange={(e) => setGatePassInput(e.target.value)}
                  />
                </div>
                <div className="gate-attempts-row" style={{ justifyContent: "flex-start" }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={`gate-attempt-dot ${i < gateAttempts.count ? "used" : ""}`} />
                  ))}
                </div>
                <div className="modal-actions" style={{ marginTop: "16px" }}>
                  <button type="button" className="btn" onClick={() => { setIsOwnerLoginOpen(false); setGatePassInput(""); }}>Cancel</button>
                  <button type="submit" className="btn primary" style={{ background: "#dc2626" }} disabled={gateBusy}>
                    {gateBusy ? "Sending alert…" : "Unlock Owner Access"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {showCloudAuth && <CloudAuthPanel userEmail={cloudUser?.email} onClose={() => setShowCloudAuth(false)} onChanged={async () => {
        // Step 1.3 fix: while we re-check who's signed in after a fresh
        // sign-in/sign-out, mark cloudReady false so screens like Staff
        // Access Manager show a loading state instead of a stale/premature
        // "Store not set up" error during this brief refetch window.
        setCloudReady(false);
        try {
          const { data } = await supabase.auth.getUser();
          setCloudUser(data.user ?? null);
          setCloudProfile(await getCurrentProfile());
        } finally {
          setCloudReady(true);
        }
      }} />}

      {/* Windows Desktop App Modal */}
      {isWindowsModalOpen && (
        <WindowsAppModal
          isOpen={isWindowsModalOpen}
          onClose={() => setIsWindowsModalOpen(false)}
          db={db}
          deferredPrompt={deferredPrompt}
          onTriggerInstall={handleTriggerPwaInstall}
        />
      )}
    </div>
  );
}
