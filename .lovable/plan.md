

## Replace old SVG logo with new PNG everywhere

### Problem
The new logo PNG was only applied in `SokratLogo.tsx` (used in HowItWorks). Four other files still have the old inline SVG logo hardcoded.

### Files to update

1. **`src/components/Navigation.tsx`** (line ~35) — student navbar logo
   - Replace the inline `<svg>` with `<img src={sokratLogo} alt="Сократ" className="w-8 h-8" />`
   - Import `sokratLogo` from `@/assets/sokrat-logo.png`

2. **`src/pages/Index.tsx`** (line ~126) — hero section large logo
   - Replace the inline `<svg>` with `<img src={sokratLogo} alt="Сократ" className="w-20 h-20 md:w-24 md:h-24 flex-shrink-0" />`
   - Import `sokratLogo`

3. **`src/components/tutor/TutorLayout.tsx`** (line ~116) — tutor dashboard navbar logo
   - Replace the inline `<svg>` with `<img src={sokratLogo} alt="Сократ" className="w-7 h-7" />`
   - Import `sokratLogo`

4. **`src/components/sections/Footer.tsx`** (line ~9) — footer logo
   - Replace the inline `<svg>` with `<img src={sokratLogo} alt="Сократ" className="w-16 h-16" />`
   - Import `sokratLogo`

### Approach
Each file: add one import line, replace ~15-line inline SVG block with a single `<img>` tag keeping the same `className` for sizing. No other changes.

