import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const FREE_DAILY_LIMIT = 10;

interface SubscriptionState {
  isPremium: boolean;
  subscriptionTier: 'free' | 'premium';
  subscriptionExpiresAt: string | null;
  isTrialActive: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number;
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
    isTrialActive: false,
    trialEndsAt: null,
    trialDaysLeft: 0,
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
      // Fetch profile with subscription and trial info
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('subscription_tier, subscription_expires_at, trial_ends_at')
        .eq('id', userId)
        .single();

      if (profileError) {
        console.error('Error fetching subscription:', profileError);
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      // Check premium status (highest priority)
      const isPremium = profile?.subscription_tier === 'premium' && 
        (!profile?.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date());

      if (isPremium) {
        setState({
          isPremium: true,
          subscriptionTier: 'premium',
          subscriptionExpiresAt: profile?.subscription_expires_at,
          isTrialActive: false,
          trialEndsAt: null,
          trialDaysLeft: 0,
          messagesUsed: 0,
          dailyLimit: -1,
          isLoading: false,
          limitReached: false
        });
        return;
      }

      // Check trial status (second priority)
      const trialEndsAt = profile?.trial_ends_at;
      const isTrialActive = trialEndsAt && new Date(trialEndsAt) > new Date();
      const trialDaysLeft = isTrialActive 
        ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 0;

      if (isTrialActive) {
        setState({
          isPremium: false,
          subscriptionTier: 'free',
          subscriptionExpiresAt: null,
          isTrialActive: true,
          trialEndsAt,
          trialDaysLeft,
          messagesUsed: 0,
          dailyLimit: -1,
          isLoading: false,
          limitReached: false
        });
        return;
      }

      // For free users without trial, fetch daily message count
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
        isTrialActive: false,
        trialEndsAt: trialEndsAt || null,
        trialDaysLeft: 0,
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
      // Don't increment for premium or trial users
      if (prev.isPremium || prev.isTrialActive) return prev;
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
