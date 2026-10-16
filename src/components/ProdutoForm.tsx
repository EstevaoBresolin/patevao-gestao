import { useEffect, useState } from 'react'
import { supabase, erroMsg } from '../lib/supabase'
import { normNome, parseNum } from '../lib/fmt'
import type { Categoria, Produto } from '../lib/types'
import { BotaoExcluir, Button, ErrorBox, Field, Input, Modal, NumInput, Select, Textarea, useConfirm, useToast } from './ui'
import { useAuth } from '../lib/auth'

const br = (n: number | null | undefined) => (n == null ? '' : String(Number(n)).replace('.', ','))

/**
 * Cadastro/edição de produto. Com `copiaDe`, abre como cadastro novo já preenchido
 * com os dados daquele produto; ao salvar, a ficha técnica e os preços também são copiados.
 */
export default function ProdutoForm({ open, onClose, onSaved, onDeleted, produto, copiaDe }: { open: boolean; onClose: () => void; onSaved: (id: string) => void; onDeleted?: () => void; produto?: Produto | null; copiaDe?: Produto | null }) {
  const toast = useToast()
  const confirmar = useConfirm()
  const { isAdmin } = useAuth()
  const [cats, setCats] = useState<Categoria[]>([])
  const [f, setF] = useState({ nome: '', sku: '', categoria_id: '', custo_padrao: '', custos_fixos_unit: '', estoque_minimo: '', anuncio_ml: '', tamanho: '', cor_led: '', observacoes: '', ativo: true })
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    supabase.from('categoria').select('*').eq('tipo', 'produto').order('nome').then(({ data }) => setCats((data ?? []) as Categoria[]))
    setErro(null)
    const base = produto ?? copiaDe
    setF({
      nome: copiaDe ? `${copiaDe.nome} (cópia)` : base?.nome ?? '',
      // SKU e anúncio do ML identificam um produto só: na cópia começam vazios.
      sku: copiaDe ? '' : base?.sku ?? '', categoria_id: base?.categoria_id ?? '',
      custo_padrao: br(base?.custo_padrao), custos_fixos_unit: br(base?.custos_fixos_unit), estoque_minimo: br(base?.estoque_minimo),
      anuncio_ml: copiaDe ? '' : base?.anuncio_ml ?? '', tamanho: base?.atributos?.tamanho ?? '', cor_led: base?.atributos?.cor_led ?? '',
      observacoes: base?.observacoes ?? '', ativo: copiaDe ? true : base?.ativo ?? true,
    })
  }, [open, produto, copiaDe])

  async function salvar() {
    if (!f.nome.trim()) return setErro('Dê um nome ao produto.')
    setBusy(true); setErro(null)
    const existentes = await supabase.from('produto').select('id,nome')
    if (existentes.error) { setBusy(false); return setErro(erroMsg(existentes.error)) }
    const igual = existentes.data.find((x) => x.id !== produto?.id && normNome(x.nome) === normNome(f.nome))
    if (igual) { setBusy(false); return setErro(`Já existe um produto chamado "${igual.nome}". Use outro nome.`) }
    const row = {
      nome: f.nome.trim(), sku: f.sku.trim() || null, categoria_id: f.categoria_id || null,
      custo_padrao: parseNum(f.custo_padrao), custos_fixos_unit: parseNum(f.custos_fixos_unit), estoque_minimo: parseNum(f.estoque_minimo),
      anuncio_ml: f.anuncio_ml.trim() || null, observacoes: f.observacoes.trim() || null, ativo: f.ativo,
      atributos: { ...(f.tamanho && { tamanho: f.tamanho }), ...(f.cor_led && { cor_led: f.cor_led }) },
    }
    const r = produto
      ? await supabase.from('produto').update(row).eq('id', produto.id).select('id').single()
      : await supabase.from('produto').insert(row).select('id').single()
    if (r.error) { setBusy(false); return setErro(erroMsg(r.error)) }
    if (copiaDe) {
      const [ficha, precos] = await Promise.all([
        supabase.from('ficha_tecnica_item').select('material_id,componente_produto_id,quantidade,perc_perda').eq('produto_id', copiaDe.id),
        supabase.from('preco_canal').select('canal_id,preco_venda').eq('produto_id', copiaDe.id),
      ])
      const erros = [ficha.error, precos.error]
      if (ficha.data?.length) erros.push((await supabase.from('ficha_tecnica_item').insert(ficha.data.map((i) => ({ ...i, produto_id: r.data.id })))).error)
      if (precos.data?.length) erros.push((await supabase.from('preco_canal').insert(precos.data.map((p) => ({ ...p, produto_id: r.data.id })))).error)
      const e = erros.find(Boolean)
      if (e) toast(`Produto criado, mas a ficha ou os preços não foram copiados por completo: ${erroMsg(e)}`)
    }
    setBusy(false)
    toast(produto ? 'Produto salvo.' : copiaDe ? 'Produto duplicado.' : 'Produto cadastrado.')
    onSaved(r.data.id)
  }
  async function excluir() {
    if (!produto) return
    if (!(await confirmar({ titulo: `Excluir ${produto.nome}?`, mensagem: 'A ficha técnica, os preços, o saldo inicial e os ajustes manuais dele também são apagados. Produto que já teve venda ou ordem de produção não pode ser excluído; nesse caso, desmarque "Produto ativo".' }))) return
    setBusy(true)
    const { error } = await supabase.rpc('excluir_produto', { p_id: produto.id })
    setBusy(false)
    if (error) return setErro(erroMsg(error))
    toast('Produto excluído.'); onDeleted?.()
  }
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v })

  return (
    <Modal open={open} onClose={onClose} title={produto ? 'Editar produto' : copiaDe ? `Duplicar ${copiaDe.nome}` : 'Novo produto'} wide
      footer={<>{produto && isAdmin && onDeleted && <BotaoExcluir disabled={busy} onClick={excluir} />}<Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={salvar}>{produto ? 'Salvar' : 'Cadastrar produto'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2"><Input value={f.nome} onChange={(e) => set('nome')(e.target.value)} placeholder="Prateleira LED 60 cm branca" /></Field>
        <Field label="SKU (código interno)"><Input value={f.sku} onChange={(e) => set('sku')(e.target.value)} placeholder="PRAT-60-BR" /></Field>
        <Field label="Categoria"><Select value={f.categoria_id} onChange={(e) => set('categoria_id')(e.target.value)}><option value="">Sem categoria</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
        <Field label="Tamanho"><Input value={f.tamanho} onChange={(e) => set('tamanho')(e.target.value)} placeholder="60 × 20 cm" /></Field>
        <Field label="Cor do LED"><Select value={f.cor_led} onChange={(e) => set('cor_led')(e.target.value)}><option value="">Não se aplica</option><option>3000K (branco quente)</option><option>4000K (neutro)</option><option>6000K (branco frio)</option><option>RGB</option></Select></Field>
        <Field label="Custo unitário informado (R$)" hint="Use enquanto não cadastrar a ficha técnica. Depois da primeira produção, o custo real passa a valer.">
          <NumInput value={f.custo_padrao} onChange={set('custo_padrao')} />
        </Field>
        <Field label="Custos fixos por unidade (R$)" hint="Embalagem, energia… somados ao custo da ficha."><NumInput value={f.custos_fixos_unit} onChange={set('custos_fixos_unit')} /></Field>
        <Field label="Estoque mínimo" hint="Avisa no painel quando o saldo chegar aqui."><NumInput value={f.estoque_minimo} onChange={set('estoque_minimo')} /></Field>
        <Field label="Código do anúncio no Mercado Livre" hint="Ex.: MLB1234567890. Anúncio com variações (cor/tamanho): MLB1234567890/ID-da-variação. Liga as vendas importadas a este produto."><Input value={f.anuncio_ml} onChange={(e) => set('anuncio_ml')(e.target.value)} placeholder="MLB1234567890" /></Field>
        <Field label="Observações" className="sm:col-span-2"><Textarea value={f.observacoes} onChange={(e) => set('observacoes')(e.target.value)} rows={2} /></Field>
        {produto && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Produto ativo (aparece nas vendas)</label>}
      </div>
      {copiaDe && <p className="mt-4 text-sm text-muted">A ficha técnica e os preços por canal também serão copiados. O estoque começa em zero.</p>}
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}
