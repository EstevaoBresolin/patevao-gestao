import { useState, type FormEvent } from 'react'
import { supabase, erroMsg } from '../lib/supabase'
import { Button, ErrorBox, Field, Input } from '../components/ui'

export default function Login() {
  const [modo, setModo] = useState<'entrar' | 'criar'>('entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault(); setErro(null); setAviso(null); setEnviando(true)
    if (modo === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
      if (error) setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : erroMsg(error))
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password: senha, options: { data: { nome } } })
      if (error) setErro(erroMsg(error))
      else if (!data.session) setAviso('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.')
    }
    setEnviando(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="led-strip inline-flex items-center gap-3 pb-2">
            <img src="/icon.svg" alt="" className="h-10 w-10" />
            <span className="wide text-2xl font-bold tracking-tight">Patevão Gestão</span>
          </div>
          <p className="mt-4 text-sm text-muted">Estoque, produção e vendas da oficina em um lugar só.</p>
        </div>
        <form onSubmit={enviar} className="flex flex-col gap-4 rounded-box border border-line bg-panel p-5">
          {modo === 'criar' && <Field label="Seu nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} required /></Field>}
          <Field label="E-mail"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Senha" hint={modo === 'criar' ? 'Mínimo de 6 caracteres.' : undefined}>
            <Input type="password" autoComplete={modo === 'criar' ? 'new-password' : 'current-password'} value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} />
          </Field>
          <ErrorBox msg={erro} />
          {aviso && <p className="rounded-box bg-good/10 px-3 py-2 text-sm text-good">{aviso}</p>}
          <Button variant="primary" disabled={enviando}>{modo === 'entrar' ? 'Entrar' : 'Criar conta'}</Button>
        </form>
        <button className="mt-4 text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setModo(modo === 'entrar' ? 'criar' : 'entrar')}>
          {modo === 'entrar' ? 'Primeiro acesso? Criar conta' : 'Já tenho conta. Entrar'}
        </button>
      </div>
    </div>
  )
}
