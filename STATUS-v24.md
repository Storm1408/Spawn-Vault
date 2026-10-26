# SpawnVault 2.4.0 — preparação local

Implementadas as nove alterações pedidas. Mantidos o Supabase existente, os recursos visuais originais e a configuração GitHub Releases da v2.3.

## Verificações reproduzíveis

- npm run check: sintaxe, versões, configuração, IDs e organização da Administração.
- npm test: atualizador e testes PostgreSQL/PGlite com as migrações reais. Cobre permissões de moderador, autor/revisor, cancelamento, decisões repetidas, rollback por duplicação, arquivo pessoal, imagens e contas bloqueadas.
- scripts/verify-ui.cjs: teste opcional com Playwright/Chromium e fixtures locais, sem pedidos ao Supabase real. Cobre criação no subgrupo atual, avisos sobre diálogos, ampliação em tabela/cartões, identificação, decisão, cancelamento, arquivo e migração em falta. Instalar Playwright separadamente e indicar SPAWNVAULT_BROWSER se necessário.
- npm run verify-release: confirma versão, nomes e hash do instalador/manifesto e existência do blockmap.

## Passos externos pendentes

1. Aplicar supabase/migration_v24.sql no Supabase já atualizado para a v2.3.
2. Confirmar num ambiente real um administrador, um moderador e um utilizador, incluindo uma aprovação e um cancelamento. Os testes locais não substituem esta verificação.
3. Validar a instalação Windows e publicar v2.4.0 no GitHub apenas depois destes passos. Não alterar os binários da v2.3.0.

Os testes PostgreSQL usam schemas auth/storage simulados. Não testam a infraestrutura Supabase real, a entrega de eventos Realtime, concorrência entre ligações reais ou a assinatura/instalação Windows. O instalador não tem assinatura digital.
