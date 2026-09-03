import React, { useState } from "react";
import { Star, MessageCircle } from "lucide-react";
import { Database, Customer } from "../types";
import { inr, round2 } from "../utils/indianCurrency";
import { openWhatsApp } from "../services/whatsapp";

interface LoyaltyRewardsViewProps {
  db: Database;
  onRedeemPoints: (customerId: string, points: number) => void;
  onUpdateLoyaltySettings: (settings: { loyaltyEnabled: boolean; loyaltyEarnPer100: number; loyaltyRedeemValue: number }) => void;
  showToast: (msg: string, color?: string) => void;
}

export const LoyaltyRewardsView: React.FC<LoyaltyRewardsViewProps> = ({ db, onRedeemPoints, onUpdateLoyaltySettings, showToast }) => {
  const [redeemAmount, setRedeemAmount] = useState<{ [id: string]: string }>({});

  const enabled = db.settings.loyaltyEnabled ?? false;
  const earnRate = db.settings.loyaltyEarnPer100 ?? 1;
  const redeemValue = db.settings.loyaltyRedeemValue ?? 0.5;

  const customersWithPoints = db.customers.filter((c) => (c.loyaltyPoints || 0) > 0 || enabled);
  const totalPointsOutstanding = db.customers.reduce((a, c) => a + (c.loyaltyPoints || 0), 0);

  const handleRedeem = (c: Customer) => {
    const pts = parseInt(redeemAmount[c.id] || "0", 10);
    if (!pts || pts <= 0) {
      showToast("Enter a valid number of points to redeem.", "red");
      return;
    }
    if (pts > (c.loyaltyPoints || 0)) {
      showToast("Customer does not have that many points.", "red");
      return;
    }
    onRedeemPoints(c.id, pts);
    setRedeemAmount((prev) => ({ ...prev, [c.id]: "" }));
    showToast(`Redeemed ${pts} points (worth ${inr(round2(pts * redeemValue))}) for ${c.name}`, "green");
  };

  return (
    <div>
      <div className="section" style={{ marginBottom: "16px" }}>
        <div className="section-head">
          <h2><Star size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />Loyalty &amp; Rewards Settings</h2>
        </div>
        <div className="grid cols-3" style={{ gap: "12px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onUpdateLoyaltySettings({ loyaltyEnabled: e.target.checked, loyaltyEarnPer100: earnRate, loyaltyRedeemValue: redeemValue })}
            />
            Enable loyalty points
          </label>
          <label style={{ fontSize: "13px" }}>
            Points earned per ₹100 spent
            <input
              type="number"
              min={0}
              step={0.5}
              value={earnRate}
              onChange={(e) => onUpdateLoyaltySettings({ loyaltyEnabled: enabled, loyaltyEarnPer100: Number(e.target.value), loyaltyRedeemValue: redeemValue })}
              style={{ width: "100%", marginTop: "4px" }}
            />
          </label>
          <label style={{ fontSize: "13px" }}>
            ₹ value per point when redeemed
            <input
              type="number"
              min={0}
              step={0.1}
              value={redeemValue}
              onChange={(e) => onUpdateLoyaltySettings({ loyaltyEnabled: enabled, loyaltyEarnPer100: earnRate, loyaltyRedeemValue: Number(e.target.value) })}
              style={{ width: "100%", marginTop: "4px" }}
            />
          </label>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "16px", maxWidth: "260px" }}>
        <h3>Points outstanding</h3>
        <div className="big purple">{totalPointsOutstanding}</div>
        <div className="foot">Worth {inr(round2(totalPointsOutstanding * redeemValue))} if redeemed today</div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Customer point balances</h2>
        </div>
        {customersWithPoints.length === 0 ? (
          <div className="empty">No customers with loyalty points yet. Points are earned automatically on sale.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Points</th>
                  <th>Redeemable value</th>
                  <th>Redeem points</th>
                  <th>Notify</th>
                </tr>
              </thead>
              <tbody>
                {customersWithPoints.map((c) => (
                  <tr key={c.id}>
                    <td><b className="truncate" title={c.name}>{c.name}</b></td>
                    <td>{c.phone}</td>
                    <td style={{ fontWeight: 800 }}>{c.loyaltyPoints || 0}</td>
                    <td>{inr(round2((c.loyaltyPoints || 0) * redeemValue))}</td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          type="number"
                          min={0}
                          placeholder="Points"
                          value={redeemAmount[c.id] || ""}
                          onChange={(e) => setRedeemAmount((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          style={{ width: "80px" }}
                        />
                        <button className="btn sm primary" onClick={() => handleRedeem(c)} disabled={!(c.loyaltyPoints || 0)}>
                          Redeem
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="btn sm blue"
                        onClick={() =>
                          openWhatsApp(
                            c.phone,
                            `Hi ${c.name}, you have ${c.loyaltyPoints || 0} reward points (worth ${inr(round2((c.loyaltyPoints || 0) * redeemValue))}) waiting at ${db.settings.shopName || "our shop"}!`
                          )
                        }
                      >
                        <MessageCircle size={14} /> WhatsApp
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
