"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const CATEGORIES = [
  "Hardware",
  "Software",
  "Network",
  "Access/Account",
  "Security",
  "Infrastructure",
  "Email",
  "Other",
] as const;

const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;

const MAX_FILE_MB = 10;
const BUCKET =
  process.env.NEXT_PUBLIC_TICKET_ATTACHMENTS_BUCKET || "ticket-attachments";

type FormState = {
  name: string;
  email: string;
  department: string;
  category: (typeof CATEGORIES)[number] | "";
  priority: (typeof PRIORITIES)[number];
  subject: string;
  description: string;
};

const initialState: FormState = {
  name: "",
  email: "",
  department: "",
  category: "",
  priority: "Medium",
  subject: "",
  description: "",
};

export default function TicketForm({ onSuccess }: { onSuccess: (ticketCode: string) => void }) {
  const [form, setForm] = useState<FormState>(initialState);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Enter your full name.";
    if (!form.email.trim()) next.email = "Enter your email.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      next.email = "Enter a valid email address.";
    if (!form.department.trim()) next.department = "Enter your department.";
    if (!form.category) next.category = "Select an issue category.";
    if (!form.subject.trim()) next.subject = "Give the issue a short subject.";
    else if (form.subject.trim().length < 5)
      next.subject = "Subject should be at least 5 characters.";
    if (!form.description.trim()) next.description = "Describe the issue.";
    else if (form.description.trim().length < 20)
      next.description = "Add a bit more detail (20+ characters) so support can help faster.";
    if (file && file.size > MAX_FILE_MB * 1024 * 1024)
      next.file = `File must be under ${MAX_FILE_MB} MB.`;

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      let attachment_url: string | null = null;

      if (file) {
        const path = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { cacheControl: "3600", upsert: false });
        if (uploadError) throw new Error(`Attachment upload failed: ${uploadError.message}`);

        const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
        attachment_url = publicUrlData.publicUrl;
      }

      const { data, error } = await supabase
        .from("tickets")
        .insert({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          department: form.department.trim(),
          category: form.category,
          priority: form.priority,
          subject: form.subject.trim(),
          description: form.description.trim(),
          attachment_url,
          status: "Open",
        })
        .select("ticket_code")
        .single();

      if (error) throw new Error(error.message);

      setForm(initialState);
      setFile(null);
      onSuccess(data.ticket_code);
    } catch (err: any) {
      setServerError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Raise a query</h2>
        <p className="mt-1 text-sm text-slate-800">
          Tell us what's going on — our team (and a little AI triage) will take it from here.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="glass-label" htmlFor="name">Name</label>
          <input
            id="name"
            className="glass-input"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Jane Doe"
          />
          {errors.name && <p className="mt-1 text-xs text-rose-400">{errors.name}</p>}
        </div>

        <div>
          <label className="glass-label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="glass-input"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="jane@company.com"
          />
          {errors.email && <p className="mt-1 text-xs text-rose-400">{errors.email}</p>}
        </div>

        <div>
          <label className="glass-label" htmlFor="department">Department</label>
          <input
            id="department"
            className="glass-input"
            value={form.department}
            onChange={(e) => update("department", e.target.value)}
            placeholder="Finance, Engineering, Sales…"
          />
          {errors.department && <p className="mt-1 text-xs text-rose-400">{errors.department}</p>}
        </div>

        <div>
          <label className="glass-label" htmlFor="category">Issue category</label>
          <select
            id="category"
            className="glass-input"
            value={form.category}
            onChange={(e) => update("category", e.target.value as FormState["category"])}
          >
            <option value="" className="bg-base-900">Select a category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c} className="bg-base-900">{c}</option>
            ))}
          </select>
          {errors.category && <p className="mt-1 text-xs text-rose-400">{errors.category}</p>}
        </div>

        <div className="sm:col-span-2">
          <label className="glass-label">Priority</label>
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => update("priority", p)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  form.priority === p
                    ? "border-accent-500/60 bg-accent-500/15 text-accent-400"
                    : "border-white/10 bg-white/[0.02] text-slate-800 hover:text-slate-900"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className="glass-label" htmlFor="subject">Subject</label>
          <input
            id="subject"
            className="glass-input"
            value={form.subject}
            onChange={(e) => update("subject", e.target.value)}
            placeholder="Short summary of the issue"
          />
          {errors.subject && <p className="mt-1 text-xs text-rose-400">{errors.subject}</p>}
        </div>

        <div className="sm:col-span-2">
          <label className="glass-label" htmlFor="description">Description</label>
          <textarea
            id="description"
            rows={4}
            className="glass-input resize-none"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="What happened, when it started, and what you've already tried."
          />
          {errors.description && <p className="mt-1 text-xs text-rose-400">{errors.description}</p>}
        </div>

        <div className="sm:col-span-2">
          <label className="glass-label" htmlFor="file">Attachment (optional)</label>
          <input
            id="file"
            type="file"
            className="glass-input file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-slate-800"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-xs text-slate-700">Screenshots or logs help — up to {MAX_FILE_MB} MB.</p>
          {errors.file && <p className="mt-1 text-xs text-rose-400">{errors.file}</p>}
        </div>
      </div>

      {serverError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {serverError}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit ticket"}
        </button>
      </div>
    </form>
  );
}
