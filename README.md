# SpawnVault 2.4.1

Aplicação Windows para o catálogo partilhado de itens e spawns FiveM, com autenticação e permissões no Supabase.

## Instalar

Após publicação e ativação da migração v2.4, descarregar SpawnVault-Setup-2.4.1.exe nos Releases de https://github.com/Storm1408/Spawn-Vault. Instalar esta primeira versão manualmente se a anterior ainda não tinha o repositório de atualizações configurado. Não é necessário recriar a conta.

## Contas e login

Login por username e palavra-passe. Só administradores ativos criam contas em Administração → Utilizadores. O email continua associado à identidade Supabase para administração, mas não é pedido no login. Os usernames existentes são listados e podem ser alterados pela administração.

## Funcionalidades

Novo cargo Moderador, identificação de autor/revisor nos pedidos, eliminação de pedidos próprios pendentes, arquivo pessoal, ampliação de imagens e avisos verdes/vermelhos sobre janelas abertas. O subgrupo atual é pré-selecionado na criação.

Dashboard, catálogo em tabela/cartões, pesquisa, cópia de spawns, grupos e subgrupos, imagens privadas, favoritos, pedidos, reciclagem/restauro, importação e exportação CSV administrativas, histórico e Realtime. A Administração reúne Utilizadores, Gerir grupos, Bloqueios e Logs. O bloqueio é reversível e apresenta o motivo no login.

## Atualização do Supabase

A ligação, a chave pública e o identificador da aplicação existentes foram mantidos. O instalador não executa SQL nem altera dados remotos.

Em projetos que já usam a v2.4, aplicar supabase/migration_v241.sql e publicar a função de contas antes de distribuir esta versão. No projeto SpawnVault existente estes passos já foram executados.

Para publicar o serviço: supabase functions deploy spawnvault-accounts --project-ref hlsbsmewlqtonxsrpnue --no-verify-jwt. As variáveis SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são fornecidas pelo servidor Supabase; nunca as copiar para o cliente. A função valida a sessão e o administrador em cada criação. A migração bloqueia inscrições fora desse fluxo. Não voltar a executar schema.sql.

Em projetos que ainda usam a v2.3, aplicar apenas supabase/migration_v24.sql. O moderador é atribuído em Administração → Utilizadores. Aplicar e validar esta migração antes de publicar a v2.4.

Em projetos que ainda usam a v2.2, aplicar supabase/migration_v23_access.sql e depois supabase/migration_v23_block_reason.sql. Se a primeira já foi aplicada, basta a segunda para concluir a v2.3; depois aplicar migration_v24.sql. Não reaplicar schema.sql nem as migrações antigas num projeto já configurado.

O bloqueio é específico do SpawnVault e protege os dados e operações administrativas através de RLS. Mantém a identidade no Supabase Auth, o papel e os dados. Dados já descarregados e URLs de imagens assinados anteriormente não podem ser retirados retroativamente.

## Desenvolvimento

Requisitos: Node.js 24 e Windows para gerar o instalador NSIS.

    npm ci
    npm start
    npm run check
    npm test
    npm run dist -- --publish never
    npm run verify-release

A distribuição é gerada em dist/. Não incluir credenciais privadas no código; a chave pública do Supabase depende das políticas de acesso do servidor.

## Próximas versões no GitHub

1. Atualizar a versão em package.json e package-lock.json e rever RELEASE_NOTES.md.
2. Validar as alterações e criar uma tag estável correspondente, por exemplo v2.4.0.
3. O workflow .github/workflows/release.yml compila, executa verificações, cria um release em rascunho, envia os ficheiros e só depois o publica. Requer o código e o workflow no repositório e GitHub Actions autorizado.
4. Em alternativa, publicar manualmente o EXE, o respetivo .blockmap e latest.yml da mesma compilação num release estável. Só enviar código para main não anuncia uma atualização.

Não substituir binários de um release já publicado. Criar uma nova versão para cada alteração distribuída. Os utilizadores com esta configuração recebem a oferta de atualização quando detetarem o novo release.

## Validação

Consultar STATUS-v241.md (versão atual), STATUS-v24.md (histórico), STATUS-v23.md (histórico) e RELEASE_NOTES.md para o âmbito das verificações e limites atuais. O instalador não possui assinatura digital.
