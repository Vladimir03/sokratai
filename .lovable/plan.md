

## Fix: Chat empty space + Guided homework chat closing on answer

### Problem 1 — Empty space in Chat header
The Chat page uses `top-[110px] md:top-[104px]` for the fixed chat container, but Navigation is only `h-14` (56px). This creates ~54px of dead space visible in the screenshot. The sidebar also uses `top-[110px]`.

**Fix**: Change `top-[110px]` → `top-14` (both mobile and desktop) in `src/pages/Chat.tsx`:
- Line 1761: main chat container `top-[110px] md:top-[104px]` → `top-14`
- Line 1778: mobile sidebar `top-[110px]` → `top-14`

### Problem 2 — Chat closes when student submits answer
In `GuidedHomeworkWorkspace.tsx`, when `syncThreadFromResponse` sets `threadStatus = 'completed'` (after all tasks done), the component immediately renders the "completed" card (line 1199), replacing the entire chat. The student loses the AI's last feedback message.

**Fix**: Instead of immediately switching to completed view, add a delay/confirmation:
- Add `showCompletedView` state (default `false`)
- When `threadStatus` becomes `'completed'`, don't immediately render the completed card — show the last task's messages with a "Результаты" button
- Only switch to completed view when student clicks the button or after initial mount with `completed` status (returning user)

**Files to modify:**
1. `src/pages/Chat.tsx` — fix `top-[110px]` → `top-14` (2 places)
2. `src/components/homework/GuidedHomeworkWorkspace.tsx` — delay completed view transition

### Technical details

**Chat.tsx** (2 line changes):
```
// Line 1761
- "fixed inset-0 top-[110px] md:top-[104px] flex flex-col"
+ "fixed inset-0 top-14 flex flex-col"

// Line 1778
- 'fixed top-[110px] bottom-0 left-0 z-50 w-80 ...'
+ 'fixed top-14 bottom-0 left-0 z-50 w-80 ...'
```

**GuidedHomeworkWorkspace.tsx**:
- New state: `const [showCompletedView, setShowCompletedView] = useState(false)`
- Initialize to `true` if thread is already `completed` on first load (user returning)
- On `syncThreadFromResponse`: when status transitions to `completed` during active session, keep `showCompletedView = false` so the chat stays visible with the last AI response
- Replace the completed guard `if (threadStatus === 'completed')` with `if (threadStatus === 'completed' && showCompletedView)`
- Add a prominent "Посмотреть результаты" button in the chat when `threadStatus === 'completed' && !showCompletedView`

