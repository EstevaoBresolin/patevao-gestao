import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Store } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataHoraBR, money } from '../lib/fmt'
import { useAuth } from '../lib/auth'
import { Badge, Button, Empty, ErrorBox, Modal, Panel, useToast } from './ui'

type Status = { conectado: boolean; nickname: string | null; atualizado_em: string | null; ultimo_evento: string | null; pendentes: number }
type Pendente = { ml_order_id: number; motivo: string; criado_em: string; resumo: { data: string; comprador: string | null; total: number; itens: { mlb: string; titulo: string; qtd: number; preco: number; variacao: number | null }[] } }

async function chamar(acao: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('ml-sync', { body: { acao, ...extra } })
  if (error) {
    // Mensagem que a função devolveu, quando houver.
    const ctx = (error as { context?: Response }).context
    const corpo = ctx ? await ctx.json().catch(() => null) : null
    throw new Error(corpo?.erro ?? error.message)
  }
  if (data?.erro) throw new Error(data.erro)
  return data
}

const RESULTADO: Record<string, string> = {
  lancada: 'lançadas', ja_lancada: 'já estavam lançadas', pendente: 'foram para conferir', cancelada: 'canceladas',
  ignorada: 'canceladas no ML (ignoradas)', aguardando_pagamento: 'aguardando pagamento', erro: 'com erro',
}

/** Configurações → conexão com o Mercado Livre. */
export function PainelML() {
  const toast = useToast()
  const { isAdmin } = useAuth()
  const st = useLoad<Status>(() => supabase.rpc('ml_status'), [])
  const [erro, setErro] = useState<string | null>(null)

  // Volta da autorização: ?ml=ok ou ?ml=erro&msg=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const r = q.get('ml')
    if (!r) return
    if (r === 'ok') toast('Mercado Livre conectado.')
    else setErro(q.get('msg') ?? 'Não foi possível conectar.')
    history.replaceState(null, '', window.location.pathname)
    st.recarregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function conectar() {
    setErro(null)
    try { const { url } = await chamar('auth_url'); window.location.href = url } catch (e) { setErro(erroMsg(e)) }
  }
  async function sincronizar() {
    setErro(null)
    try {
      const r = await chamar('sincronizar')
      const partes = Object.entries(r).filter(([k]) => k !== 'total').map(([k, v]) => `${v} ${RESULTADO[k] ?? k}`)
      toast(r.total ? `${r.total} pedidos dos últimos 7 dias: ${partes.join(', ')}.` : 'Nenhum pedido nos últimos 7 dias.')
      st.recarregar()
    } catch (e) { setErro(erroMsg(e)) }
  }

  const s = st.data
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Store size={17} /> Mercado Livre</span>}
      actions={s?.conectado ? <Badge tone="good">Conectado{ s.nickname ? ` · ${s.nickname}` : ''}</Badge> : <Badge>Não conectado</Badge>}>
      <div className="flex flex-col gap-3 p-4 text-sm">
        <p className="text-muted">Vendas do Mercado Livre entram sozinhas, com a taxa e o frete que o ML cobrou de verdade. Cancelamentos devolvem o estoque e mudanças de envio atualizam a situação. Perguntas novas são avisadas por e-mail.</p>
        {s?.conectado && (
          <p className="text-muted">
            Último aviso recebido: {s.ultimo_evento ? dataHoraBR(s.ultimo_evento) : 'nenhum ainda'}
            {s.pendentes > 0 && <> · <Link to="/vendas" className="font-medium text-ledink underline">{s.pendentes} venda(s) para conferir</Link></>}
          </p>
        )}
        <p className="text-xs text-muted">Para a venda entrar sozinha, preencha em cada produto o <b>Código do anúncio no Mercado Livre</b> (MLB…).</p>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <Button size="sm" variant={s?.conectado ? 'plain' : 'primary'} onClick={conectar}>{s?.conectado ? 'Reconectar conta' : 'Conectar Mercado Livre'}</Button>}
          {s?.conectado && <Button size="sm" onClick={sincronizar}><RefreshCw size={15} /> Buscar vendas dos últimos 7 dias</Button>}
        </div>
        <ErrorBox msg={erro} />
      </div>
    </Panel>
  )
}

/** Vendas → aviso e lista das vendas do ML que não entraram sozinhas. */
export function PendentesML({ onImportou }: { onImportou: () => void }) {
  const toast = useToast()
  const lista = useLoad<Pendente[]>(() => supabase.from('ml_pendente').select('*').eq('resolvido', false).order('criado_em', { ascending: false }), [])
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const n = lista.data?.length ?? 0

  async function tentar(p: Pendente) {
    setErro(null)
    try {
      const { resultado } = await chamar('importar', { order_id: p.ml_order_id })
      if (resultado === 'lancada' || resultado === 'ja_lancada') { toast('Venda do Mercado Livre lançada.'); onImportou() }
      else if (resultado === 'pendente') setErro('Ainda não deu para lançar. Veja o motivo atualizado na lista.')
      else toast(`Pedido ${RESULTADO[resultado] ?? resultado}.`)
      lista.recarregar()
    } catch (e) { setErro(erroMsg(e)) }
  }
  async function ignorar(p: Pendente) {
    const { error } = await supabase.from('ml_pendente').update({ resolvido: true }).eq('ml_order_id', p.ml_order_id)
    if (error) return setErro(erroMsg(error))
    lista.recarregar()
  }

  if (!n) return null
  return (
    <>
      <button onClick={() => setAberto(true)} className="mb-4 flex w-full items-center justify-between gap-3 rounded-box border border-led/50 bg-led/10 px-4 py-3 text-left text-sm hover:bg-led/15">
        <span><b>{n} venda(s) do Mercado Livre para conferir.</b> <span className="text-muted">Não entraram sozinhas: veja o motivo e resolva.</span></span>
        <span className="font-medium text-ledink">Ver</span>
      </button>
      <Modal open={aberto} onClose={() => setAberto(false)} title="Vendas do Mercado Livre para conferir" wide
        footer={<Button onClick={() => setAberto(false)}>Fechar</Button>}>
        {n === 0 ? <Empty title="Tudo resolvido" /> : (
          <ul className="flex flex-col gap-3">
            {(lista.data ?? []).map((p) => (
              <li key={p.ml_order_id} className="rounded-box border border-line p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">Pedido {p.ml_order_id}{p.resumo?.comprador && <span className="font-normal text-muted"> · {p.resumo.comprador}</span>}</p>
                    <p className="num text-xs text-muted">{p.resumo?.data} · {money(p.resumo?.total)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => tentar(p)}>Tentar de novo</Button>
                    <Button size="sm" variant="ghost" onClick={() => ignorar(p)}>Ignorar</Button>
                  </div>
                </div>
                <ul className="mt-2 space-y-0.5 text-muted">
                  {(p.resumo?.itens ?? []).map((i, k) => <li key={k}>{i.qtd}× {i.titulo} <span className="text-xs">({i.mlb}{i.variacao ? `/${i.variacao}` : ''})</span></li>)}
                </ul>
                <p className="mt-2 rounded-box bg-warn/10 px-2.5 py-1.5 text-warn">{p.motivo}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">Para ligar um anúncio: abra o produto em <Link to="/produtos" className="underline" onClick={() => setAberto(false)}>Produtos</Link>, clique em Editar e preencha o "Código do anúncio" com o código acima. Depois clique em "Tentar de novo". "Ignorar" só tira da lista; nada é lançado.</p>
        <div className="mt-3"><ErrorBox msg={erro} /></div>
      </Modal>
    </>
  )
}
