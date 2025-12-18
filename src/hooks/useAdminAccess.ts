import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useAdminAccess = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAdminAccess = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setIsAdmin(false);
          setIsLoading(false);
          return;
        }

        // Check admin access using the database function
        const { data, error } = await supabase.rpc("is_admin", { _user_id: user.id });
        
        if (error) {
          console.error("Error checking admin access:", error);
          setIsAdmin(false);
        } else {
          setIsAdmin(data === true);
        }
      } catch (error) {
        console.error("Error checking admin access:", error);
        setIsAdmin(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAdminAccess();
  }, []);

  return { isAdmin, isLoading };
};
