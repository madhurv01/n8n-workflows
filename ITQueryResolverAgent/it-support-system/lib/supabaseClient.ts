import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly in dev rather than silently sending malformed requests.
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase env vars are missing. Copy .env.example to .env.local and fill in your project credentials."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type TicketPriority = "Low" | "Medium" | "High" | "Critical";
export type TicketCategory =
  | "Hardware"
  | "Software"
  | "Network"
  | "Access/Account"
  | "Security"
  | "Infrastructure"
  | "Email"
  | "Other";
export type TicketStatus = "Open" | "In Progress" | "Resolved" | "Closed";

export interface Ticket {
  id: string;
  ticket_code: string;
  name: string;
  email: string;
  department: string;
  category: TicketCategory;
  priority: TicketPriority;
  subject: string;
  description: string;
  attachment_url: string | null;
  status: TicketStatus;
  ai_summary: string | null;
  ai_severity: string | null;
  ai_recommended_team: string | null;
  jira_issue_key: string | null;
  report_url: string | null;
  created_at: string;
  updated_at: string;
}
