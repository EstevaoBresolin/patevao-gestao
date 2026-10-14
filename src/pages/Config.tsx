import { useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataBR, hoje, money, parseNum, qty } from '../lib/fmt'
import type { Categoria } from '../lib/types'
import { Badge, Button, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Panel, Select, Table, useToast } from '../components/ui'
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

function Canais() {
  const toast = useToast()
  const { data, recarregar } = useLoad<Canal[]>(() => supabase.from('canal').select('*, canal_taxa(*)').order('nome'), [])
  const [taxa, setTaxa] = useState<{ canal_id: string; canal: string; perfil: string; perc: string; fixa: string; ate: string; frete: string; desde: string } | null>(null)
  const [novoCanal, setNovoCanal] = useState<{ nome: string; tipo: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function salvarTaxa() {
    if (!taxa) return
    if (!taxa.perfil.trim()) return setErro('Dê um nome ao tipo de anúncio.')
    const { error } = await supabase.from('canal_taxa').insert({ canal_id: taxa.canal_id, perfil: taxa.perfil.trim(), perc_taxa: parseNum(taxa.perc), tarifa_fixa: parseNum(taxa.fixa), tarifa_ate_preco: taxa.ate.trim() ? parseNum(taxa.ate) : null, frete_padrao: parseNum(taxa.frete), vigente_desde: taxa.desde })
    if (error) return setErro(erroMsg(error))
    toast('Taxa salva. Vendas antigas mantêm a taxa da época.'); setTaxa(null); recarregar()
  }
  async function salvarCanal() {
    if (!novoCanal?.nome.trim()) return setErro('Dê um nome ao canal.')
    const { data: c, error } = await supabase.from('canal').insert({ nome: novoCanal.nome.trim(), tipo: novoCanal.tipo }).select('id').single()
    if (error) return setErro(erroMsg(error))
    await supabase.from('canal_taxa').insert({ canal_id: c.id, perfil: 'Padrão', perc_taxa: 0, vigente_desde: '2000-01-01' })
    toast('Canal criado.'); setNovoCanal(null); recarregar()
  }

  return (
    <Panel title="Canais de venda e taxas" actions={<Button size="sm" onClick={() => { setErro(null); setNovoCanal({ nome: '', tipo: 'marketplace' }) }}><Plus size={15} /> Novo canal</Button>}>
      <div className="divide-y divide-line">
        {(data ?? []).map((c) => {
          const vigentes = new Map<string, Taxa>()
          ;[...c.canal_taxa].filter((t) => t.ativo && t.vigente_desde <= hoje()).sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde)).forEach((t) => vigentes.set(t.perfil, t))
          const historico = [...c.canal_taxa].sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))
          return (
            <div key={c.id} className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{c.nome} <span className="ml-1 text-sm font-normal text-muted">{c.tipo === 'direto' ? 'venda direta' : 'marketplace'}</span></p>
                <Button size="sm" onClick={() => { setErro(null); setTaxa({ canal_id: c.id, canal: c.nome, perfil: [...vigentes.keys()][0] ?? 'Padrão', perc: '', fixa: '0', ate: '', frete: c.tipo === 'direto' ? '0' : '25', desde: hoje() }) }}>Mudar taxa</Button>
              </div>
              <Table head={<tr><th>Tipo de anúncio</th><th className="text-right">Taxa</th><th className="text-right">Tarifa fixa</th><th className="text-right">Frete padrão</th><th>Vale desde</th></tr>}>
                {historico.map((t) => {
                  const atual = vigentes.get(t.perfil)?.id === t.id
                  return (
                    <tr key={t.id} className={atual ? '' : 'text-muted'}>
                      <td>{t.perfil} {atual ? <Badge tone="good">Em uso</Badge> : t.vigente_desde > hoje() ? <Badge tone="led">Futura</Badge> : <Badge>Anterior</Badge>}</td>
                      <td className="num text-right">{qty(t.perc_taxa)}%</td>
                      <td className="num text-right">{Number(t.tarifa_fixa) ? `${money(t.tarifa_fixa)}${t.tarifa_ate_preco ? ` até ${money(t.tarifa_ate_preco)}` : ''}` : '–'}</td>
                      <td className="num text-right">{money(t.frete_padrao)}</td>
                      <td className="num">{dataBR(t.vigente_desde)}</td>
                    </tr>
                  )
                })}
              </Table>
            </div>
          )
        })}
      </div>
      <Modal open={!!taxa} onClose={() => setTaxa(null)} title={`Taxa do ${taxa?.canal}`} footer={<><Button onClick={() => setTaxa(null)}>Cancelar</Button><Button variant="primary" onClick={salvarTaxa}>Salvar taxa</Button></>}>
        {taxa && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de anúncio" hint="Ex.: Clássico, Premium. Use um nome novo para criar outro tipo." className="sm:col-span-2"><Input value={taxa.perfil} onChange={(e) => setTaxa({ ...taxa, perfil: e.target.value })} /></Field>
            <Field label="Taxa sobre a venda (%)"><NumInput value={taxa.perc} onChange={(v) => setTaxa({ ...taxa, perc: v })} /></Field>
            <Field label="Frete padrão (R$)" hint="Sugerido em cada venda; sempre editável."><NumInput value={taxa.frete} onChange={(v) => setTaxa({ ...taxa, frete: v })} /></Field>
            <Field label="Tarifa fixa por unidade (R$)"><NumInput value={taxa.fixa} onChange={(v) => setTaxa({ ...taxa, fixa: v })} /></Field>
            <Field label="Tarifa só até o preço de (R$)" hint="Vazio = vale para qualquer preço."><NumInput value={taxa.ate} onChange={(v) => setTaxa({ ...taxa, ate: v })} /></Field>
            <Field label="Vale a partir de"><Input type="date" value={taxa.desde} onChange={(e) => setTaxa({ ...taxa, desde: e.target.value })} /></Field>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">A taxa anterior fica guardada. Vendas já lançadas não mudam.</p>
        <div className="mt-3"><ErrorBox msg={erro} /></div>
      </Modal>
      <Modal open={!!novoCanal} onClose={() => setNovoCanal(null)} title="Novo canal de venda" footer={<><Button onClick={() => setNovoCanal(null)}>Cancelar</Button><Button variant="primary" onClick={salvarCanal}>Criar canal</Button></>}>
        {novoCanal && (
          <div className="grid gap-4">
            <Field label="Nome"><Input value={novoCanal.nome} onChange={(e) => setNovoCanal({ ...novoCanal, nome: e.target.value })} placeholder="Shopee" /></Field>
            <Field label="Tipo"><Select value={novoCanal.tipo} onChange={(e) => setNovoCanal({ ...novoCanal, tipo: e.target.value })}><option value="marketplace">Marketplace</option><option value="direto">Venda direta</option></Select></Field>
            <p className="text-sm text-muted">Depois de criar, use "Mudar taxa" para definir a porcentagem e o frete.</p>
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
  const { data, recarregar } = useLoad<Categoria[]>(() => supabase.from('categoria').select('*').order('tipo').order('nome'), [])
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<'material' | 'produto' | 'despesa'>('material')
  const [erro, setErro] = useState<string | null>(null)
  async function add() {
    if (!nome.trim()) return
    const { error } = await supabase.from('categoria').insert({ nome: nome.trim(), tipo })
    if (error) return setErro(erroMsg(error))
    setNome(''); setErro(null); recarregar()
  }
  const grupos = { material: 'Materiais', produto: 'Produtos', despesa: 'Despesas' } as const
  return (
    <Panel title="Categorias">
      <div className="space-y-3 p-4 text-sm">
        {(Object.keys(grupos) as (keyof typeof grupos)[]).map((g) => (
          <div key={g}><p className="mb-1 text-muted">{grupos[g]}</p><div className="flex flex-wrap gap-1.5">{(data ?? []).filter((c) => c.tipo === g).map((c) => <Badge key={c.id}>{c.nome}</Badge>)}</div></div>
        ))}
        <div className="flex gap-2 pt-2">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className="w-36"><option value="material">Material</option><option value="produto">Produto</option><option value="despesa">Despesa</option></Select>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nova categoria" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button onClick={add}>Adicionar</Button>
        </div>
        <ErrorBox msg={erro} />
      </div>
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
