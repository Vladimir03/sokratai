

## Fix: Chat area collapses to zero after sending a message

### Root cause

`GuidedHomeworkWorkspace.tsx` line 377-381 uses `messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })` to auto-scroll after messages update. 

`scrollIntoView` scrolls **all** scrollable ancestors — not just the immediate `overflow-y-auto` container. The fixed overlay sits inside AuthGuard's wrapper `<div className="pt-14 pb-20">`, which is a normal-flow block that CAN scroll. When `scrollIntoView` fires, it pushes the AuthGuard wrapper out of view, creating the white void below the navigation bar. The fixed overlay stays positioned correctly, but its parent content has scrolled away, causing the visual collapse.

### Fix

**File: `src/components/homework/GuidedHomeworkWorkspace.tsx`**

1. **Add a ref to the messages scroll container** (the `flex-1 overflow-y-auto` div at line 1340):
   ```tsx
   const messagesContainerRef = useRef<HTMLDivElement>(null);
   ```

2. **Replace `scrollIntoView` with direct container scroll** (line 377-381):
   ```tsx
   useEffect(() => {
     const container = messagesContainerRef.current;
     if (container) {
       container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
     }
   }, [messages, currentTaskOrder, streamingContent]);
   ```
   This scrolls only the messages container, never ancestors.

3. **Attach the ref** to the messages div:
   ```tsx
   <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
   ```

4. **Keep `messagesEndRef`** only as the scroll sentinel inside the container (no changes needed to the `<div ref={messagesEndRef} />` at line 1378).

### Why this fixes it

`container.scrollTo()` operates on the element itself — it cannot scroll ancestors. The AuthGuard wrapper stays at scroll position 0, and the chat messages scroll correctly within their container.

