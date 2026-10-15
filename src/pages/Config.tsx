import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataBR, hoje, money, parseNum, qty } from '../lib/fmt'
import type { Categoria } from '../lib/types'
import { Badge, BotaoExcluir, Button, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Panel, Select, Table, useConfirm, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'

type Canal = { id: string; nome: string; tipo: string; ativo: boolean; canal_taxa: Taxa[] }
type Taxa = { id: string; perfil: string; perc_taxa: number; tarifa_fixa: number; tarifa_ate_preco: number | null; frete_padrao: number; vigente_desde: string; ativo: boolean }
type Usuario = { id: string; nome: string; email: string; perfil: string }

export default function Config() {
  return (
    <div>
      <PageHeader title="Configurações" />
      <div className="flex min-w-0 flex-col gap-5">
        <Canais />
        <div className="grid min-w-0 gap-5 lg:grid-cols-2"><Parametros /><Categorias /></div>
        <Usuarios />
      </div>
    </div>
  )
}

type FormTaxa = { id?: string; canal_id: string; canal: string; perfil: string; perc: string; fixa: string; ate: string; frete: string; desde: string; ativo: boolean }
const brn = (n: number | null | undefined) => (n == null ? '' : String(Number(n)).replace('.', ','))

function Canais() {
  const toast = useToast()
  const confirmar = useConfirm()
  const { data, recarregar } = useLoad<Canal[]>(() => supabase.from('canal').select('*, canal_taxa(*)').order('nome'), [])
  const [taxa, setTaxa] = useState<FormTaxa | null>(null)
  const [canal, setCanal] = useState<{ id?: string; nome: string; tipo: string; ativo: boolean } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function salvarTaxa() {
    if (!taxa) return
    if (!taxa.perfil.trim()) return setErro('Dê um nome ao tipo de anúncio.')
    const row = { canal_id: taxa.canal_id, perfil: taxa.perfil.trim(), perc_taxa: parseNum(taxa.perc), tarifa_fixa: parseNum(taxa.fixa), tarifa_ate_preco: taxa.ate.trim() ? parseNum(taxa.ate) : null, frete_padrao: parseNum(taxa.frete), vigente_desde: taxa.desde, ativo: taxa.ativo }
    const { error } = taxa.id ? await supabase.from('canal_taxa').update(row).eq('id', taxa.id) : await supabase.from('canal_taxa').insert(row)
    if (error) return setErro(erroMsg(error))
    toast(taxa.id ? 'Taxa corrigida. Vendas já lançadas mantêm os valores da época.' : 'Taxa salva. Vendas antigas mantêm a taxa da época.'); setTaxa(null); recarregar()
  }
  async function excluirTaxa(t: { id: string; perfil: string }) {
    if (!(await confirmar({ titulo: `Excluir a taxa "${t.perfil}"?`, mensagem: 'Taxa que já foi usada em alguma venda não pode ser excluída; nesse caso, desmarque "Em uso" para ela parar de aparecer nas vendas novas.' }))) return
    const { error } = await supabase.from('canal_taxa').delete().eq('id', t.id)
    if (error) return setErro(erroMsg(error))
    toast('Taxa excluída.'); setTaxa(null); recarregar()
  }
  async function salvarCanal() {
    if (!canal?.nome.trim()) return setErro('Dê um nome ao canal.')
    if (canal.id) {
      const { error } = await supabase.from('canal').update({ nome: canal.nome.trim(), tipo: canal.tipo, ativo: canal.ativo }).eq('id', canal.id)
      if (error) return setErro(erroMsg(error))
      toast('Canal salvo.'); setCanal(null); recarregar(); return
    }
    const { data: c, error } = await supabase.from('canal').insert({ nome: canal.nome.trim(), tipo: canal.tipo, ativo: canal.ativo }).select('id').single()
    if (error) return setErro(erroMsg(error))
    await supabase.from('canal_taxa').insert({ canal_id: c.id, perfil: 'Padrão', perc_taxa: 0, vigente_desde: '2000-01-01' })
    toast('Canal criado.'); setCanal(null); recarregar()
  }
  async function excluirCanal() {
    if (!canal?.id) return
    if (!(await confirmar({ titulo: `Excluir o canal ${canal.nome}?`, mensagem: 'As taxas e os preços desse canal também são apagados. Canal com vendas lançadas não pode ser excluído; nesse caso, desmarque "Canal ativo".' }))) return
    const { error } = await supabase.rpc('excluir_canal', { p_id: canal.id })
    if (error) return setErro(erroMsg(error))
    toast('Canal excluído.'); setCanal(null); recarregar()
  }
  const editarTaxa = (c: Canal, t: Taxa) => { setErro(null); setTaxa({ id: t.id, canal_id: c.id, canal: c.nome, perfil: t.perfil, perc: brn(t.perc_taxa), fixa: brn(t.tarifa_fixa), ate: brn(t.tarifa_ate_preco), frete: brn(t.frete_padrao), desde: t.vigente_desde, ativo: t.ativo }) }

  return (
    <Panel title="Canais de venda e taxas" actions={<Button size="sm" onClick={() => { setErro(null); setCanal({ nome: '', tipo: 'marketplace', ativo: true }) }}><Plus size={15} /> Novo canal</Button>}>
      <div className="divide-y divide-line">
        {(data ?? []).map((c) => {
          const vigentes = new Map<string, Taxa>()
          ;[...c.canal_taxa].filter((t) => t.ativo && t.vigente_desde <= hoje()).sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde)).forEach((t) => vigentes.set(t.perfil, t))
          const historico = [...c.canal_taxa].sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))
          return (
            <div key={c.id} className={`p-4 ${c.ativo ? '' : 'opacity-60'}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{c.nome} <span className="ml-1 text-sm font-normal text-muted">{c.tipo === 'direto' ? 'venda direta' : 'marketplace'}</span>{!c.ativo && <span className="ml-2"><Badge>Inativo</Badge></span>}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setErro(null); setCanal({ id: c.id, nome: c.nome, tipo: c.tipo, ativo: c.ativo }) }}><Pencil size={15} /> Editar canal</Button>
                  <Button size="sm" onClick={() => { setErro(null); setTaxa({ canal_id: c.id, canal: c.nome, perfil: [...vigentes.keys()][0] ?? 'Padrão', perc: '', fixa: '0', ate: '', frete: c.tipo === 'direto' ? '0' : '25', desde: hoje(), ativo: true }) }}>Mudar taxa</Button>
                </div>
              </div>
              <Table head={<tr><th>Tipo de anúncio</th><th className="text-right">Taxa</th><th className="text-right">Tarifa fixa</th><th className="text-right">Frete padrão</th><th>Vale desde</th><th /></tr>}>
                {historico.map((t) => {
                  const atual = vigentes.get(t.perfil)?.id === t.id
                  return (
                    <tr key={t.id} className={atual ? '' : 'text-muted'}>
                      <td>{t.perfil} {!t.ativo ? <Badge>Desativada</Badge> : atual ? <Badge tone="good">Em uso</Badge> : t.vigente_desde > hoje() ? <Badge tone="led">Futura</Badge> : <Badge>Anterior</Badge>}</td>
                      <td className="num text-right">{qty(t.perc_taxa)}%</td>
                      <td className="num text-right">{Number(t.tarifa_fixa) ? `${money(t.tarifa_fixa)}${t.tarifa_ate_preco ? ` até ${money(t.tarifa_ate_preco)}` : ''}` : '–'}</td>
                      <td className="num text-right">{money(t.frete_padrao)}</td>
                      <td className="num">{dataBR(t.vigente_desde)}</td>
                      <td className="w-20 whitespace-nowrap text-right">
                        <button aria-label={`Editar taxa ${t.perfil}`} onClick={() => editarTaxa(c, t)} className="mr-3 text-muted hover:text-ink"><Pencil size={15} /></button>
                        <button aria-label={`Excluir taxa ${t.perfil}`} onClick={() => excluirTaxa(t)} className="text-muted hover:text-bad"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  )
                })}
              </Table>
            </div>
          )
        })}
      </div>
      <Modal open={!!taxa} onClose={() => setTaxa(null)} title={taxa?.id ? `Corrigir taxa do ${taxa.canal}` : `Nova taxa do ${taxa?.canal}`}
        footer={<>{taxa?.id && <BotaoExcluir onClick={() => excluirTaxa({ id: taxa.id!, perfil: taxa.perfil })} />}<Button onClick={() => setTaxa(null)}>Cancelar</Button><Button variant="primary" onClick={salvarTaxa}>Salvar taxa</Button></>}>
        {taxa && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de anúncio" hint="Ex.: Clássico, Premium. Use um nome novo para criar outro tipo." className="sm:col-span-2"><Input value={taxa.perfil} onChange={(e) => setTaxa({ ...taxa, perfil: e.target.value })} /></Field>
            <Field label="Taxa sobre a venda (%)"><NumInput value={taxa.perc} onChange={(v) => setTaxa({ ...taxa, perc: v })} /></Field>
            <Field label="Frete padrão (R$)" hint="Sugerido em cada venda; sempre editável."><NumInput value={taxa.frete} onChange={(v) => setTaxa({ ...taxa, frete: v })} /></Field>
            <Field label="Tarifa fixa por unidade (R$)"><NumInput value={taxa.fixa} onChange={(v) => setTaxa({ ...taxa, fixa: v })} /></Field>
            <Field label="Tarifa só até o preço de (R$)" hint="Vazio = vale para qualquer preço."><NumInput value={taxa.ate} onChange={(v) => setTaxa({ ...taxa, ate: v })} /></Field>
            <Field label="Vale a partir de"><Input type="date" value={taxa.desde} onChange={(e) => setTaxa({ ...taxa, desde: e.target.value })} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={taxa.ativo} onChange={(e) => setTaxa({ ...taxa, ativo: e.target.checked })} /> Em uso (aparece nas vendas novas)</label>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">{taxa?.id ? 'Use para corrigir um valor digitado errado. Se a taxa do canal mudou, prefira "Mudar taxa" para guardar o histórico.' : 'A taxa anterior fica guardada.'} Vendas já lançadas não mudam.</p>
        <div className="mt-3"><ErrorBox msg={erro} /></div>
      </Modal>
      <Modal open={!!canal} onClose={() => setCanal(null)} title={canal?.id ? 'Editar canal de venda' : 'Novo canal de venda'}
        footer={<>{canal?.id && <BotaoExcluir onClick={excluirCanal} />}<Button onClick={() => setCanal(null)}>Cancelar</Button><Button variant="primary" onClick={salvarCanal}>{canal?.id ? 'Salvar canal' : 'Criar canal'}</Button></>}>
        {canal && (
          <div className="grid gap-4">
            <Field label="Nome"><Input value={canal.nome} onChange={(e) => setCanal({ ...canal, nome: e.target.value })} placeholder="Shopee" /></Field>
            <Field label="Tipo"><Select value={canal.tipo} onChange={(e) => setCanal({ ...canal, tipo: e.target.value })}><option value="marketplace">Marketplace</option><option value="direto">Venda direta</option></Select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={canal.ativo} onChange={(e) => setCanal({ ...canal, ativo: e.target.checked })} /> Canal ativo</label>
            {!canal.id && <p className="text-sm text-muted">Depois de criar, use "Mudar taxa" para definir a porcentagem e o frete.</p>}
          </div>
        )}
        <div className="mt-3"><ErrorBox msg={erro} /></div>
      </Modal>
    </Panel>
  )
}

function Parametros() {
  const toast = useToast()
  const { data, recarregar } = useLoad<{ chave: string; valor: string }[]>(() => supabase.from('parametro').select('*'), [])
  const [ed, setEd] = useState<Record<string, string>>({})
  const v = (k: string) => ed[k] ?? (data ?? []).find((p) => p.chave === k)?.valor ?? ''
  async function salvar(k: string, valor: string) {
    const { error } = await supabase.from('parametro').upsert({ chave: k, valor })
    if (error) return toast(erroMsg(error), 'bad')
    toast('Configuração salva.'); recarregar()
  }
  if (!data) return <Panel title="Regras do sistema"><Loading /></Panel>
  return (
    <Panel title="Regras do sistema">
      <div className="flex flex-col gap-4 p-4">
        <Field label="Imposto sobre a venda (%)" hint="Hoje 0%. Ao migrar para o Simples, coloque a alíquota aqui; vale para as próximas vendas.">
          <NumInput value={v('imposto_perc').replace('.', ',')} onChange={(x) => setEd({ ...ed, imposto_perc: x })} onBlur={() => salvar('imposto_perc', String(parseNum(v('imposto_perc'))))} className="max-w-32" />
        </Field>
        <Field label="Avisar sobre vendas abertas há mais de (dias)">
          <NumInput value={v('dias_alerta_venda_aberta')} onChange={(x) => setEd({ ...ed, dias_alerta_venda_aberta: x })} onBlur={() => salvar('dias_alerta_venda_aberta', String(parseNum(v('dias_alerta_venda_aberta'))))} className="max-w-32" />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v('permite_estoque_negativo') === 'true'} onChange={(e) => salvar('permite_estoque_negativo', String(e.target.checked))} />
          <span>Permitir vender sem estoque<span className="block text-xs text-muted">Desligado: o sistema bloqueia a venda quando não há saldo. Ligue só se vender sob encomenda.</span></span>
        </label>
      </div>
    </Panel>
  )
}

function Categorias() {
  const toast = useToast()
  const confirmar = useConfirm()
  const { data, recarregar } = useLoad<Categoria[]>(() => supabase.from('categoria').select('*').order('tipo').order('nome'), [])
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<Categoria['tipo']>('material')
  const [ed, setEd] = useState<Categoria | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  async function add() {
    if (!nome.trim()) return
    const { error } = await supabase.from('categoria').insert({ nome: nome.trim(), tipo })
    if (error) return setErro(erroMsg(error))
    setNome(''); setErro(null); recarregar()
  }
  async function salvar() {
    if (!ed?.nome.trim()) return setErro('Dê um nome à categoria.')
    const { error } = await supabase.from('categoria').update({ nome: ed.nome.trim(), tipo: ed.tipo }).eq('id', ed.id)
    if (error) return setErro(erroMsg(error))
    toast('Categoria salva.'); setEd(null); recarregar()
  }
  async function excluir() {
    if (!ed) return
    if (!(await confirmar({ titulo: `Excluir a categoria ${ed.nome}?`, mensagem: 'Só dá para excluir categoria que não está em nenhum material, produto ou despesa.' }))) return
    const { error } = await supabase.from('categoria').delete().eq('id', ed.id)
    if (error) return setErro(erroMsg(error))
    toast('Categoria excluída.'); setEd(null); recarregar()
  }
  const grupos = { material: 'Materiais', produto: 'Produtos', despesa: 'Despesas' } as const
  return (
    <Panel title="Categorias">
      <div className="space-y-3 p-4 text-sm">
        {(Object.keys(grupos) as (keyof typeof grupos)[]).map((g) => (
          <div key={g}><p className="mb-1 text-muted">{grupos[g]}</p><div className="flex flex-wrap gap-1.5">{(data ?? []).filter((c) => c.tipo === g).map((c) => (
            <button key={c.id} onClick={() => { setErro(null); setEd({ ...c }) }} className="rounded hover:ring-1 hover:ring-muted" aria-label={`Editar categoria ${c.nome}`}><Badge>{c.nome}</Badge></button>
          ))}</div></div>
        ))}
        <p className="text-xs text-muted">Clique numa categoria para renomear ou excluir.</p>
        <div className="flex gap-2 pt-2">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className="w-36"><option value="material">Material</option><option value="produto">Produto</option><option value="despesa">Despesa</option></Select>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nova categoria" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button onClick={add}>Adicionar</Button>
        </div>
        {!ed && <ErrorBox msg={erro} />}
      </div>
      <Modal open={!!ed} onClose={() => setEd(null)} title="Editar categoria"
        footer={<><BotaoExcluir onClick={excluir} /><Button onClick={() => setEd(null)}>Cancelar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></>}>
        {ed && (
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <Field label="Tipo"><Select value={ed.tipo} onChange={(e) => setEd({ ...ed, tipo: e.target.value as Categoria['tipo'] })}><option value="material">Material</option><option value="produto">Produto</option><option value="despesa">Despesa</option></Select></Field>
            <Field label="Nome"><Input value={ed.nome} onChange={(e) => setEd({ ...ed, nome: e.target.value })} /></Field>
          </div>
        )}
        <div className="mt-3"><ErrorBox msg={erro} /></div>
      </Modal>
    </Panel>
  )
}

function Usuarios() {
  const toast = useToast()
  const { session } = useAuth()
  const { data, carregando, recarregar } = useLoad<Usuario[]>(() => supabase.from('usuario').select('*').order('created_at'), [])
  async function mudar(u: Usuario, perfil: string) {
    const { error } = await supabase.from('usuario').update({ perfil }).eq('id', u.id)
    if (error) return toast(erroMsg(error), 'bad')
    toast(`${u.nome} agora é ${perfil === 'admin' ? 'administrador' : perfil === 'operador' ? 'operador' : 'sem acesso'}.`); recarregar()
  }
  return (
    <Panel title="Usuários">
      {carregando && !data ? <Loading /> : (
        <Table head={<tr><th>Nome</th><th>E-mail</th><th>Acesso</th></tr>}>
          {(data ?? []).map((u) => (
            <tr key={u.id}>
              <td className="font-medium">{u.nome}{u.perfil === 'pendente' && <span className="ml-2"><Badge tone="led">Aguardando liberação</Badge></span>}</td>
              <td>{u.email}</td>
              <td>
                <Select value={u.perfil} disabled={u.id === session?.user.id} onChange={(e) => mudar(u, e.target.value)} className="h-8 w-44 text-sm">
                  <option value="admin">Administrador</option><option value="operador">Operador</option><option value="pendente">Sem acesso</option>
                </Select>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">A outra pessoa cria a conta na tela de entrada e aparece aqui para você liberar. Operador lança vendas, compras, produção e estoque; não vê despesas nem configurações.</p>
    </Panel>
  )
}
