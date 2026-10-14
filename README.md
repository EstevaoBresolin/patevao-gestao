# Patevão Gestão

Sistema de estoque, produção e vendas da Patevão Store.
React + Vite + Tailwind no front; Supabase (PostgreSQL) no back, sem servidor próprio.

## Banco de dados

Já criado no projeto Supabase **patevao-store** (região São Paulo), migrações 001 a 005
(veja em Supabase → Database → Migrations). Toda regra de negócio roda em funções do banco,
numa transação só:

| Função | O que faz |
| --- | --- |
| `registrar_venda` | grava venda e itens, congela custo, calcula lucro, baixa estoque |
| `cancelar_venda` / `devolver_venda` | estornam o estoque |
| `atualizar_custos_venda` | corrige taxa/frete e recalcula o lucro |
| `receber_compra` | dá entrada nos materiais com o frete rateado no custo |
| `concluir_producao` | baixa materiais pela ficha técnica e dá entrada no produto com custo real |
| `movimentar_estoque` | entrada manual, perda, uso interno, ajuste |
| `abrir_inventario` / `concluir_inventario` | contagem física e ajustes |
| `dashboard` | indicadores do período |

O saldo nunca é editado direto: é sempre resultado de `movimento_estoque`.

## Rodar local

    npm install
    cp .env.example .env
    npm run dev

## Publicar na Vercel

    npx vercel --prod

ou importe a pasta num repositório GitHub e conecte na Vercel (framework Vite). Cadastre
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (valores no `.env.example`; são chaves públicas).

Depois de publicar, em Supabase → Authentication → URL Configuration, coloque o endereço da
Vercel em **Site URL**, senão o link de confirmação de e-mail aponta para localhost.

## Primeiro acesso

A primeira conta criada vira administrador. As próximas ficam aguardando até o admin liberar
em Configurações → Usuários (como Operador ou Administrador).
