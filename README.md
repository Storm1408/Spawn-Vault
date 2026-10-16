# SpawnVault 2.3

Aplicação Windows para o catálogo partilhado de itens e spawns FiveM, com autenticação e permissões no Supabase.

## Instalar

Descarregar SpawnVault-Setup-2.3.0.exe nos Releases de https://github.com/Storm1408/Spawn-Vault. Instalar esta primeira versão manualmente se a anterior ainda não tinha o repositório de atualizações configurado. Não é necessário recriar a conta.

## Funcionalidades

Dashboard, catálogo em tabela/cartões, pesquisa, cópia de spawns, grupos e subgrupos, imagens privadas, favoritos, pedidos, reciclagem/restauro, importação e exportação CSV administrativas, histórico e Realtime. A Administração reúne Utilizadores, Gerir grupos, Bloqueios e Logs. O bloqueio é reversível e apresenta o motivo no login.

## Atualização do Supabase

A ligação, a chave pública e o identificador da aplicação existentes foram mantidos. O instalador não executa SQL nem altera dados remotos.

Em projetos que já usam a v2.2, aplicar supabase/migration_v23_access.sql e depois supabase/migration_v23_block_reason.sql. Se a primeira já foi aplicada, basta a segunda. Não reaplicar schema.sql nem as migrações antigas num projeto já configurado.

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
2. Validar as alterações e criar uma tag estável correspondente, por exemplo v2.3.1.
3. O workflow .github/workflows/release.yml compila, executa verificações, cria um release em rascunho, envia os ficheiros e só depois o publica. Requer o código e o workflow no repositório e GitHub Actions autorizado.
4. Em alternativa, publicar manualmente o EXE, o respetivo .blockmap e latest.yml da mesma compilação num release estável. Só enviar código para main não anuncia uma atualização.

Não substituir binários de um release já publicado. Criar uma nova versão para cada alteração distribuída. Os utilizadores com esta configuração recebem a oferta de atualização quando detetarem o novo release.

## Validação

Consultar STATUS-v23.md e RELEASE_NOTES.md para o âmbito das verificações e limites atuais. O instalador não possui assinatura digital.
