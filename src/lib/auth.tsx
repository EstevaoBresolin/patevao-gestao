import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

type Perfil = 'admin' | 'operador' | 'pendente' | null
type Ctx = { session: Session | null; perfil: Perfil; nome: string; carregando: boolean; isAdmin: boolean }
const AuthCtx = createContext<Ctx>({ session: null, perfil: null, nome: '', carregando: true, isAdmin: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil>(null)
  const [nome, setNome] = useState('')
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setCarregando(false) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setPerfil(null); return }
    setCarregando(true)
    supabase.from('usuario').select('perfil,nome').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => { setPerfil((data?.perfil as Perfil) ?? 'pendente'); setNome(data?.nome ?? ''); setCarregando(false) })
  }, [session])

  return <AuthCtx.Provider value={{ session, perfil, nome, carregando, isAdmin: perfil === 'admin' }}>{children}</AuthCtx.Provider>
}
export const useAuth = () => useContext(AuthCtx)
