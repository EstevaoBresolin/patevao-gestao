// Recebe os avisos do Mercado Livre (vendas, envios e perguntas).
import { admin, APP_ID, atualizarEnvio, avisarPergunta, importarPedido } from '../_shared/ml.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

async function processar(topic: string, resource: string) {
  const db = admin()
  const id = Number(resource.split('/').filter(Boolean).pop())
  if (!id) return 'sem_id'
  if (topic === 'orders_v2' || topic === 'orders') return importarPedido(db, id)
  if (topic === 'shipments') {
    const r = await atualizarEnvio(db, id)
    // Envio de um pedido que ainda não foi lançado: lança agora.
    if (!r.vendas && r.orderId) return importarPedido(db, r.orderId)
    return 'envio_atualizado'
  }
  if (topic === 'questions') return avisarPergunta(db, id)
  return 'ignorado'
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  const body = await req.json().catch(() => null)
  // O ML não assina os avisos: aceita só os do nosso aplicativo e só usa o id para buscar os dados na API.
  if (!body?.resource || String(body.application_id) !== APP_ID) return new Response('ignorado')
  const db = admin()
  const { data: ev } = await db.from('ml_evento').insert({ topic: body.topic, resource: body.resource }).select('id').single()
  // Responde 200 na hora (senão o ML reenvia) e processa em segundo plano.
  EdgeRuntime.waitUntil(
    processar(String(body.topic), String(body.resource))
      .then((r) => db.from('ml_evento').update({ processado_em: new Date().toISOString(), erro: r === 'pendente' ? 'Venda foi para conferir' : null }).eq('id', ev?.id))
      .catch((e) => db.from('ml_evento').update({ processado_em: new Date().toISOString(), erro: String(e?.message ?? e) }).eq('id', ev?.id)),
  )
  return new Response('ok')
})
