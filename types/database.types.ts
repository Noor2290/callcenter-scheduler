export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      employees: {
        Row: {
          id: string;
          name: string | null;
          code: string | null;
          employment_type: string | null;
          allowed_shifts: string[] | null;
          preferred_days_off: string[] | null;
        };
        Insert: {
          id?: string;
          name?: string | null;
          code?: string | null;
          employment_type?: string | null;
          allowed_shifts?: string[] | null;
          preferred_days_off?: string[] | null;
        };
        Update: {
          id?: string;
          name?: string | null;
          code?: string | null;
          employment_type?: string | null;
          allowed_shifts?: string[] | null;
          preferred_days_off?: string[] | null;
        };
        Relationships: [];
      };
      requests: {
        Row: {
          id: string;
          employee_id: string;
          date: string; // ISO yyyy-MM-dd
          type: string; // e.g., 'Vacation' | 'Off'
        };
        Insert: {
          id?: string;
          employee_id: string;
          date: string;
          type: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          date?: string;
          type?: string;
        };
        Relationships: [];
      };
      months: {
        Row: {
          id: string;
          year: number;
          month: number;
        };
        Insert: {
          id?: string;
          year: number;
          month: number;
        };
        Update: {
          id?: string;
          year?: number;
          month?: number;
        };
        Relationships: [];
      };
      assignments: {
        Row: {
          employee_id: string;
          date: string; // ISO yyyy-MM-dd
          symbol: string;
          month_id: string | null;
        };
        Insert: {
          employee_id: string;
          date: string;
          symbol: string;
          month_id?: string | null;
        };
        Update: {
          employee_id?: string;
          date?: string;
          symbol?: string;
          month_id?: string | null;
        };
        Relationships: [];
      };
      settings: {
        Row: { key: string; value: string | null };
        Insert: { key: string; value?: string | null };
        Update: { key?: string; value?: string | null };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}
