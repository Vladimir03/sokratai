
## Fix blank space in “Понимай предметы сам...” block

### What is actually wrong
The cards in `ValueProposition.tsx` are still rendered with `fade-base`, which sets them to `opacity: 0` by default. They only become visible if `useScrollAnimation()` successfully adds `animate-fade-in-up`.

So the empty white area is not “removed” right now — the cards are simply hidden.

There is also a second source of fragility:
- `Card` already has its own default mount animation in `src/components/ui/card.tsx`
- `ValueProposition` adds a separate scroll-hidden animation on top

That combination is brittle for a near-the-top landing section.

### Minimal fix
Make the 3 value cards visible immediately instead of depending on `IntersectionObserver`.

### Planned changes
1. **Update `src/components/sections/ValueProposition.tsx`**
   - remove `useScrollAnimation` from this section
   - remove `fade-base` from the cards
   - render cards normally so they are always visible on first paint

2. **Disable double animation on these cards**
   - pass `animate={false}` to `Card` in this section if needed
   - keep hover styles (`hover:shadow-elegant`, `hover:-translate-y-2`, etc.)

3. **Keep spacing compact**
   - preserve the reduced section padding already applied
   - keep the grid and text layout unchanged

### Technical details
Current issue in code:
```tsx
<Card
  ref={ref}
  className="fade-base ..."
>
```

And in CSS:
```css
.fade-base {
  opacity: 0;
  transform: translateY(30px);
}
```

If the observer does not reveal the card in time, the user sees whitespace with no text.

Safer result:
- for this specific section, cards should not start hidden at all
- this removes the failure mode completely instead of trying to “fix” observer timing

### Files to modify
- `src/components/sections/ValueProposition.tsx`

### Optional follow-up audit
I also see the same hidden-by-default animation pattern in other landing sections (`AhaMoments`, `Testimonials`). I would first fix this block only, then optionally audit the rest of the landing for similar “invisible until observed” behavior so this does not repeat elsewhere.
