-- PadalaSplit initial schema (CONTRACT.md v1.2, Backend A).
-- Access is server-only via the service-role key; the browser never talks to
-- the database directly (no NEXT_PUBLIC_SUPABASE_* anywhere).

create table if not exists users (
  wallet_address text primary key, -- G... Stellar address; identity is the wallet
  created_at     timestamptz not null default now()
);

create table if not exists transfers (
  transfer_id    text primary key,              -- 'tr_' || app-generated UUID
  template_id    text not null,
  asset          text not null default 'USDC',
  deployment_id  text not null,                 -- server-only, never returned by the API
  wallet_address text not null references users(wallet_address),
  amount         text not null,                 -- total in stroops (integer string)
  mock           boolean not null default false,
  prep           jsonb not null,                -- {unsignedXdr, txHash, networkPassphrase,
                                                --  network, expiresAt, prepRequestId, preparedAt}
  submitted      jsonb,                         -- {signedXdr, txHash, submittedAt, resultStatus}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- P2 history route (skipped for now) will use the wallet index.
create index if not exists transfers_wallet_idx
  on transfers (wallet_address, created_at desc);
