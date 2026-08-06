"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase, Ticket } from "@/lib/supabaseClient";
import Background from "@/components/Background";

const STATUS_STYLES: Record<string, string> = {
  Open: "bg-sky-500/15 text-sky-400 border border-sky-500/30",
  "In Progress": "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  Resolved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  Closed: "bg-slate-500/15 text-slate-800 border border-slate-500/30",
};

const PRIORITY_STYLES: Record<string, string> = {
  Low: "text-slate-800",
  Medium: "text-sky-400",
  High: "text-amber-400",
  Critical: "text-rose-400",
};

export default function HistoryPage() {
  const [email, setEmail] = useState("");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from("tickets")
        .select("*")
        .eq("email", email.trim().toLowerCase())
        .order("created_at", { ascending: false });
      if (qErr) throw new Error(qErr.message);
      setTickets(data as Ticket[]);
    } catch (err: any) {
      setError(err.message || "Couldn't load tickets.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-16">
      <Background variant="history" />
      <Link href="/" className="text-sm text-slate-800 hover:text-accent-400">← Back</Link>

      <h1 className="mt-4 text-2xl font-semibold text-slate-900">Your tickets</h1>
      <p className="mt-1 text-sm text-slate-800">Enter the email you used to submit a ticket.</p>

      <form onSubmit={lookup} className="glass-panel mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="glass-label" htmlFor="lookup-email">Email</label>
          <input
            id="lookup-email"
            type="email"
            className="glass-input"
            placeholder="jane@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button className="btn-primary" disabled={loading}>
          {loading ? "Searching…" : "Find tickets"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

      {tickets && tickets.length === 0 && (
        <div className="glass-panel mt-6 p-8 text-center text-sm text-slate-800">
          No tickets found for that email yet.
        </div>
      )}

      {tickets && tickets.length > 0 && (
        <div className="mt-6 space-y-3">
          {tickets.map((t) => (
            <div key={t.id} className="glass-panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-700">{t.ticket_code}</span>
                <span className={`status-pill ${STATUS_STYLES[t.status] ?? ""}`}>{t.status}</span>
              </div>
              <h3 className="mt-2 font-medium text-slate-900">{t.subject}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-slate-800">{t.description}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-700">
                <span>Category: <span className="text-slate-800">{t.category}</span></span>
                <span>Priority: <span className={PRIORITY_STYLES[t.priority]}>{t.priority}</span></span>
                {t.jira_issue_key && <span>Jira: <span className="text-accent-400">{t.jira_issue_key}</span></span>}
                {t.ai_recommended_team && <span>Team: <span className="text-slate-800">{t.ai_recommended_team}</span></span>}
              </div>
              {t.ai_summary && (
                <p className="mt-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs text-slate-800">
                  <span className="font-medium text-slate-800">AI summary: </span>{t.ai_summary}
                </p>
              )}
              {t.report_url && (
                <a href={t.report_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-accent-400 hover:underline">
                  View incident report →
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
