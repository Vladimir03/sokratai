-- Политика для чтения всех чатов админами
CREATE POLICY "Admins can view all chats" 
ON public.chats 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_admin_email(auth.uid()));

-- Политика для чтения всех сообщений админами
CREATE POLICY "Admins can view all messages" 
ON public.chat_messages 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_admin_email(auth.uid()));

-- Политика для чтения всех профилей админами (чтобы видеть имена)
CREATE POLICY "Admins can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_admin_email(auth.uid()));