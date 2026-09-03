# Step 7.1 — Cloudflare R2 Setup (1 baar karna hai, 5 minute ka kaam)

Code + Edge Function already deployed hai (live Supabase project mein). Bas
Cloudflare ki taraf se **1 chhota manual step** baaki hai — yeh step is liye
manual hai kyunki R2 API credentials banana ek sensitive security action hai,
jo Anthropic ka Cloudflare connector automatically nahi kar sakta (isse koi
bhi AI session apne aap aapke R2 account ki full keys nahi bana sakta —
yeh jaan-boojhkar Cloudflare/Anthropic dono taraf se restrict hai).

## Already done (isse dobara mat karna)
- ✅ R2 buckets bana diye: `ds-mobile-digital-hub` (product photos, box-scan,
  invoices) aur `ds-mobile-digital-hub-private` (KYC documents).
- ✅ `supabase/functions/r2-storage` Edge Function likh kar **live deploy** kar
  diya hai (project: DS mobile & Digital Hub, ref `vjimgnmbgghtsfafamye`).
- ✅ App ka poora code (`photoStorage.ts`, `kycPhotoStorage.ts`, naya
  `r2Client.ts`) is naye function ko use karne ke liye already updated hai —
  koi aur code change nahi chahiye.

## Baaki 1 Step — R2 API Token banao aur 3 secrets set karo

1. Cloudflare Dashboard → **R2** → **Manage R2 API Tokens** → **Create API Token**.
2. Naam: `ds-mobile-digital-hub-r2` (ya kuch bhi).
3. Permissions: **Object Read & Write**.
4. Bucket scope: dono buckets select karo — `ds-mobile-digital-hub` aur
   `ds-mobile-digital-hub-private` (ya "Apply to all buckets" bhi chalega).
5. Create karne ke baad Cloudflare 3 cheezein dikhayega — **abhi copy kar lo,
   dobara nahi dikhega**:
   - **Account ID**
   - **Access Key ID**
   - **Secret Access Key**
6. Ab Supabase Dashboard → project **DS mobile & Digital Hub** → **Edge
   Functions** → **r2-storage** → **Secrets** (ya **Settings → Edge Functions
   → Secrets**, Supabase UI version ke hisaab se) → yeh 3 secrets add karo:

   | Secret name | Value |
   |---|---|
   | `CF_ACCOUNT_ID` | Cloudflare se copy kiya hua Account ID |
   | `CF_R2_ACCESS_KEY_ID` | Access Key ID |
   | `CF_R2_SECRET_ACCESS_KEY` | Secret Access Key |

7. Save karte hi (redeploy ki zaroorat nahi — function secrets ko live
   read karta hai) product photo upload/KYC photo upload turant Cloudflare
   R2 mein jaana shuru ho jayega.

## Isse pehle kya hota hai (secrets set hone tak)
Function abhi bhi bilkul safe rehta hai — agar secrets missing hain to har
upload attempt cleanly fail ho jaata hai aur app apne aap purane fallback
(compressed photo seedha data mein, jaise pehle tha) pe chali jaati hai.
Koi crash nahi, koi data loss nahi — bas heavy files tab tak Cloudflare
mein migrate nahi hongi jab tak yeh 1 step na ho.

## Verify kaise karein (secrets set karne ke baad)
1. App kholo → koi bhi product photo add/edit karo.
2. Product ka `photo` field ab is pattern ka URL dikhna chahiye:
   `https://vjimgnmbgghtsfafamye.supabase.co/functions/v1/r2-storage/product/<storeId>/<file>.jpg`
   (`data:` se shuru nahi hona chahiye — matlab R2 upload successful hua).
3. Second-Hand KYC mein ek doc/seller photo upload karke check karo ki
   voucher mein photo dikh rahi hai (yeh authenticated fetch se load hoti
   hai, thoda slower ho sakta hai pehli baar).
