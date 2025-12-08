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

    // show loading while refreshing for a new userId
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      // Single source of truth from Postgres
      const { data: status, error } = await supabase
        .rpc('get_subscription_status', { p_user_id: userId })
        .single();

      if (error || !status) {
        console.error('Error fetching subscription:', error);
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      const isPremium = Boolean(status.is_premium);
      const isTrialActive = Boolean(status.is_trial_active);
      const trialEndsAt = status.trial_ends_at as string | null;
      const trialDaysLeft = status.trial_days_left || 0;
      const dailyLimit = status.daily_limit ?? FREE_DAILY_LIMIT;
      const messagesUsed = status.messages_used ?? 0;
      const limitReached = Boolean(status.limit_reached);

      if (isPremium) {
        setState({
          isPremium: true,
          subscriptionTier: 'premium',
          subscriptionExpiresAt: status.subscription_expires_at as string | null,
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

      setState({
        isPremium: false,
        subscriptionTier: 'free',
        subscriptionExpiresAt: null,
        isTrialActive: false,
        trialEndsAt: trialEndsAt || null,
        trialDaysLeft: 0,
        messagesUsed,
        dailyLimit,
        isLoading: false,
        limitReached
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
