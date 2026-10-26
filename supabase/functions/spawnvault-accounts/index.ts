import { createAccountHandler } from '../_shared/accounts.mjs';

Deno.serve(createAccountHandler({
 url: Deno.env.get('SUPABASE_URL'),
 serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
 publicKey: Deno.env.get('SUPABASE_ANON_KEY'),
 fetch: globalThis.fetch,
 crypto: globalThis.crypto,
}));
