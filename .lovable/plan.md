

## Fix: AddStudentDialog missing props in TutorDashboard

The build error is straightforward. The `AddStudentDialog` component now requires 4 new props (`miniGroupsEnabled`, `groups`, `onCreateGroup`, `onSyncStudentMembership`) added as part of the mini-groups foundation, but the `TutorDashboard.tsx` usage was not updated.

Since the Dashboard doesn't use mini-groups functionality, I'll pass safe defaults:

### Changes to `src/pages/tutor/TutorDashboard.tsx` (lines 422-431)

Add the 4 missing props with no-op/empty defaults:

```tsx
<AddStudentDialog
  open={inviteModalOpen}
  onOpenChange={setInviteModalOpen}
  inviteCode={inviteCode}
  inviteWebLink={inviteWebLink}
  inviteTelegramLink={inviteTelegramLink}
  miniGroupsEnabled={false}
  groups={[]}
  onCreateGroup={async () => null}
  onSyncStudentMembership={async () => {}}
  onManualAdded={(tutorStudentId) => {
    navigate(`/tutor/students/${tutorStudentId}`);
  }}
/>
```

This fixes the TypeScript error while keeping mini-group controls hidden on the Dashboard (they're only relevant on the Students page).

