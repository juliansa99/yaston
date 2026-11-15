-- Yagui Geo: perfiles, partidas diarias y tabla de posiciones.

create table public.geo_profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.geo_plays (
  user_id uuid not null references public.geo_profiles (id) on delete cascade,
  day date not null,
  rounds jsonb not null,
  total int not null check (total between 0 and 1000),
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.geo_profiles enable row level security;
alter table public.geo_plays enable row level security;

create policy "geo_profiles: lectura publica" on public.geo_profiles
  for select to anon, authenticated using (true);
create policy "geo_profiles: crear el propio" on public.geo_profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "geo_profiles: editar el propio" on public.geo_profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "geo_plays: lectura publica" on public.geo_plays
  for select to anon, authenticated using (true);
-- Una sola partida por dia (clave primaria), solo la propia y solo la del dia de hoy.
-- No hay politicas de update/delete: un puntaje guardado no se puede cambiar.
create policy "geo_plays: guardar la propia de hoy" on public.geo_plays
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and day = (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );

create view public.geo_leaderboard with (security_invoker = on) as
select
  p.id,
  p.name,
  p.avatar_url,
  count(*)::int as days,
  sum(pl.total)::int as total,
  round(avg(pl.total), 1) as average,
  max(pl.total) as best,
  max(pl.total) filter (
    where pl.day = (now() at time zone 'America/Argentina/Buenos_Aires')::date
  ) as today
from public.geo_profiles p
join public.geo_plays pl on pl.user_id = p.id
group by p.id;

grant select on public.geo_leaderboard to anon, authenticated;
