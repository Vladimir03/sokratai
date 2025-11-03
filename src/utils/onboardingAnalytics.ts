import { supabase } from "@/integrations/supabase/client";

export class OnboardingAnalytics {
  private analyticsId: string | null = null;
  private stepStartTimes: Map<number, number> = new Map();
  private currentStep: number = 1;

  async start(userId: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('onboarding_analytics')
        .insert({ user_id: userId })
        .select('id')
        .single();

      if (error) throw error;

      this.analyticsId = data.id;
      this.stepStartTimes.set(1, Date.now());
      console.log('📊 Onboarding analytics started:', this.analyticsId);
    } catch (error) {
      console.error('Error starting analytics:', error);
    }
  }

  moveToStep(step: number): void {
    this.currentStep = step;
    this.stepStartTimes.set(step, Date.now());
  }

  async saveStepDuration(
    step: number, 
    additionalData?: Record<string, any>
  ): Promise<void> {
    if (!this.analyticsId) return;

    const startTime = this.stepStartTimes.get(step);
    if (!startTime) return;

    const duration = Date.now() - startTime;
    const columnName = `step${step}_duration_ms`;

    try {
      await supabase
        .from('onboarding_analytics')
        .update({
          [columnName]: duration,
          ...additionalData
        })
        .eq('id', this.analyticsId);

      console.log(`📊 Step ${step} duration saved: ${duration}ms`);
    } catch (error) {
      console.error(`Error saving step ${step} duration:`, error);
    }
  }

  async trackDemoHintUsed(): Promise<void> {
    if (!this.analyticsId) return;

    try {
      await supabase.rpc('increment_demo_hints', {
        analytics_id: this.analyticsId
      });
      console.log('📊 Demo hint usage tracked');
    } catch (error) {
      console.error('Error tracking hint:', error);
    }
  }

  async trackDemoAnswerAttempted(): Promise<void> {
    if (!this.analyticsId) return;

    try {
      await supabase
        .from('onboarding_analytics')
        .update({ demo_answer_attempted: true })
        .eq('id', this.analyticsId);
      console.log('📊 Demo answer attempt tracked');
    } catch (error) {
      console.error('Error tracking answer attempt:', error);
    }
  }

  async complete(grade: number, subject: string, goal: string): Promise<void> {
    if (!this.analyticsId) return;

    try {
      await supabase
        .from('onboarding_analytics')
        .update({
          completed_at: new Date().toISOString(),
          grade,
          subject,
          goal
        })
        .eq('id', this.analyticsId);

      console.log('📊 Onboarding completed');
    } catch (error) {
      console.error('Error completing analytics:', error);
    }
  }
}
