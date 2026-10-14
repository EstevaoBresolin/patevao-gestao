import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataBR, hoje, money, parseNum } from '../lib/fmt'
import type { Categoria } from '../lib/types'
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Panel, Select, Table, useToast } from '../components/ui'

type Despesa = { id: string; data: string; descricao: string; valor: number; recorrente: boolean; forma_pagamento: string | null; categoria: { nome: string } | null }

export default function Financeiro() {
  const toast = useToast()
  const [mes, setMes] = useState(hoje().slice(0, 7))
  const ini = `${mes}-01`
  const fimD = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)
  const fim = `${mes}-${String(fimD.getDate()).padStart(2, '0')}`
  const desp = useLoad<Despesa[]>(() => supabase.from('despesa').select('*, categoria(nome)').gte('data', ini).lte('data', fim).order('data', { ascending: false }), [mes])
  const res = useLoad<{ periodo: { lucro: number; faturamento: number } }>(() => supabase.rpc('dashboard', { p_inicio: ini, p_fim: fim }), [mes])
  const cats = useLoad<Categoria[]>(() => supabase.from('categoria').select('*').eq('tipo', 'despesa').order('nome'), [])
  const [nova, setNova] = useState<{ data: string; descricao: string; valor: string; categoria_id: string; recorrente: boolean; forma_pagamento: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const total = (desp.data ?? []).reduce((s, d) => s + Number(d.valor), 0)
  const lucroVendas = Number(res.data?.periodo.lucro ?? 0)

  async function salvar() {
    if (!nova) return
    if (!nova.descricao.trim() || parseNum(nova.valor) <= 0) return setErro('Informe a descrição e o valor.')
    const { error } = await supabase.from('despesa').insert({ data: nova.data, descricao: nova.descricao.trim(), valor: parseNum(nova.valor), categoria_id: nova.categoria_id || null, recorrente: nova.recorrente, forma_pagamento: nova.forma_pagamento || null })
    if (error) return setErro(erroMsg(error))
    toast('Despesa lançada.'); setNova(null); desp.recarregar()
  }
  async function excluir(id: string) {
    const { error } = await supabase.from('despesa').delete().eq('id', id)
    if (error) return setErro(erroMsg(error))
    desp.recarregar()
  }
  async function copiarRecorrentes() {
    const [y, m] = mes.split('-').map(Number)
    const ant = new Date(y, m - 2, 1)
    const aIni = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}-01`
    const aFim = new Date(ant.getFullYear(), ant.getMonth() + 1, 0).toISOString().slice(0, 10)
    const { data } = await supabase.from('despesa').select('*').eq('recorrente', true).gte('data', aIni).lte('data', aFim)
    if (!data?.length) return toast('Nenhuma despesa recorrente no mês anterior.', 'bad')
    const { error } = await supabase.from('despesa').insert(data.map((d) => ({ data: ini, descricao: d.descricao, valor: d.valor, categoria_id: d.categoria_id, recorrente: true, forma_pagamento: d.forma_pagamento })))
    if (error) return setErro(erroMsg(error))
    toast(`${data.length} despesas recorrentes copiadas.`); desp.recarregar()
  }

  return (
    <div>
      <PageHeader title="Despesas" sub="Gastos que não são de uma venda específica: anúncios, ferramentas, contador…"
        actions={<><Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-auto" /><Button size="sm" onClick={copiarRecorrentes}>Copiar recorrentes do mês anterior</Button><Button size="sm" variant="primary" onClick={() => { setErro(null); setNova({ data: hoje(), descricao: '', valor: '', categoria_id: '', recorrente: false, forma_pagamento: '' }) }}><Plus size={15} /> Nova despesa</Button></>} />
      <ErrorBox msg={erro} />
      <Panel className="mb-5">
        <div className="num grid grid-cols-1 gap-px overflow-hidden rounded-box bg-line sm:grid-cols-3 [&>*]:bg-panel [&>*]:px-4 [&>*]:py-3.5">
          <div><p className="text-sm text-muted">Lucro das vendas</p><p className="wide text-[22px] font-bold">{money(lucroVendas)}</p></div>
          <div><p className="text-sm text-muted">Despesas do mês</p><p className="wide text-[22px] font-bold">− {money(total)}</p></div>
          <div className="led-strip"><p className="text-sm text-muted">Resultado do mês</p><p className={`wide text-[22px] font-bold ${lucroVendas - total < 0 ? 'text-bad' : ''}`}>{money(lucroVendas - total)}</p></div>
        </div>
      </Panel>
      <Panel>
        {desp.carregando && !desp.data ? <Loading /> : (desp.data ?? []).length === 0 ? <Empty title="Nenhuma despesa neste mês" /> : (
          <Table head={<tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Pagamento</th><th className="text-right">Valor</th><th /></tr>}>
            {(desp.data ?? []).map((d) => (
              <tr key={d.id}>
                <td className="num">{dataBR(d.data)}</td><td className="font-medium">{d.descricao} {d.recorrente && <Badge>Mensal</Badge>}</td><td>{d.categoria?.nome}</td><td>{d.forma_pagamento}</td>
                <td className="num text-right">{money(d.valor)}</td>
                <td className="w-10"><button aria-label="Excluir" onClick={() => excluir(d.id)} className="text-muted hover:text-bad"><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Modal open={!!nova} onClose={() => setNova(null)} title="Nova despesa" footer={<><Button onClick={() => setNova(null)}>Cancelar</Button><Button variant="primary" onClick={salvar}>Lançar despesa</Button></>}>
        {nova && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Descrição" className="sm:col-span-2"><Input value={nova.descricao} onChange={(e) => setNova({ ...nova, descricao: e.target.value })} placeholder="Mercado Ads outubro" /></Field>
            <Field label="Valor (R$)"><NumInput value={nova.valor} onChange={(v) => setNova({ ...nova, valor: v })} /></Field>
            <Field label="Data"><Input type="date" value={nova.data} onChange={(e) => setNova({ ...nova, data: e.target.value })} /></Field>
            <Field label="Categoria"><Select value={nova.categoria_id} onChange={(e) => setNova({ ...nova, categoria_id: e.target.value })}><option value="">Sem categoria</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
            <Field label="Pagamento"><Select value={nova.forma_pagamento} onChange={(e) => setNova({ ...nova, forma_pagamento: e.target.value })}><option value="">–</option><option>Pix</option><option>Boleto</option><option>Cartão de crédito</option><option>Débito automático</option></Select></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={nova.recorrente} onChange={(e) => setNova({ ...nova, recorrente: e.target.checked })} /> Repete todo mês</label>
          </div>
        )}
        <div className="mt-3"><ErrorBox msg={erro} /></div>
      </Modal>
    </div>
  )
}
