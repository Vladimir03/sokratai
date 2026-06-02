/**
 * Stub for schedule-bulk-complete CC-B (баннер + sheet).
 * RPCs (`tutor_confirm_lessons` / `tutor_revert_lesson`) shipped in CC-A
 * (commit 594d197a) and the wiring import in `TutorSchedule.tsx` shipped in
 * 67462e3b, but the component itself has not landed in main yet. This stub
 * keeps the preview build green; replace when CC-B is merged.
 */
import type { TutorLesson } from '@/types/tutor';

interface Props {
  onOpenMaterials?: (lesson: TutorLesson) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PastLessonsConfirmBanner(_props: Props) {
  return null;
}

export default PastLessonsConfirmBanner;