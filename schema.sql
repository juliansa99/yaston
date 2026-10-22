-- ============================================================
-- YASTON · Base de datos (Supabase / Postgres)
-- Pegá TODO esto en Supabase > SQL Editor > New query > Run
-- ============================================================

-- 0) ADMINS: los mails que pueden cargar jugadores, partidos y resultados.
--    ⚠️ Cambiá el mail por el tuyo (el de Gmail con el que vas a entrar).
create table if not exists public.admins (email text primary key);
insert into public.admins (email) values ('TU_MAIL@gmail.com') on conflict do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 1) TABLAS
create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  photo_url  text,
  guest      boolean not null default false,   -- true = invitado de un solo partido (sin foto, no figura en el Plantel)
  created_at timestamptz not null default now()
);

-- Los mails van aparte para que NO los vea cualquiera (solo el admin)
create table if not exists public.player_emails (
  player_id uuid primary key references public.players(id) on delete cascade,
  email     text not null
);
create unique index if not exists player_emails_email_uq on public.player_emails (lower(email));

create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  played_on   date not null,
  result      text check (result in ('A','B','D')),  -- A gana, B gana, D empate, null = todavía sin resultado
  voting_open boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.match_players (
  match_id  uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team      text not null check (team in ('A','B')),
  primary key (match_id, player_id)
);

create table if not exists public.votes (
  match_id   uuid not null references public.matches(id) on delete cascade,
  voter_id   uuid not null references public.players(id) on delete cascade,
  voted_for  uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, voter_id),
  check (voter_id <> voted_for)
);

-- Si sacás a alguien de un partido, se borran los votos que lo involucran
create or replace function public.clean_votes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.votes
  where match_id = old.match_id and (voter_id = old.player_id or voted_for = old.player_id);
  return old;
end $$;
drop trigger if exists trg_clean_votes on public.match_players;
create trigger trg_clean_votes after delete on public.match_players
  for each row execute function public.clean_votes();

-- ¿Qué jugador soy yo? (el que tiene cargado mi mail de Google)
create or replace function public.my_player_id() returns uuid
language sql stable security definer set search_path = public as $$
  select player_id from public.player_emails
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

-- 2) SEGURIDAD (RLS): cualquiera puede VER (sin registrarse); solo el admin escribe; para votar hay que entrar con Google
alter table public.admins        enable row level security;
alter table public.players       enable row level security;
alter table public.player_emails enable row level security;
alter table public.matches       enable row level security;
alter table public.match_players enable row level security;
alter table public.votes         enable row level security;

drop policy if exists admins_admin on public.admins;
create policy admins_admin on public.admins for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists emails_admin on public.player_emails;
create policy emails_admin on public.player_emails for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists players_read on public.players;
create policy players_read on public.players for select to anon, authenticated using (true);
drop policy if exists players_admin on public.players;
create policy players_admin on public.players for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select to anon, authenticated using (true);
drop policy if exists matches_admin on public.matches;
create policy matches_admin on public.matches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists mp_read on public.match_players;
create policy mp_read on public.match_players for select to anon, authenticated using (true);
drop policy if exists mp_admin on public.match_players;
create policy mp_admin on public.match_players for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Votos: cada uno ve solo el suyo (el voto es secreto). Se vota con cast_vote().
drop policy if exists votes_own on public.votes;
create policy votes_own on public.votes for select to authenticated
  using (voter_id = public.my_player_id());

-- 3) FUNCIONES
-- Votar (o cambiar el voto mientras la votación esté abierta)
create or replace function public.cast_vote(p_match uuid, p_for uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_player_id();
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  if me is null then raise exception 'Tu mail no está vinculado a ningún jugador. Pedile al admin que lo cargue.'; end if;
  if not exists (select 1 from public.matches where id = p_match and voting_open) then
    raise exception 'La votación de este partido está cerrada';
  end if;
  if not exists (select 1 from public.match_players where match_id = p_match and player_id = me) then
    raise exception 'Solo votan quienes jugaron el partido';
  end if;
  if not exists (select 1 from public.match_players where match_id = p_match and player_id = p_for) then
    raise exception 'Ese jugador no jugó el partido';
  end if;
  if p_for = me then raise exception 'No podés votarte a vos mismo'; end if;
  insert into public.votes (match_id, voter_id, voted_for) values (p_match, me, p_for)
  on conflict (match_id, voter_id) do update set voted_for = excluded.voted_for, created_at = now();
end $$;

-- Resultado de la votación: solo de partidos con votación cerrada
create or replace function public.mvp_counts()
returns table (match_id uuid, player_id uuid, votes int)
language sql stable security definer set search_path = public as $$
  select v.match_id, v.voted_for, count(*)::int
  from public.votes v join public.matches m on m.id = v.match_id
  where not m.voting_open
  group by v.match_id, v.voted_for;
$$;

-- Cuántos votaron en cada partido (sin decir por quién)
create or replace function public.vote_totals()
returns table (match_id uuid, total int)
language sql stable security definer set search_path = public as $$
  select match_id, count(*)::int from public.votes group by match_id;
$$;

revoke all on function public.clean_votes() from public, anon, authenticated;
revoke all on function public.mvp_counts(), public.vote_totals(), public.cast_vote(uuid, uuid), public.my_player_id(), public.is_admin() from public, anon;
grant execute on function public.mvp_counts(), public.vote_totals(), public.cast_vote(uuid, uuid), public.my_player_id(), public.is_admin() to authenticated;
grant execute on function public.mvp_counts(), public.vote_totals() to anon;  -- ver resultados no requiere login

-- Elegir "quién soy": el usuario logueado se vincula a un jugador que todavía no tenga mail
create or replace function public.unclaimed_players() returns setof uuid
language sql stable security definer set search_path = public as $fn$
  select p.id from public.players p
  where not p.guest and not exists (select 1 from public.player_emails e where e.player_id = p.id);
$fn$;

create or replace function public.claim_player(p_player uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or mail = '' then raise exception 'Tenés que iniciar sesión'; end if;
  if public.my_player_id() is not null then raise exception 'Tu cuenta ya está vinculada a un jugador'; end if;
  if not exists (select 1 from public.players where id = p_player) then raise exception 'Ese jugador no existe'; end if;
  if exists (select 1 from public.player_emails where player_id = p_player) then
    raise exception 'Ese jugador ya fue elegido por otra persona. Avisale al admin.';
  end if;
  insert into public.player_emails (player_id, email) values (p_player, mail);
end
$fn$;

revoke all on function public.unclaimed_players(), public.claim_player(uuid) from public, anon;
grant execute on function public.unclaimed_players(), public.claim_player(uuid) to authenticated;

-- 4) FOTOS (Storage)
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true) on conflict (id) do nothing;

drop policy if exists fotos_insert on storage.objects;
create policy fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.is_admin());
drop policy if exists fotos_select on storage.objects;
create policy fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.is_admin());
drop policy if exists fotos_update on storage.objects;
create policy fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.is_admin());
drop policy if exists fotos_delete on storage.objects;
create policy fotos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.is_admin());

-- 5) JUEGOS: un juego por semana, hasta 3 intentos por cuenta de Google, y tabla semanal
create table if not exists public.game_plays (
  id          uuid primary key default gen_random_uuid(),
  game        text not null,
  week        date not null,                         -- lunes de la semana (hora de Buenos Aires)
  user_id     uuid not null default auth.uid(),
  player_id   uuid not null references public.players(id) on delete cascade,
  goals       int check (goals between 0 and 5),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.game_plays enable row level security;
drop policy if exists plays_own on public.game_plays;
create policy plays_own on public.game_plays for select to authenticated using (user_id = auth.uid());

create or replace function public.current_week() returns date
language sql stable set search_path = public as $fn$
  select (date_trunc('week', now() at time zone 'America/Argentina/Buenos_Aires'))::date
$fn$;

create or replace function public.start_play(p_game text) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := public.my_player_id();
  wk date := public.current_week();
  n int;
  pid uuid;
begin
  if auth.uid() is null then raise exception 'Tenés que entrar con Google para jugar'; end if;
  if me is null then raise exception 'Primero elegí quién sos (pestaña Plantel)'; end if;
  select count(*) into n from public.game_plays where user_id = auth.uid() and game = p_game and week = wk;
  if n >= 3 then raise exception 'Ya usaste tus 3 intentos de esta semana'; end if;
  insert into public.game_plays (game, week, user_id, player_id) values (p_game, wk, auth.uid(), me) returning id into pid;
  return pid;
end
$fn$;

create or replace function public.finish_play(p_play uuid, p_goals int) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update public.game_plays
     set goals = greatest(0, least(5, p_goals)), finished_at = now()
   where id = p_play and user_id = auth.uid() and goals is null;
  if not found then raise exception 'Ese intento no es válido o ya terminó'; end if;
end
$fn$;

create or replace function public.game_board(p_game text)
returns table (player_id uuid, best int, total int, tries int)
language sql stable security definer set search_path = public as $fn$
  select g.player_id, max(coalesce(g.goals, 0))::int, sum(coalesce(g.goals, 0))::int, count(*)::int
  from public.game_plays g
  where g.game = p_game and g.week = public.current_week()
  group by g.player_id
$fn$;

revoke all on function public.current_week(), public.game_board(text), public.start_play(text), public.finish_play(uuid, int) from public, anon;
grant execute on function public.current_week(), public.game_board(text) to anon, authenticated;
grant execute on function public.start_play(text), public.finish_play(uuid, int) to authenticated;
