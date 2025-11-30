import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const FREE_DAILY_LIMIT = 10;

interface SubscriptionState {
  isPremium: boolean;
  subscriptionTier: 'free' | 'premium';
  subscriptionExpiresAt: string | null;
  messagesUsed: number;
  dailyLimit: number;
  isLoading: boolean;
  limitReached: boolean;
}

export function useSubscription(userId: string | undefined) {
  const [state, setState] = useState<SubscriptionState>({
    isPremium: false,
    subscriptionTier: 'free',
    subscriptionExpiresAt: null,
    messagesUsed: 0,
    dailyLimit: FREE_DAILY_LIMIT,
    isLoading: true,
    limitReached: false
  });

  const fetchSubscriptionStatus = useCallback(async () => {
    if (!userId) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      // Fetch profile with subscription info
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('subscription_tier, subscription_expires_at')
        .eq('id', userId)
        .single();

      if (profileError) {
        console.error('Error fetching subscription:', profileError);
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      const isPremium = profile?.subscription_tier === 'premium' && 
        (!profile?.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date());

      if (isPremium) {
        setState({
          isPremium: true,
          subscriptionTier: 'premium',
          subscriptionExpiresAt: profile?.subscription_expires_at,
          messagesUsed: 0,
          dailyLimit: -1,
          isLoading: false,
          limitReached: false
        });
        return;
      }

      // For free users, fetch daily message count
      const today = new Date().toISOString().split('T')[0];
      const { data: limitData } = await supabase
        .from('daily_message_limits')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      const messagesUsed = (limitData?.last_reset_date === today) 
        ? limitData.messages_today 
        : 0;

      setState({
        isPremium: false,
        subscriptionTier: 'free',
        subscriptionExpiresAt: null,
        messagesUsed,
        dailyLimit: FREE_DAILY_LIMIT,
        isLoading: false,
        limitReached: messagesUsed >= FREE_DAILY_LIMIT
      });
    } catch (error) {
      console.error('Error in useSubscription:', error);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [userId]);

  useEffect(() => {
    fetchSubscriptionStatus();
  }, [fetchSubscriptionStatus]);

  const incrementMessageCount = useCallback(() => {
    setState(prev => {
      if (prev.isPremium) return prev;
      const newCount = prev.messagesUsed + 1;
      return {
        ...prev,
        messagesUsed: newCount,
        limitReached: newCount >= FREE_DAILY_LIMIT
      };
    });
  }, []);

  const setLimitReached = useCallback((reached: boolean) => {
    setState(prev => ({ ...prev, limitReached: reached }));
  }, []);

  return {
    ...state,
    refresh: fetchSubscriptionStatus,
    incrementMessageCount,
    setLimitReached
  };
}
