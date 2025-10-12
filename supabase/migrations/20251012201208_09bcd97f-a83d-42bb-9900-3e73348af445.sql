-- Drop the restrictive policy that blocks all operations
DROP POLICY IF EXISTS "Rate limits managed by system" ON api_rate_limits;

-- Allow users to insert their own rate limit records
CREATE POLICY "Users can insert own rate limits"
ON api_rate_limits
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own rate limit records
CREATE POLICY "Users can update own rate limits"
ON api_rate_limits
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);