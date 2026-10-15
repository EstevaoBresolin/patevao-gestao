import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataHoraBR, money, parseNum, percent, qty } from '../lib/fmt'
import { custoProduto, TIPO_MOV, type Material, type Produto, type TaxaVigente } from '../lib/types'
import { Badge, Button, Empty, ErrorBox, Field, Loading, NumInput, PageHeader, Panel, Select, Stat, Table, useToast } from '../components/ui'
import ProdutoForm from '../components/ProdutoForm'

type Item = { id: string; material_id: string; quantidade: number; perc_perda: number; material: Material | null }

export default function ProdutoDetalhe() {
  const { id } = useParams()
  const toast = useToast()
  const navigate = useNavigate()
  const [editar, setEditar] = useState(false)
  const [itemEdit, setItemEdit] = useState<Record<string, { quantidade?: string; perc_perda?: string }>>({})
  const prod = useLoad<Produto>(() => supabase.from('vw_produto_estoque').select('*').eq('id', id!).single(), [id])
  const ficha = useLoad<Item[]>(() => supabase.from('ficha_tecnica_item').select('*, material(*)').eq('produto_id', id!).not('material_id', 'is', null), [id])
  const materiais = useLoad<Material[]>(() => supabase.from('material').select('*').eq('ativo', true).order('nome'), [])
  const taxas = useLoad<TaxaVigente[]>(() => supabase.from('vw_canal_taxa_vigente').select('*').order('canal_nome'), [])
  const precos = useLoad<{ canal_id: string; preco_venda: number }[]>(() => supabase.from('preco_canal').select('canal_id,preco_venda').eq('produto_id', id!), [id])
  const imposto = useLoad<{ valor: string }>(() => supabase.from('parametro').select('valor').eq('chave', 'imposto_perc').maybeSingle(), [])
  const movs = useLoad<{ id: string; data: string; tipo: string; quantidade: number; saldo_apos: number; motivo: string | null }[]>(
    () => supabase.from('movimento_estoque').select('id,data,tipo,quantidade,saldo_apos,motivo').eq('produto_id', id!).order('data', { ascending: false }).limit(15), [id])

  const [novo, setNovo] = useState({ material_id: '', quantidade: '', perc_perda: '0' })
  const [erro, setErro] = useState<string | null>(null)
  const [precoEdit, setPrecoEdit] = useState<Record<string, string>>({})

  const p = prod.data
  if (prod.erro) return <ErrorBox msg={prod.erro} />
  if (!p) return <Loading />

  const itens = ficha.data ?? []
  const custoFicha = itens.reduce((s, i) => s + Number(i.quantidade) * (1 + Number(i.perc_perda) / 100) * Number(i.material?.custo_medio ?? 0), 0) + Number(p.custos_fixos_unit)
  const custoAtual = custoProduto(p)
  const matNovo = (materiais.data ?? []).find((m) => m.id === novo.material_id)

  async function addItem() {
    setErro(null)
    if (!novo.material_id || parseNum(novo.quantidade) <= 0) return setErro('Escolha o material e a quantidade usada por unidade.')
    const { error } = await supabase.from('ficha_tecnica_item').insert({ produto_id: id, material_id: novo.material_id, quantidade: parseNum(novo.quantidade), perc_perda: parseNum(novo.perc_perda) })
    if (error) return setErro(erroMsg(error))
    setNovo({ material_id: '', quantidade: '', perc_perda: '0' }); ficha.recarregar()
  }
  async function delItem(itemId: string) {
    const { error } = await supabase.from('ficha_tecnica_item').delete().eq('id', itemId)
    if (error) return setErro(erroMsg(error))
    ficha.recarregar()
  }
  async function salvarItem(i: Item) {
    const e = itemEdit[i.id]
    if (!e) return
    const quantidade = e.quantidade !== undefined ? parseNum(e.quantidade) : Number(i.quantidade)
    const perc_perda = e.perc_perda !== undefined ? parseNum(e.perc_perda) : Number(i.perc_perda)
    if (quantidade <= 0) return setErro('A quantidade precisa ser maior que zero. Para tirar o material da ficha, use a lixeira.')
    if (quantidade === Number(i.quantidade) && perc_perda === Number(i.perc_perda)) return
    const { error } = await supabase.from('ficha_tecnica_item').update({ quantidade, perc_perda }).eq('id', i.id)
    if (error) return setErro(erroMsg(error))
    setItemEdit(({ [i.id]: _, ...resto }) => resto)
    toast('Ficha técnica atualizada.'); ficha.recarregar()
  }
  async function atualizarCustoPadrao() {
    const { error } = await supabase.from('produto').update({ custo_padrao: Math.round(custoFicha * 10000) / 10000 }).eq('id', id!)
    if (error) return setErro(erroMsg(error))
    toast('Custo do produto atualizado pela ficha técnica.'); prod.recarregar()
  }
  async function salvarPreco(canal_id: string) {
    const v = precoEdit[canal_id]
    if (v === undefined) return
    const { error } = v.trim() === ''
      ? await supabase.from('preco_canal').delete().eq('produto_id', id!).eq('canal_id', canal_id)
      : await supabase.from('preco_canal').upsert({ produto_id: id, canal_id, preco_venda: parseNum(v) })
    if (error) return setErro(erroMsg(error))
    toast('Preço salvo.'); precos.recarregar()
  }

  const imp = Number(imposto.data?.valor ?? 0)
  const canaisUnicos = Array.from(new Map((taxas.data ?? []).map((t) => [t.canal_id, t])).values())

  return (
    <div>
      <Link to="/produtos" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Produtos</Link>
      <PageHeader title={p.nome} sub={<>{p.sku && `${p.sku} · `}{p.atributos?.tamanho}{p.atributos?.cor_led && ` · ${p.atributos.cor_led}`}{!p.ativo && <span className="ml-2"><Badge>Inativo</Badge></span>}</>}
        actions={<Button size="sm" onClick={() => setEditar(true)}><Pencil size={15} /> Editar</Button>} />
      <ErrorBox msg={erro} />

      <Panel className="mb-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-box bg-line sm:grid-cols-4 [&>*]:bg-panel">
          <Stat label="Em estoque" value={qty(p.saldo)} />
          <Stat label="Custo usado nas vendas" value={money(custoAtual)} />
          <Stat label="Custo pela ficha técnica" value={itens.length ? money(custoFicha) : '–'} />
          <Stat label="Valor em estoque" value={money(p.valor_estoque)} />
        </div>
      </Panel>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Ficha técnica (por unidade)"
          actions={itens.length > 0 && Math.abs(custoFicha - Number(p.custo_padrao)) > 0.01 && Number(p.custo_medio) === 0 && <Button size="sm" onClick={atualizarCustoPadrao}>Usar custo da ficha</Button>}>
          {itens.length > 0 && <p className="border-b border-line px-4 py-2 text-xs text-muted">Para corrigir, altere a quantidade ou a perda e clique fora do campo.</p>}
          {itens.length === 0 ? <Empty title="Nenhum material cadastrado">Adicione os materiais que uma unidade consome. Assim a produção baixa o estoque deles e o custo sai certo.</Empty> : (
            <Table head={<tr><th>Material</th><th className="text-right">Qtd.</th><th className="text-right">Perda</th><th className="text-right">Custo</th><th /></tr>}>
              {itens.map((i) => (
                <tr key={i.id}>
                  <td>{i.material?.nome}</td>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <NumInput aria-label={`Quantidade de ${i.material?.nome}`} className="h-8 w-20" value={itemEdit[i.id]?.quantidade ?? String(Number(i.quantidade)).replace('.', ',')}
                        onChange={(v) => setItemEdit({ ...itemEdit, [i.id]: { ...itemEdit[i.id], quantidade: v } })} onBlur={() => salvarItem(i)} />
                      <span className="text-xs text-muted">{i.material?.unidade_uso}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <NumInput aria-label={`Perda de ${i.material?.nome}`} className="h-8 w-16" value={itemEdit[i.id]?.perc_perda ?? String(Number(i.perc_perda)).replace('.', ',')}
                        onChange={(v) => setItemEdit({ ...itemEdit, [i.id]: { ...itemEdit[i.id], perc_perda: v } })} onBlur={() => salvarItem(i)} />
                      <span className="text-xs text-muted">%</span>
                    </div>
                  </td>
                  <td className="num text-right">{money(Number(i.quantidade) * (1 + Number(i.perc_perda) / 100) * Number(i.material?.custo_medio ?? 0))}</td>
                  <td className="w-10"><button aria-label="Remover" onClick={() => delItem(i.id)} className="text-muted hover:text-bad"><Trash2 size={15} /></button></td>
                </tr>
              ))}
              {Number(p.custos_fixos_unit) > 0 && <tr><td className="text-muted">Custos fixos por unidade</td><td /><td /><td className="num text-right">{money(p.custos_fixos_unit)}</td><td /></tr>}
              <tr className="font-semibold"><td>Total</td><td /><td /><td className="num text-right">{money(custoFicha)}</td><td /></tr>
            </Table>
          )}
          <div className="grid grid-cols-[1fr_90px_80px] gap-2 border-t border-line p-4 sm:grid-cols-[1fr_110px_90px_auto] sm:items-end">
            <Field label="Material" className="col-span-3 sm:col-span-1">
              <Select value={novo.material_id} onChange={(e) => setNovo({ ...novo, material_id: e.target.value })}>
                <option value="">Escolha…</option>
                {(materiais.data ?? []).filter((m) => !itens.some((i) => i.material_id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </Select>
            </Field>
            <Field label={`Qtd.${matNovo ? ` (${matNovo.unidade_uso})` : ''}`}><NumInput value={novo.quantidade} onChange={(v) => setNovo({ ...novo, quantidade: v })} /></Field>
            <Field label="Perda %"><NumInput value={novo.perc_perda} onChange={(v) => setNovo({ ...novo, perc_perda: v })} /></Field>
            <Button onClick={addItem} className="col-span-1"><Plus size={15} /> Adicionar</Button>
          </div>
          {(materiais.data ?? []).length === 0 && <p className="px-4 pb-4 text-sm text-muted">Cadastre os materiais primeiro em <Link to="/materiais" className="underline">Materiais</Link>.</p>}
        </Panel>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Preço por canal">
            <div className="divide-y divide-line">
              {canaisUnicos.map((t) => {
                const atual = (precos.data ?? []).find((x) => x.canal_id === t.canal_id)?.preco_venda
                const txt = precoEdit[t.canal_id] ?? (atual != null ? String(atual).replace('.', ',') : '')
                const pv = parseNum(txt)
                const tarifa = Number(t.tarifa_fixa) && (t.tarifa_ate_preco == null || pv <= Number(t.tarifa_ate_preco)) ? Number(t.tarifa_fixa) : 0
                const lucro = pv - pv * (Number(t.perc_taxa) + imp) / 100 - tarifa - Number(t.frete_padrao) - custoAtual
                return (
                  <div key={t.canal_id} className="grid grid-cols-[1fr_120px] items-end gap-3 p-4">
                    <div>
                      <p className="font-medium">{t.canal_nome}</p>
                      {pv > 0 ? <p className="num mt-1 text-sm text-muted">Lucro estimado por unidade: <span className={lucro < 0 ? 'text-bad' : 'text-ink'}>{money(lucro)}</span> ({percent(lucro / pv)})</p>
                        : <p className="mt-1 text-sm text-muted">Sem preço definido</p>}
                      <p className="mt-0.5 text-xs text-muted">Considera taxa {qty(t.perc_taxa)}%{t.perfil !== 'Padrão' && ` (${t.perfil})`}, frete {money(t.frete_padrao)}{imp > 0 && `, imposto ${qty(imp)}%`}.</p>
                    </div>
                    <Field label="Preço (R$)"><NumInput value={txt} onChange={(v) => setPrecoEdit({ ...precoEdit, [t.canal_id]: v })} onBlur={() => salvarPreco(t.canal_id)} /></Field>
                  </div>
                )
              })}
            </div>
          </Panel>

          <Panel title="Últimos movimentos">
            {(movs.data ?? []).length === 0 ? <Empty title="Nenhum movimento ainda" /> : (
              <ul className="divide-y divide-line text-sm">
                {(movs.data ?? []).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div><p>{TIPO_MOV[m.tipo]}</p><p className="text-xs text-muted">{dataHoraBR(m.data)}{m.motivo && ` · ${m.motivo}`}</p></div>
                    <div className="num text-right"><p className={Number(m.quantidade) < 0 ? 'text-bad' : 'text-good'}>{Number(m.quantidade) > 0 ? '+' : ''}{qty(m.quantidade)}</p><p className="text-xs text-muted">saldo {qty(m.saldo_apos)}</p></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <ProdutoForm open={editar} produto={p} onClose={() => setEditar(false)} onSaved={() => { setEditar(false); prod.recarregar() }} onDeleted={() => navigate('/produtos')} />
    </div>
  )
}
