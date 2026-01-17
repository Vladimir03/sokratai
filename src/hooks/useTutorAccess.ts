import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

export const useTutorAccess = () => {
  const [isTutor, setIsTutor] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkTutorAccess = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setIsTutor(false);
          setIsLoading(false);
          return;
        }

        // Check tutor access using the database function
        const { data, error } = await supabase.rpc("is_tutor", { _user_id: user.id });
        
        if (error) {
          console.error("Error checking tutor access:", error);
          setIsTutor(false);
        } else {
          setIsTutor(data === true);
        }
      } catch (error) {
        console.error("Error checking tutor access:", error);
        setIsTutor(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkTutorAccess();
  }, []);

  return { isTutor, isLoading };
};
