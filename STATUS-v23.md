# SpawnVault 2.3.0 — validação

O destino de atualizações é Storm1408/Spawn-Vault. O identificador da aplicação e a configuração Supabase existentes foram preservados.

## Verificado localmente

Login obrigatório, pesquisa e cartões; formulários; visibilidade administrativa; navegação e regresso ao login. Administração com Utilizadores, Gerir grupos, Bloqueios e Logs, com criação de grupos e navegação por teclado. Bloqueio/desbloqueio, motivo opcional apresentado no login, filtros, proteção da própria conta, recusas do servidor e falta de migração.

As migrações SQL foram verificadas sobre os SQL da v2.2 em PostgreSQL temporário, com autenticação e armazenamento simulados. Contas bloqueadas perdem acesso às tabelas e funções administrativas. Desbloquear mantém papel e dados.

O controlador de atualizações foi verificado com serviço simulado: início/periocidade, aviso, descarga, adiamento, instalação posterior, falhas de rede e concorrência. Foram verificados código, configuração de distribuição, conteúdo do pacote e integridade dos ficheiros de atualização.

## Por validar no ambiente real

As contas e migrações não foram testadas nem alteradas no Supabase de produção. A instalação/atualização completa no Windows e o workflow de publicação exigem verificação nesse ambiente. O instalador não é assinado digitalmente.

## Ativar bloqueios e motivo

Se necessário, executar supabase/migration_v23_access.sql e depois supabase/migration_v23_block_reason.sql no projeto existente. Se a primeira já foi aplicada, basta a segunda. O instalador não aplica SQL.

Uma conta bloqueada continua a existir no Supabase Auth mas perde acesso aos dados e funções da aplicação. A interface verifica o estado ao carregar dados, ao recuperar foco e a cada 15 segundos. Dados já descarregados e URLs de imagens assinados antes do bloqueio podem continuar acessíveis até expirarem.

## Atualizações

Instalações anteriores sem a configuração do GitHub precisam de atualizar manualmente uma vez. Depois, a aplicação verifica versões estáveis ao abrir, periodicamente e ao retomar o computador. A descarga e o reinício para instalar requerem escolha do utilizador. A publicação está descrita em README.md.
