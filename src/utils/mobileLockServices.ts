// Quick-pick list for the "Mobile Unlock / Lock Services" section under Sales/Jobs.
// Shop owners who take in phones for pattern/PIN removal, FRP (Google account)
// bypass, Mi/iCloud account removal etc. can log these as a job ticket in one
// tap instead of typing the issue out every time. Prices are just starting
// defaults — owner can edit the amount on every ticket before saving.
export interface MobileLockServiceOption {
  key: string;
  label: string;
  defaultPrice: number;
}

export const MOBILE_LOCK_SERVICES: MobileLockServiceOption[] = [
  { key: "pattern_pin", label: "Pattern / PIN Lock Remove", defaultPrice: 150 },
  { key: "frp_bypass", label: "FRP Bypass (Google Account Lock)", defaultPrice: 300 },
  { key: "mi_account", label: "Mi Account Remove", defaultPrice: 250 },
  { key: "icloud_remove", label: "iCloud / Apple ID Remove", defaultPrice: 500 },
  { key: "samsung_account", label: "Samsung Account Remove", defaultPrice: 250 },
  { key: "software_flash", label: "Software Flash / Dead Recovery", defaultPrice: 400 },
  { key: "custom", label: "Custom / Other Lock Service", defaultPrice: 0 },
];
