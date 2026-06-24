export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      billing_events: {
        Row: {
          created_at: string;
          event_type: string;
          id: string;
          payload: Json;
          stripe_customer_id: string | null;
          stripe_event_id: string;
          stripe_subscription_id: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          id?: string;
          payload: Json;
          stripe_customer_id?: string | null;
          stripe_event_id: string;
          stripe_subscription_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          id?: string;
          payload?: Json;
          stripe_customer_id?: string | null;
          stripe_event_id?: string;
          stripe_subscription_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      map_apps: {
        Row: {
          app_type: string;
          config: Json;
          created_at: string;
          description: string | null;
          id: string;
          owner_id: string;
          published_at: string | null;
          slug: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          app_type?: string;
          config?: Json;
          created_at?: string;
          description?: string | null;
          id?: string;
          owner_id: string;
          published_at?: string | null;
          slug: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          app_type?: string;
          config?: Json;
          created_at?: string;
          description?: string | null;
          id?: string;
          owner_id?: string;
          published_at?: string | null;
          slug?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          stripe_customer_id: string | null;
          subscription_price_id: string | null;
          subscription_status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          stripe_customer_id?: string | null;
          subscription_price_id?: string | null;
          subscription_status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          stripe_customer_id?: string | null;
          subscription_price_id?: string | null;
          subscription_status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          id: string;
          price_id: string | null;
          status: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          price_id?: string | null;
          status: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          price_id?: string | null;
          status?: string;
          stripe_customer_id?: string;
          stripe_subscription_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      super_admins: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
