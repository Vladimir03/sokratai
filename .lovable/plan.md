

## Fix: Eliminate slow icon loading on landing page

### Problem
The chat icon (`sokrat-chat-icon.png`) is **2.8 MB** and **1645x1645 px**, but displayed at only 96x96 CSS pixels. Same issue with `sokrat-logo.png` (2.7 MB). On slow connections, these massive images load visibly late.

### Solution
Resize and compress both images to appropriate dimensions:

- **sokrat-chat-icon.png**: resize to 192x192 px (2x retina for max display of 96px) — expected size ~10-20 KB
- **sokrat-logo.png**: resize to 192x192 px (2x retina for max display of 64px in footer) — expected size ~10-20 KB
- Also update `public/sokrat-logo.png` (favicon) to a smaller version

This alone will reduce load time by ~99%. No code changes needed — just optimized assets replacing the current ones.

### Steps
1. Resize `src/assets/sokrat-chat-icon.png` to 192x192 with PNG compression
2. Resize `src/assets/sokrat-logo.png` to 192x192 with PNG compression
3. Resize `public/sokrat-logo.png` to 192x192 with PNG compression

### Technical note
At 192px, the images cover 2x retina at every usage (hero: 96px, footer: 64px, navbar: 32px). Quality will be identical to the eye since the originals were being downscaled by the browser anyway.

