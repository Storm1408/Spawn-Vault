# SpawnVault 2.4.1

Login por username e palavra-passe. As contas são criadas em Administração → Utilizadores por administradores ativos. O email permanece no Supabase Auth, sem ser mostrado no formulário de login nem devolvido pelo serviço público de resolução.

As contas existentes conservam UUID, email, palavra-passe, cargo, bloqueio, favoritos e pedidos. A migração atribui usernames únicos, usando o username anterior ou o nome antes do @. Caracteres incompatíveis são substituídos por _ e colisões recebem um sufixo. Só a administração pode alterar o username.

## Servidor

- supabase/migration_v241.sql: usernames, acessos, limites de login e criação transacional. Requer v2.4.
- supabase/functions/spawnvault-accounts/index.ts e _shared/accounts.mjs: serviço de login e criação. A chave administrativa é lida apenas das variáveis automáticas do servidor.
- supabase/config.toml: a função aceita o login sem sessão; a ação create valida o JWT através do Auth e confirma o administrador ativo no servidor. Desligar Verify JWT with legacy secret apenas nesta função, após autorização do proprietário.
- O trigger em auth.users recusa inscrições sem os metadados privados enviados pelo serviço administrativo. Em caso de colisão ou perda de permissões, a criação é revertida. Passwords são geridas pela API oficial Supabase Auth; não são escritas por SQL.

## Validação

npm run check e npm test: atualizador, moderação, permissões PostgreSQL, preservação de contas e credenciais, nomes únicos, criação transacional, inscrição pública recusada, autorização administrativa e limites de tentativas.

scripts/verify-accounts-ui.cjs: login com username, erros, criação sem substituir a sessão do administrador, alteração de username e recusa de acesso ao moderador, usando fixtures. scripts/verify-ui.cjs cobre a funcionalidade da v2.4.

No projeto existente, a migração e a função foram aplicadas com autorização explícita. A contagem de contas, itens e grupos foi conferida antes/depois e manteve-se. Verificados em HTTP público: login fictício inválido, criação sem sessão recusada e resolução privada de email inacessível.

Não foram usadas passwords de utilizadores reais. É necessário confirmar na aplicação o login com a password existente e a criação de uma conta pela administração. A instalação completa Windows não foi testada; o instalador não tem assinatura digital.
