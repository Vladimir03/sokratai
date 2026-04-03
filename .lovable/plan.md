

## Replace Site Icon Everywhere with Uploaded Image

### What changes

1. **Copy uploaded PNG to project** as `src/assets/sokrat-logo.png` (for React components) and `public/sokrat-logo.png` (for favicon)

2. **Favicon** — update `index.html`:
   - Add `<link rel="icon" href="/sokrat-logo.png" type="image/png">`
   - Delete `public/favicon.ico` if it exists (browsers auto-request it and it overrides)

3. **SokratLogo component** — rewrite `src/components/SokratLogo.tsx`:
   - Replace the inline SVG with an `<img>` tag importing from `@/assets/sokrat-logo.png`
   - Keep the same `className` prop for sizing
   - This automatically updates everywhere it's used (currently: `HowItWorks.tsx` section header)

### Quality preservation
- The uploaded PNG is high-resolution. Using it as-is (not converting to SVG) preserves full quality.
- For favicon, browsers handle PNG favicons well at all sizes.
- For the React component, the image scales cleanly via CSS `width`/`height` classes already passed as `className`.

### Files modified
- `index.html` — favicon link
- `src/components/SokratLogo.tsx` — img instead of SVG
- `src/assets/sokrat-logo.png` — new file (copy from upload)
- `public/sokrat-logo.png` — new file (copy from upload)

