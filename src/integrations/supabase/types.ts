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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      formula_round_results: {
        Row: {
          answers: Json
          completed: boolean
          created_at: string
          duration_seconds: number
          id: string
          lives_remaining: number
          round_id: string
          score: number
          student_id: string
          total: number
          weak_formulas: Json
        }
        Insert: {
          answers?: Json
          completed?: boolean
          created_at?: string
          duration_seconds?: number
          id?: string
          lives_remaining?: number
          round_id: string
          score?: number
          student_id: string
          total?: number
          weak_formulas?: Json
        }
        Update: {
          answers?: Json
          completed?: boolean
          created_at?: string
          duration_seconds?: number
          id?: string
          lives_remaining?: number
          round_id?: string
          score?: number
          student_id?: string
          total?: number
          weak_formulas?: Json
        }
        Relationships: [
          {
            foreignKeyName: "formula_round_results_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "formula_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      formula_rounds: {
        Row: {
          assignment_id: string
          created_at: string
          formula_count: number
          id: string
          lives: number
          questions_per_round: number
          section: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          formula_count?: number
          id?: string
          lives?: number
          questions_per_round?: number
          section?: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          formula_count?: number
          id?: string
          lives?: number
          questions_per_round?: number
          section?: string
        }
        Relationships: [
          {
            foreignKeyName: "formula_rounds_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_assignments"
            referencedColumns: ["id"]
          },
        ]
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
      homework_kb_tasks: {
        Row: {
          added_at: string | null
          homework_id: string
          id: string
          snapshot_edited: boolean | null
          sort_order: number | null
          task_answer_snapshot: string | null
          task_id: string | null
          task_solution_snapshot: string | null
          task_text_snapshot: string
        }
        Insert: {
          added_at?: string | null
          homework_id: string
          id?: string
          snapshot_edited?: boolean | null
          sort_order?: number | null
          task_answer_snapshot?: string | null
          task_id?: string | null
          task_solution_snapshot?: string | null
          task_text_snapshot: string
        }
        Update: {
          added_at?: string | null
          homework_id?: string
          id?: string
          snapshot_edited?: boolean | null
          sort_order?: number | null
          task_answer_snapshot?: string | null
          task_id?: string | null
          task_solution_snapshot?: string | null
          task_text_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_kb_tasks_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_kb_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "kb_tasks"
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
      homework_tutor_assignments: {
        Row: {
          created_at: string
          deadline: string | null
          description: string | null
          disable_ai_bootstrap: boolean
          group_id: string | null
          id: string
          max_attempts: number
          status: string
          subject: string
          title: string
          topic: string | null
          tutor_id: string
          workflow_mode: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          description?: string | null
          disable_ai_bootstrap?: boolean
          group_id?: string | null
          id?: string
          max_attempts?: number
          status?: string
          subject: string
          title: string
          topic?: string | null
          tutor_id: string
          workflow_mode?: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          description?: string | null
          disable_ai_bootstrap?: boolean
          group_id?: string | null
          id?: string
          max_attempts?: number
          status?: string
          subject?: string
          title?: string
          topic?: string | null
          tutor_id?: string
          workflow_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "tutor_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_materials: {
        Row: {
          assignment_id: string
          created_at: string
          id: string
          storage_ref: string | null
          title: string
          type: string
          url: string | null
        }
        Insert: {
          assignment_id: string
          created_at?: string
          id?: string
          storage_ref?: string | null
          title: string
          type: string
          url?: string | null
        }
        Update: {
          assignment_id?: string
          created_at?: string
          id?: string
          storage_ref?: string | null
          title?: string
          type?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_materials_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_reminder_log: {
        Row: {
          assignment_id: string
          channel: string | null
          id: string
          reminder_type: string
          sent_at: string
          student_id: string
        }
        Insert: {
          assignment_id: string
          channel?: string | null
          id?: string
          reminder_type: string
          sent_at?: string
          student_id: string
        }
        Update: {
          assignment_id?: string
          channel?: string | null
          id?: string
          reminder_type?: string
          sent_at?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_reminder_log_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_student_assignments: {
        Row: {
          assignment_id: string
          delivery_channel: string | null
          delivery_error_code: string | null
          delivery_status: string
          id: string
          notified: boolean
          notified_at: string | null
          student_id: string
        }
        Insert: {
          assignment_id: string
          delivery_channel?: string | null
          delivery_error_code?: string | null
          delivery_status?: string
          id?: string
          notified?: boolean
          notified_at?: string | null
          student_id: string
        }
        Update: {
          assignment_id?: string
          delivery_channel?: string | null
          delivery_error_code?: string | null
          delivery_status?: string
          id?: string
          notified?: boolean
          notified_at?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_student_assignments_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_submission_items: {
        Row: {
          ai_confidence: number | null
          ai_error_type: string | null
          ai_feedback: string | null
          ai_is_correct: boolean | null
          ai_score: number | null
          answer_type: string | null
          created_at: string
          id: string
          recognized_text: string | null
          student_image_urls: string[] | null
          student_text: string | null
          submission_id: string
          task_id: string
          tutor_comment: string | null
          tutor_override_correct: boolean | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_error_type?: string | null
          ai_feedback?: string | null
          ai_is_correct?: boolean | null
          ai_score?: number | null
          answer_type?: string | null
          created_at?: string
          id?: string
          recognized_text?: string | null
          student_image_urls?: string[] | null
          student_text?: string | null
          submission_id: string
          task_id: string
          tutor_comment?: string | null
          tutor_override_correct?: boolean | null
        }
        Update: {
          ai_confidence?: number | null
          ai_error_type?: string | null
          ai_feedback?: string | null
          ai_is_correct?: boolean | null
          ai_score?: number | null
          answer_type?: string | null
          created_at?: string
          id?: string
          recognized_text?: string | null
          student_image_urls?: string[] | null
          student_text?: string | null
          submission_id?: string
          task_id?: string
          tutor_comment?: string | null
          tutor_override_correct?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_submission_items_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_tutor_submission_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_submissions: {
        Row: {
          assignment_id: string
          attempt_no: number
          id: string
          status: string
          student_id: string
          submitted_at: string | null
          telegram_chat_id: number | null
          total_max_score: number | null
          total_score: number | null
        }
        Insert: {
          assignment_id: string
          attempt_no?: number
          id?: string
          status?: string
          student_id: string
          submitted_at?: string | null
          telegram_chat_id?: number | null
          total_max_score?: number | null
          total_score?: number | null
        }
        Update: {
          assignment_id?: string
          attempt_no?: number
          id?: string
          status?: string
          student_id?: string
          submitted_at?: string | null
          telegram_chat_id?: number | null
          total_max_score?: number | null
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_task_states: {
        Row: {
          attempts: number
          available_score: number | null
          await_mode: string
          best_score: number | null
          context_summary: string | null
          created_at: string
          earned_score: number | null
          hint_count: number
          id: string
          last_ai_feedback: string | null
          status: string
          task_id: string
          thread_id: string
          updated_at: string
          wrong_answer_count: number
        }
        Insert: {
          attempts?: number
          available_score?: number | null
          await_mode?: string
          best_score?: number | null
          context_summary?: string | null
          created_at?: string
          earned_score?: number | null
          hint_count?: number
          id?: string
          last_ai_feedback?: string | null
          status?: string
          task_id: string
          thread_id: string
          updated_at?: string
          wrong_answer_count?: number
        }
        Update: {
          attempts?: number
          available_score?: number | null
          await_mode?: string
          best_score?: number | null
          context_summary?: string | null
          created_at?: string
          earned_score?: number | null
          hint_count?: number
          id?: string
          last_ai_feedback?: string | null
          status?: string
          task_id?: string
          thread_id?: string
          updated_at?: string
          wrong_answer_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_task_states_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_tutor_task_states_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_tasks: {
        Row: {
          assignment_id: string
          check_format: string
          correct_answer: string | null
          id: string
          max_score: number
          ocr_text: string | null
          order_num: number
          rubric_text: string | null
          solution_steps: string | null
          task_image_url: string | null
          task_text: string
        }
        Insert: {
          assignment_id: string
          check_format?: string
          correct_answer?: string | null
          id?: string
          max_score?: number
          ocr_text?: string | null
          order_num: number
          rubric_text?: string | null
          solution_steps?: string | null
          task_image_url?: string | null
          task_text: string
        }
        Update: {
          assignment_id?: string
          check_format?: string
          correct_answer?: string | null
          id?: string
          max_score?: number
          ocr_text?: string | null
          order_num?: number
          rubric_text?: string | null
          solution_steps?: string | null
          task_image_url?: string | null
          task_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_tasks_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_templates: {
        Row: {
          created_at: string
          id: string
          subject: string
          tags: string[]
          tasks_json: Json
          title: string
          topic: string | null
          tutor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          subject: string
          tags?: string[]
          tasks_json?: Json
          title: string
          topic?: string | null
          tutor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          subject?: string
          tags?: string[]
          tasks_json?: Json
          title?: string
          topic?: string | null
          tutor_id?: string
        }
        Relationships: []
      }
      homework_tutor_thread_messages: {
        Row: {
          author_user_id: string | null
          content: string
          created_at: string
          id: string
          image_url: string | null
          message_kind: string | null
          role: string
          task_order: number | null
          thread_id: string
          visible_to_student: boolean
        }
        Insert: {
          author_user_id?: string | null
          content: string
          created_at?: string
          id?: string
          image_url?: string | null
          message_kind?: string | null
          role: string
          task_order?: number | null
          thread_id: string
          visible_to_student?: boolean
        }
        Update: {
          author_user_id?: string | null
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          message_kind?: string | null
          role?: string
          task_order?: number | null
          thread_id?: string
          visible_to_student?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_thread_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "homework_tutor_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_threads: {
        Row: {
          created_at: string
          current_task_order: number
          id: string
          last_student_message_at: string | null
          last_tutor_message_at: string | null
          status: string
          student_assignment_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_task_order?: number
          id?: string
          last_student_message_at?: string | null
          last_tutor_message_at?: string | null
          status?: string
          student_assignment_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_task_order?: number
          id?: string
          last_student_message_at?: string | null
          last_tutor_message_at?: string | null
          status?: string
          student_assignment_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_tutor_threads_student_assignment_id_fkey"
            columns: ["student_assignment_id"]
            isOneToOne: true
            referencedRelation: "homework_tutor_student_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_tutor_user_bot_state: {
        Row: {
          context: Json
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          context?: Json
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          context?: Json
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      kb_folders: {
        Row: {
          created_at: string | null
          id: string
          name: string
          owner_id: string
          parent_id: string | null
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          owner_id: string
          parent_id?: string | null
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          parent_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "kb_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_materials: {
        Row: {
          created_at: string | null
          folder_id: string | null
          format: string | null
          id: string
          name: string
          owner_id: string | null
          storage_key: string | null
          topic_id: string | null
          type: string
          url: string | null
        }
        Insert: {
          created_at?: string | null
          folder_id?: string | null
          format?: string | null
          id?: string
          name: string
          owner_id?: string | null
          storage_key?: string | null
          topic_id?: string | null
          type: string
          url?: string | null
        }
        Update: {
          created_at?: string | null
          folder_id?: string | null
          format?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          storage_key?: string | null
          topic_id?: string | null
          type?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_materials_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "kb_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_materials_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "kb_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_materials_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "kb_topics_with_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_moderation_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          moderator_id: string
          source_task_id: string | null
          task_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          moderator_id: string
          source_task_id?: string | null
          task_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          moderator_id?: string
          source_task_id?: string | null
          task_id?: string | null
        }
        Relationships: []
      }
      kb_subtopics: {
        Row: {
          id: string
          name: string
          sort_order: number | null
          topic_id: string | null
        }
        Insert: {
          id?: string
          name: string
          sort_order?: number | null
          topic_id?: string | null
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number | null
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_subtopics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "kb_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_subtopics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "kb_topics_with_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_tasks: {
        Row: {
          answer: string | null
          answer_format: string | null
          attachment_url: string | null
          created_at: string | null
          exam: Database["public"]["Enums"]["exam_type"] | null
          fingerprint: string | null
          folder_id: string | null
          hidden_reason: string | null
          id: string
          kim_number: number | null
          moderation_status: string
          owner_id: string | null
          primary_score: number | null
          published_at: string | null
          published_by: string | null
          published_task_id: string | null
          solution: string | null
          solution_attachment_url: string | null
          source_label: string | null
          source_task_id: string | null
          subtopic_id: string | null
          text: string
          topic_id: string | null
          updated_at: string | null
        }
        Insert: {
          answer?: string | null
          answer_format?: string | null
          attachment_url?: string | null
          created_at?: string | null
          exam?: Database["public"]["Enums"]["exam_type"] | null
          fingerprint?: string | null
          folder_id?: string | null
          hidden_reason?: string | null
          id?: string
          kim_number?: number | null
          moderation_status?: string
          owner_id?: string | null
          primary_score?: number | null
          published_at?: string | null
          published_by?: string | null
          published_task_id?: string | null
          solution?: string | null
          solution_attachment_url?: string | null
          source_label?: string | null
          source_task_id?: string | null
          subtopic_id?: string | null
          text: string
          topic_id?: string | null
          updated_at?: string | null
        }
        Update: {
          answer?: string | null
          answer_format?: string | null
          attachment_url?: string | null
          created_at?: string | null
          exam?: Database["public"]["Enums"]["exam_type"] | null
          fingerprint?: string | null
          folder_id?: string | null
          hidden_reason?: string | null
          id?: string
          kim_number?: number | null
          moderation_status?: string
          owner_id?: string | null
          primary_score?: number | null
          published_at?: string | null
          published_by?: string | null
          published_task_id?: string | null
          solution?: string | null
          solution_attachment_url?: string | null
          source_label?: string | null
          source_task_id?: string | null
          subtopic_id?: string | null
          text?: string
          topic_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_tasks_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "kb_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_tasks_published_task_id_fkey"
            columns: ["published_task_id"]
            isOneToOne: false
            referencedRelation: "kb_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_tasks_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "kb_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_tasks_subtopic_id_fkey"
            columns: ["subtopic_id"]
            isOneToOne: false
            referencedRelation: "kb_subtopics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_tasks_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "kb_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_tasks_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "kb_topics_with_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_topics: {
        Row: {
          created_at: string | null
          exam: Database["public"]["Enums"]["exam_type"]
          id: string
          kim_numbers: number[] | null
          name: string
          section: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          exam: Database["public"]["Enums"]["exam_type"]
          id?: string
          kim_numbers?: number[] | null
          name: string
          section: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          exam?: Database["public"]["Enums"]["exam_type"]
          id?: string
          kim_numbers?: number[] | null
          name?: string
          section?: string
          sort_order?: number | null
        }
        Relationships: []
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
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          idempotency_key: string | null
          status: string
          subscription_activated_at: string | null
          subscription_days: number
          subscription_expires_at: string | null
          updated_at: string
          user_id: string
          webhook_data: Json | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id: string
          idempotency_key?: string | null
          status?: string
          subscription_activated_at?: string | null
          subscription_days?: number
          subscription_expires_at?: string | null
          updated_at?: string
          user_id: string
          webhook_data?: Json | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          status?: string
          subscription_activated_at?: string | null
          subscription_days?: number
          subscription_expires_at?: string | null
          updated_at?: string
          user_id?: string
          webhook_data?: Json | null
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
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
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
      tutor_availability_exceptions: {
        Row: {
          created_at: string | null
          exception_date: string
          id: string
          reason: string | null
          tutor_id: string
        }
        Insert: {
          created_at?: string | null
          exception_date: string
          id?: string
          reason?: string | null
          tutor_id: string
        }
        Update: {
          created_at?: string | null
          exception_date?: string
          id?: string
          reason?: string | null
          tutor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_availability_exceptions_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "tutors"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_calendar_settings: {
        Row: {
          allow_student_cancel: boolean
          auto_confirm: boolean
          buffer_minutes: number
          cancel_notice_hours: number
          created_at: string | null
          default_duration: number
          id: string
          max_advance_days: number
          min_notice_hours: number
          payment_details_text: string | null
          payment_reminder_delay_minutes: number | null
          payment_reminder_enabled: boolean | null
          timezone: string
          tutor_id: string
          updated_at: string | null
        }
        Insert: {
          allow_student_cancel?: boolean
          auto_confirm?: boolean
          buffer_minutes?: number
          cancel_notice_hours?: number
          created_at?: string | null
          default_duration?: number
          id?: string
          max_advance_days?: number
          min_notice_hours?: number
          payment_details_text?: string | null
          payment_reminder_delay_minutes?: number | null
          payment_reminder_enabled?: boolean | null
          timezone?: string
          tutor_id: string
          updated_at?: string | null
        }
        Update: {
          allow_student_cancel?: boolean
          auto_confirm?: boolean
          buffer_minutes?: number
          cancel_notice_hours?: number
          created_at?: string | null
          default_duration?: number
          id?: string
          max_advance_days?: number
          min_notice_hours?: number
          payment_details_text?: string | null
          payment_reminder_delay_minutes?: number | null
          payment_reminder_enabled?: boolean | null
          timezone?: string
          tutor_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tutor_calendar_settings_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: true
            referencedRelation: "tutors"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_feature_onboarding: {
        Row: {
          completed_at: string | null
          dismissed_at: string | null
          feature_key: string
          id: string
          shown_at: string | null
          tutor_id: string
        }
        Insert: {
          completed_at?: string | null
          dismissed_at?: string | null
          feature_key: string
          id?: string
          shown_at?: string | null
          tutor_id: string
        }
        Update: {
          completed_at?: string | null
          dismissed_at?: string | null
          feature_key?: string
          id?: string
          shown_at?: string | null
          tutor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_feature_onboarding_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "tutors"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_group_memberships: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          tutor_group_id: string
          tutor_id: string
          tutor_student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          tutor_group_id: string
          tutor_id: string
          tutor_student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          tutor_group_id?: string
          tutor_id?: string
          tutor_student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_group_memberships_tutor_group_id_fkey"
            columns: ["tutor_group_id"]
            isOneToOne: false
            referencedRelation: "tutor_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_group_memberships_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "tutors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_group_memberships_tutor_student_id_fkey"
            columns: ["tutor_student_id"]
            isOneToOne: false
            referencedRelation: "tutor_students"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_groups: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          short_name: string | null
          tutor_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          short_name?: string | null
          tutor_id: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          short_name?: string | null
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_groups_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "tutors"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_lesson_participants: {
        Row: {
          created_at: string
          id: string
          lesson_id: string
          paid_at: string | null
          payment_amount: number | null
          payment_status: string
          student_id: string
          tutor_student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_id: string
          paid_at?: string | null
          payment_amount?: number | null
          payment_status?: string
          student_id: string
          tutor_student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lesson_id?: string
          paid_at?: string | null
          payment_amount?: number | null
          payment_status?: string
          student_id?: string
          tutor_student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_lesson_participants_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "tutor_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_lesson_participants_tutor_student_id_fkey"
            columns: ["tutor_student_id"]
            isOneToOne: false
            referencedRelation: "tutor_students"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_lesson_reminder_logs: {
        Row: {
          error_message: string | null
          id: string
          lesson_id: string
          remind_before_minutes: number
          sent_at: string | null
          sent_to: string
          success: boolean
          telegram_user_id: number | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          lesson_id: string
          remind_before_minutes: number
          sent_at?: string | null
          sent_to: string
          success?: boolean
          telegram_user_id?: number | null
        }
        Update: {
          error_message?: string | null
          id?: string
          lesson_id?: string
          remind_before_minutes?: number
          sent_at?: string | null
          sent_to?: string
          success?: boolean
          telegram_user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tutor_lesson_reminder_logs_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "tutor_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_lessons: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string | null
          duration_min: number
          group_session_id: string | null
          group_size_snapshot: number | null
          group_source_tutor_group_id: string | null
          group_title_snapshot: string | null
          id: string
          is_recurring: boolean
          lesson_type: string
          notes: string | null
          paid_at: string | null
          parent_lesson_id: string | null
          payment_amount: number | null
          payment_method: string | null
          payment_reminder_sent: boolean | null
          payment_status: string | null
          recurrence_rule: string | null
          source: string
          start_at: string
          status: string
          student_id: string | null
          subject: string | null
          tutor_id: string
          tutor_student_id: string | null
          updated_at: string | null
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string | null
          duration_min?: number
          group_session_id?: string | null
          group_size_snapshot?: number | null
          group_source_tutor_group_id?: string | null
          group_title_snapshot?: string | null
          id?: string
          is_recurring?: boolean
          lesson_type?: string
          notes?: string | null
          paid_at?: string | null
          parent_lesson_id?: string | null
          payment_amount?: number | null
          payment_method?: string | null
          payment_reminder_sent?: boolean | null
          payment_status?: string | null
          recurrence_rule?: string | null
          source?: string
          start_at: string
          status?: string
          student_id?: string | null
          subject?: string | null
          tutor_id: string
          tutor_student_id?: string | null
          updated_at?: string | null
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string | null
          duration_min?: number
          group_session_id?: string | null
          group_size_snapshot?: number | null
          group_source_tutor_group_id?: string | null
          group_title_snapshot?: string | null
          id?: string
          is_recurring?: boolean
          lesson_type?: string
          notes?: string | null
          paid_at?: string | null
          parent_lesson_id?: string | null
          payment_amount?: number | null
          payment_method?: string | null
          payment_reminder_sent?: boolean | null
          payment_status?: string | null
          recurrence_rule?: string | null
          source?: string
          start_at?: string
          status?: string
          student_id?: string | null
          subject?: string | null
          tutor_id?: string
          tutor_student_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tutor_lessons_group_source_tutor_group_id_fkey"
            columns: ["group_source_tutor_group_id"]
            isOneToOne: false
            referencedRelation: "tutor_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_lessons_parent_lesson_id_fkey"
            columns: ["parent_lesson_id"]
            isOneToOne: false
            referencedRelation: "tutor_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_lessons_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_lessons_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "tutors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_lessons_tutor_student_id_fkey"
            columns: ["tutor_student_id"]
            isOneToOne: false
            referencedRelation: "tutor_students"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_payments: {
        Row: {
          amount: number
          created_at: string | null
          due_date: string | null
          id: string
          lesson_id: string | null
          paid_at: string | null
          period: string | null
          status: string
          tutor_student_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          due_date?: string | null
          id?: string
          lesson_id?: string | null
          paid_at?: string | null
          period?: string | null
          status?: string
          tutor_student_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          due_date?: string | null
          id?: string
          lesson_id?: string | null
          paid_at?: string | null
          period?: string | null
          status?: string
          tutor_student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tutor_payments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "tutor_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_payments_tutor_student_id_fkey"
            columns: ["tutor_student_id"]
            isOneToOne: false
            referencedRelation: "tutor_students"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_reminder_settings: {
        Row: {
          created_at: string | null
          enabled: boolean
          id: string
          remind_before_minutes: number[]
          template_student: string | null
          template_tutor: string | null
          tutor_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean
          id?: string
          remind_before_minutes?: number[]
          template_student?: string | null
          template_tutor?: string | null
          tutor_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean
          id?: string
          remind_before_minutes?: number[]
          template_student?: string | null
          template_tutor?: string | null
          tutor_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tutor_reminder_settings_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: true
            referencedRelation: "tutors"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_student_mock_exams: {
        Row: {
          created_at: string | null
          date: string
          id: string
          max_score: number | null
          notes: string | null
          score: number
          tutor_student_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          max_score?: number | null
          notes?: string | null
          score: number
          tutor_student_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          max_score?: number | null
          notes?: string | null
          score?: number
          tutor_student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tutor_student_mock_exams_tutor_student_id_fkey"
            columns: ["tutor_student_id"]
            isOneToOne: false
            referencedRelation: "tutor_students"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_students: {
        Row: {
          created_at: string | null
          current_score: number | null
          exam_type: string | null
          hourly_rate_cents: number | null
          id: string
          last_activity_at: string | null
          last_lesson_at: string | null
          notes: string | null
          paid_until: string | null
          parent_contact: string | null
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
          hourly_rate_cents?: number | null
          id?: string
          last_activity_at?: string | null
          last_lesson_at?: string | null
          notes?: string | null
          paid_until?: string | null
          parent_contact?: string | null
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
          hourly_rate_cents?: number | null
          id?: string
          last_activity_at?: string | null
          last_lesson_at?: string | null
          notes?: string | null
          paid_until?: string | null
          parent_contact?: string | null
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
      tutor_weekly_slots: {
        Row: {
          created_at: string | null
          day_of_week: number
          duration_min: number
          id: string
          is_available: boolean
          start_time: string
          tutor_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          duration_min?: number
          id?: string
          is_available?: boolean
          start_time: string
          tutor_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          duration_min?: number
          id?: string
          is_available?: boolean
          start_time?: string
          tutor_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tutor_weekly_slots_tutor_id_fkey"
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
          invite_code: string | null
          mini_groups_enabled: boolean
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
          invite_code?: string | null
          mini_groups_enabled?: boolean
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
          invite_code?: string | null
          mini_groups_enabled?: boolean
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
      kb_topics_with_counts: {
        Row: {
          created_at: string | null
          exam: Database["public"]["Enums"]["exam_type"] | null
          id: string | null
          kim_numbers: number[] | null
          material_count: number | null
          name: string | null
          section: string | null
          sort_order: number | null
          subtopic_names: string[] | null
          task_count: number | null
        }
        Relationships: []
      }
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
      book_lesson_slot: {
        Args: {
          _booking_link: string
          _duration_min?: number
          _slot_date: string
          _start_time: string
        }
        Returns: string
      }
      check_and_update_streak: { Args: { p_user_id: string }; Returns: number }
      check_problem_answer: {
        Args: { problem_id_input: string; user_answer_input: string }
        Returns: {
          correct_answer: string
          is_correct: boolean
          solution: string
        }[]
      }
      complete_lesson_and_create_payment: {
        Args: {
          _amount: number
          _lesson_id: string
          _payment_status?: string
          _tutor_telegram_id?: string
        }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      fetch_catalog_tasks_all: {
        Args: { p_topic_id: string }
        Returns: {
          answer: string | null
          answer_format: string | null
          attachment_url: string | null
          created_at: string | null
          exam: Database["public"]["Enums"]["exam_type"] | null
          fingerprint: string | null
          folder_id: string | null
          hidden_reason: string | null
          id: string
          kim_number: number | null
          moderation_status: string
          owner_id: string | null
          primary_score: number | null
          published_at: string | null
          published_by: string | null
          published_task_id: string | null
          solution: string | null
          solution_attachment_url: string | null
          source_label: string | null
          source_task_id: string | null
          subtopic_id: string | null
          text: string
          topic_id: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "kb_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fetch_catalog_tasks_v2: {
        Args: { p_topic_id: string }
        Returns: {
          answer: string | null
          answer_format: string | null
          attachment_url: string | null
          created_at: string | null
          exam: Database["public"]["Enums"]["exam_type"] | null
          fingerprint: string | null
          folder_id: string | null
          hidden_reason: string | null
          id: string
          kim_number: number | null
          moderation_status: string
          owner_id: string | null
          primary_score: number | null
          published_at: string | null
          published_by: string | null
          published_task_id: string | null
          solution: string | null
          solution_attachment_url: string | null
          source_label: string | null
          source_task_id: string | null
          subtopic_id: string | null
          text: string
          topic_id: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "kb_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      generate_invite_code: { Args: never; Returns: string }
      get_available_booking_slots: {
        Args: { _booking_link: string; _days_ahead?: number }
        Returns: {
          duration_min: number
          is_booked: boolean
          slot_date: string
          start_time: string
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
      get_lessons_needing_payment_reminder: {
        Args: never
        Returns: {
          duration_min: number
          lesson_date: string
          lesson_id: string
          lesson_time: string
          student_name: string
          tutor_id: string
          tutor_telegram_id: string
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
      get_tutor_pending_payments_by_telegram: {
        Args: { _telegram_id: string }
        Returns: {
          amount: number
          due_date: string
          lesson_start_at: string
          payment_id: string
          period: string
          student_name: string
          tutor_student_id: string
        }[]
      }
      get_tutor_students_debt: {
        Args: never
        Returns: {
          debt_amount: number
          overdue_amount: number
          pending_amount: number
          tutor_student_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hw_reorder_tasks: {
        Args: { p_assignment_id: string; p_task_order: Json }
        Returns: undefined
      }
      increment_demo_hints: {
        Args: { analytics_id: string }
        Returns: undefined
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_admin_email: { Args: { _user_id: string }; Returns: boolean }
      is_assignment_student: {
        Args: { _assignment_id: string }
        Returns: boolean
      }
      is_assignment_tutor: {
        Args: { _assignment_id: string }
        Returns: boolean
      }
      is_kb_homework_tutor: { Args: { _homework_id: string }; Returns: boolean }
      is_tutor: { Args: { _user_id: string }; Returns: boolean }
      is_tutor_of_student: { Args: { _student_id: string }; Returns: boolean }
      kb_folder_owned_by: {
        Args: { _folder_id: string; _owner_id: string }
        Returns: boolean
      }
      kb_is_in_socrat_tree: { Args: { p_folder_id: string }; Returns: boolean }
      kb_mod_reassign: {
        Args: { p_new_source_task_id: string; p_published_task_id: string }
        Returns: undefined
      }
      kb_mod_unpublish: {
        Args: { p_published_task_id: string }
        Returns: undefined
      }
      kb_normalize_fingerprint:
        | { Args: { p_answer: string; p_text: string }; Returns: string }
        | {
            Args: {
              p_answer: string
              p_attachment_url?: string
              p_text: string
            }
            Returns: string
          }
      kb_publish_task: { Args: { p_source_task_id: string }; Returns: string }
      kb_resync_task: { Args: { p_source_task_id: string }; Returns: undefined }
      kb_search: {
        Args: {
          exam_filter: Database["public"]["Enums"]["exam_type"]
          query: string
          result_limit?: number
          source_filter?: string
        }
        Returns: {
          exam: Database["public"]["Enums"]["exam_type"]
          parent_topic_id: string
          relevance: number
          result_id: string
          result_type: string
          snippet: string
          source: string
          title: string
        }[]
      }
      mark_payment_as_paid_by_telegram: {
        Args: { _payment_id: string; _telegram_id: string }
        Returns: boolean
      }
      mark_payment_reminder_sent: {
        Args: { _lesson_id: string }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      owns_lesson: { Args: { _lesson_id: string }; Returns: boolean }
      owns_tutor: { Args: { _tutor_id: string }; Returns: boolean }
      owns_tutor_student: {
        Args: { _tutor_student_id: string }
        Returns: boolean
      }
      promote_folder_to_catalog: {
        Args: {
          p_folder_id: string
          p_source_label?: string
          p_subtopic_id?: string
          p_topic_id: string
        }
        Returns: {
          promoted_count: number
          task_ids: string[]
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      update_group_participant_payment_status: {
        Args: {
          _lesson_id: string
          _payment_status: string
          _tutor_student_id: string
        }
        Returns: Json
      }
      update_lesson_payment: {
        Args: {
          _lesson_id: string
          _payment_status: string
          _tutor_telegram_id: string
        }
        Returns: boolean
      }
      update_lesson_series: {
        Args: {
          _apply_time_shift?: boolean
          _from_start_at: string
          _lesson_type?: string
          _notes?: string
          _root_lesson_id: string
          _selected_lesson_id: string
          _shift_minutes?: number
          _student_id?: string
          _subject?: string
          _tutor_student_id?: string
        }
        Returns: number
      }
      update_user_stats_on_solve: {
        Args: { p_is_correct: boolean; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "tutor"
      exam_type: "ege" | "oge"
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
      exam_type: ["ege", "oge"],
    },
  },
} as const
