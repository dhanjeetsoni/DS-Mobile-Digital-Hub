# Staff Access Manager — Part 1 of 3 (DONE)

Owner mode mein ab ek naya "Staff Access Manager" screen hai (Sidebar → More
Tools → Staff Access Manager, owner-only).

## Ye ab kaam karta hai
1. **Owner staff ka Login ID + Password bana sakta hai** ("Add Staff"). Staff
   ise Android/desktop app ke starting screen par "Staff Area" tap karke, wahi
   ID/Password daal ke login karega.
2. **Access ON/OFF toggle** — har staff ke aage "Turn OFF" button. OFF karte
   hi wo turant logout ho jaata/jaati hai aur dobara login try karne par
   screen par saaf "Access Disabled — Contact Shop Owner for Access" dikhta
   hai, app ke andar nahi ja paata.
3. **Password Reset** aur **Delete** bhi owner kar sakta hai.
4. Sab kuch Supabase (RLS + service-role Edge Function) ke through secure hai
   — password kabhi client code mein plaintext store nahi hota, sirf Supabase
   Auth ke through.
5. Agar shop cloud sync use hi nahi kar raha (offline-only install), staff
   area pehle jaisa hi kaam karta hai — koi breaking change nahi.

## Files add/change hue
- `supabase/migrations/20260829_staff_access_management_v14.sql` — naye
  columns (`staff_login_id`, `access_enabled`, `access_mode`,
  `access_expires_at`, `visibility_from`, etc.) `profiles` table mein +
  owner/manager RLS policy.
- `supabase/functions/staff-manage/` — naya Edge Function (create / reset
  password / delete — inhe service-role chahiye isliye server-side hai).
- `src/services/staffAuth.ts` — client helpers (list, toggle access, staff
  login).
- `src/components/StaffAccessView.tsx` — owner ka naya screen.
- `src/components/Sidebar.tsx`, `src/App.tsx` — naya nav item + staff login
  gate screen + "access disabled/expired" screen wire kiya.

## Deploy karne ke liye (ek hi baar)
```
supabase db push                     # naya migration apply
supabase functions deploy staff-manage
```

## Abhi baaki hai (Part 2 aur Part 3 mein aayega)
- **Part 2**: Hours/Minutes/Full-day/No-restriction access window + offline
  hote hue bhi time khatam hote hi auto-logout, aur "sirf grant ke baad ki
  sales/galla dikhna" (purana galla hidden, product list hamesha A-Z dikhti
  rahegi).
- **Part 3**: Realtime sale → stock deduct → invoice auto-generate bina extra
  owner-approval ke; offline pe hui sale local save ho ke net aane par
  auto-sync + "X sales pending sync" indicator; owner ke liye sale
  edit/delete/add A-to-Z rights; har sale ka default 10-din ka
  correction/edit window (owner ise change bhi kar sakta hai), uske baad
  permanently lock.

Ready ho to "ok" bolo — Part 2 par shuru kar deta hoon.
