import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { supabase } from './lib/supabase'
import Layout from './components/Layout'
import Login, { NovaSenha } from './pages/Login'
import Dashboard from './pages/Dashboard'
import Vendas from './pages/Vendas'
import NovaVenda from './pages/NovaVenda'
import VendaDetalhe from './pages/VendaDetalhe'
import Produtos from './pages/Produtos'
import ProdutoDetalhe from './pages/ProdutoDetalhe'
import Materiais from './pages/Materiais'
import Estoque from './pages/Estoque'
import Producao from './pages/Producao'
import Compras from './pages/Compras'
import Cadastros from './pages/Cadastros'
import Financeiro from './pages/Financeiro'
import Financas from './pages/Financas'
import Config from './pages/Config'
import { Button } from './components/ui'

export default function App() {
  const { session, perfil, carregando, isAdmin, recuperando } = useAuth()
  if (carregando) return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Carregando…</div>
  if (recuperando && session) return <NovaSenha />
  if (!session) return <Login />
  if (perfil === 'pendente')
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="wide text-xl font-bold">Acesso aguardando liberação</p>
        <p className="max-w-sm text-sm text-muted">O administrador precisa liberar sua conta em Configurações → Usuários. Depois disso, entre de novo.</p>
        <Button onClick={() => supabase.auth.signOut()}>Sair</Button>
      </div>
    )
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="vendas" element={<Vendas />} />
        <Route path="vendas/nova" element={<NovaVenda />} />
        <Route path="vendas/:id" element={<VendaDetalhe />} />
        <Route path="produtos" element={<Produtos />} />
        <Route path="produtos/:id" element={<ProdutoDetalhe />} />
        <Route path="materiais" element={<Materiais />} />
        <Route path="estoque" element={<Estoque />} />
        <Route path="producao" element={<Producao />} />
        <Route path="compras" element={<Compras />} />
        <Route path="cadastros" element={<Cadastros />} />
        {isAdmin && <Route path="financeiro" element={<Financeiro />} />}
        {isAdmin && <Route path="financas" element={<Financas />} />}
        {isAdmin && <Route path="config" element={<Config />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
