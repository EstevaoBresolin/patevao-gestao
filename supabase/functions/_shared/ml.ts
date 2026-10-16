// Integração Patevão Gestão × Mercado Livre (compartilhado pelas funções ml-*).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const APP_ID = '6923228129063734'
export const REDIRECT_URI = 'https://xizdrfbcihvjfiylfgov.supabase.co/functions/v1/ml-oauth'
export const APP_URL = 'https://patevao-gestao.vercel.app'
export const NOTIFY_EMAIL = 'estevaobresolin@hotmail.com'
const API = 'https://api.mercadolibre.com'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
export const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Cliente com service_role: ignora RLS e conta como membro nas funções do banco. */
export const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

type Tokens = { access_token: string; refresh_token: string; expires_in: number; user_id: number }

export async function trocarToken(params: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: APP_ID, client_secret: Deno.env.get('ML_SECRET') ?? '', ...params }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Autorização do Mercado Livre falhou: ${j.message ?? j.error ?? r.status}`)
  return j
}

export async function salvarTokens(db: SupabaseClient, t: Tokens, extra: Record<string, unknown> = {}) {
  const { error } = await db.from('ml_conta').upsert({
    id: 1, ml_user_id: t.user_id, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in - 300) * 1000).toISOString(), updated_at: new Date().toISOString(), ...extra,
  })
  if (error) throw error
}

/** Token de acesso válido; renova sozinho (o do ML vale ~6 h e o refresh só pode ser usado uma vez). */
export async function token(db: SupabaseClient): Promise<string> {
  const ler = async () => (await db.from('ml_conta').select('*').eq('id', 1).maybeSingle()).data
  const c = await ler()
  if (!c?.refresh_token) throw new Error('Mercado Livre não conectado')
  if (c.access_token && new Date(c.expires_at).getTime() > Date.now()) return c.access_token
  try {
    const t = await trocarToken({ grant_type: 'refresh_token', refresh_token: c.refresh_token })
    await salvarTokens(db, t)
    return t.access_token
  } catch (e) {
    // Outro aviso pode ter renovado ao mesmo tempo: usa o token novo se já existir.
    const c2 = await ler()
    if (c2?.access_token && new Date(c2.expires_at).getTime() > Date.now()) return c2.access_token
    throw e
  }
}

export async function ml(db: SupabaseClient, path: string) {
  const tk = await token(db)
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${tk}`, 'x-format-new': 'true' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Mercado Livre ${path}: ${j.message ?? r.status}`)
  return j
}

const dataBR = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const digitos = (s: string) => s.replace(/\D/g, '')
const statusEnvio = (s?: string) => (s === 'delivered' ? 'entregue' : s === 'shipped' ? 'enviada' : 'aberta')
const ORDEM = { aberta: 0, enviada: 1, entregue: 2 } as Record<string, number>

/** Liga o anúncio ao produto pelo campo "Código do anúncio" (MLB…, ou MLB…/variação). */
async function produtoDoAnuncio(db: SupabaseClient, mlb: string, variacao: number | null) {
  const { data } = await db.from('produto').select('id, nome, anuncio_ml').not('anuncio_ml', 'is', null)
  const lista = (data ?? []).map((p) => {
    const [a, v] = String(p.anuncio_ml).split('/')
    return { ...p, mlb: digitos(a), variacao: v ? digitos(v) : null }
  }).filter((p) => p.mlb === digitos(mlb))
  if (variacao != null) {
    const exata = lista.find((p) => p.variacao === String(variacao))
    if (exata) return exata
  }
  const semVar = lista.filter((p) => !p.variacao)
  return semVar.length === 1 ? semVar[0] : lista.length === 1 ? lista[0] : null
}

type Componente = { produto_id: string; quantidade: number; peso: number }

/**
 * O que sai do estoque em 1 unidade vendida do anúncio.
 * Primeiro olha a composição do anúncio (kits, em Configurações → Mercado Livre);
 * senão, o produto que tem esse código de anúncio (1 unidade).
 * O peso (custo) serve para repartir o preço do kit entre os produtos.
 */
async function componentesDoAnuncio(db: SupabaseClient, mlb: string, variacao: number | null): Promise<Componente[] | null> {
  const codigo = 'MLB' + digitos(mlb)
  const { data: kit } = await db.from('ml_anuncio_item').select('produto_id, quantidade, variacao').eq('anuncio', codigo)
  let linhas = (kit ?? []).filter((k) => variacao != null && Number(k.variacao) === variacao)
  if (!linhas.length) linhas = (kit ?? []).filter((k) => k.variacao == null)
  let comp: { produto_id: string; quantidade: number }[]
  if (linhas.length) comp = linhas.map((k) => ({ produto_id: k.produto_id, quantidade: Number(k.quantidade) }))
  else {
    const p = await produtoDoAnuncio(db, mlb, variacao)
    if (!p) return null
    comp = [{ produto_id: p.id, quantidade: 1 }]
  }
  const { data: custos } = await db.from('vw_produto_estoque').select('id, custo_medio, custo_padrao').in('id', comp.map((c) => c.produto_id))
  return comp.map((c) => {
    const x = (custos ?? []).find((y) => y.id === c.produto_id)
    const custo = Number(x?.custo_medio) > 0 ? Number(x?.custo_medio) : Number(x?.custo_padrao) > 0 ? Number(x?.custo_padrao) : 1
    return { ...c, peso: custo * c.quantidade }
  })
}

export async function atualizarEnvio(db: SupabaseClient, shipmentId: number) {
  const s = await ml(db, `/shipments/${shipmentId}`)
  const novo = statusEnvio(s.status)
  const { data: vendas } = await db.from('venda').select('id, status').eq('ml_shipment_id', shipmentId)
  for (const v of vendas ?? []) {
    if (!(v.status in ORDEM) || ORDEM[novo] <= ORDEM[v.status]) continue
    const { error } = await db.rpc('mudar_status_venda', { p_id: v.id, p_status: novo })
    if (error) throw error
  }
  return { vendas: vendas?.length ?? 0, orderId: s.order_id as number | undefined }
}

/** Lança (ou atualiza) a venda de um pedido do ML. Pedido que não dá para lançar vai para "Vendas do ML para conferir". */
export async function importarPedido(db: SupabaseClient, orderId: number): Promise<string> {
  const o = await ml(db, `/orders/${orderId}`)
  const { data: existente } = await db.from('venda').select('id, status').eq('ml_order_id', orderId).maybeSingle()

  if (o.status === 'cancelled') {
    if (existente && !['cancelada', 'devolvida'].includes(existente.status)) {
      const { error } = await db.rpc('cancelar_venda', { p_id: existente.id, p_motivo: 'Cancelada no Mercado Livre' })
      if (error) throw error
    }
    await db.from('ml_pendente').update({ resolvido: true }).eq('ml_order_id', orderId)
    return existente ? 'cancelada' : 'ignorada'
  }
  if (existente) {
    if (o.shipping?.id) await atualizarEnvio(db, o.shipping.id)
    return 'ja_lancada'
  }
  if (o.status !== 'paid') return 'aguardando_pagamento'

  const resumo = {
    data: dataBR(o.date_closed ?? o.date_created), comprador: o.buyer?.nickname ?? null, total: o.total_amount,
    itens: (o.order_items ?? []).map((i: any) => ({ mlb: i.item.id, variacao: i.item.variation_id ?? null, titulo: i.item.title, qtd: i.quantity, preco: i.unit_price })),
  }
  const pendente = async (motivo: string) => {
    await db.from('ml_pendente').upsert({ ml_order_id: orderId, motivo, resumo, resolvido: false })
    return 'pendente'
  }

  const itens: { produto_id: string; quantidade: number; preco_unit: number }[] = []
  let taxa = 0, bruta = 0
  for (const i of o.order_items ?? []) {
    const comp = await componentesDoAnuncio(db, i.item.id, i.item.variation_id ?? null)
    if (!comp) return pendente(`O anúncio ${i.item.id} ("${i.item.title}") não está ligado a nenhum produto. Use "Ligar anúncio" para dizer qual produto (ou quais, se for kit) sai do estoque.`)
    const qtd = Number(i.quantity), linha = qtd * Number(i.unit_price)
    // Kit: o valor do anúncio é repartido entre os produtos pelo custo de cada um.
    const pesoTotal = comp.reduce((s, c) => s + c.peso, 0)
    let resto = Math.round(linha * 100) / 100
    comp.forEach((c, k) => {
      const quantidade = qtd * c.quantidade
      const valor = k === comp.length - 1 ? resto : Math.round(linha * (c.peso / pesoTotal) * 100) / 100
      const preco_unit = Math.round((valor / quantidade) * 100) / 100
      resto = Math.round((resto - preco_unit * quantidade) * 100) / 100
      itens.push({ produto_id: c.produto_id, quantidade, preco_unit })
    })
    taxa += Number(i.sale_fee ?? 0) * qtd
    bruta += linha
  }

  const { data: canal } = await db.from('canal').select('id').ilike('nome', '%mercado%livre%').eq('ativo', true).limit(1).maybeSingle()
  if (!canal) return pendente('Não existe um canal ativo chamado "Mercado Livre" em Configurações.')
  const { data: taxaCanal } = await db.from('vw_canal_taxa_vigente').select('id').eq('canal_id', canal.id).limit(1).maybeSingle()

  // Frete: o que o vendedor pagou. Em carrinho (vários pedidos, um envio) conta uma vez só.
  let frete = 0, statusVenda = 'aberta'
  const shipId = o.shipping?.id ?? null
  if (shipId) {
    const { count } = await db.from('venda').select('id', { count: 'exact', head: true }).eq('ml_shipment_id', shipId)
    if (!count) {
      try {
        const custos = await ml(db, `/shipments/${shipId}/costs`)
        frete = (custos.senders ?? []).reduce((s: number, x: any) => s + Number(x.cost ?? 0), 0)
      } catch { /* sem custo de envio disponível */ }
    }
    try { statusVenda = statusEnvio((await ml(db, `/shipments/${shipId}`)).status) } catch { /* mantém aberta */ }
  }

  const { error, data: vendaId } = await db.rpc('importar_venda_ml', {
    p_order: orderId, p_shipment: shipId,
    p: {
      data: resumo.data, canal_id: canal.id, canal_taxa_id: taxaCanal?.id ?? null,
      pedido_externo: String(o.pack_id ?? o.id), status: statusVenda,
      perc_taxa: bruta > 0 ? Math.round((taxa / bruta) * 100 * 10000) / 10000 : 0, tarifa_fixa: 0,
      frete: Math.round(frete * 100) / 100, desconto: 0, outros_custos: 0,
      forma_pagamento: 'Mercado Pago',
      observacoes: `Importada do Mercado Livre${resumo.comprador ? `. Comprador: ${resumo.comprador}` : ''}.`,
      itens,
    },
  })
  if (error) return pendente(error.message)
  return vendaId ? 'lancada' : 'erro'
}

async function enviarEmail(assunto: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Patevão Gestão <onboarding@resend.dev>', to: [NOTIFY_EMAIL], subject: assunto, html }),
  })
  if (!r.ok) throw new Error(`E-mail não enviado: ${await r.text()}`)
}

async function enviarWhatsApp(texto: string) {
  // CallMeBot: liga quando houver apikey (CALLMEBOT_PHONE e CALLMEBOT_APIKEY nos segredos do Supabase).
  const phone = Deno.env.get('CALLMEBOT_PHONE'), apikey = Deno.env.get('CALLMEBOT_APIKEY')
  if (!phone || !apikey) return
  await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(apikey)}`)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Avisa por e-mail (e WhatsApp, se configurado) quando chega pergunta nova. Cada pergunta é avisada uma vez. */
export async function avisarPergunta(db: SupabaseClient, questionId: number) {
  const q = await ml(db, `/questions/${questionId}`)
  if (q.status !== 'UNANSWERED') return 'respondida'
  const { data: novo } = await db.from('ml_pergunta_avisada').upsert({ question_id: questionId }, { onConflict: 'question_id', ignoreDuplicates: true }).select('question_id')
  if (!novo?.length) return 'ja_avisada'
  let titulo = q.item_id as string, link = `https://produto.mercadolivre.com.br/${String(q.item_id).replace(/^MLB/, 'MLB-')}`
  try { const it = await ml(db, `/items/${q.item_id}`); titulo = it.title; link = it.permalink ?? link } catch { /* usa o código */ }
  const texto = String(q.text ?? '')
  await Promise.allSettled([
    enviarEmail(`Nova pergunta no ML: ${titulo}`,
      `<p style="font:15px system-ui;color:#555">Nova pergunta no Mercado Livre</p>
       <p style="font:600 17px system-ui">${esc(titulo)}</p>
       <blockquote style="font:16px system-ui;border-left:3px solid #F2A93B;margin:12px 0;padding:6px 12px">${esc(texto)}</blockquote>
       <p style="font:14px system-ui;color:#555">Responda pelo app do Mercado Livre, em <b>Vendas → Perguntas</b>. <a href="${link}">Ver anúncio</a></p>`),
    enviarWhatsApp(`❓ Nova pergunta no ML\n*${titulo}*\n"${texto}"\nResponda pelo app do ML (Vendas → Perguntas).`),
  ])
  return 'avisada'
}
