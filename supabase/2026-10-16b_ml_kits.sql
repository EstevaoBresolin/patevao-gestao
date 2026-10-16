-- Kits do Mercado Livre: quais produtos (e quantos) saem do estoque em 1 unidade vendida do anúncio.
-- Já aplicado no projeto.
create table if not exists ml_anuncio_item (
  id uuid primary key default gen_random_uuid(),
  anuncio text not null check (anuncio ~ '^MLB[0-9]+$'),
  variacao bigint,
  titulo text,
  produto_id uuid not null references produto(id),
  quantidade numeric(12,3) not null check (quantidade > 0),
  criado_em timestamptz not null default now()
);
create index if not exists ml_anuncio_item_anuncio on ml_anuncio_item(anuncio);
alter table ml_anuncio_item enable row level security;
create policy ml_anuncio_item_sel on ml_anuncio_item for select using (is_membro());
create policy ml_anuncio_item_ins on ml_anuncio_item for insert with check (is_membro());
create policy ml_anuncio_item_upd on ml_anuncio_item for update using (is_membro()) with check (is_membro());
create policy ml_anuncio_item_del on ml_anuncio_item for delete using (is_membro());
grant select, insert, update, delete on ml_anuncio_item to authenticated, service_role;
