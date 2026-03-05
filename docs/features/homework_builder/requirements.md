Feature: Homework Builder

WHEN tutor creates assignment
THE SYSTEM SHALL store assignment with deadline and max_attempts

WHEN tutor assigns homework to group
THE SYSTEM SHALL expand tutor_group_memberships

WHEN student opens homework from Telegram
THE SYSTEM SHALL authenticate student and open homework page

WHEN student opens homework
THE SYSTEM SHALL display tasks and materials

WHEN student submits attempt
THE SYSTEM SHALL validate deadline and max_attempts

WHEN student answers task
THE SYSTEM SHALL accept text answers

WHEN student uploads image
THE SYSTEM SHALL allow camera capture

WHEN student uploads image
THE SYSTEM SHALL store the image in homework-submissions storage

WHEN student uploads PDF
THE SYSTEM SHALL store the PDF in homework-submissions storage

WHEN submission finalized
THE SYSTEM SHALL create submission record