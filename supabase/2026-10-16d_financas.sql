-- Finanças: contas (Mercado Pago, banco…), extrato e dinheiro a receber do Mercado Livre.
-- O saldo de cada conta = saldo informado em "saldo_em" + tudo que entrou/saiu DEPOIS dessa data:
--   vendas fora do ML (entram na data da venda), dinheiro do ML (entra na data de liberação),
--   despesas, compras recebidas e lançamentos manuais (entradas, saídas, transferências, ajustes).
-- Despesa/compra/venda sem conta escolhida usa a conta padrão. Já aplicado no projeto.

create table if not exists conta_financeira (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  saldo_inicial numeric(14,2) not null default 0,
  saldo_em date not null default current_date,
  padrao boolean not null default false,
  recebe_ml boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists conta_financeira_um_padrao on conta_financeira (padrao) where padrao;
create unique index if not exists conta_financeira_um_ml on conta_financeira (recebe_ml) where recebe_ml;

create table if not exists movimento_financeiro (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references conta_financeira(id),
  data date not null default current_date,
  valor numeric(14,2) not null check (valor <> 0),
  descricao text not null,
  transferencia uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists movimento_financeiro_conta on movimento_financeiro (conta_id, data);

alter table despesa add column if not exists conta_id uuid references conta_financeira(id);
alter table compra  add column if not exists conta_id uuid references conta_financeira(id);
alter table venda   add column if not exists conta_id uuid references conta_financeira(id);
alter table venda   add column if not exists ml_liquido numeric(14,2);
alter table venda   add column if not exists ml_liberacao_em timestamptz;
alter table venda   add column if not exists ml_liberado boolean not null default false;

alter table conta_financeira enable row level security;
alter table movimento_financeiro enable row level security;
create policy admin_all on conta_financeira for all using (is_admin()) with check (is_admin());
create policy membros_select on conta_financeira for select using (is_membro());
create policy admin_all on movimento_financeiro for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on conta_financeira, movimento_financeiro to authenticated;
grant all on conta_financeira, movimento_financeiro to service_role;

-- Valor que a venda deixa na conta: ML = líquido informado pelo Mercado Pago (ou estimativa); outras = receita − taxas − frete − outros custos.
create or replace function venda_liquido(v venda) returns numeric language sql stable as $$
  select coalesce(case when v.ml_order_id is not null then v.ml_liquido end,
                  v.receita - v.valor_taxa - v.tarifa_fixa - v.frete - v.outros_custos)
$$;

create or replace view vw_extrato with (security_invoker = true) as
with padrao as (select id from conta_financeira where padrao limit 1),
     contaml as (select coalesce((select id from conta_financeira where recebe_ml limit 1), (select id from padrao)) id),
     mov as (
  select m.conta_id, m.data, m.valor, m.descricao, case when m.transferencia is null then 'manual' else 'transferencia' end origem, m.id ref_id
    from movimento_financeiro m
  union all
  select coalesce(d.conta_id, (select id from padrao)), d.data, -d.valor, d.descricao, 'despesa', d.id
    from despesa d
  union all
  select coalesce(c.conta_id, (select id from padrao)), c.data,
         -(coalesce((select sum(i.qtd_compra * i.preco_unit_compra) from compra_item i where i.compra_id = c.id), 0) + c.frete + c.outras_despesas - c.desconto),
         'Compra #' || c.numero || coalesce(' · ' || f.nome, ''), 'compra', c.id
    from compra c left join fornecedor f on f.id = c.fornecedor_id
   where c.status in ('recebida', 'parcial')
  union all
  select coalesce(v.conta_id, (select id from padrao)), v.data, venda_liquido(v),
         'Venda #' || v.numero || coalesce(' · ' || cn.nome, ''), 'venda', v.id
    from venda v left join canal cn on cn.id = v.canal_id
   where v.ml_order_id is null and v.status not in ('cancelada', 'devolvida')
  union all
  select (select id from contaml), (v.ml_liberacao_em at time zone 'America/Sao_Paulo')::date, venda_liquido(v),
         'Liberado pelo ML · venda #' || v.numero, 'ml', v.id
    from venda v
   where v.ml_order_id is not null and v.status not in ('cancelada', 'devolvida')
     and v.ml_liberacao_em is not null and (v.ml_liberado or v.ml_liberacao_em <= now())
)
select mov.*, c.nome conta_nome from mov join conta_financeira c on c.id = mov.conta_id
 where mov.data > c.saldo_em;

create or replace view vw_conta_saldo with (security_invoker = true) as
select c.*, c.saldo_inicial + coalesce((select sum(e.valor) from vw_extrato e where e.conta_id = c.id), 0) saldo
  from conta_financeira c;

-- Vendas do ML com dinheiro ainda não liberado.
create or replace view vw_ml_a_receber with (security_invoker = true) as
select v.id, v.numero, v.data, v.pedido_externo, v.receita, venda_liquido(v) liquido, v.ml_liquido is null estimado,
       v.ml_liberacao_em, v.status
  from venda v
 where v.ml_order_id is not null and v.status not in ('cancelada', 'devolvida')
   and not v.ml_liberado and (v.ml_liberacao_em is null or v.ml_liberacao_em > now());

grant select on vw_extrato, vw_conta_saldo, vw_ml_a_receber to authenticated;

-- Conta da venda (quando há mais de uma conta): a venda em si só muda por RPC.
create or replace function definir_conta_venda(p_venda uuid, p_conta uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  update venda set conta_id = p_conta where id = p_venda;
end $$;
revoke all on function definir_conta_venda(uuid, uuid) from public, anon;
grant execute on function definir_conta_venda(uuid, uuid) to authenticated;
