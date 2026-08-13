create table invoices (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,
  invoice_number text not null,
  invoice_date date,
  due_date date,
  currency text,
  subtotal numeric,
  tax numeric,
  total_amount numeric,
  payment_status text,
  description text,
  drive_file_url text,
  drive_file_id text,
  email_id text,
  created_at timestamptz default now(),
  unique (vendor, invoice_number)
);
