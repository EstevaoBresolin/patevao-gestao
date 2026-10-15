-- Patevão Gestão: funções para editar/excluir registros.
-- Rodar uma vez no Supabase: SQL Editor → New query → colar tudo → Run.

-- Editar venda: agora também troca o cliente e permite limpar campos de texto.
create or replace function public.atualizar_custos_venda(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  update venda set
    data = coalesce((p->>'data')::date, data),
    pedido_externo = case when p ? 'pedido_externo' then nullif(p->>'pedido_externo','') else pedido_externo end,
    cliente_id = case when p ? 'cliente_id' then nullif(p->>'cliente_id','')::uuid else cliente_id end,
    desconto = coalesce((p->>'desconto')::numeric, desconto),
    perc_taxa = coalesce((p->>'perc_taxa')::numeric, perc_taxa),
    tarifa_fixa = coalesce((p->>'tarifa_fixa')::numeric, tarifa_fixa),
    frete = coalesce((p->>'frete')::numeric, frete),
    perc_imposto = coalesce((p->>'perc_imposto')::numeric, perc_imposto),
    outros_custos = coalesce((p->>'outros_custos')::numeric, outros_custos),
    forma_pagamento = case when p ? 'forma_pagamento' then nullif(p->>'forma_pagamento','') else forma_pagamento end,
    observacoes = case when p ? 'observacoes' then nullif(p->>'observacoes','') else observacoes end
  where id = p_id and status not in ('cancelada','devolvida');
  if not found then raise exception 'Venda cancelada ou devolvida não pode ser alterada'; end if;
  perform recalcular_venda(p_id);
end $$;

-- Excluir compra que ainda não deu entrada no estoque.
create or replace function public.excluir_compra(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare s text;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  select status into s from compra where id = p_id for update;
  if s is null then raise exception 'Compra não encontrada'; end if;
  if s not in ('pedida','cancelada') then
    raise exception 'Compra já recebida: os materiais já entraram no estoque e não dá para excluir';
  end if;
  delete from compra where id = p_id;
end $$;

-- Excluir ordem de produção que não foi concluída (nada saiu do estoque).
create or replace function public.excluir_ordem_producao(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare s text;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  select status into s from ordem_producao where id = p_id for update;
  if s is null then raise exception 'Ordem não encontrada'; end if;
  if s = 'concluida' then raise exception 'Ordem concluída já movimentou o estoque e não dá para excluir'; end if;
  delete from ordem_producao where id = p_id;
end $$;

-- Excluir canal sem vendas (com vendas, o caminho é desativar).
create or replace function public.excluir_canal(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_admin() then raise exception 'Sem permissão'; end if;
  if exists (select 1 from venda where canal_id = p_id) then
    raise exception 'Este canal já tem vendas lançadas. Desative-o em vez de excluir.';
  end if;
  delete from canal where id = p_id;
end $$;

grant execute on function public.excluir_compra(uuid), public.excluir_ordem_producao(uuid), public.excluir_canal(uuid) to authenticated;
