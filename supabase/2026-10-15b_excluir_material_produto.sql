-- Patevão Gestão: excluir material/produto cadastrado por engano + ajustes de segurança.
-- Rodar uma vez no Supabase: SQL Editor → New query → colar tudo → Run.

-- O histórico de estoque é protegido contra alteração; para excluir um cadastro errado
-- liberamos só a remoção dos lançamentos manuais (saldo inicial, ajuste, perda, uso interno).
create or replace function public.excluir_material(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_nome text;
begin
  if not is_admin() then raise exception 'Sem permissão'; end if;
  select nome into v_nome from material where id = p_id for update;
  if v_nome is null then raise exception 'Material não encontrado'; end if;
  if exists (select 1 from compra_item where material_id = p_id) then
    raise exception 'Não dá para excluir: % aparece em compras. Desmarque "Material ativo" para tirá-lo das listas.', v_nome; end if;
  if exists (select 1 from ficha_tecnica_item where material_id = p_id) then
    raise exception 'Não dá para excluir: % está na ficha técnica de algum produto. Tire-o da ficha primeiro.', v_nome; end if;
  if exists (select 1 from ordem_producao_consumo where material_id = p_id) then
    raise exception 'Não dá para excluir: % já foi consumido em produção. Desmarque "Material ativo" para tirá-lo das listas.', v_nome; end if;
  if exists (select 1 from movimento_estoque where material_id = p_id and tipo not in ('entrada_manual','ajuste','perda','uso_interno')) then
    raise exception 'Não dá para excluir: % tem movimentações de estoque de compra ou produção.', v_nome; end if;
  delete from inventario_item where material_id = p_id;
  delete from movimento_estoque where material_id = p_id;
  delete from material where id = p_id;
end $$;

create or replace function public.excluir_produto(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_nome text;
begin
  if not is_admin() then raise exception 'Sem permissão'; end if;
  select nome into v_nome from produto where id = p_id for update;
  if v_nome is null then raise exception 'Produto não encontrado'; end if;
  if exists (select 1 from venda_item where produto_id = p_id) then
    raise exception 'Não dá para excluir: % já tem vendas. Desmarque "Produto ativo" para tirá-lo das listas.', v_nome; end if;
  if exists (select 1 from ordem_producao where produto_id = p_id) then
    raise exception 'Não dá para excluir: % tem ordens de produção. Exclua as ordens ou desmarque "Produto ativo".', v_nome; end if;
  if exists (select 1 from ficha_tecnica_item where componente_produto_id = p_id) then
    raise exception 'Não dá para excluir: % é componente de outro produto.', v_nome; end if;
  if exists (select 1 from produto where produto_pai_id = p_id) then
    raise exception 'Não dá para excluir: % tem variações cadastradas.', v_nome; end if;
  if exists (select 1 from movimento_estoque where produto_id = p_id and tipo not in ('entrada_manual','ajuste','perda','uso_interno')) then
    raise exception 'Não dá para excluir: % tem movimentações de estoque de venda ou produção.', v_nome; end if;
  delete from inventario_item where produto_id = p_id;
  delete from movimento_estoque where produto_id = p_id;
  delete from produto where id = p_id;  -- ficha técnica e preços saem junto (cascade)
end $$;

grant execute on function public.excluir_material(uuid), public.excluir_produto(uuid) to authenticated;

-- Segurança: funções que alteram dados não devem ser chamáveis sem login.
revoke execute on function public.excluir_compra(uuid), public.excluir_ordem_producao(uuid), public.excluir_canal(uuid),
  public.excluir_material(uuid), public.excluir_produto(uuid) from anon, public;
