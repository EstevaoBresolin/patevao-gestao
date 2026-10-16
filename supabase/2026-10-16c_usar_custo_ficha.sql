-- Produto passa a usar o custo da ficha técnica (custo_padrao e custo_medio).
-- Opcional: recalcula o custo e o lucro das vendas já lançadas desse produto. Já aplicado no projeto.
create or replace function public.usar_custo_ficha(p_id uuid, p_corrigir_vendas boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_custo numeric; v_vendas int := 0; r record;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  if not exists (select 1 from ficha_tecnica_item where produto_id = p_id) then raise exception 'Este produto não tem ficha técnica'; end if;
  v_custo := round(custo_ficha(p_id), 4);
  if v_custo <= 0 then raise exception 'O custo da ficha está zerado: confira o custo dos materiais'; end if;
  update produto set custo_padrao = v_custo, custo_medio = v_custo where id = p_id;
  if p_corrigir_vendas then
    for r in select distinct vi.venda_id from venda_item vi join venda v on v.id = vi.venda_id
             where vi.produto_id = p_id and v.status not in ('cancelada','devolvida') loop
      update venda_item set custo_unit_congelado = v_custo where venda_id = r.venda_id and produto_id = p_id;
      perform recalcular_venda(r.venda_id);
      v_vendas := v_vendas + 1;
    end loop;
  end if;
  return jsonb_build_object('custo', v_custo, 'vendas', v_vendas);
end $$;
revoke all on function public.usar_custo_ficha(uuid, boolean) from public, anon;
grant execute on function public.usar_custo_ficha(uuid, boolean) to authenticated;
