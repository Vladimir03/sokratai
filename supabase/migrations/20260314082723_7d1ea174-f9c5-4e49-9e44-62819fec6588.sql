
-- Create kb-attachments bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('kb-attachments', 'kb-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: authenticated users can upload to their own folder
CREATE POLICY "kb_attachments_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'kb-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS: authenticated users can read all kb-attachments
CREATE POLICY "kb_attachments_select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'kb-attachments');

-- RLS: authenticated users can update their own files
CREATE POLICY "kb_attachments_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'kb-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS: authenticated users can delete their own files
CREATE POLICY "kb_attachments_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'kb-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
