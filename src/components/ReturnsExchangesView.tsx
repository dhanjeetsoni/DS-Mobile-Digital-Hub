import React, { useState, useEffect } from "react";
import { RotateCcw, Search, CheckCircle2, ArrowRight, Printer, AlertTriangle, RefreshCw, ShieldCheck, Clock } from "lucide-react";
import { Database, Sale, ReturnRecord, ExchangeRecord, ReturnItem, WarrantyClaim, Product } from "../types";
import { inr } from "../utils/indianCurrency";
import { todayStr, nowTimeStr, uid, addStockBatch, consumeFIFO } from "../utils/fifoEngine";
import { supabase, isCloudConfigured } from "../services/supabaseClient";
import { queueOfflineOperation } from "../services/repository";
import { requestReturnApproval, listReturnApprovalRequests, approveReturn, ReturnApprovalRequest } from "../services/phase6";

interface ReturnsExchangesViewProps {
  db: Database;
  // Phase 1 completion (2026-09-06): live-relational display copy of
  // db.products (photo/mrp/warranty/notes/etc kept current via realtime).
  // Optional + falls back to db.products so this component still works
  // fine if a caller (e.g. a test) doesn't pass it. Used ONLY for the
  // replacement-product picker below — every stock mutation in this file
  // correctly keeps using the real db.products, unchanged.
  catalogProducts?: Product[];
  storeId?: string;
  // Phase 6: refund/return requires owner approval before it completes.
  // record_return itself already refuses staff server-side; this decides
  // which RPC handleProcessReturn calls in the first place, so a staff
  // return correctly goes through request_return_approval from the start
  // instead of hitting that rejection and (as it used to) getting silently
  // treated like a transient sync failure — completing locally anyway
  // while the server-side record never actually existed.
  isStaff?: boolean;
  onUpdate: () => void;
  toast: (msg: string, type?: "green" | "red" | "amber") => void;
}

// Server-side rejections fail again on retry — queuing those would spam the
// offline queue forever. Only network/availability errors get queued for
// the background worker. Same rule as StockAdjustView.
function isBusinessRejection(message: string): boolean {
  return /invalid quantity|not authorized|unknown product|insufficient inventory/i.test(message);
}

// Local ids (sale.id / customerId) are only real cloud UUIDs once that
// record has itself synced — many are still device-local ids like
// "sale_<uuid>" (see uid() in fifoEngine.ts). Sending those straight into a
// `uuid` RPC param throws a Postgres cast error, so only pass through values
// that are actually plain UUIDs; the RPC treats a null sale/customer id as
// "not linked yet" rather than failing the whole return/exchange.
const PLAIN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isSaleUuid(value: unknown): value is string {
  return typeof value === "string" && PLAIN_UUID_RE.test(value);
}

export const ReturnsExchangesView: React.FC<ReturnsExchangesViewProps> = ({
  db,
  catalogProducts,
  storeId,
  isStaff = false,
  onUpdate,
  toast,
}) => {
  const [activeTab, setActiveTab] = useState<"history" | "newReturn" | "newExchange" | "newWarranty" | "approvals">("history");
  const [searchInvoiceNo, setSearchInvoiceNo] = useState("");
  const [foundSale, setFoundSale] = useState<Sale | null>(null);

  // Return Form States
  const [selectedReturnItems, setSelectedReturnItems] = useState<{ [productId: string]: number }>({});
  const [returnReason, setReturnReason] = useState("Defective / Not Working");
  const [refundMethod, setRefundMethod] = useState("Cash");
  const [returnNotes, setReturnNotes] = useState("");
  const [viewingReturn, setViewingReturn] = useState<ReturnRecord | null>(null);

  // Exchange Form States
  const [exchangeReturnItems, setExchangeReturnItems] = useState<{ [productId: string]: number }>({});
  const [exchangeReplacementId, setExchangeReplacementId] = useState("");
  const [exchangeReplacementQty, setExchangeReplacementQty] = useState(1);
  const [exchangeReason, setExchangeReason] = useState("Model mismatch / customer preference");
  const [exchangePaymentMethod, setExchangePaymentMethod] = useState("Cash");

  // Warranty Claim Form State
  const [warrantyProductId, setWarrantyProductId] = useState("");
  const [warrantyIssue, setWarrantyIssue] = useState("");
  const [isSavingWarranty, setIsSavingWarranty] = useState(false);
  const [claimStatusDraft, setClaimStatusDraft] = useState<{ [claimId: string]: string }>({});
  // Phase 6: the warranty-reminder backend (schedule_warranty_claim_reminder
  // trigger + the daily dispatch_due_warranty_reminders() cron + Telegram)
  // already existed and was already running live — it just never showed up
  // anywhere in the UI (no "next reminder" date, no reminder count, no way
  // to nudge one manually). Keyed by claim_no rather than the claim's local
  // id, same "client-local id != real relational id" pattern as products.
  const [reminderInfo, setReminderInfo] = useState<Record<string, { id: string; nextReminderAt: string | null; reminderCount: number; lastReminderAt: string | null }>>({});
  const [remindingClaimNo, setRemindingClaimNo] = useState<string | null>(null);

  useEffect(() => {
    if (!isCloudConfigured || !storeId) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("warranty_claims")
        .select("id, claim_no, next_reminder_at, reminder_count, last_reminder_at")
        .eq("store_id", storeId);
      if (!active || error || !data) return;
      const map: Record<string, { id: string; nextReminderAt: string | null; reminderCount: number; lastReminderAt: string | null }> = {};
      for (const row of data) {
        if (!row.claim_no) continue;
        map[row.claim_no] = {
          id: row.id,
          nextReminderAt: row.next_reminder_at,
          reminderCount: row.reminder_count || 0,
          lastReminderAt: row.last_reminder_at,
        };
      }
      setReminderInfo(map);
    })();
    return () => { active = false; };
  }, [isCloudConfigured, storeId, db.warrantyClaims]);

  const handleRemindNow = async (claimNo: string) => {
    const info = reminderInfo[claimNo];
    if (!info) {
      toast("Ye claim abhi cloud se sync nahi hua — thodi der baad try karein.", "amber");
      return;
    }
    setRemindingClaimNo(claimNo);
    try {
      const { data, error } = await supabase.rpc("remind_warranty_claim_now", { p_claim_id: info.id });
      if (error) throw error;
      if (data?.sent) {
        toast(`Reminder bhej diya — ${claimNo}`, "green");
        setReminderInfo((prev) => ({
          ...prev,
          [claimNo]: {
            ...prev[claimNo],
            reminderCount: (prev[claimNo]?.reminderCount || 0) + 1,
            lastReminderAt: new Date().toISOString(),
          },
        }));
      } else {
        toast("Telegram connected nahi hai — Settings mein connect karein.", "amber");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Reminder bhejne mein error aaya.", "red");
    } finally {
      setRemindingClaimNo(null);
    }
  };

  function formatReminderDate(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.round((d.getTime() - now.setHours(0, 0, 0, 0)) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays < 0) return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} (overdue)`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  const handleSearchInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInvoiceNo.trim()) return;
    const s = db.sales.find(
      (x) => x.invoiceNo.toLowerCase() === searchInvoiceNo.trim().toLowerCase()
    );
    if (!s) {
      toast(`Invoice #${searchInvoiceNo} not found`, "red");
      setFoundSale(null);
    } else {
      setFoundSale(s);
      setSelectedReturnItems({});
      setExchangeReturnItems({});
      toast(`Invoice #${s.invoiceNo} loaded!`, "green");
    }
  };

  // BUG FIX: previously used item.qty as the max returnable quantity with no
  // memory of what was already returned, so the same sale item could be
  // "returned" over and over for repeat refunds. This looks at the running
  // total already returned/exchanged against this exact sale.
  const alreadyReturnedQty = (productId: string) => {
    if (!foundSale) return 0;
    let taken = 0;
    for (const r of db.returns) {
      if (r.saleId !== foundSale.id) continue;
      for (const it of r.items) if (it.productId === productId) taken += it.qty;
    }
    for (const ex of db.exchanges) {
      if (ex.saleId !== foundSale.id) continue;
      for (const it of ex.returnedItems) if (it.productId === productId) taken += it.qty;
    }
    return taken;
  };

  const returnableQty = (item: { productId: string; qty: number }) =>
    Math.max(0, item.qty - alreadyReturnedQty(item.productId));

  const calculateReturnRefund = () => {
    if (!foundSale) return 0;
    let sum = 0;
    foundSale.items.forEach((item) => {
      const q = selectedReturnItems[item.productId] || 0;
      if (q > 0) {
        sum += item.price * q;
      }
    });
    return sum;
  };

  const [isSavingReturn, setIsSavingReturn] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ReturnApprovalRequest[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);

  const loadPendingApprovals = async () => {
    if (isStaff || !storeId || !isCloudConfigured) return;
    setApprovalsLoading(true);
    try {
      const rows = await listReturnApprovalRequests(storeId, "pending");
      setPendingApprovals(rows);
    } catch (err: any) {
      toast(err?.message || "Pending approvals load nahi ho paye.", "red");
    } finally {
      setApprovalsLoading(false);
    }
  };

  useEffect(() => {
    void loadPendingApprovals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, isStaff]);

  const handleApproval = async (requestId: string, approve: boolean) => {
    setApprovalBusyId(requestId);
    try {
      await approveReturn(requestId, approve);
      toast(approve ? "Return approve ho gaya — stock update ho gaya." : "Return reject kar diya gaya.", approve ? "green" : "amber");
      setPendingApprovals((prev) => prev.filter((r) => r.id !== requestId));
      onUpdate();
    } catch (err: any) {
      toast(err?.message || "Approval process nahi ho paya, dobara try karein.", "red");
    } finally {
      setApprovalBusyId(null);
    }
  };

  const handleProcessReturn = async () => {
    if (!foundSale) return;
    const totalRefund = calculateReturnRefund();
    if (totalRefund <= 0) {
      toast("Return karne ke liye kam se kam 1 item chunein", "red");
      return;
    }

    // Phase 1: compute the return lines WITHOUT mutating db state yet, so a
    // server-side business rejection can still abort cleanly (same pattern
    // as StockAdjustView's handleApplyAdjustment).
    const returnItems: ReturnItem[] = [];
    foundSale.items.forEach((item) => {
      const q = selectedReturnItems[item.productId] || 0;
      const maxQ = returnableQty(item);
      if (q > 0 && q <= maxQ) {
        returnItems.push({
          productId: item.productId,
          name: item.name,
          category: item.category,
          qty: q,
          price: item.price,
          purchasePrice: item.purchasePrice,
          refund: item.price * q,
        });
      }
    });

    if (returnItems.length === 0) {
      toast("Selected return quantity exceeds what's left to return on this invoice.", "red");
      return;
    }

    const returnNo = `RET-${String((db.returnSeq || 1)).padStart(4, "0")}`;

    setIsSavingReturn(true);
    try {
      const idempotencyKey = crypto.randomUUID();

      // Phase 6: staff can never complete a return directly — record_return
      // itself already refuses them server-side ('staff return requires
      // owner approval'). Branching here, before any RPC call, means a
      // staff member's return correctly waits for the owner to approve it
      // instead of the old behaviour: hit that rejection, treat it as a
      // harmless sync hiccup, and complete the return in the local ledger
      // anyway (stock restocked, record created) even though nothing like
      // that ever happened server-side.
      if (isStaff) {
        if (!isCloudConfigured || !storeId) {
          toast("Return ke liye internet chahiye — owner approval ke bina staff return complete nahi kar sakte.", "red");
          return;
        }
        try {
          await requestReturnApproval({
            storeId,
            saleId: isSaleUuid(foundSale.id) ? foundSale.id : null,
            returnNo,
            customerId: isSaleUuid(foundSale.customerId) ? foundSale.customerId : null,
            returnType: returnItems.length === foundSale.items.length ? "full" : "partial",
            reason: returnReason,
            refundMethod,
            notes: returnNotes,
            idempotencyKey,
            items: returnItems.map((it) => ({
              product_id: isSaleUuid(it.productId) ? it.productId : null,
              quantity: it.qty,
              unit_price: it.price,
              purchase_price: it.purchasePrice,
              refund_amount: it.refund,
            })),
          });
          toast(`${returnNo} owner ko approval ke liye bhej diya gaya — approve hote hi stock update hoga.`, "green");
          setFoundSale(null);
          setSelectedReturnItems({});
        } catch (err: any) {
          toast(err?.message || "Return request bhejne mein dikkat hui, dobara try karein.", "red");
        }
        return;
      }

      // Cloud side: writes the returns rows + re-opens FIFO stock atomically
      // in Postgres (mirrors StockAdjustView/PurchasesView). Falls back to
      // the offline queue on any network/availability failure; the local
      // ledger below always applies regardless, and stays the offline cache.
      if (isCloudConfigured && storeId) {
        try {
          const { error } = await supabase.rpc("record_return", {
            p_store_id: storeId,
            p_sale_id: isSaleUuid(foundSale.id) ? foundSale.id : null,
            p_return_no: returnNo,
            p_customer_id: isSaleUuid(foundSale.customerId) ? foundSale.customerId : null,
            p_return_type: returnItems.length === foundSale.items.length ? "full" : "partial",
            p_reason: returnReason,
            p_refund_method: refundMethod,
            p_notes: returnNotes,
            p_idempotency_key: idempotencyKey,
            p_items: returnItems.map((it) => ({
              product_id: isSaleUuid(it.productId) ? it.productId : null,
              quantity: it.qty,
              unit_price: it.price,
              purchase_price: it.purchasePrice,
              refund_amount: it.refund,
            })),
          });
          if (error) throw error;
        } catch (err: any) {
          const msg = String(err?.message || err || "");
          if (isBusinessRejection(msg)) {
            // BUG FIX: this used to `return` here, which aborted the whole
            // return — including the local stock restock — any time the
            // cloud mirror rejected the call. In practice the cloud
            // `products` table has nothing populated into it yet (no code
            // path syncs products there), so this rejection fires on
            // every single return. The shop's own local return must never
            // depend on that cloud table being in sync — only warn, then
            // keep going into the local save below.
            toast(`Saved locally. Cloud sync skipped: ${msg || "rejected by server"}`, "amber");
          } else {
            try {
              await queueOfflineOperation(
                "return",
                "returns",
                { returnRecord: buildReturnPayload(returnNo, returnItems, totalRefund) },
                idempotencyKey
              );
            } catch {
              toast("Saved locally, but couldn't queue for background sync.", "amber");
            }
          }
        }
      }

      // Phase 2: apply the local mutations — always happens either way, so
      // the shop's own stock/refund records never depend on connectivity.
      returnItems.forEach((it) => {
        // BUG FIX: restocking used to just bump product.stock without adding a
        // matching FIFO batch. That desynced stock count from stockBatches, so
        // a later sale could show stock available yet consumeFIFO() would throw
        // "Insufficient stock / inventory mismatch." Restoring the item's own
        // original purchase price as a new batch keeps FIFO costing correct.
        const p = db.products.find((prod) => prod.id === it.productId);
        if (p) {
          p.stock += it.qty;
          addStockBatch(db, p.id, it.qty, it.purchasePrice || 0, todayStr(), {
            source: "return",
            ref: foundSale.invoiceNo,
          });
        }
        // Track how much of this sale item has now been returned so it can't
        // be returned again beyond what was actually sold.
        const saleItem = foundSale.items.find((si) => si.productId === it.productId);
        if (saleItem) saleItem.returnedQty = (saleItem.returnedQty || 0) + it.qty;
      });

      const newRecord: ReturnRecord = {
        id: uid("ret"),
        ...buildReturnPayload(returnNo, returnItems, totalRefund),
      };

      db.returns.push(newRecord);
      db.returnSeq = (db.returnSeq || 1) + 1;

      onUpdate();
      toast(`Return ${returnNo} processed! Restocked items.`, "green");
      setViewingReturn(newRecord);
      setFoundSale(null);
      setSelectedReturnItems({});
      setActiveTab("history");
    } finally {
      setIsSavingReturn(false);
    }
  };

  function buildReturnPayload(returnNo: string, returnItems: ReturnItem[], totalRefund: number): Omit<ReturnRecord, "id"> {
    return {
      returnNo,
      saleId: foundSale!.id,
      invoiceNo: foundSale!.invoiceNo,
      date: todayStr(),
      time: nowTimeStr(),
      type: returnItems.length === foundSale!.items.length ? "full" : "partial",
      items: returnItems,
      reason: returnReason,
      refundMethod,
      notes: returnNotes,
      subtotalRefund: totalRefund,
      dueOffset: 0,
      settlementAmount: totalRefund,
      customerId: foundSale!.customerId,
      customer: foundSale!.customer,
      createdAt: new Date().toISOString(),
    };
  }

  const [isSavingExchange, setIsSavingExchange] = useState(false);

  const handleProcessExchange = async () => {
    if (!foundSale) return;
    const replacementProd = db.products.find((p) => p.id === exchangeReplacementId);
    if (!replacementProd) {
      toast("Catalog se replacement product chunein", "red");
      return;
    }
    if (replacementProd.stock < exchangeReplacementQty) {
      toast(`Insufficient stock for ${replacementProd.name}`, "red");
      return;
    }

    // Phase 1: compute without mutating db state yet.
    const returnedItemsList: any[] = [];
    let returnedVal = 0;
    foundSale.items.forEach((item) => {
      const q = exchangeReturnItems[item.productId] || 0;
      const maxQ = returnableQty(item);
      if (q > 0 && q <= maxQ) {
        returnedVal += item.price * q;
        returnedItemsList.push({
          productId: item.productId,
          name: item.name,
          category: item.category,
          qty: q,
          price: item.price,
          purchasePrice: item.purchasePrice,
        });
      }
    });

    if (returnedItemsList.length === 0) {
      toast("Kam se kam 1 returned item chunein", "red");
      return;
    }

    const replacementVal = replacementProd.sellingPrice * exchangeReplacementQty;
    const diff = replacementVal - returnedVal;
    const exchangeNo = `EXC-${String((db.exchangeSeq || 1)).padStart(4, "0")}`;
    const replacementItemsList = [
      {
        productId: replacementProd.id,
        name: replacementProd.name,
        category: replacementProd.category,
        qty: exchangeReplacementQty,
        price: replacementProd.sellingPrice,
        purchasePrice: replacementProd.purchasePrice || 0,
        cost: replacementProd.purchasePrice || 0,
        warrantyEnabled: replacementProd.warrantyEnabled,
        warrantyMonths: replacementProd.warrantyMonths,
      },
    ];

    setIsSavingExchange(true);
    try {
      const idempotencyKey = crypto.randomUUID();

      // Cloud side: restocks the returned item(s) + consumes FIFO for the
      // replacement item(s) atomically in Postgres. Falls back to the
      // offline queue on any network/availability failure; the local
      // ledger below always applies regardless.
      if (isCloudConfigured && storeId) {
        try {
          const { error } = await supabase.rpc("record_exchange", {
            p_store_id: storeId,
            p_sale_id: isSaleUuid(foundSale.id) ? foundSale.id : null,
            p_exchange_no: exchangeNo,
            p_customer_id: isSaleUuid(foundSale.customerId) ? foundSale.customerId : null,
            p_returned_value: returnedVal,
            p_replacement_value: replacementVal,
            p_difference_amount: diff,
            p_settlement_method: exchangePaymentMethod,
            p_reason: exchangeReason,
            p_idempotency_key: idempotencyKey,
            p_returned_items: returnedItemsList.map((it) => ({
              product_id: isSaleUuid(it.productId) ? it.productId : null,
              quantity: it.qty,
              unit_price: it.price,
              purchase_price: it.purchasePrice,
            })),
            p_replacement_items: replacementItemsList.map((it) => ({
              product_id: isSaleUuid(it.productId) ? it.productId : null,
              quantity: it.qty,
              unit_price: it.price,
              purchase_price: it.purchasePrice,
            })),
          });
          if (error) throw error;
        } catch (err: any) {
          const msg = String(err?.message || err || "");
          if (isBusinessRejection(msg)) {
            // Same fix as returns: cloud rejection (e.g. products table not
            // yet synced) must never block the local exchange. Warn and
            // continue into the local save below.
            toast(`Saved locally. Cloud sync skipped: ${msg || "rejected by server"}`, "amber");
          } else {
            try {
              await queueOfflineOperation(
                "exchange",
                "exchanges",
                {
                  exchangeRecord: {
                    exchangeNo, saleId: foundSale.id, customerId: foundSale.customerId,
                    returnedItems: returnedItemsList, replacementItems: replacementItemsList,
                    returnedValue: returnedVal, replacementValue: replacementVal, differenceAmount: diff,
                    settlementMethod: exchangePaymentMethod, reason: exchangeReason,
                  },
                },
                idempotencyKey
              );
            } catch {
              toast("Saved locally, but couldn't queue for background sync.", "amber");
            }
          }
        }
      }

      // Phase 2: apply local mutations — always happens either way.
      returnedItemsList.forEach((it) => {
        // BUG FIX: same FIFO-batch desync as returns — restock via addStockBatch,
        // not just an in-place stock bump, and mark returnedQty so this exact
        // sale item can't be given back again beyond its billed quantity.
        const p = db.products.find((prod) => prod.id === it.productId);
        if (p) {
          p.stock += it.qty;
          addStockBatch(db, p.id, it.qty, it.purchasePrice || 0, todayStr(), {
            source: "exchange",
            ref: foundSale.invoiceNo,
          });
        }
        const saleItem = foundSale.items.find((si) => si.productId === it.productId);
        if (saleItem) saleItem.returnedQty = (saleItem.returnedQty || 0) + it.qty;
      });

      // Deduct replacement stock via FIFO too, mirroring how a normal sale consumes it.
      try {
        consumeFIFO(db, replacementProd.id, exchangeReplacementQty);
      } catch {
        // Pre-existing batch/stock desync — the flat decrement below still applies.
      }
      replacementProd.stock -= exchangeReplacementQty;

      const excRecord: ExchangeRecord = {
        id: uid("exc"),
        exchangeNo,
        saleId: foundSale.id,
        invoiceNo: foundSale.invoiceNo,
        date: todayStr(),
        time: nowTimeStr(),
        returnedItems: returnedItemsList,
        replacementItems: replacementItemsList,
        returnedValue: returnedVal,
        replacementValue: replacementVal,
        differenceAmount: diff,
        settlementMethod: exchangePaymentMethod,
        reason: exchangeReason,
        customer: foundSale.customer,
        customerId: foundSale.customerId,
        createdAt: new Date().toISOString(),
      };

      db.exchanges.push(excRecord);
      db.exchangeSeq = (db.exchangeSeq || 1) + 1;

      onUpdate();
      toast(`Exchange ${exchangeNo} completed!`, "green");
      setFoundSale(null);
      setExchangeReturnItems({});
      setActiveTab("history");
    } finally {
      setIsSavingExchange(false);
    }
  };

  const isWarrantyValid = (item: { warrantyEnd?: string | null }) =>
    !!item.warrantyEnd && item.warrantyEnd >= todayStr();

  const handleRaiseWarrantyClaim = async () => {
    if (!foundSale) return;
    const item = foundSale.items.find((it) => it.productId === warrantyProductId);
    if (!item) {
      toast("Warranty claim kis item ke liye hai, chunein", "red");
      return;
    }
    if (!warrantyIssue.trim()) {
      toast("Issue ke baare mein likhein", "red");
      return;
    }

    const claimNo = `WCL-${String((db.warrantyClaimSeq || 1)).padStart(4, "0")}`;
    setIsSavingWarranty(true);
    try {
      const idempotencyKey = crypto.randomUUID();

      if (isCloudConfigured && storeId) {
        try {
          const { error } = await supabase.rpc("record_warranty_claim", {
            p_store_id: storeId,
            p_sale_id: isSaleUuid(foundSale.id) ? foundSale.id : null,
            p_product_id: isSaleUuid(item.productId) ? item.productId : null,
            p_customer_id: isSaleUuid(foundSale.customerId) ? foundSale.customerId : null,
            p_claim_no: claimNo,
            p_issue_description: warrantyIssue,
            p_idempotency_key: idempotencyKey,
          });
          if (error) throw error;
        } catch (err: any) {
          const msg = String(err?.message || err || "");
          if (isBusinessRejection(msg)) {
            // Same fix as returns/exchanges: cloud rejection must never
            // block the local claim from being logged.
            toast(`Saved locally. Cloud sync skipped: ${msg || "rejected by server"}`, "amber");
          } else {
            try {
              await queueOfflineOperation(
                "warranty",
                "warranty_claims",
                {
                  claim: {
                    saleId: foundSale.id,
                    productId: item.productId,
                    customerId: foundSale.customerId,
                    claimNo,
                    issueDescription: warrantyIssue,
                  },
                },
                idempotencyKey
              );
            } catch {
              toast("Saved locally, but couldn't queue for background sync.", "amber");
            }
          }
        }
      }

      const claim: WarrantyClaim = {
        id: uid("wcl"),
        claimNo,
        saleId: foundSale.id,
        invoiceNo: foundSale.invoiceNo,
        productId: item.productId,
        productName: item.name,
        category: item.category,
        date: todayStr(),
        time: nowTimeStr(),
        issueDescription: warrantyIssue,
        status: "Open",
        customerId: foundSale.customerId,
        customer: foundSale.customer,
        warrantyEnd: item.warrantyEnd || null,
        createdAt: new Date().toISOString(),
      };

      db.warrantyClaims = db.warrantyClaims || [];
      db.warrantyClaims.push(claim);
      db.warrantyClaimSeq = (db.warrantyClaimSeq || 1) + 1;

      onUpdate();
      toast(`Warranty claim ${claimNo} raised.`, "green");
      setFoundSale(null);
      setWarrantyProductId("");
      setWarrantyIssue("");
      setActiveTab("history");
    } finally {
      setIsSavingWarranty(false);
    }
  };

  const handleUpdateClaimStatus = async (claim: WarrantyClaim) => {
    const nextStatus = claimStatusDraft[claim.id] || claim.status;
    if (nextStatus === claim.status) return;

    if (isCloudConfigured && storeId) {
      try {
        const { error } = await supabase.rpc("update_warranty_claim_status_by_no", {
          p_store_id: storeId,
          p_claim_no: claim.claimNo,
          p_status: nextStatus,
          p_resolution: null,
        });
        if (error) throw error;
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        if (!isBusinessRejection(msg)) {
          try {
            await queueOfflineOperation(
              "warranty",
              "warranty_claims",
              { kind: "status_by_no", statusUpdate: { claimNo: claim.claimNo, status: nextStatus } },
              crypto.randomUUID()
            );
          } catch {
            /* best-effort — local status still updates below */
          }
        }
      }
    }

    claim.status = nextStatus as WarrantyClaim["status"];
    if (nextStatus === "Resolved" || nextStatus === "Rejected") {
      claim.resolvedAt = new Date().toISOString();
    }
    onUpdate();
    toast(`Claim ${claim.claimNo} marked ${nextStatus}.`, "green");
  };

  return (
    <div className="section">
      <div className="section-head">
        <div>
          <h2>🔄 Returns &amp; Exchanges Studio</h2>
          <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
            Process product returns, manage cash/account refunds, restock inventory, and issue exchange vouchers
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className={`btn sm ${activeTab === "history" ? "primary" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            📋 Return Records ({db.returns.length + db.exchanges.length})
          </button>
          {!isStaff && (
            <button
              className={`btn sm ${activeTab === "approvals" ? "primary" : ""}`}
              onClick={() => { setActiveTab("approvals"); void loadPendingApprovals(); }}
              style={pendingApprovals.length > 0 ? { borderColor: "var(--amber)" } : undefined}
            >
              <Clock size={13} /> Pending Approvals {pendingApprovals.length > 0 ? `(${pendingApprovals.length})` : ""}
            </button>
          )}
          <button
            className={`btn sm ${activeTab === "newReturn" ? "primary" : ""}`}
            onClick={() => {
              setActiveTab("newReturn");
              setFoundSale(null);
            }}
          >
            <RotateCcw size={13} /> + New Return
          </button>
          <button
            className={`btn sm ${activeTab === "newExchange" ? "primary" : ""}`}
            onClick={() => {
              setActiveTab("newExchange");
              setFoundSale(null);
            }}
          >
            <RefreshCw size={13} /> + New Exchange
          </button>
          <button
            className={`btn sm ${activeTab === "newWarranty" ? "primary" : ""}`}
            onClick={() => {
              setActiveTab("newWarranty");
              setFoundSale(null);
              setWarrantyProductId("");
              setWarrantyIssue("");
            }}
          >
            <ShieldCheck size={13} /> + Warranty Claim ({(db.warrantyClaims || []).length})
          </button>
        </div>
      </div>

      {/* Pending Return Approvals (owner/manager only) */}
      {activeTab === "approvals" && !isStaff && (
        <div className="card">
          <p style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: 0 }}>
            Staff ne submit kiye gaye returns yahan approval ka wait kar rahe hain — approve karne par hi stock
            wapas add hota hai aur refund record banta hai.
          </p>
          {approvalsLoading && pendingApprovals.length === 0 ? (
            <div className="empty">Loading...</div>
          ) : pendingApprovals.length === 0 ? (
            <div className="empty">Koi pending return approval nahi hai.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Return No.</th>
                    <th>Requested By</th>
                    <th>Reason</th>
                    <th>Refund Method</th>
                    <th>Items</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingApprovals.map((req) => (
                    <tr key={req.id}>
                      <td style={{ fontWeight: 700 }}>{req.return_no}</td>
                      <td>{req.requester_name || "Staff"}</td>
                      <td>{req.reason || "—"}</td>
                      <td>{req.refund_method || "—"}</td>
                      <td>{Array.isArray(req.items) ? req.items.length : 0} item(s)</td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            className="btn sm primary"
                            disabled={approvalBusyId === req.id}
                            onClick={() => void handleApproval(req.id, true)}
                          >
                            <CheckCircle2 size={13} /> Approve
                          </button>
                          <button
                            className="btn sm"
                            disabled={approvalBusyId === req.id}
                            onClick={() => void handleApproval(req.id, false)}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* New Return Flow */}
      {activeTab === "newReturn" && (
        <div style={{ background: "var(--paper)", padding: "16px", borderRadius: "10px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            Step 1: Look up Customer Invoice
          </h3>
          <form onSubmit={handleSearchInvoice} style={{ display: "flex", gap: "10px" }}>
            <input
              placeholder="Enter Invoice Number e.g. INV-0001"
              value={searchInvoiceNo}
              onChange={(e) => setSearchInvoiceNo(e.target.value)}
              style={{ maxWidth: "320px" }}
              autoFocus
            />
            <button type="submit" className="btn primary">
              <Search size={14} /> Find Invoice
            </button>
          </form>

          {foundSale && (
            <div style={{ marginTop: "16px", background: "var(--card)", padding: "16px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: "8px", marginBottom: "12px" }}>
                <div>
                  <b style={{ fontSize: "14.5px" }}>{foundSale.invoiceNo}</b> • {foundSale.date}
                  <div style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
                    Customer: <b>{foundSale.customer?.name || "Walk-in"}</b> ({foundSale.customer?.phone || "No phone"})
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "11px", color: "var(--ink-soft)" }}>Original Total</div>
                  <b style={{ fontSize: "15px", color: "var(--blue)" }}>{inr(foundSale.total)}</b>
                </div>
              </div>

              <h4 style={{ margin: "8px 0", fontSize: "12.5px", fontWeight: 800, color: "var(--ink)" }}>
                Select Items to Return:
              </h4>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {foundSale.items.map((item) => {
                  const maxQ = returnableQty(item);
                  return (
                  <div key={item.productId} className="cart-line" style={{ borderRadius: "6px" }}>
                    <div className="nm">
                      <b className="truncate" title={item.name}>{item.name}</b> <span className="hint">({item.category})</span>
                      <div className="hint">
                        Billed Qty: {item.qty} • Rate: {inr(item.price)}
                        {(item.returnedQty || 0) > 0 && ` • Already returned: ${item.returnedQty}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700 }}>Return Qty:</span>
                      <select
                        style={{ width: "70px", padding: "4px" }}
                        value={selectedReturnItems[item.productId] || 0}
                        disabled={maxQ === 0}
                        onChange={(e) =>
                          setSelectedReturnItems({
                            ...selectedReturnItems,
                            [item.productId]: Number(e.target.value),
                          })
                        }
                      >
                        {Array.from({ length: maxQ + 1 }, (_, i) => (
                          <option key={i} value={i}>
                            {i}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  );
                })}
              </div>

              <div className="formgrid" style={{ marginTop: "16px" }}>
                <div className="field">
                  <label>Return Reason</label>
                  <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)}>
                    <option>Defective / Not Working</option>
                    <option>Customer Changed Mind</option>
                    <option>Wrong Model Purchased</option>
                    <option>Warranty Claim</option>
                    <option>Packaging Damaged</option>
                  </select>
                </div>

                <div className="field">
                  <label>Refund Payment Method</label>
                  <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                    <option>Cash (From Counter Galla)</option>
                    <option>UPI / Online Transfer</option>
                    <option>Store Credit / Khata Adjustment</option>
                  </select>
                </div>

                <div className="field full">
                  <label>Additional Notes</label>
                  <input
                    placeholder="e.g. Returned with original bill and box"
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--line)" }}>
                <div>
                  <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>Total Refund Amount:</span>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--red)" }}>
                    {inr(calculateReturnRefund())}
                  </div>
                </div>

                <button
                  className="btn primary"
                  disabled={calculateReturnRefund() <= 0 || isSavingReturn}
                  onClick={handleProcessReturn}
                >
                  <CheckCircle2 size={16} /> {isSavingReturn ? "Saving..." : "Process Return & Restock Stock"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Exchange Flow */}
      {activeTab === "newExchange" && (
        <div style={{ background: "var(--paper)", padding: "16px", borderRadius: "10px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            Step 1: Search Original Invoice for Exchange
          </h3>
          <form onSubmit={handleSearchInvoice} style={{ display: "flex", gap: "10px" }}>
            <input
              placeholder="Enter Invoice Number e.g. INV-0001"
              value={searchInvoiceNo}
              onChange={(e) => setSearchInvoiceNo(e.target.value)}
              style={{ maxWidth: "320px" }}
              autoFocus
            />
            <button type="submit" className="btn primary">
              <Search size={14} /> Find Invoice
            </button>
          </form>

          {foundSale && (
            <div style={{ marginTop: "16px", background: "var(--card)", padding: "16px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              <div style={{ marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid var(--line)" }}>
                <b>Invoice: {foundSale.invoiceNo}</b> • Customer: <b>{foundSale.customer?.name || "Walk-in"}</b>
              </div>

              <div className="grid cols-2" style={{ gap: "16px" }}>
                {/* Returned Item selection */}
                <div>
                  <h4 style={{ margin: "0 0 8px", fontSize: "13px", color: "var(--red)" }}>
                    1. Item Being Given Back:
                  </h4>
                  {foundSale.items.map((item) => {
                    const maxQ = returnableQty(item);
                    return (
                    <div key={item.productId} className="cart-line">
                      <div className="nm">
                        <b className="truncate" title={item.name}>{item.name}</b>
                        <div className="hint">
                          {inr(item.price)} each
                          {(item.returnedQty || 0) > 0 && ` • Already returned: ${item.returnedQty}`}
                        </div>
                      </div>
                      <select
                        style={{ width: "65px", padding: "4px" }}
                        value={exchangeReturnItems[item.productId] || 0}
                        disabled={maxQ === 0}
                        onChange={(e) =>
                          setExchangeReturnItems({
                            ...exchangeReturnItems,
                            [item.productId]: Number(e.target.value),
                          })
                        }
                      >
                        {Array.from({ length: maxQ + 1 }, (_, i) => (
                          <option key={i} value={i}>{i}</option>
                        ))}
                      </select>
                    </div>
                    );
                  })}
                </div>

                {/* Replacement product selection */}
                <div>
                  <h4 style={{ margin: "0 0 8px", fontSize: "13px", color: "var(--green)" }}>
                    2. New Replacement Product:
                  </h4>
                  <div className="field">
                    <label>Select Product from Catalog</label>
                    <select
                      value={exchangeReplacementId}
                      onChange={(e) => setExchangeReplacementId(e.target.value)}
                    >
                      <option value="">-- Choose Replacement --</option>
                      {(catalogProducts || db.products).filter((p) => p.stock > 0).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({inr(p.sellingPrice)}) - Stock: {p.stock}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field" style={{ marginTop: "8px" }}>
                    <label>Quantity</label>
                    <input
                      type="number"
                      min="1"
                      value={exchangeReplacementQty}
                      onChange={(e) => setExchangeReplacementQty(Number(e.target.value) || 1)}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button className="btn primary" disabled={isSavingExchange} onClick={handleProcessExchange}>
                  <RefreshCw size={15} /> {isSavingExchange ? "Saving..." : "Complete Product Exchange"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Warranty Claim Flow */}
      {activeTab === "newWarranty" && (
        <div style={{ background: "var(--paper)", padding: "16px", borderRadius: "10px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            Step 1: Look up Customer Invoice
          </h3>
          <form onSubmit={handleSearchInvoice} style={{ display: "flex", gap: "10px" }}>
            <input
              placeholder="Enter Invoice Number e.g. INV-0001"
              value={searchInvoiceNo}
              onChange={(e) => setSearchInvoiceNo(e.target.value)}
              style={{ maxWidth: "320px" }}
              autoFocus
            />
            <button type="submit" className="btn primary">
              <Search size={14} /> Find Invoice
            </button>
          </form>

          {foundSale && (
            <div style={{ marginTop: "16px", background: "var(--card)", padding: "16px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: "8px", marginBottom: "12px" }}>
                <div>
                  <b style={{ fontSize: "14.5px" }}>{foundSale.invoiceNo}</b> • {foundSale.date}
                  <div style={{ fontSize: "12px", color: "var(--ink-soft)" }}>
                    Customer: <b>{foundSale.customer?.name || "Walk-in"}</b> ({foundSale.customer?.phone || "No phone"})
                  </div>
                </div>
              </div>

              <h4 style={{ margin: "8px 0", fontSize: "12.5px", fontWeight: 800, color: "var(--ink)" }}>
                Step 2: Select the item under warranty
              </h4>

              {foundSale.items.filter((it) => it.warrantyEnabled).length === 0 ? (
                <div className="hint" style={{ padding: "8px 0" }}>
                  No items on this invoice have warranty enabled.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {foundSale.items.filter((it) => it.warrantyEnabled).map((item) => {
                    const valid = isWarrantyValid(item);
                    return (
                      <label
                        key={item.productId}
                        className="cart-line"
                        style={{
                          borderRadius: "6px",
                          cursor: "pointer",
                          border: warrantyProductId === item.productId ? "2px solid var(--blue)" : "1px solid var(--line)",
                        }}
                      >
                        <input
                          type="radio"
                          name="warrantyItem"
                          checked={warrantyProductId === item.productId}
                          onChange={() => setWarrantyProductId(item.productId)}
                          style={{ marginRight: "8px" }}
                        />
                        <div className="nm">
                          <b className="truncate" title={item.name}>{item.name}</b> <span className="hint">({item.category})</span>
                          <div className="hint" style={{ color: valid ? "var(--green)" : "var(--red)" }}>
                            {valid ? (
                              <>
                                <ShieldCheck size={12} style={{ verticalAlign: "-2px" }} /> Warranty valid till {item.warrantyEnd}
                              </>
                            ) : (
                              <>
                                <Clock size={12} style={{ verticalAlign: "-2px" }} />{" "}
                                {item.warrantyEnd ? `Warranty expired on ${item.warrantyEnd}` : "No warranty window recorded"}
                              </>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              <h4 style={{ margin: "14px 0 8px", fontSize: "12.5px", fontWeight: 800, color: "var(--ink)" }}>
                Step 3: Describe the issue
              </h4>
              <textarea
                placeholder="e.g. Screen flickers intermittently, customer reports since last week"
                value={warrantyIssue}
                onChange={(e) => setWarrantyIssue(e.target.value)}
                rows={3}
                style={{ width: "100%" }}
              />

              <div className="modal-actions" style={{ marginTop: "16px" }}>
                <button
                  className="btn primary"
                  disabled={!warrantyProductId || !warrantyIssue.trim() || isSavingWarranty}
                  onClick={handleRaiseWarrantyClaim}
                >
                  <ShieldCheck size={15} /> {isSavingWarranty ? "Saving..." : "Raise Warranty Claim"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History List */}
      {activeTab === "history" && (
        <div>
          <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            Returns History ({db.returns.length})
          </h3>
          <div className="table-wrap returns-desktop-table" style={{ marginBottom: "20px" }}>
            {db.returns.length === 0 ? (
              <div className="empty">No returns logged yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Return #</th>
                    <th>Date</th>
                    <th>Invoice Ref</th>
                    <th>Customer</th>
                    <th>Returned Items</th>
                    <th>Refund Amount</th>
                    <th>Reason</th>
                    <th>Refund Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {db.returns.slice().reverse().map((r) => (
                    <tr key={r.id}>
                      <td><b style={{ color: "var(--red)" }}>{r.returnNo}</b></td>
                      <td>{r.date}</td>
                      <td><b>{r.invoiceNo}</b></td>
                      <td>{r.customer?.name || "Walk-in"}</td>
                      <td>
                        {r.items.map((i) => `${i.name} (x${i.qty})`).join(", ")}
                      </td>
                      <td><b style={{ color: "var(--red)" }}>{inr(r.settlementAmount)}</b></td>
                      <td>{r.reason}</td>
                      <td><span className="badge info">{r.refundMethod}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Mobile card list — same toggle pattern as the rest of this
              Phase 4 screen-by-screen pass. */}
          <div className="returns-mobile-list" style={{ marginBottom: "20px" }}>
            {db.returns.length === 0 ? (
              <div className="empty">No returns logged yet.</div>
            ) : (
              db.returns.slice().reverse().map((r) => (
                <div key={r.id} className="dash-mobile-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div className="dash-mobile-row-main">
                      <b style={{ color: "var(--red)" }}>{r.returnNo}</b>
                      <span className="hint">{r.invoiceNo} • {r.customer?.name || "Walk-in"} • {r.date}</span>
                    </div>
                    <b style={{ color: "var(--red)" }}>{inr(r.settlementAmount)}</b>
                  </div>
                  <span className="hint">{r.items.map((i) => `${i.name} (x${i.qty})`).join(", ")}</span>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="hint">{r.reason}</span>
                    <span className="badge info">{r.refundMethod}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            Exchanges History ({db.exchanges.length})
          </h3>
          <div className="table-wrap returns-desktop-table">
            {db.exchanges.length === 0 ? (
              <div className="empty">No exchanges logged yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Exchange #</th>
                    <th>Date</th>
                    <th>Invoice Ref</th>
                    <th>Given Back</th>
                    <th>Taken Replacement</th>
                    <th>Difference (₹)</th>
                    <th>Payment Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {db.exchanges.slice().reverse().map((exc) => (
                    <tr key={exc.id}>
                      <td><b style={{ color: "var(--purple)" }}>{exc.exchangeNo}</b></td>
                      <td>{exc.date}</td>
                      <td><b>{exc.invoiceNo}</b></td>
                      <td>{exc.returnedItems.map((i) => `${i.name} (x${i.qty})`).join(", ")}</td>
                      <td>{exc.replacementItems.map((i) => `${i.name} (x${i.qty})`).join(", ")}</td>
                      <td>
                        <b style={{ color: exc.differenceAmount >= 0 ? "var(--green)" : "var(--red)" }}>
                          {exc.differenceAmount >= 0 ? `+${inr(exc.differenceAmount)}` : inr(exc.differenceAmount)}
                        </b>
                      </td>
                      <td><span className="badge ok">{exc.settlementMethod}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="returns-mobile-list">
            {db.exchanges.length === 0 ? (
              <div className="empty">No exchanges logged yet.</div>
            ) : (
              db.exchanges.slice().reverse().map((exc) => (
                <div key={exc.id} className="dash-mobile-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div className="dash-mobile-row-main">
                      <b style={{ color: "var(--purple)" }}>{exc.exchangeNo}</b>
                      <span className="hint">{exc.invoiceNo} • {exc.date}</span>
                    </div>
                    <b style={{ color: exc.differenceAmount >= 0 ? "var(--green)" : "var(--red)" }}>
                      {exc.differenceAmount >= 0 ? `+${inr(exc.differenceAmount)}` : inr(exc.differenceAmount)}
                    </b>
                  </div>
                  <span className="hint">Given: {exc.returnedItems.map((i) => `${i.name} (x${i.qty})`).join(", ")}</span>
                  <span className="hint">Taken: {exc.replacementItems.map((i) => `${i.name} (x${i.qty})`).join(", ")}</span>
                  <span className="badge ok" style={{ alignSelf: "flex-start" }}>{exc.settlementMethod}</span>
                </div>
              ))
            )}
          </div>

        <h3 style={{ margin: "20px 0 10px", fontSize: "14px", fontWeight: 800, color: "var(--ink)" }}>
            Warranty Claims ({(db.warrantyClaims || []).length})
          </h3>
          <div className="table-wrap returns-desktop-table">
            {(db.warrantyClaims || []).length === 0 ? (
              <div className="empty">No warranty claims raised yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Claim #</th>
                    <th>Date</th>
                    <th>Invoice Ref</th>
                    <th>Item</th>
                    <th>Customer</th>
                    <th>Issue</th>
                    <th>Status</th>
                    <th>Next Reminder</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(db.warrantyClaims || []).slice().reverse().map((c) => {
                    const statusColor =
                      c.status === "Resolved" ? "var(--green)" : c.status === "Rejected" ? "var(--red)" : "var(--amber)";
                    return (
                      <tr key={c.id}>
                        <td><b style={{ color: "var(--blue)" }}>{c.claimNo}</b></td>
                        <td>{c.date}</td>
                        <td><b>{c.invoiceNo}</b></td>
                        <td>{c.productName}</td>
                        <td>{c.customer?.name || "Walk-in"}</td>
                        <td style={{ maxWidth: "220px" }}>{c.issueDescription}</td>
                        <td><span className="badge" style={{ background: statusColor, color: "#fff" }}>{c.status}</span></td>
                        <td>
                          {c.status === "Resolved" || c.status === "Rejected" ? (
                            <span className="hint">—</span>
                          ) : reminderInfo[c.claimNo] ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontWeight: 700 }}>{formatReminderDate(reminderInfo[c.claimNo].nextReminderAt)}</span>
                              <span className="hint">{reminderInfo[c.claimNo].reminderCount}x sent</span>
                              <button
                                className="btn sm"
                                style={{ marginTop: "2px" }}
                                disabled={remindingClaimNo === c.claimNo}
                                onClick={() => handleRemindNow(c.claimNo)}
                              >
                                {remindingClaimNo === c.claimNo ? "Sending…" : "Remind Now"}
                              </button>
                            </div>
                          ) : (
                            <span className="hint">Syncing…</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <select
                              value={claimStatusDraft[c.id] || c.status}
                              onChange={(e) => setClaimStatusDraft({ ...claimStatusDraft, [c.id]: e.target.value })}
                            >
                              <option value="Open">Open</option>
                              <option value="In Progress">In Progress</option>
                              <option value="Resolved">Resolved</option>
                              <option value="Rejected">Rejected</option>
                            </select>
                            <button className="btn sm" onClick={() => handleUpdateClaimStatus(c)}>
                              Update
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="returns-mobile-list">
            {(db.warrantyClaims || []).length === 0 ? (
              <div className="empty">No warranty claims raised yet.</div>
            ) : (
              (db.warrantyClaims || []).slice().reverse().map((c) => {
                const statusColor =
                  c.status === "Resolved" ? "var(--green)" : c.status === "Rejected" ? "var(--red)" : "var(--amber)";
                return (
                  <div key={c.id} className="dash-mobile-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div className="dash-mobile-row-main">
                        <b style={{ color: "var(--blue)" }}>{c.claimNo}</b>
                        <span className="hint">{c.productName} • {c.invoiceNo} • {c.date}</span>
                        <span className="hint">{c.customer?.name || "Walk-in"}</span>
                      </div>
                      <span className="badge" style={{ background: statusColor, color: "#fff", height: "fit-content" }}>{c.status}</span>
                    </div>
                    <span className="hint">{c.issueDescription}</span>
                    {c.status !== "Resolved" && c.status !== "Rejected" && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        {reminderInfo[c.claimNo] ? (
                          <span className="hint">
                            Next reminder: <b>{formatReminderDate(reminderInfo[c.claimNo].nextReminderAt)}</b> • {reminderInfo[c.claimNo].reminderCount}x sent
                          </span>
                        ) : (
                          <span className="hint">Syncing…</span>
                        )}
                        <button
                          className="btn sm"
                          style={{ minHeight: "36px" }}
                          disabled={!reminderInfo[c.claimNo] || remindingClaimNo === c.claimNo}
                          onClick={() => handleRemindNow(c.claimNo)}
                        >
                          {remindingClaimNo === c.claimNo ? "Sending…" : "Remind Now"}
                        </button>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "6px" }}>
                      <select
                        style={{ flex: 1, minHeight: "40px" }}
                        value={claimStatusDraft[c.id] || c.status}
                        onChange={(e) => setClaimStatusDraft({ ...claimStatusDraft, [c.id]: e.target.value })}
                      >
                        <option value="Open">Open</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Resolved">Resolved</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                      <button className="btn sm" style={{ minHeight: "40px" }} onClick={() => handleUpdateClaimStatus(c)}>
                        Update
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
      </div>
      )}
    </div>
  );
};
