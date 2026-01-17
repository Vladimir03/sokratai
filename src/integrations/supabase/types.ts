export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      admin_emails: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      answer_attempts: {
        Row: {
          attempt_time: string
          problem_id: string
          user_id: string
          was_correct: boolean
        }
        Insert: {
          attempt_time?: string
          problem_id: string
          user_id: string
          was_correct?: boolean
        }
        Update: {
          attempt_time?: string
          problem_id?: string
          user_id?: string
          was_correct?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "answer_attempts_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_attempts_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems_public"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limits: {
        Row: {
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      broadcast_logs: {
        Row: {
          broadcast_type: string
          error_message: string | null
          id: string
          message_preview: string | null
          sent_at: string | null
          success: boolean | null
          telegram_user_id: number
        }
        Insert: {
          broadcast_type: string
          error_message?: string | null
          id?: string
          message_preview?: string | null
          sent_at?: string | null
          success?: boolean | null
          telegram_user_id: number
        }
        Update: {
          broadcast_type?: string
          error_message?: string | null
          id?: string
          message_preview?: string | null
          sent_at?: string | null
          success?: boolean | null
          telegram_user_id?: number
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          chat_id: string | null
          content: string
          created_at: string | null
          extracted_text: string | null
          id: string
          image_path: string | null
          image_url: string | null
          input_method: string | null
          role: string
          user_id: string
        }
        Insert: {
          chat_id?: string | null
          content: string
          created_at?: string | null
          extracted_text?: string | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          input_method?: string | null
          role: string
          user_id: string
        }
        Update: {
          chat_id?: string | null
          content?: string
          created_at?: string | null
          extracted_text?: string | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          input_method?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          chat_type: string
          created_at: string
          homework_task_id: string | null
          icon: string | null
          id: string
          is_archived: boolean
          last_message_at: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_type: string
          created_at?: string
          homework_task_id?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_type?: string
          created_at?: string
          homework_task_id?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          last_message_at?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_homework_task_id_fkey"
            columns: ["homework_task_id"]
            isOneToOne: false
            referencedRelation: "homework_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_message_limits: {
        Row: {
          last_reset_date: string
          messages_today: number
          user_id: string
        }
        Insert: {
          last_reset_date?: string
          messages_today?: number
          user_id: string
        }
        Update: {
          last_reset_date?: string
          messages_today?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_message_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_answers: {
        Row: {
          created_at: string | null
          ege_number: number
          id: string
          is_correct: boolean
          problem_id: string
          question_order: number
          session_id: string
          time_spent_seconds: number | null
          user_answer: string
        }
        Insert: {
          created_at?: string | null
          ege_number: number
          id?: string
          is_correct: boolean
          problem_id: string
          question_order: number
          session_id: string
          time_spent_seconds?: number | null
          user_answer: string
        }
        Update: {
          created_at?: string | null
          ege_number?: number
          id?: string
          is_correct?: boolean
          problem_id?: string
          question_order?: number
          session_id?: string
          time_spent_seconds?: number | null
          user_answer?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_answers_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "ege_problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_question: number | null
          id: string
          predicted_primary_score: number | null
          predicted_test_score: number | null
          recommended_start_topic: number | null
          started_at: string | null
          status: string
          strong_topics: number[] | null
          time_spent_seconds: number | null
          topic_scores: Json | null
          total_questions: number | null
          updated_at: string | null
          user_id: string
          weak_topics: number[] | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_question?: number | null
          id?: string
          predicted_primary_score?: number | null
          predicted_test_score?: number | null
          recommended_start_topic?: number | null
          started_at?: string | null
          status?: string
          strong_topics?: number[] | null
          time_spent_seconds?: number | null
          topic_scores?: Json | null
          total_questions?: number | null
          updated_at?: string | null
          user_id: string
          weak_topics?: number[] | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_question?: number | null
          id?: string
          predicted_primary_score?: number | null
          predicted_test_score?: number | null
          recommended_start_topic?: number | null
          started_at?: string | null
          status?: string
          strong_topics?: number[] | null
          time_spent_seconds?: number | null
          topic_scores?: Json | null
          total_questions?: number | null
          updated_at?: string | null
          user_id?: string
          weak_topics?: number[] | null
        }
        Relationships: []
      }
      ege_problems: {
        Row: {
          answer_tolerance: number | null
          answer_type: string
          condition_image_url: string | null
          condition_text: string
          correct_answer: string
          created_at: string | null
          difficulty: number | null
          ege_number: number
          hints: Json | null
          id: string
          is_active: boolean | null
          is_diagnostic: boolean | null
          solution_text: string | null
          solution_video_url: string | null
          source_id: string | null
          subtopic: string | null
          tags: string[] | null
          topic: string
          updated_at: string | null
          variant_source: string | null
          year: number | null
        }
        Insert: {
          answer_tolerance?: number | null
          answer_type: string
          condition_image_url?: string | null
          condition_text: string
          correct_answer: string
          created_at?: string | null
          difficulty?: number | null
          ege_number: number
          hints?: Json | null
          id?: string
          is_active?: boolean | null
          is_diagnostic?: boolean | null
          solution_text?: string | null
          solution_video_url?: string | null
          source_id?: string | null
          subtopic?: string | null
          tags?: string[] | null
          topic: string
          updated_at?: string | null
          variant_source?: string | null
          year?: number | null
        }
        Update: {
          answer_tolerance?: number | null
          answer_type?: string
          condition_image_url?: string | null
          condition_text?: string
          correct_answer?: string
          created_at?: string | null
          difficulty?: number | null
          ege_number?: number
          hints?: Json | null
          id?: string
          is_active?: boolean | null
          is_diagnostic?: boolean | null
          solution_text?: string | null
          solution_video_url?: string | null
          source_id?: string | null
          subtopic?: string | null
          tags?: string[] | null
          topic?: string
          updated_at?: string | null
          variant_source?: string | null
          year?: number | null
        }
        Relationships: []
      }
      homework_chat_messages: {
        Row: {
          content: string
          created_at: string
          homework_task_id: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          homework_task_id: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          homework_task_id?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_chat_messages_homework_task_id_fkey"
            columns: ["homework_task_id"]
            isOneToOne: false
            referencedRelation: "homework_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_sets: {
        Row: {
          created_at: string
          deadline: string | null
          id: string
          photo_url: string | null
          priority: string
          subject: string
          topic: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          id?: string
          photo_url?: string | null
          priority?: string
          subject: string
          topic: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          id?: string
          photo_url?: string | null
          priority?: string
          subject?: string
          topic?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      homework_tasks: {
        Row: {
          ai_analysis: Json | null
          condition_photo_url: string | null
          condition_text: string | null
          created_at: string
          homework_set_id: string
          id: string
          status: string
          task_number: string
          updated_at: string
        }
        Insert: {
          ai_analysis?: Json | null
          condition_photo_url?: string | null
          condition_text?: string | null
          created_at?: string
          homework_set_id: string
          id?: string
          status?: string
          task_number: string
          updated_at?: string
        }
        Update: {
          ai_analysis?: Json | null
          condition_photo_url?: string | null
          condition_text?: string | null
          created_at?: string
          homework_set_id?: string
          id?: string
          status?: string
          task_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_tasks_homework_set_id_fkey"
            columns: ["homework_set_id"]
            isOneToOne: false
            referencedRelation: "homework_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      message_feedback: {
        Row: {
          created_at: string | null
          feedback_type: string
          id: string
          message_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          feedback_type: string
          id?: string
          message_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          feedback_type?: string
          id?: string
          message_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_interactions: {
        Row: {
          created_at: string
          id: string
          interaction_count: number
          interaction_type: string
          message_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          interaction_count?: number
          interaction_type: string
          message_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interaction_count?: number
          interaction_type?: string
          message_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      onboarding_analytics: {
        Row: {
          completed_at: string | null
          created_at: string | null
          demo_answer_attempted: boolean | null
          demo_hints_used: number | null
          goal: string | null
          grade: number | null
          id: string
          source: string | null
          started_at: string | null
          step1_duration_ms: number | null
          step2_duration_ms: number | null
          step3_duration_ms: number | null
          step4_duration_ms: number | null
          step5_duration_ms: number | null
          subject: string | null
          telegram_user_id: number | null
          user_id: string
          utm_source: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          demo_answer_attempted?: boolean | null
          demo_hints_used?: number | null
          goal?: string | null
          grade?: number | null
          id?: string
          source?: string | null
          started_at?: string | null
          step1_duration_ms?: number | null
          step2_duration_ms?: number | null
          step3_duration_ms?: number | null
          step4_duration_ms?: number | null
          step5_duration_ms?: number | null
          subject?: string | null
          telegram_user_id?: number | null
          user_id: string
          utm_source?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          demo_answer_attempted?: boolean | null
          demo_hints_used?: number | null
          goal?: string | null
          grade?: number | null
          id?: string
          source?: string | null
          started_at?: string | null
          step1_duration_ms?: number | null
          step2_duration_ms?: number | null
          step3_duration_ms?: number | null
          step4_duration_ms?: number | null
          step5_duration_ms?: number | null
          subject?: string | null
          telegram_user_id?: number | null
          user_id?: string
          utm_source?: string | null
        }
        Relationships: []
      }
      practice_attempts: {
        Row: {
          asked_ai: boolean | null
          created_at: string | null
          hints_used: number | null
          id: string
          is_correct: boolean
          problem_id: string
          started_at: string
          submitted_at: string
          user_answer: string
          user_id: string
        }
        Insert: {
          asked_ai?: boolean | null
          created_at?: string | null
          hints_used?: number | null
          id?: string
          is_correct: boolean
          problem_id: string
          started_at?: string
          submitted_at?: string
          user_answer: string
          user_id: string
        }
        Update: {
          asked_ai?: boolean | null
          created_at?: string | null
          hints_used?: number | null
          id?: string
          is_correct?: boolean
          problem_id?: string
          started_at?: string
          submitted_at?: string
          user_answer?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_attempts_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "ege_problems"
            referencedColumns: ["id"]
          },
        ]
      }
      problems: {
        Row: {
          answer: string | null
          created_at: string | null
          id: string
          level: string
          question: string
          solution: string | null
          topic: string
        }
        Insert: {
          answer?: string | null
          created_at?: string | null
          id?: string
          level: string
          question: string
          solution?: string | null
          topic: string
        }
        Update: {
          answer?: string | null
          created_at?: string | null
          id?: string
          level?: string
          question?: string
          solution?: string | null
          topic?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          current_streak: number | null
          diagnostic_completed: boolean | null
          difficult_subject: string | null
          grade: number | null
          id: string
          last_diagnostic_at: string | null
          last_diagnostic_score: number | null
          last_streak_update: string | null
          learning_goal: string | null
          onboarding_completed: boolean | null
          promo_code: string | null
          registration_source: string | null
          subscription_expires_at: string | null
          subscription_tier: string
          telegram_user_id: number | null
          telegram_username: string | null
          trial_ends_at: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          current_streak?: number | null
          diagnostic_completed?: boolean | null
          difficult_subject?: string | null
          grade?: number | null
          id: string
          last_diagnostic_at?: string | null
          last_diagnostic_score?: number | null
          last_streak_update?: string | null
          learning_goal?: string | null
          onboarding_completed?: boolean | null
          promo_code?: string | null
          registration_source?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string
          telegram_user_id?: number | null
          telegram_username?: string | null
          trial_ends_at?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          current_streak?: number | null
          diagnostic_completed?: boolean | null
          difficult_subject?: string | null
          grade?: number | null
          id?: string
          last_diagnostic_at?: string | null
          last_diagnostic_score?: number | null
          last_streak_update?: string | null
          learning_goal?: string | null
          onboarding_completed?: boolean | null
          promo_code?: string | null
          registration_source?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string
          telegram_user_id?: number | null
          telegram_username?: string | null
          trial_ends_at?: string | null
          username?: string
        }
        Relationships: []
      }
      solutions: {
        Row: {
          created_at: string
          id: string
          problem_text: string
          solution_data: Json
          telegram_chat_id: number | null
          telegram_user_id: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          problem_text: string
          solution_data: Json
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          problem_text?: string
          solution_data?: Json
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      telegram_login_tokens: {
        Row: {
          action_type: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          intended_role: string | null
          session_data: Json | null
          status: string | null
          telegram_user_id: number | null
          token: string
          user_id: string | null
          verified_at: string | null
        }
        Insert: {
          action_type?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          intended_role?: string | null
          session_data?: Json | null
          status?: string | null
          telegram_user_id?: number | null
          token: string
          user_id?: string | null
          verified_at?: string | null
        }
        Update: {
          action_type?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          intended_role?: string | null
          session_data?: Json | null
          status?: string | null
          telegram_user_id?: number | null
          token?: string
          user_id?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      telegram_sessions: {
        Row: {
          created_at: string | null
          current_mode: string | null
          diagnostic_state: Json | null
          onboarding_data: Json | null
          onboarding_state: string | null
          practice_state: Json | null
          telegram_user_id: number
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_mode?: string | null
          diagnostic_state?: Json | null
          onboarding_data?: Json | null
          onboarding_state?: string | null
          practice_state?: Json | null
          telegram_user_id: number
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_mode?: string | null
          diagnostic_state?: Json | null
          onboarding_data?: Json | null
          onboarding_state?: string | null
          practice_state?: Json | null
          telegram_user_id?: number
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      token_usage_logs: {
        Row: {
          chat_id: string | null
          completion_tokens: number | null
          created_at: string
          id: string
          model: string
          prompt_tokens: number | null
          total_tokens: number | null
          user_id: string
        }
        Insert: {
          chat_id?: string | null
          completion_tokens?: number | null
          created_at?: string
          id?: string
          model: string
          prompt_tokens?: number | null
          total_tokens?: number | null
          user_id: string
        }
        Update: {
          chat_id?: string | null
          completion_tokens?: number | null
          created_at?: string
          id?: string
          model?: string
          prompt_tokens?: number | null
          total_tokens?: number | null
          user_id?: string
        }
        Relationships: []
      }
      tutor_students: {
        Row: {
          created_at: string | null
          current_score: number | null
          exam_type: string | null
          id: string
          last_activity_at: string | null
          notes: string | null
          paid_until: string | null
          start_score: number | null
          status: string | null
          student_id: string
          subject: string | null
          target_score: number | null
          tutor_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_score?: number | null
          exam_type?: string | null
          id?: string
          last_activity_at?: string | null
          notes?: string | null
          paid_until?: string | null
          start_score?: number | null
          status?: string | null
          student_id: string
          subject?: string | null
          target_score?: number | null
          tutor_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_score?: number | null
          exam_type?: string | null
          id?: string
          last_activity_at?: string | null
          notes?: string | null
          paid_until?: string | null
          start_score?: number | null
          status?: string | null
          student_id?: string
          subject?: string | null
          target_score?: number | null
          tutor_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tutor_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_students_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "tutors"
            referencedColumns: ["id"]
          },
        ]
      }
      tutors: {
        Row: {
          avatar_url: string | null
          bio: string | null
          booking_link: string | null
          created_at: string | null
          id: string
          name: string
          subjects: string[] | null
          telegram_id: string | null
          telegram_username: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          booking_link?: string | null
          created_at?: string | null
          id?: string
          name: string
          subjects?: string[] | null
          telegram_id?: string | null
          telegram_username?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          booking_link?: string | null
          created_at?: string | null
          id?: string
          name?: string
          subjects?: string[] | null
          telegram_id?: string | null
          telegram_username?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_ege_progress: {
        Row: {
          correct_attempts: number | null
          created_at: string | null
          current_difficulty: number | null
          ege_number: number
          id: string
          last_practiced_at: string | null
          total_attempts: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          correct_attempts?: number | null
          created_at?: string | null
          current_difficulty?: number | null
          ege_number: number
          id?: string
          last_practiced_at?: string | null
          total_attempts?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          correct_attempts?: number | null
          created_at?: string | null
          current_difficulty?: number | null
          ege_number?: number
          id?: string
          last_practiced_at?: string | null
          total_attempts?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_solutions: {
        Row: {
          id: string
          is_correct: boolean
          problem_id: string
          solved_at: string | null
          user_answer: string | null
          user_id: string
        }
        Insert: {
          id?: string
          is_correct: boolean
          problem_id: string
          solved_at?: string | null
          user_answer?: string | null
          user_id: string
        }
        Update: {
          id?: string
          is_correct?: boolean
          problem_id?: string
          solved_at?: string | null
          user_answer?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_solutions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_solutions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_solutions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_stats: {
        Row: {
          created_at: string | null
          current_streak: number
          id: string
          last_activity: string | null
          level: number
          total_xp: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_streak?: number
          id?: string
          last_activity?: string | null
          level?: number
          total_xp?: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_streak?: number
          id?: string
          last_activity?: string | null
          level?: number
          total_xp?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      problems_public: {
        Row: {
          created_at: string | null
          id: string | null
          level: string | null
          question: string | null
          topic: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          level?: string | null
          question?: string | null
          topic?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          level?: string | null
          question?: string | null
          topic?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_and_update_streak: { Args: { p_user_id: string }; Returns: number }
      check_problem_answer: {
        Args: { problem_id_input: string; user_answer_input: string }
        Returns: {
          correct_answer: string
          is_correct: boolean
          solution: string
        }[]
      }
      get_diagnostic_problems: {
        Args: { p_total_questions?: number }
        Returns: {
          answer_type: string
          condition_image_url: string
          condition_text: string
          correct_answer: string
          difficulty: number
          ege_number: number
          id: string
          subtopic: string
          topic: string
        }[]
      }
      get_subscription_status: {
        Args: { p_user_id: string }
        Returns: {
          daily_limit: number
          is_premium: boolean
          is_trial_active: boolean
          limit_reached: boolean
          messages_used: number
          subscription_expires_at: string
          trial_days_left: number
          trial_ends_at: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_demo_hints: {
        Args: { analytics_id: string }
        Returns: undefined
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_admin_email: { Args: { _user_id: string }; Returns: boolean }
      is_tutor: { Args: { _user_id: string }; Returns: boolean }
      update_user_stats_on_solve: {
        Args: { p_is_correct: boolean; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "tutor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user", "tutor"],
    },
  },
} as const
