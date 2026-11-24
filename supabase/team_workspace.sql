-- AI TeamWork shared workspace migration (safe add-on; does not alter the old tasks/messages tables)
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default 'Thành viên',
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- Add display fields when upgrading from the earlier workspace draft.
alter table public.workspace_members add column if not exists email text not null default '';
alter table public.workspace_members add column if not exists display_name text not null default 'Thành viên';
update public.workspace_members wm
set email = coalesce(u.email, ''),
    display_name = coalesce(nullif(u.raw_user_meta_data->>'full_name',''), nullif(split_part(coalesce(u.email,''),'@',1),''), 'Thành viên')
from auth.users u where u.id = wm.user_id;

create table if not exists public.team_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 180),
  description text not null default '',
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  attachment_path text,
  attachment_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.team_tasks add column if not exists attachment_path text;
alter table public.team_tasks add column if not exists attachment_name text;

create table if not exists public.team_meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 180),
  starts_at timestamptz not null,
  room_name text not null unique,
  notes text not null default '',
  transcript text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sender_name text not null default 'Thành viên',
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_members_user on public.workspace_members(user_id);
create index if not exists idx_team_tasks_workspace_created on public.team_tasks(workspace_id, created_at desc);
create index if not exists idx_team_tasks_assignee on public.team_tasks(assigned_to);
create index if not exists idx_team_meetings_workspace_date on public.team_meetings(workspace_id, starts_at);
create index if not exists idx_team_messages_workspace_date on public.team_messages(workspace_id, created_at desc);
create index if not exists idx_workspace_notifications_user_date on public.workspace_notifications(user_id, created_at desc);

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = auth.uid()
  );
$$;

create or replace function public.add_workspace_owner()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
declare
  v_email text;
  v_name text;
begin
  select u.email, coalesce(nullif(u.raw_user_meta_data->>'full_name',''), split_part(coalesce(u.email,''),'@',1), 'Trưởng nhóm')
    into v_email, v_name from auth.users u where u.id = new.owner_id;
  insert into public.workspace_members(workspace_id, user_id, email, display_name, role)
  values(new.id, new.owner_id, coalesce(v_email,''), coalesce(v_name,'Trưởng nhóm'), 'owner')
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_add_workspace_owner on public.workspaces;
create trigger trg_add_workspace_owner after insert on public.workspaces
for each row execute function public.add_workspace_owner();

create or replace function public.join_workspace_by_code(p_invite_code text)
returns uuid language plpgsql security definer set search_path = public, auth
as $$
declare
  v_workspace public.workspaces%rowtype;
  v_email text;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Bạn cần đăng nhập trước.'; end if;
  select * into v_workspace from public.workspaces where invite_code = upper(trim(p_invite_code));
  if not found then raise exception 'Mã tham gia không hợp lệ.'; end if;
  select u.email, coalesce(nullif(u.raw_user_meta_data->>'full_name',''), split_part(coalesce(u.email,''),'@',1), 'Thành viên')
    into v_email, v_name from auth.users u where u.id = auth.uid();
  insert into public.workspace_members(workspace_id, user_id, email, display_name, role)
  values(v_workspace.id, auth.uid(), coalesce(v_email,''), coalesce(v_name,'Thành viên'), 'member')
  on conflict (workspace_id, user_id) do nothing;
  return v_workspace.id;
end;
$$;
revoke all on function public.join_workspace_by_code(text) from public;
grant execute on function public.join_workspace_by_code(text) to authenticated;

create or replace function public.set_team_task_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_team_tasks_updated_at on public.team_tasks;
create trigger trg_team_tasks_updated_at before update on public.team_tasks
for each row execute function public.set_team_task_updated_at();

create or replace function public.notify_task_assignee()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.assigned_to is not null and new.assigned_to <> coalesce(auth.uid(), new.created_by) then
    insert into public.workspace_notifications(workspace_id, user_id, message)
    values(new.workspace_id, new.assigned_to, 'Bạn được giao công việc: ' || new.title);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_task_assignee on public.team_tasks;
create trigger trg_notify_task_assignee after insert or update of assigned_to on public.team_tasks
for each row execute function public.notify_task_assignee();

create or replace function public.notify_new_team_meeting()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.workspace_notifications(workspace_id, user_id, message)
  select new.workspace_id, wm.user_id, 'Cuộc họp mới: ' || new.title
  from public.workspace_members wm
  where wm.workspace_id = new.workspace_id and wm.user_id <> new.created_by;
  return new;
end;
$$;
drop trigger if exists trg_notify_new_team_meeting on public.team_meetings;
create trigger trg_notify_new_team_meeting after insert on public.team_meetings
for each row execute function public.notify_new_team_meeting();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.team_tasks enable row level security;
alter table public.team_meetings enable row level security;
alter table public.team_messages enable row level security;
alter table public.workspace_notifications enable row level security;

-- Reset only the policies owned by this migration so it can be safely run again.
drop policy if exists workspace_read_members on public.workspaces;
drop policy if exists workspace_create_owner on public.workspaces;
drop policy if exists workspace_update_owner on public.workspaces;
drop policy if exists workspace_delete_owner on public.workspaces;
create policy workspace_read_members on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy workspace_create_owner on public.workspaces for insert to authenticated with check (owner_id = auth.uid());
create policy workspace_update_owner on public.workspaces for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy workspace_delete_owner on public.workspaces for delete to authenticated using (owner_id = auth.uid());

drop policy if exists members_read_workspace on public.workspace_members;
drop policy if exists members_delete_self_or_owner on public.workspace_members;
drop policy if exists members_update_owner on public.workspace_members;
drop policy if exists "members read memberships" on public.workspace_members;
drop policy if exists "users join workspace" on public.workspace_members;
drop policy if exists "users leave workspace" on public.workspace_members;
create policy members_read_workspace on public.workspace_members for select to authenticated using (user_id = auth.uid() or public.is_workspace_member(workspace_id));
create policy members_delete_self_or_owner on public.workspace_members for delete to authenticated using (user_id = auth.uid() or public.is_workspace_owner(workspace_id));
create policy members_update_owner on public.workspace_members for update to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id) and role in ('admin','member'));

-- Team data is visible only to authenticated members of the same workspace.
drop policy if exists team_tasks_member_all on public.team_tasks;
create policy team_tasks_member_all on public.team_tasks for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists team_meetings_member_all on public.team_meetings;
create policy team_meetings_member_all on public.team_meetings for all to authenticated
using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists team_messages_member_read on public.team_messages;
drop policy if exists team_messages_member_insert on public.team_messages;
drop policy if exists team_messages_author_delete on public.team_messages;
create policy team_messages_member_read on public.team_messages for select to authenticated using (public.is_workspace_member(workspace_id));
create policy team_messages_member_insert on public.team_messages for insert to authenticated with check (public.is_workspace_member(workspace_id) and sender_id = auth.uid());
create policy team_messages_author_delete on public.team_messages for delete to authenticated using (sender_id = auth.uid());

drop policy if exists notifications_read_own on public.workspace_notifications;
drop policy if exists notifications_update_own on public.workspace_notifications;
drop policy if exists "users read own workspace notifications" on public.workspace_notifications;
drop policy if exists "members create workspace notifications" on public.workspace_notifications;
drop policy if exists "users update own workspace notifications" on public.workspace_notifications;
create policy notifications_read_own on public.workspace_notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.workspace_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private task-attachment bucket. Paths are: workspace_id/user_id/filename.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-teamwork-files', 'ai-teamwork-files', false, 10485760, array['image/png','image/jpeg','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = 10485760;
drop policy if exists teamwork_files_read on storage.objects;
drop policy if exists teamwork_files_upload on storage.objects;
drop policy if exists teamwork_files_delete on storage.objects;
create policy teamwork_files_read on storage.objects for select to authenticated
using (bucket_id = 'ai-teamwork-files' and public.is_workspace_member(((storage.foldername(name))[1])::uuid));
create policy teamwork_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'ai-teamwork-files' and public.is_workspace_member(((storage.foldername(name))[1])::uuid) and (storage.foldername(name))[2] = auth.uid()::text);
create policy teamwork_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'ai-teamwork-files' and (storage.foldername(name))[2] = auth.uid()::text and public.is_workspace_member(((storage.foldername(name))[1])::uuid));

-- Enable Realtime for shared changes if the publication exists.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['team_messages','team_tasks','team_meetings','workspace_notifications'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
exception when insufficient_privilege then null; end $$;
