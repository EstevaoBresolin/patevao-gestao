import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { money, parseNum, qty } from '../lib/fmt'
import { UNIDADES, type Categoria, type Fornecedor, type Material } from '../lib/types'
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Panel, Select, Table, Textarea, useToast } from '../components/ui'

const br = (n: number | null | undefined) => (n == null ? '' : String(Number(n)).replace('.', ','))

export default function Materiais() {
  const [edit, setEdit] = useState<Material | null | 'novo'>(null)
  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('')
  const [soBaixo, setSoBaixo] = useState(false)
  const { data, erro, carregando, recarregar } = useLoad<Material[]>(() => supabase.from('vw_material_estoque').select('*').order('nome'), [])
  const cats = useLoad<Categoria[]>(() => supabase.from('categoria').select('*').eq('tipo', 'material').order('nome'), [])

  const lista = useMemo(() => (data ?? []).filter((m) => m.ativo && (!cat || m.categoria_id === cat) && (!soBaixo || m.situacao !== 'ok') &&
    (!busca || `${m.nome} ${m.sku ?? ''}`.toLowerCase().includes(busca.toLowerCase()))), [data, busca, cat, soBaixo])
  const total = lista.reduce((s, m) => s + Number(m.valor_estoque ?? 0), 0)

  return (
    <div>
      <PageHeader title="Materiais" sub={`Insumos usados na montagem · ${money(total)} em estoque`}
        actions={<Button variant="primary" size="sm" onClick={() => setEdit('novo')}><Plus size={15} /> Novo material</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Buscar por nome ou SKU" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-auto"><option value="">Todas as categorias</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={soBaixo} onChange={(e) => setSoBaixo(e.target.checked)} /> Só abaixo do mínimo</label>
      </div>
      <ErrorBox msg={erro} />
      <Panel>
        {carregando && !data ? <Loading /> : lista.length === 0 ? (
          <Empty title={data?.length ? 'Nenhum material neste filtro' : 'Nenhum material cadastrado'}>
            {!data?.length && <>Cadastre MDF, fita LED, perfil, fonte, interruptor, conectores…<br /><Button className="mt-3" onClick={() => setEdit('novo')}><Plus size={15} /> Cadastrar material</Button></>}
          </Empty>
        ) : (
          <Table head={<tr><th>Material</th><th className="text-right">Saldo</th><th className="text-right">Mínimo</th><th className="text-right">Dura</th><th className="text-right">Custo médio</th><th className="text-right">Valor</th></tr>}>
            {lista.map((m) => {
              const dias = Number(m.consumo_diario) > 0 ? Number(m.saldo) / Number(m.consumo_diario) : null
              return (
                <tr key={m.id} onClick={() => setEdit(m)} className="cursor-pointer hover:bg-line/30">
                  <td><span className="font-medium">{m.nome}</span>{m.sku && <span className="ml-2 text-xs text-muted">{m.sku}</span>}{m.localizacao && <span className="block text-xs text-muted">{m.localizacao}</span>}</td>
                  <td className="num whitespace-nowrap text-right"><span className="mr-2">{qty(m.saldo)} {m.unidade_uso}</span>{m.situacao !== 'ok' && <Badge tone={m.situacao === 'zerado' ? 'bad' : 'warn'}>{m.situacao === 'zerado' ? 'Zerado' : 'Baixo'}</Badge>}</td>
                  <td className="num text-right text-muted">{qty(m.estoque_minimo)}</td>
                  <td className="num whitespace-nowrap text-right">{dias == null ? <span className="text-muted">–</span> : `${Math.floor(dias)} dias`}</td>
                  <td className="num whitespace-nowrap text-right">{money(m.custo_medio)}<span className="text-xs text-muted">/{m.unidade_uso}</span></td>
                  <td className="num text-right">{money(m.valor_estoque)}</td>
                </tr>
              )
            })}
          </Table>
        )}
      </Panel>
      <p className="mt-3 text-xs text-muted">"Dura" é a estimativa de dias até acabar, pelo consumo dos últimos 30 dias na produção.</p>
      <MaterialForm open={edit !== null} material={edit === 'novo' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); recarregar() }} />
    </div>
  )
}

function MaterialForm({ open, material, onClose, onSaved }: { open: boolean; material: Material | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [cats, setCats] = useState<Categoria[]>([])
  const [forns, setForns] = useState<Fornecedor[]>([])
  const vazio = { nome: '', sku: '', categoria_id: '', unidade_uso: 'un', unidade_compra: 'un', fator_conversao: '1', fornecedor_padrao_id: '', estoque_minimo: '', localizacao: '', observacoes: '', ativo: true, saldo_inicial: '', custo_inicial: '' }
  const [f, setF] = useState(vazio)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    supabase.from('categoria').select('*').eq('tipo', 'material').order('nome').then(({ data }) => setCats((data ?? []) as Categoria[]))
    supabase.from('fornecedor').select('*').eq('ativo', true).order('nome').then(({ data }) => setForns((data ?? []) as Fornecedor[]))
    setErro(null)
    setF(material ? {
      ...vazio, nome: material.nome, sku: material.sku ?? '', categoria_id: material.categoria_id ?? '', unidade_uso: material.unidade_uso,
      unidade_compra: material.unidade_compra, fator_conversao: br(material.fator_conversao), fornecedor_padrao_id: material.fornecedor_padrao_id ?? '',
      estoque_minimo: br(material.estoque_minimo), localizacao: material.localizacao ?? '', observacoes: material.observacoes ?? '', ativo: material.ativo,
    } : vazio)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, material])

  async function salvar() {
    if (!f.nome.trim()) return setErro('Dê um nome ao material.')
    if (parseNum(f.fator_conversao) <= 0) return setErro('A conversão precisa ser maior que zero.')
    setBusy(true); setErro(null)
    const row = {
      nome: f.nome.trim(), sku: f.sku.trim() || null, categoria_id: f.categoria_id || null, unidade_uso: f.unidade_uso, unidade_compra: f.unidade_compra,
      fator_conversao: parseNum(f.fator_conversao), fornecedor_padrao_id: f.fornecedor_padrao_id || null, estoque_minimo: parseNum(f.estoque_minimo),
      localizacao: f.localizacao.trim() || null, observacoes: f.observacoes.trim() || null, ativo: f.ativo,
    }
    const r = material ? await supabase.from('material').update(row).eq('id', material.id).select('id').single() : await supabase.from('material').insert(row).select('id').single()
    if (r.error) { setBusy(false); return setErro(erroMsg(r.error)) }
    if (!material && parseNum(f.saldo_inicial) > 0) {
      const m = await supabase.rpc('movimentar_estoque', { p_item_tipo: 'material', p_item_id: r.data.id, p_tipo: 'entrada_manual', p_quantidade: parseNum(f.saldo_inicial), p_custo_unit: parseNum(f.custo_inicial), p_motivo: 'Saldo inicial' })
      if (m.error) { setBusy(false); return setErro(erroMsg(m.error)) }
    }
    setBusy(false)
    toast(material ? 'Material salvo.' : 'Material cadastrado.')
    onSaved()
  }
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v })
  const conv = f.unidade_compra !== f.unidade_uso

  return (
    <Modal open={open} onClose={onClose} title={material ? material.nome : 'Novo material'} wide
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={salvar}>{material ? 'Salvar' : 'Cadastrar material'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2"><Input value={f.nome} onChange={(e) => set('nome')(e.target.value)} placeholder="Fita LED 3000K 12V" /></Field>
        <Field label="SKU (código interno)"><Input value={f.sku} onChange={(e) => set('sku')(e.target.value)} /></Field>
        <Field label="Categoria"><Select value={f.categoria_id} onChange={(e) => set('categoria_id')(e.target.value)}><option value="">Sem categoria</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
        <Field label="Unidade de uso" hint="Como a ficha técnica mede o consumo."><Select value={f.unidade_uso} onChange={(e) => set('unidade_uso')(e.target.value)}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</Select></Field>
        <Field label="Unidade de compra" hint="Como você compra do fornecedor."><Select value={f.unidade_compra} onChange={(e) => set('unidade_compra')(e.target.value)}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</Select></Field>
        {conv && (
          <Field label={`Quantos ${f.unidade_uso} vêm em 1 ${f.unidade_compra}?`} className="sm:col-span-2" hint={`Ex.: rolo de fita de 5 m = 500 cm. Na compra você digita ${f.unidade_compra}s e o estoque entra em ${f.unidade_uso}.`}>
            <NumInput value={f.fator_conversao} onChange={set('fator_conversao')} className="max-w-40" />
          </Field>
        )}
        <Field label={`Estoque mínimo (${f.unidade_uso})`}><NumInput value={f.estoque_minimo} onChange={set('estoque_minimo')} /></Field>
        <Field label="Fornecedor principal"><Select value={f.fornecedor_padrao_id} onChange={(e) => set('fornecedor_padrao_id')(e.target.value)}><option value="">Nenhum</option>{forns.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
        <Field label="Onde fica guardado"><Input value={f.localizacao} onChange={(e) => set('localizacao')(e.target.value)} placeholder="Prateleira 2, caixa azul" /></Field>
        {!material && (
          <>
            <Field label={`Quantidade que você já tem (${f.unidade_uso})`} hint="Opcional. Entra como saldo inicial."><NumInput value={f.saldo_inicial} onChange={set('saldo_inicial')} /></Field>
            <Field label={`Custo por ${f.unidade_uso} (R$)`}><NumInput value={f.custo_inicial} onChange={set('custo_inicial')} /></Field>
          </>
        )}
        <Field label="Observações" className="sm:col-span-2"><Textarea value={f.observacoes} onChange={(e) => set('observacoes')(e.target.value)} rows={2} /></Field>
        {material && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Material ativo</label>}
      </div>
      {material && <p className="mt-4 text-sm text-muted">Saldo atual: {qty(material.saldo)} {material.unidade_uso} a {money(material.custo_medio)} cada. Para mudar o saldo, use Estoque → Movimentar.</p>}
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}
