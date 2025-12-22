import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRef } from 'react';

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
  const fetchRef = useRef<() => void>(() => {});

  const fetchSubscriptionStatus = useCallback(async () => {
    if (!userId) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    // show loading while refreshing for a new userId
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      // Single source of truth from Postgres - use type assertion since types are auto-generated
      const { data: status, error } = await supabase
        .rpc('get_subscription_status' as any, { p_user_id: userId })
        .single();

      if (error || !status) {
        console.error('Error fetching subscription:', error);
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      // Type assertion for the response
      const typedStatus = status as {
        is_premium: boolean;
        subscription_expires_at: string | null;
        is_trial_active: boolean;
        trial_ends_at: string | null;
        trial_days_left: number;
        daily_limit: number;
        messages_used: number;
        limit_reached: boolean;
      };

      const isPremium = Boolean(typedStatus.is_premium);
      const isTrialActive = Boolean(typedStatus.is_trial_active);
      const trialEndsAt = typedStatus.trial_ends_at;
      const trialDaysLeft = typedStatus.trial_days_left || 0;
      const dailyLimit = typedStatus.daily_limit ?? FREE_DAILY_LIMIT;
      const messagesUsed = typedStatus.messages_used ?? 0;
      const limitReached = Boolean(typedStatus.limit_reached);

      if (isPremium) {
        setState({
          isPremium: true,
          subscriptionTier: 'premium',
          subscriptionExpiresAt: typedStatus.subscription_expires_at,
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

  // Keep a stable ref to the latest fetch function to avoid recreating intervals
  useEffect(() => {
    fetchRef.current = fetchSubscriptionStatus;
  }, [fetchSubscriptionStatus]);

  useEffect(() => {
    fetchSubscriptionStatus();
  }, [fetchSubscriptionStatus]);

  // Periodic refresh to sync cross-surface (e.g., Telegram) usage
  useEffect(() => {
    if (!userId) return;

    const interval = setInterval(() => {
      fetchRef.current();
    }, 30000); // 30s soft poll

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId]);

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
