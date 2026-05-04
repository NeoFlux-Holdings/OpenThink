create table if not exists users (
  id text primary key,
  email text,
  auth_source text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists deployments (
  id text primary key,
  user_id text not null,
  flow text not null check (flow in ('self', 'stripe', 'button', 'agent', 'partner')),
  starter_template text not null check (starter_template = 'personal-agent'),
  status text not null check (status in ('provisioning', 'deploying', 'ready', 'failed')),
  agent_url text not null,
  resource_plan_json text not null default '{}',
  created_at text not null,
  updated_at text not null,
  foreign key (user_id) references users(id)
);

create index if not exists deployments_user_created_idx
  on deployments(user_id, created_at desc);

create table if not exists deployment_authorizations (
  deployment_id text primary key,
  user_id text not null,
  cloudflare_account_id text not null,
  token_fingerprint text,
  spend_limit_usd integer not null,
  terms_accepted_at text not null,
  tenant_kind text not null check (tenant_kind in ('self', 'partner')),
  agent_name text not null,
  created_at text not null,
  updated_at text not null,
  foreign key (deployment_id) references deployments(id),
  foreign key (user_id) references users(id)
);

create index if not exists deployment_authorizations_user_idx
  on deployment_authorizations(user_id, created_at desc);

create table if not exists deployment_events (
  id text primary key,
  deployment_id text not null,
  stage text not null,
  status text not null,
  progress integer not null,
  label text not null,
  detail text not null,
  created_at text not null,
  foreign key (deployment_id) references deployments(id)
);

create table if not exists agent_configs (
  id text primary key,
  user_id text not null,
  deployment_id text,
  name text not null,
  starter_template text not null,
  model_provider text not null default 'workers-ai',
  model_name text not null default '@cf/meta/llama-3.1-8b-instruct',
  mcp_servers_json text not null default '[]',
  created_at text not null,
  updated_at text not null,
  foreign key (user_id) references users(id),
  foreign key (deployment_id) references deployments(id)
);

create table if not exists audit_logs (
  id text primary key,
  user_id text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata_json text not null default '{}',
  created_at text not null,
  foreign key (user_id) references users(id)
);

create table if not exists terminal_sessions (
  id text primary key,
  user_id text not null,
  deployment_id text,
  container_id text,
  status text not null check (status in ('starting', 'running', 'hibernating', 'stopped', 'failed')),
  transport text not null check (transport in ('websocket-pty', 'cloudflared')),
  cols integer not null default 120,
  rows integer not null default 32,
  created_at text not null,
  updated_at text not null,
  foreign key (user_id) references users(id),
  foreign key (deployment_id) references deployments(id)
);
