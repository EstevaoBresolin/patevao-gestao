import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

type Perfil = 'admin' | 'operador' | 'pendente' | null
type Ctx = {
  session: Session | null; perfil: Perfil; nome: string; carregando: boolean; isAdmin: boolean
  /** true quando o usuário chegou pelo link de "esqueci minha senha" e precisa definir uma nova. */
  recuperando: boolean; fimRecuperacao: () => void
}
const AuthCtx = createContext<Ctx>({ session: null, perfil: null, nome: '', carregando: true, isAdmin: false, recuperando: false, fimRecuperacao: () => {} })

/** Endereço público do sistema, usado nos links enviados por e-mail (confirmação e redefinição de senha). */
export const URL_APP = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') || window.location.origin

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil>(null)
  const [nome, setNome] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [recuperando, setRecuperando] = useState(() => /type=recovery/.test(window.location.hash))

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setCarregando(false) })
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      if (evento === 'PASSWORD_RECOVERY') setRecuperando(true)
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Ao voltar para a aba o Supabase renova o token e entrega um objeto de sessão novo.
  // Só recarregamos o perfil quando o usuário muda; senão a tela inteira era desmontada
  // ("Carregando…") e qualquer modal aberto perdia o que estava digitado.
  const userId = session?.user.id ?? null
  useEffect(() => {
    if (!userId) { setPerfil(null); return }
    setCarregando(true)
    supabase.from('usuario').select('perfil,nome').eq('id', userId).maybeSingle()
      .then(({ data }) => { setPerfil((data?.perfil as Perfil) ?? 'pendente'); setNome(data?.nome ?? ''); setCarregando(false) })
  }, [userId])

  const fimRecuperacao = () => {
    setRecuperando(false)
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
  }

  return (
    <AuthCtx.Provider value={{ session, perfil, nome, carregando, isAdmin: perfil === 'admin', recuperando, fimRecuperacao }}>
      {children}
    </AuthCtx.Provider>
  )
}
export const useAuth = () => useContext(AuthCtx)
