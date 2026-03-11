

## Plan: Premium toggle for VladimirKam

There's already a "Сбросить на Free (dev)" button gated by `profile?.username === 'VladimirKam'` (line 445). I'll replace that single reset button with a proper toggle (Switch component) that lets you switch between Free and Premium.

### Changes

**File: `src/pages/Profile.tsx`** (lines 444–466)

Replace the existing "Сбросить на Free (dev)" button with a Switch toggle:
- Show only when `profile?.username === 'VladimirKam'`
- Label: "Premium (dev)" with a Crown icon
- Toggle ON → sets `subscription_tier: 'premium'`, `subscription_expires_at: +1 year`
- Toggle OFF → sets `subscription_tier: 'free'`, `subscription_expires_at: null`
- After toggle, call `subscription.refresh()`
- Import `Switch` from `@/components/ui/switch`

This keeps the existing payment flow for all other users untouched and gives only your account a quick dev toggle.

