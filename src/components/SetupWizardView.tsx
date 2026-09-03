import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, X } from "lucide-react";
import { Database } from "../types";
import { getGeminiKeyStatus } from "../services/geminiKeys";
import { listStaffAccounts } from "../services/staffAuth";
import { getCloudflareUsage } from "../services/storageUsage";

// STEP 11 — Day-Zero Setup Wizard (First-Launch Experience).
//
// Deliberately does NOT store its own "is step N done" flags for the 6
// steps that already have a real, checkable signal somewhere else in the
// app — same philosophy as Step 9.1's Status Dashboard ("never a separate
// fake health-check path that could drift from what's actually true").
// Only 2 things get a real settings flag:
//   - `pricingTutorialSeen` — there's no natural data signal for "owner
//     understood the 4-tier pricing", so this is an explicit ack.
//   - `setupWizardDismissed` — owner can permanently close the wizard
//     (whether they finished it or chose to skip); it then only opens again
//     if reopened manually from the sidebar.
// The other 6 checklist items are computed live from db/staff/keys/storage —
// exactly the plan's own steps 1,2,3,4,5,6,8 (5 becomes "first staff ID",
// 6 becomes "first product", 8 becomes "first test sale").

interface SetupWizardViewProps {
  db: Database;
  storeId: string | null | undefined;
  telegramConnected: boolean;
  onConnectTelegram: () => void;
  onNavigate: (page: string) => void;
  onOpenAddProduct: () => void;
  onMarkPricingUnderstood: () => void;
  onDismiss: () => void;
}

type StepStatus = "done" | "pending" | "checking";

const StepRow: React.FC<{
  n: number;
  title: string;
  desc: string;
  status: StepStatus;
  cta?: { label: string; onClick: () => void };
  extra?: React.ReactNode;
}> = ({ n, title, desc, status, cta, extra }) => (
  <div
    style={{
      display: "flex",
      gap: 14,
      padding: 16,
      borderRadius: 12,
      background: status === "done" ? "rgba(34,197,94,0.06)" : "var(--card)",
      border: `1px solid ${status === "done" ? "rgba(34,197,94,0.25)" : "var(--line)"}`,
      marginBottom: 10,
    }}
  >
    <div style={{ flexShrink: 0, marginTop: 2 }}>
      {status === "checking" ? (
        <Loader2 size={22} className="spin" style={{ opacity: 0.5 }} />
      ) : status === "done" ? (
        <CheckCircle2 size={22} color="#22c55e" />
      ) : (
        <Circle size={22} style={{ opacity: 0.3 }} />
      )}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 800, fontSize: 14.5 }}>
        {n}. {title}
      </div>
      <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>{desc}</div>
      {extra}
      {cta && status !== "done" && (
        <button className="btn sm primary" style={{ marginTop: 10 }} onClick={cta.onClick}>
          {cta.label}
        </button>
      )}
    </div>
  </div>
);

export const SetupWizardView: React.FC<SetupWizardViewProps> = ({
  db,
  storeId,
  telegramConnected,
  onConnectTelegram,
  onNavigate,
  onOpenAddProduct,
  onMarkPricingUnderstood,
  onDismiss,
}) => {
  const [loading, setLoading] = useState(true);
  const [geminiKeyCount, setGeminiKeyCount] = useState<number | null>(null);
  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [cloudflareReady, setCloudflareReady] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [geminiRes, staffRes, cfRes] = await Promise.allSettled([
      getGeminiKeyStatus(),
      storeId ? listStaffAccounts(storeId) : Promise.reject(new Error("Store abhi load nahi hua.")),
      storeId ? getCloudflareUsage(storeId) : Promise.reject(new Error("Store abhi load nahi hua.")),
    ]);
    setGeminiKeyCount(geminiRes.status === "fulfilled" ? geminiRes.value.filter((s) => s.hasKey).length : null);
    setStaffCount(staffRes.status === "fulfilled" ? staffRes.value.length : null);
    setCloudflareReady(cfRes.status === "fulfilled");
    setLoading(false);
  }, [storeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const shopDetailsDone = Boolean(
    db.settings.shopName?.trim() && db.settings.phone?.trim() && db.settings.address?.trim()
  );
  const productsDone = db.products.length > 0;
  const salesDone = db.sales.length > 0;
  const pricingDone = Boolean(db.settings.pricingTutorialSeen);

  const stepStatus = (real: boolean): StepStatus => (loading && real === false ? "checking" : real ? "done" : "pending");

  const items: { n: number; title: string; desc: string; status: StepStatus; cta?: { label: string; onClick: () => void }; extra?: React.ReactNode }[] = [
    {
      n: 1,
      title: "Shop details bharein",
      desc: "Naam, address, phone, UPI, invoice terms — yeh har bill par print hote hain.",
      status: shopDetailsDone ? "done" : "pending",
      cta: { label: "Shop Settings kholein", onClick: () => onNavigate("settings") },
    },
    {
      n: 2,
      title: "Telegram account connect karein",
      desc: "Security alerts, weekly reports, aur Confidential Price approvals Telegram par aayenge.",
      status: telegramConnected ? "done" : "pending",
      cta: { label: "Telegram Connect karein", onClick: onConnectTelegram },
    },
    {
      n: 3,
      title: "Gemini AI keys daalein",
      desc: "10 keys tak daal sakte hain — jitni zyada keys, AI auto-fill utna reliable rahega.",
      status: stepStatus(Boolean(geminiKeyCount && geminiKeyCount > 0)),
      cta: { label: "AI Keys panel kholein", onClick: () => onNavigate("settings") },
      extra: geminiKeyCount !== null && geminiKeyCount > 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{geminiKeyCount} of 10 slots mein key hai.</div>
      ) : undefined,
    },
    {
      n: 4,
      title: "Cloudflare storage connect karein",
      desc: "Product photos aur heavy files yahan store hoti hain — ek baar manual token setup chahiye hoga.",
      status: stepStatus(Boolean(cloudflareReady)),
      cta: { label: "Setup instructions dekhein (Status Dashboard)", onClick: () => onNavigate("statusDashboard") },
    },
    {
      n: 5,
      title: "Pehla Staff ID generate karein",
      desc: "Agar staff rakhna hai to unke liye login access yahan se banega. Skip kar sakte hain agar akela chala rahe ho.",
      status: stepStatus(Boolean(staffCount && staffCount > 0)),
      cta: { label: "Staff Access kholein", onClick: () => onNavigate("staffAccess") },
    },
    {
      n: 6,
      title: "Pehla product add karein",
      desc: "Test ke taur pe ek product add karke dekhein — AI auto-fill kaise brand/model/price bharta hai.",
      status: productsDone ? "done" : "pending",
      cta: { label: "Product Add karein", onClick: onOpenAddProduct },
    },
    {
      n: 7,
      title: "Pricing samjhein",
      desc: "4-tier pricing (Original/Confidential/Selling/MRP) ka chhota explainer neeche hai.",
      status: pricingDone ? "done" : "pending",
    },
    {
      n: 8,
      title: "Ek test sale karke dekhein",
      desc: "Invoice kaisa banta hai, discount/gift/warranty box kaisa dikhta hai — ek chhoti test sale karke check karein.",
      status: salesDone ? "done" : "pending",
      cta: { label: "New Bill kholein", onClick: () => onNavigate("sell") },
    },
  ];

  const doneCount = items.filter((i) => i.status === "done").length;
  const allDone = doneCount === items.length;

  return (
    <div className="section">
      <div className="section-head" style={{ alignItems: "flex-start" }}>
        <div>
          <h2>🚀 Shuruaati Setup Checklist</h2>
          <p className="hint" style={{ marginTop: 4 }}>
            Pehli baar shop set kar rahe hain? Yeh 8 steps follow karein — 30-45 minute mein poora system launch ke
            liye ready ho jaayega. Kabhi bhi skip/band kar sakte hain, sidebar ke "⚙️ System" mein yeh checklist
            hamesha mil jaayegi.
          </p>
        </div>
        <button className="btn sm" onClick={onDismiss} title="Wizard band karein">
          <X size={16} /> Band Karein
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "6px 0 18px",
        }}
      >
        <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--paper)", overflow: "hidden" }}>
          <div
            style={{
              width: `${(doneCount / items.length) * 100}%`,
              height: "100%",
              background: allDone ? "#22c55e" : "var(--blue)",
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
          {doneCount} / {items.length} complete
        </span>
      </div>

      {allDone && (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.3)",
            marginBottom: 16,
            fontWeight: 700,
          }}
        >
          ✅ Sab steps complete! Aapka shop launch ke liye ready hai.
        </div>
      )}

      {items.map((it) =>
        it.n === 7 ? (
          <div
            key={it.n}
            style={{
              display: "flex",
              gap: 14,
              padding: 16,
              borderRadius: 12,
              background: pricingDone ? "rgba(34,197,94,0.06)" : "var(--card)",
              border: `1px solid ${pricingDone ? "rgba(34,197,94,0.25)" : "var(--line)"}`,
              marginBottom: 10,
            }}
          >
            <div style={{ flexShrink: 0, marginTop: 2 }}>
              {pricingDone ? <CheckCircle2 size={22} color="#22c55e" /> : <Circle size={22} style={{ opacity: 0.3 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14.5 }}>7. Pricing samjhein</div>
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6, lineHeight: 1.6 }}>
                Har product mein 4 price fields ho sakte hain:
                <br />
                <b>Original Price</b> — aapki asli cost (sabse kam, sirf owner ko dikhta hai).
                <br />
                <b>Confidential Price</b> — special discount jo sirf approval ke baad staff use kar sakta hai.
                <br />
                <b>Selling Price</b> — normal counter price jo har customer ko dikhta/milta hai.
                <br />
                <b>MRP</b> — printed/label price (sabse zyada, sirf reference ke liye).
                <br />
                Order hamesha: Original ≤ Confidential ≤ Selling ≤ MRP.
              </div>
              {!pricingDone && (
                <button className="btn sm primary" style={{ marginTop: 10 }} onClick={onMarkPricingUnderstood}>
                  Samajh gaya
                </button>
              )}
            </div>
          </div>
        ) : (
          <StepRow key={it.n} n={it.n} title={it.title} desc={it.desc} status={it.status} cta={it.cta} extra={it.extra} />
        )
      )}
    </div>
  );
};
