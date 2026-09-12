-- À coller une seule fois dans Supabase : SQL Editor > New query > Run
create table if not exists public.leads (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  company text not null,
  interest text not null check (interest in ('chaud','tiède','froid')),
  score integer not null check (score between 0 and 100),
  status text not null,
  follow text not null,
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;

create policy "Users manage only their leads"
on public.leads for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists leads_user_id_updated_at_idx on public.leads(user_id, updated_at desc);
