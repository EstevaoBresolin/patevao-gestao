// Volta da autorização do Mercado Livre: troca o código pelos tokens e guarda no banco.
import { admin, APP_URL, REDIRECT_URI, salvarTokens, trocarToken } from '../_shared/ml.ts'

const voltar = (q: string) => Response.redirect(`${APP_URL}/config?${q}`, 302)

Deno.serve(async (req) => {
  const u = new URL(req.url)
  const code = u.searchParams.get('code'), state = u.searchParams.get('state')
  if (!code || !state) return voltar('ml=erro&msg=' + encodeURIComponent(u.searchParams.get('error_description') ?? 'Autorização cancelada'))
  const db = admin()
  // Só aceita autorizações iniciadas pelo botão "Conectar" do sistema (vale 15 minutos).
  const { data: st } = await db.from('ml_oauth_state').select('created_at').eq('state', state).maybeSingle()
  await db.from('ml_oauth_state').delete().eq('state', state)
  if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60 * 1000) return voltar('ml=erro&msg=' + encodeURIComponent('Link de conexão vencido. Clique em Conectar de novo.'))
  try {
    const t = await trocarToken({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
    const me = await fetch('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => ({}))
    await salvarTokens(db, t, { nickname: me.nickname ?? null })
    return voltar('ml=ok')
  } catch (e) {
    return voltar('ml=erro&msg=' + encodeURIComponent(String((e as Error).message ?? e)))
  }
})
