# SpawnVault 2.3.0

Nova interface em grafite e vermelho, com o cofre original, marca de água S e assinatura By: $torm. Mantém o catálogo, pesquisa, cartões, favoritos, pedidos, reciclagem, imagens, histórico e sincronização da v2.2.

A Administração reúne Utilizadores, Gerir grupos, Bloqueios e Logs. Os bloqueios são reversíveis, preservam as contas e os dados e apresentam o motivo no login.

As atualizações passam a ser verificadas automaticamente através deste repositório, com aviso de nova versão e opção de descarregar, instalar ou adiar.

## Instalação

Instalar SpawnVault-Setup-2.3.0.exe. Versões antigas que ainda não tinham o repositório configurado precisam desta primeira instalação manual. A aplicação mantém o identificador e a ligação ao Supabase existentes.

## Atualização do Supabase

Se ainda não foram aplicados, executar migration_v23_access.sql e depois migration_v23_block_reason.sql no SQL Editor do projeto existente. Se o bloqueio já estava ativado, basta aplicar a migração do motivo. O instalador não executa SQL nem altera contas, permissões ou dados de produção.

## Verificação

Verificações locais de interface, regras de acesso em PostgreSQL temporário, controlador de atualizações, conteúdo do pacote e integridade do instalador. A instalação/atualização completa no Windows e as contas do Supabase de produção não foram testadas neste ambiente. O instalador não tem assinatura digital.
