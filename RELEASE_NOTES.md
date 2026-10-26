# SpawnVault 2.4.1

- Login por **username e palavra-passe**, em substituição do email no formulário.
- **Administração → Utilizadores → Criar utilizador**: criação de contas apenas por administradores ativos, com username, email, palavra-passe e cargo.
- A administração pode consultar e alterar os usernames das contas existentes. Os usernames são únicos e o login não distingue maiúsculas de minúsculas.
- Mantidos UUIDs, passwords, emails, cargos, bloqueios e dados. As contas anteriores recebem um username baseado no perfil existente ou no nome antes do @; caracteres incompatíveis e nomes repetidos são ajustados automaticamente.
- Criação de contas validada no servidor, sem chave administrativa dentro da aplicação. Inscrições diretas fora deste fluxo são recusadas. O serviço público de login não devolve emails e limita tentativas repetidas.
- Mantidas as funcionalidades e o design da v2.4.0.

## Instalação

Usar Verificar atualizações na aplicação ou instalar SpawnVault-Setup-2.4.1.exe. Consultar o username em Administração → Utilizadores; as palavras-passe existentes mantêm-se.

## Supabase

No projeto SpawnVault existente, a migração v2.4.1 e o serviço de contas foram aplicados com autorização do proprietário antes da publicação. Para outras instalações, aplicar supabase/migration_v241.sql após v2.4 e publicar a função spawnvault-accounts com supabase/config.toml. O instalador não executa SQL nem publica funções. A configuração e instruções estão no código-fonte.

## Validação

Testes locais de interface, atualizador, regras PostgreSQL e serviço de contas. Migração aplicada e contagens de dados conferidas no projeto existente. Verificado que pedidos públicos inválidos são recusados e emails não são expostos. Login com credenciais reais, criação administrativa na aplicação e instalação Windows completa aguardam validação do utilizador. Instalador sem assinatura digital.
