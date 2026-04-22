import { useState } from "react";
import { AdminHomeworkBreadcrumbs } from "./AdminHomeworkBreadcrumbs";
import { AdminTutorList } from "./AdminTutorList";
import { AdminTutorAssignmentList } from "./AdminTutorAssignmentList";
import { AdminAssignmentStudentList } from "./AdminAssignmentStudentList";
import { AdminHWThreadView, type AdminThreadHeader } from "./AdminHWThreadView";
import type { TutorOverview, AssignmentOverview, AssignmentStudentRow } from "@/lib/adminHomeworkApi";

type View = "tutors" | "assignments" | "students" | "thread";

export const AdminHomeworkChats = () => {
  const [view, setView] = useState<View>("tutors");
  const [tutor, setTutor] = useState<TutorOverview | null>(null);
  const [assignment, setAssignment] = useState<AssignmentOverview | null>(null);
  const [thread, setThread] = useState<AdminThreadHeader | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const goTutors = () => {
    setView("tutors");
    setTutor(null);
    setAssignment(null);
    setThread(null);
  };
  const goAssignments = () => {
    setView("assignments");
    setAssignment(null);
    setThread(null);
  };
  const goStudents = () => {
    setView("students");
    setThread(null);
  };

  const segments = [
    { label: "Репетиторы", onClick: view !== "tutors" ? goTutors : undefined },
    ...(tutor ? [{ label: tutor.tutorName, onClick: view !== "assignments" ? goAssignments : undefined }] : []),
    ...(assignment ? [{ label: assignment.title, onClick: view !== "students" ? goStudents : undefined }] : []),
    ...(thread ? [{ label: thread.studentName }] : []),
  ];

  return (
    <div>
      <AdminHomeworkBreadcrumbs
        segments={segments}
        onRefresh={() => setReloadKey((k) => k + 1)}
      />

      {view === "tutors" && (
        <AdminTutorList
          reloadKey={reloadKey}
          onSelectTutor={(t) => {
            setTutor(t);
            setView("assignments");
          }}
        />
      )}

      {view === "assignments" && tutor && (
        <AdminTutorAssignmentList
          tutorId={tutor.tutorId}
          reloadKey={reloadKey}
          onSelectAssignment={(a) => {
            setAssignment(a);
            setView("students");
          }}
        />
      )}

      {view === "students" && assignment && (
        <AdminAssignmentStudentList
          assignmentId={assignment.assignmentId}
          reloadKey={reloadKey}
          onSelectStudent={(s) => {
            if (!s.threadId) return;
            setThread({
              id: s.threadId,
              status: s.status,
              studentName: s.studentName,
              assignmentTitle: assignment.title,
              assignmentSubject: assignment.subject,
            });
            setView("thread");
          }}
        />
      )}

      {view === "thread" && thread && (
        <AdminHWThreadView thread={thread} />
      )}
    </div>
  );
};
