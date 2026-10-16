-- Patevão Gestão: integração Mercado Livre (já aplicado no projeto em 2026-10-16; mantido como registro).
create table if not exists public.ml_conta (
  id int primary key default 1 check (id = 1),
  ml_user_id bigint, nickname text,
  access_token text, refresh_token text, expires_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.ml_oauth_state (state text primary key, created_by uuid, created_at timestamptz not null default now());
create table if not exists public.ml_evento (
  id bigint generated always as identity primary key,
  topic text, resource text, recebido_em timestamptz not null default now(), processado_em timestamptz, erro text
);
create table if not exists public.ml_pendente (
  ml_order_id bigint primary key, motivo text not null, resumo jsonb,
  criado_em timestamptz not null default now(), resolvido boolean not null default false
);
create table if not exists public.ml_pergunta_avisada (question_id bigint primary key, avisada_em timestamptz not null default now());
alter table public.venda add column if not exists ml_order_id bigint;
alter table public.venda add column if not exists ml_shipment_id bigint;
create unique index if not exists venda_ml_order_id_key on public.venda (ml_order_id) where ml_order_id is not null;
alter table public.ml_conta enable row level security;
alter table public.ml_oauth_state enable row level security;
alter table public.ml_evento enable row level security;
alter table public.ml_pendente enable row level security;
alter table public.ml_pergunta_avisada enable row level security;
create policy membros_select on public.ml_pendente for select to authenticated using (is_membro());
create policy membros_update on public.ml_pendente for update to authenticated using (is_membro()) with check (is_membro());
create policy admin_select on public.ml_evento for select to authenticated using (is_admin());

create or replace function public.is_membro() returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(auth.role() = 'service_role', false)
      or coalesce((select perfil in ('admin','operador') from public.usuario where id = auth.uid()), false)
$$;

create or replace function public.ml_status() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when not is_membro() then null else
    jsonb_build_object(
      'conectado', exists (select 1 from ml_conta where refresh_token is not null),
      'nickname', (select nickname from ml_conta),
      'atualizado_em', (select updated_at from ml_conta),
      'ultimo_evento', (select max(recebido_em) from ml_evento),
      'pendentes', (select count(*) from ml_pendente where not resolvido))
  end
$$;
grant execute on function public.ml_status() to authenticated;
revoke execute on function public.ml_status() from anon;

create or replace function public.importar_venda_ml(p jsonb, p_order bigint, p_shipment bigint)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Sem permissão'; end if;
  perform pg_advisory_xact_lock(p_order);
  select id into v_id from venda where ml_order_id = p_order;
  if v_id is not null then return v_id; end if;
  v_id := registrar_venda(p);
  update venda set ml_order_id = p_order, ml_shipment_id = p_shipment where id = v_id;
  update ml_pendente set resolvido = true where ml_order_id = p_order;
  return v_id;
end $$;
revoke execute on function public.importar_venda_ml(jsonb, bigint, bigint) from public, anon, authenticated;
grant execute on function public.importar_venda_ml(jsonb, bigint, bigint) to service_role;
