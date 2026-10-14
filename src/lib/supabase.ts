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
  if (m.includes('violates foreign key')) return 'Este registro está em uso e não pode ser excluído. Desative-o em vez disso.'
  if (m.includes('row-level security')) return 'Seu perfil não tem permissão para esta ação.'
  return m
}
