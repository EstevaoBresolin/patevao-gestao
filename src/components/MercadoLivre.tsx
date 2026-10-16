import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Plus, RefreshCw, Store, Trash2 } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataHoraBR, money, parseNum, qty } from '../lib/fmt'
import { useAuth } from '../lib/auth'
import { Badge, Button, Empty, ErrorBox, Field, Input, Modal, NumInput, Panel, Select, useConfirm, useToast } from './ui'

type Status = { conectado: boolean; nickname: string | null; atualizado_em: string | null; ultimo_evento: string | null; pendentes: number }
type Ligacao = { id: string; anuncio: string; variacao: number | null; titulo: string | null; produto_id: string; quantidade: number; produto?: { nome: string } }
type Alvo = { anuncio: string; variacao: number | null; titulo: string | null }
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
        <p className="text-xs text-muted">Para a venda entrar sozinha, preencha em cada produto o <b>Código do anúncio no Mercado Livre</b> (MLB…). Para kits, use "Ligar anúncio" abaixo.</p>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <Button size="sm" variant={s?.conectado ? 'plain' : 'primary'} onClick={conectar}>{s?.conectado ? 'Reconectar conta' : 'Conectar Mercado Livre'}</Button>}
          {s?.conectado && <Button size="sm" onClick={sincronizar}><RefreshCw size={15} /> Buscar vendas dos últimos 7 dias</Button>}
        </div>
        <ErrorBox msg={erro} />
        {s?.conectado && <AnunciosLigados />}
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
  const [ligar, setLigar] = useState<{ alvo: Alvo; pedido: Pendente } | null>(null)
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
                  <div className="flex flex-wrap gap-2">
                    {p.motivo.includes('não está ligado') && (() => {
                      const i = p.resumo?.itens?.find((x) => p.motivo.includes(x.mlb)) ?? p.resumo?.itens?.[0]
                      return i && <Button size="sm" variant="primary" onClick={() => setLigar({ alvo: { anuncio: i.mlb, variacao: i.variacao, titulo: i.titulo }, pedido: p })}><Link2 size={15} /> Ligar anúncio</Button>
                    })()}
                    <Button size="sm" variant={p.motivo.includes('não está ligado') ? 'plain' : 'primary'} onClick={() => tentar(p)}>Tentar de novo</Button>
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
        <p className="mt-4 text-xs text-muted">"Ligar anúncio" diz qual produto sai do estoque (num kit, quais e quantos) e já lança a venda. Se o produto ainda não existe, cadastre antes em <Link to="/produtos" className="underline" onClick={() => setAberto(false)}>Produtos</Link>. "Ignorar" só tira da lista; nada é lançado.</p>
        <div className="mt-3"><ErrorBox msg={erro} /></div>
      </Modal>
      <LigarAnuncio alvo={ligar?.alvo ?? null} onClose={() => setLigar(null)} onSalvo={async () => { const p = ligar?.pedido; setLigar(null); if (p) await tentar(p) }} />
    </>
  )
}

const codigoMLB = (s: string) => { const d = s.replace(/\D/g, ''); return d ? `MLB${d}` : '' }

/**
 * Diz quais produtos (e quantos) saem do estoque quando 1 unidade do anúncio é vendida.
 * Serve para kits ("Kit 2 prateleiras" = 2× Prateleira Branca) e para anúncios
 * que não são de um produto só. O valor da venda é repartido pelo custo de cada produto.
 */
export function LigarAnuncio({ alvo, onClose, onSalvo }: { alvo: Alvo | null; onClose: () => void; onSalvo: (a: Alvo) => void }) {
  const toast = useToast()
  const [anuncio, setAnuncio] = useState('')
  const [variacao, setVariacao] = useState('')
  const [titulo, setTitulo] = useState('')
  const [linhas, setLinhas] = useState<{ produto_id: string; quantidade: string }[]>([])
  const [produtos, setProdutos] = useState<{ id: string; nome: string }[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const novo = !alvo?.anuncio

  useEffect(() => {
    if (!alvo) return
    setErro(null); setAnuncio(alvo.anuncio); setVariacao(alvo.variacao ? String(alvo.variacao) : ''); setTitulo(alvo.titulo ?? '')
    supabase.from('produto').select('id,nome').eq('ativo', true).order('nome').then(({ data }) => setProdutos(data ?? []))
    if (!alvo.anuncio) { setLinhas([{ produto_id: '', quantidade: '1' }]); return }
    let q = supabase.from('ml_anuncio_item').select('produto_id,quantidade').eq('anuncio', codigoMLB(alvo.anuncio))
    q = alvo.variacao ? q.eq('variacao', alvo.variacao) : q.is('variacao', null)
    q.then(({ data }) => setLinhas(data?.length ? data.map((l) => ({ produto_id: l.produto_id, quantidade: String(Number(l.quantidade)).replace('.', ',') })) : [{ produto_id: '', quantidade: kitDoTitulo(alvo.titulo) }]))
  }, [alvo])

  async function salvar() {
    const cod = codigoMLB(anuncio)
    if (!cod) return setErro('Informe o código do anúncio (MLB…).')
    const validas = linhas.filter((l) => l.produto_id)
    if (!validas.length) return setErro('Escolha pelo menos um produto.')
    if (validas.some((l) => !(parseNum(l.quantidade) > 0))) return setErro('A quantidade de cada produto precisa ser maior que zero.')
    const v = variacao.trim() ? Number(variacao.replace(/\D/g, '')) : null
    let del = supabase.from('ml_anuncio_item').delete().eq('anuncio', cod)
    del = v ? del.eq('variacao', v) : del.is('variacao', null)
    const d = await del
    if (d.error) return setErro(erroMsg(d.error))
    const { error } = await supabase.from('ml_anuncio_item').insert(validas.map((l) => ({ anuncio: cod, variacao: v, titulo: titulo.trim() || null, produto_id: l.produto_id, quantidade: parseNum(l.quantidade) })))
    if (error) return setErro(erroMsg(error))
    toast('Anúncio ligado.')
    onSalvo({ anuncio: cod, variacao: v, titulo })
  }
  const set = (k: number, campo: 'produto_id' | 'quantidade', valor: string) => setLinhas(linhas.map((l, i) => (i === k ? { ...l, [campo]: valor } : l)))

  return (
    <Modal open={alvo !== null} onClose={onClose} title={novo ? 'Ligar anúncio do Mercado Livre' : `Ligar ${codigoMLB(anuncio)}`} wide
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></>}>
      <div className="flex flex-col gap-4 text-sm">
        {titulo && !novo && <p className="font-medium">{titulo}</p>}
        {novo && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Código do anúncio"><Input value={anuncio} onChange={(e) => setAnuncio(e.target.value)} placeholder="MLB1234567890" /></Field>
            <Field label="Variação (opcional)"><Input value={variacao} onChange={(e) => setVariacao(e.target.value)} /></Field>
            <Field label="Nome para lembrar"><Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Kit 2 brancas" /></Field>
          </div>
        )}
        <p className="text-muted">Quando <b>1 unidade</b> deste anúncio for vendida, sai do estoque:</p>
        {linhas.map((l, k) => (
          <div key={k} className="flex items-end gap-2">
            <Field label={k === 0 ? 'Quantidade' : ''} className="w-24"><NumInput value={l.quantidade} onChange={(v) => set(k, 'quantidade', v)} /></Field>
            <Field label={k === 0 ? 'Produto' : ''} className="flex-1">
              <Select value={l.produto_id} onChange={(e) => set(k, 'produto_id', e.target.value)}><option value="">Escolha…</option>{produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select>
            </Field>
            {linhas.length > 1 && <Button variant="ghost" aria-label="Tirar" onClick={() => setLinhas(linhas.filter((_, i) => i !== k))}><Trash2 size={15} /></Button>}
          </div>
        ))}
        <div><Button size="sm" onClick={() => setLinhas([...linhas, { produto_id: '', quantidade: '1' }])}><Plus size={15} /> Outro produto no kit</Button></div>
        <p className="text-xs text-muted">Se o produto não aparece, cadastre em Produtos (dá para usar Duplicar) e volte aqui. Num kit com produtos diferentes, o valor da venda é repartido pelo custo de cada um.</p>
        <ErrorBox msg={erro} />
      </div>
    </Modal>
  )
}

/** Tenta adivinhar a quantidade pelo título ("Kit 2 Prateleiras", "Kit Com 3 …"). */
function kitDoTitulo(t: string | null) {
  const m = t?.match(/kit\s+(?:com\s+|de\s+)?(\d+)/i)
  return m ? m[1] : '1'
}

/** Configurações → lista dos anúncios ligados por composição (kits). */
function AnunciosLigados() {
  const confirmar = useConfirm()
  const lista = useLoad<Ligacao[]>(() => supabase.from('ml_anuncio_item').select('*, produto(nome)').order('anuncio'), [])
  const [alvo, setAlvo] = useState<Alvo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const grupos = new Map<string, Ligacao[]>()
  for (const l of lista.data ?? []) {
    const k = `${l.anuncio}/${l.variacao ?? ''}`
    grupos.set(k, [...(grupos.get(k) ?? []), l])
  }
  async function excluir(g: Ligacao[]) {
    if (!(await confirmar({ titulo: `Desligar ${g[0].anuncio}?`, mensagem: 'Vendas novas deste anúncio passam a ir para "conferir". Vendas já lançadas não mudam.' }))) return
    const { error } = await supabase.from('ml_anuncio_item').delete().in('id', g.map((l) => l.id))
    if (error) return setErro(erroMsg(error))
    lista.recarregar()
  }
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Kits e anúncios ligados</p>
        <Button size="sm" onClick={() => setAlvo({ anuncio: '', variacao: null, titulo: null })}><Link2 size={15} /> Ligar anúncio</Button>
      </div>
      {grupos.size === 0 ? <p className="text-xs text-muted">Nenhum ainda. Use para kits (ex.: "Kit 2 prateleiras" = 2× Prateleira Branca).</p> : (
        <ul className="divide-y divide-line rounded-box border border-line">
          {[...grupos.values()].map((g) => (
            <li key={g[0].anuncio + (g[0].variacao ?? '')} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <p className="font-medium">{g[0].titulo || g[0].anuncio}<span className="ml-2 text-xs font-normal text-muted">{g[0].anuncio}{g[0].variacao ? `/${g[0].variacao}` : ''}</span></p>
                <p className="text-xs text-muted">{g.map((l) => `${qty(l.quantidade)}× ${l.produto?.nome ?? '?'}`).join(' + ')}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setAlvo({ anuncio: g[0].anuncio, variacao: g[0].variacao, titulo: g[0].titulo })}>Editar</Button>
                <Button size="sm" variant="ghost" aria-label="Desligar" onClick={() => excluir(g)}><Trash2 size={15} /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ErrorBox msg={erro} />
      <LigarAnuncio alvo={alvo} onClose={() => setAlvo(null)} onSalvo={() => { setAlvo(null); lista.recarregar() }} />
    </div>
  )
}
