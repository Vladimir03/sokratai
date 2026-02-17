
-- 1. Security definer functions to break RLS recursion
CREATE OR REPLACE FUNCTION public.is_assignment_tutor(_assignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM homework_tutor_assignments
    WHERE id = _assignment_id AND tutor_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.is_assignment_student(_assignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM homework_tutor_student_assignments
    WHERE assignment_id = _assignment_id AND student_id = auth.uid()
  )
$$;

-- 2. Fix homework_tutor_assignments student SELECT policy
DROP POLICY IF EXISTS "HW students select assigned assignments" ON homework_tutor_assignments;
CREATE POLICY "HW students select assigned assignments"
ON homework_tutor_assignments FOR SELECT
USING (
  status IN ('active','closed')
  AND is_assignment_student(id)
);

-- 3. Fix homework_tutor_student_assignments policies (remove cross-table subqueries)
DROP POLICY IF EXISTS "HW tutor student assignments select by owner" ON homework_tutor_student_assignments;
CREATE POLICY "HW tutor student assignments select by owner"
ON homework_tutor_student_assignments FOR SELECT
USING (is_assignment_tutor(assignment_id) AND is_tutor_of_student(student_id));

DROP POLICY IF EXISTS "HW tutor student assignments insert by owner" ON homework_tutor_student_assignments;
CREATE POLICY "HW tutor student assignments insert by owner"
ON homework_tutor_student_assignments FOR INSERT
WITH CHECK (is_assignment_tutor(assignment_id) AND is_tutor_of_student(student_id));

DROP POLICY IF EXISTS "HW tutor student assignments delete by owner" ON homework_tutor_student_assignments;
CREATE POLICY "HW tutor student assignments delete by owner"
ON homework_tutor_student_assignments FOR DELETE
USING (is_assignment_tutor(assignment_id) AND is_tutor_of_student(student_id));

-- 4. Fix storage policies for homework-images bucket (replace recursive JOINs)
-- Drop existing problematic policies
DROP POLICY IF EXISTS "HW student upload homework images" ON storage.objects;
DROP POLICY IF EXISTS "HW student read own homework images" ON storage.objects;
DROP POLICY IF EXISTS "HW tutor read homework images" ON storage.objects;
DROP POLICY IF EXISTS "HW student update own homework images" ON storage.objects;
DROP POLICY IF EXISTS "HW student delete own homework images" ON storage.objects;

-- Recreate with security definer functions instead of recursive JOINs
CREATE POLICY "HW student upload homework images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'homework-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = 'homework'
);

CREATE POLICY "HW student read own homework images"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'homework-images'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "HW student update own homework images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'homework-images'
  AND auth.uid() = owner
);

CREATE POLICY "HW student delete own homework images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'homework-images'
  AND auth.uid() = owner
);

-- 5. Also fix homework_tutor_tasks student SELECT policy which references both tables
DROP POLICY IF EXISTS "HW students select tasks of assigned assignments" ON homework_tutor_tasks;
CREATE POLICY "HW students select tasks of assigned assignments"
ON homework_tutor_tasks FOR SELECT
USING (
  is_assignment_student(assignment_id)
  AND (SELECT status FROM homework_tutor_assignments WHERE id = assignment_id) IN ('active','closed')
);
