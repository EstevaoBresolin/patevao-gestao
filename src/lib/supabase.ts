import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
)

/** Mensagem legível de um erro do Supabase/Postgres. */
export function erroMsg(e: unknown): string {
  if (!e) return 'Erro desconhecido'
  const m = (e as { message?: string }).message ?? String(e)
  if (m.includes('duplicate key')) return 'Já existe um registro com esse código (SKU/nome).'
  if (m.includes('violates foreign key')) return 'Este registro já é usado em outros lançamentos (vendas, compras, estoque…) e não pode ser excluído. Se existir a opção, desative-o.'
  if (m.includes('Could not find the function') || m.includes('does not exist')) return 'Esta ação precisa de uma atualização no banco que ainda não foi aplicada (arquivo supabase/2026-10-15_editar_excluir.sql).'
  if (m.includes('row-level security')) return 'Seu perfil não tem permissão para esta ação.'
  return m
}
