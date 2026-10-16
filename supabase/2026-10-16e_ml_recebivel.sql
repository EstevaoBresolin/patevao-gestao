-- Ajuste pontual: pedidos do ML de antes do sistema com dinheiro ainda a liberar.
-- Preenchido uma vez a partir do Mercado Pago (17 pedidos, R$ 2.931,59). Não são vendas lançadas:
-- só entram em "A receber do ML" e, na data de liberação, no saldo da conta. Já aplicado no projeto
-- (as views vw_extrato e vw_ml_a_receber ganharam a parte "ml_antigo"/"avulso").
create table if not exists ml_recebivel (
  id uuid primary key default gen_random_uuid(),
  ml_order_id bigint not null unique,
  data date not null,
  descricao text not null,
  valor numeric(12,2) not null,
  liberacao_em timestamptz,
  liberado boolean not null default false,
  criado_em timestamptz not null default now()
);
alter table ml_recebivel enable row level security;
create policy admin_all on ml_recebivel for all using (is_admin()) with check (is_admin());
