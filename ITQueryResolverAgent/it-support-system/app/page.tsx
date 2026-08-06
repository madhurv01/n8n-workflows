"use client";

import { useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import TicketForm from "@/components/TicketForm";
import Background from "@/components/Background";

export default function HomePage() {
  const [open, setOpen] = useState(false);
  const [successCode, setSuccessCode] = useState<string | null>(null);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
      <Background variant="home" />
      <div className="w-full text-center">
        <span className="status-pill border border-accent-500/30 bg-accent-500/10 text-accent-400">
          IT Support Desk
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Something broken? Let's fix it.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-800">
          Submit a ticket and it's automatically triaged, classified, and routed —
          no waiting for someone to read your email first.
        </p>
      </div>

      <div className="glass-panel mt-10 inline-flex w-fit flex-col items-center p-6">
        <button className="btn-primary px-8 py-3 text-base" onClick={() => { setSuccessCode(null); setOpen(true); }}>
          Raise a Query
        </button>
        <div className="mt-4">
          <Link href="/history" className="text-sm text-slate-800 underline-offset-4 hover:text-accent-400 hover:underline whitespace-nowrap">
            Track an existing ticket →
          </Link>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)}>
        {successCode ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              ✓
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Ticket submitted</h3>
            <p className="mt-1 text-sm text-slate-800">
              Your reference is <span className="font-mono text-accent-400">{successCode}</span>.
              We've started AI triage and you'll get an email update shortly.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button className="btn-ghost" onClick={() => setOpen(false)}>Close</button>
              <Link href="/history" className="btn-primary">View ticket history</Link>
            </div>
          </div>
        ) : (
          <TicketForm onSuccess={(code) => setSuccessCode(code)} />
        )}
      </Modal>
    </main>
  );
}
