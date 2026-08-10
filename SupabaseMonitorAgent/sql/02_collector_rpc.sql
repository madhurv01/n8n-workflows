-- =====================================================================
-- 02_collector_rpc.sql
-- Run this on EVERY MONITORED Supabase project (including the central
-- one, if you also want to monitor it).
--
-- Installs public.mon_collect(): a single SECURITY DEFINER function that
-- performs FULL discovery + metric collection in ONE round trip.
-- This is why the n8n workflow needs only ~11 nodes regardless of how
-- many projects / tables you monitor.
-- =====================================================================

create or replace function public.mon_collect(
  p_schemas          text[]  default array['public'],
  p_max_tables       int     default 200,
  p_exact_count_max  bigint  default 5000000,   -- above this -> estimates only
  p_max_profile_cols int     default 40,        -- max cols profiled per table
  p_max_fk_checks    int     default 60,        -- max orphan checks per run
  p_dup_min_rows     bigint  default 1          -- min rows before dup check
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tables        jsonb := '[]'::jsonb;
  v_fk_checked    int   := 0;
  v_start         timestamptz := clock_timestamp();
  t               record;
  c               record;
  fk              record;
  v_cols          jsonb;
  v_idx           jsonb;
  v_fks           jsonb;
  v_orphans       jsonb;
  v_select        text[];
  v_profile       jsonb;
  v_ts_cols       text[] := '{}';
  v_has_created   boolean;
  v_has_updated   boolean;
  v_exact         boolean;
  v_fingerprint   text;
  v_sql           text;
  v_row           jsonb;
  v_ncols         int;
  v_orphan_cnt    bigint;
  v_err           text;
begin
  for t in
    select n.nspname  as schema_name,
           c2.relname as table_name,
           c2.oid     as reloid,
           coalesce(c2.reltuples,0)::bigint            as est_rows,
           pg_total_relation_size(c2.oid)              as total_bytes,
           pg_relation_size(c2.oid)                    as heap_bytes,
           pg_indexes_size(c2.oid)                     as index_bytes,
           s.n_live_tup, s.n_dead_tup, s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
           s.seq_scan, s.idx_scan, s.last_vacuum, s.last_autovacuum, s.last_analyze,
           s.last_autoanalyze
    from pg_class c2
    join pg_namespace n on n.oid = c2.relnamespace
    left join pg_stat_user_tables s on s.relid = c2.oid
    where c2.relkind in ('r','p')
      and n.nspname = any(p_schemas)
      and has_table_privilege(c2.oid,'SELECT')
    order by pg_total_relation_size(c2.oid) desc
    limit p_max_tables
  loop
    -- ---------------- columns -------------------------------------
    select jsonb_agg(jsonb_build_object(
             'name', a.attname,
             'type', format_type(a.atttypid, a.atttypmod),
             'base_type', tt.typname,
             'ordinal', a.attnum,
             'nullable', not a.attnotnull,
             'has_default', a.atthasdef,
             'is_identity', a.attidentity <> ''
           ) order by a.attnum)
    into v_cols
    from pg_attribute a
    join pg_type tt on tt.oid = a.atttypid
    where a.attrelid = t.reloid and a.attnum > 0 and not a.attisdropped;

    v_cols := coalesce(v_cols,'[]'::jsonb);
    v_fingerprint := md5((select string_agg(x->>'name'||':'||(x->>'type')||':'||(x->>'nullable'), ',' order by (x->>'ordinal')::int)
                          from jsonb_array_elements(v_cols) x));

    -- ---------------- indexes -------------------------------------
    select jsonb_agg(jsonb_build_object(
             'name', ic.relname,
             'definition', pg_get_indexdef(i.indexrelid),
             'is_unique', i.indisunique,
             'is_primary', i.indisprimary,
             'is_valid', i.indisvalid,
             'is_ready', i.indisready,
             'size_bytes', pg_relation_size(i.indexrelid),
             'scans', coalesce(si.idx_scan,0),
             'columns', (select array_agg(att.attname order by k.ord)
                         from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                         join pg_attribute att on att.attrelid = t.reloid and att.attnum = k.attnum)
           ))
    into v_idx
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    left join pg_stat_user_indexes si on si.indexrelid = i.indexrelid
    where i.indrelid = t.reloid;

    -- ---------------- foreign keys --------------------------------
    select jsonb_agg(jsonb_build_object(
             'name', con.conname,
             'columns', (select array_agg(att.attname order by k.ord)
                         from unnest(con.conkey) with ordinality k(attnum,ord)
                         join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum),
             'ref_schema', rn.nspname,
             'ref_table', rc.relname,
             'ref_columns', (select array_agg(att.attname order by k.ord)
                             from unnest(con.confkey) with ordinality k(attnum,ord)
                             join pg_attribute att on att.attrelid = con.confrelid and att.attnum = k.attnum),
             'on_delete', con.confdeltype))
    into v_fks
    from pg_constraint con
    join pg_class rc on rc.oid = con.confrelid
    join pg_namespace rn on rn.oid = rc.relnamespace
    where con.conrelid = t.reloid and con.contype = 'f';

    -- ---------------- build dynamic profiling query ---------------
    v_select := array['count(*)::bigint as row_count'];
    v_ts_cols := '{}';
    v_ncols := 0;
    v_exact := t.est_rows <= p_exact_count_max;

    for c in
      select (x->>'name') as name, (x->>'base_type') as base_type,
             (x->>'ordinal')::int as ordinal, (x->>'nullable')::boolean as nullable
      from jsonb_array_elements(v_cols) x
      order by (x->>'ordinal')::int
    loop
      exit when v_ncols >= p_max_profile_cols;
      v_ncols := v_ncols + 1;

      if c.base_type in ('timestamp','timestamptz','date') then
        v_ts_cols := v_ts_cols || c.name;
        v_select := v_select || format(
          'min(%1$I)::text as tmin_%2$s, max(%1$I)::text as tmax_%2$s,'
          || 'count(*) filter (where %1$I >= now() - interval ''1 minute'')::bigint as w1m_%2$s,'
          || 'count(*) filter (where %1$I >= now() - interval ''1 hour'')::bigint  as w1h_%2$s,'
          || 'count(*) filter (where %1$I >= now() - interval ''24 hours'')::bigint as w24h_%2$s,'
          || 'count(*) filter (where %1$I >= now() - interval ''7 days'')::bigint  as w7d_%2$s,'
          || 'count(*) filter (where %1$I > now() + interval ''1 day'')::bigint    as future_%2$s,'
          || 'count(*) filter (where %1$I < timestamptz ''1980-01-01'')::bigint    as ancient_%2$s',
          c.name, c.ordinal);
      end if;

      if v_exact then
        v_select := v_select || format('(count(*) - count(%1$I))::bigint as nulls_%2$s', c.name, c.ordinal);

        if c.base_type in ('text','varchar','bpchar','citext') then
          v_select := v_select || format(
            'count(*) filter (where %1$I = '''')::bigint as empty_%2$s,'
            || 'count(*) filter (where btrim(%1$I) = '''' and %1$I <> '''')::bigint as blank_%2$s,'
            || 'count(*) filter (where lower(%1$I) in (''null'',''undefined'',''n/a'',''none''))::bigint as sentinel_%2$s',
            c.name, c.ordinal);
        end if;

        if c.base_type in ('text','varchar','uuid','int2','int4','int8','citext')
           and t.est_rows >= p_dup_min_rows then
          v_select := v_select || format('count(distinct %1$I)::bigint as distinct_%2$s', c.name, c.ordinal);
        end if;
      end if;
    end loop;

    -- created_at / updated_at consistency
    v_has_created := exists (select 1 from jsonb_array_elements(v_cols) x
                             where x->>'name' in ('created_at','inserted_at','created_on'));
    v_has_updated := exists (select 1 from jsonb_array_elements(v_cols) x
                             where x->>'name' in ('updated_at','modified_at','updated_on'));
    if v_exact and v_has_created and v_has_updated then
      v_select := v_select || format(
        'count(*) filter (where %I < %I)::bigint as ts_inconsistent',
        (select x->>'name' from jsonb_array_elements(v_cols) x
          where x->>'name' in ('updated_at','modified_at','updated_on') limit 1),
        (select x->>'name' from jsonb_array_elements(v_cols) x
          where x->>'name' in ('created_at','inserted_at','created_on') limit 1));
    end if;

    v_profile := '{}'::jsonb;
    begin
      if v_exact then
        v_sql := format('select to_jsonb(q) from (select %s from %I.%I) q',
                        array_to_string(v_select,', '), t.schema_name, t.table_name);
      else
        -- Huge table: no full scan. Use planner estimate for rows and only
        -- min/max on the first timestamp column (index-friendly).
        v_sql := format('select to_jsonb(q) from (select %s) q',
          case when coalesce(array_length(v_ts_cols,1),0) = 0
               then format('%s::bigint as row_count_estimated', t.est_rows)
               else format('%s::bigint as row_count_estimated, '
                        || '(select min(%2$I)::text from %3$I.%4$I) as tmin_approx, '
                        || '(select max(%2$I)::text from %3$I.%4$I) as tmax_approx',
                        t.est_rows, v_ts_cols[1], t.schema_name, t.table_name)
          end);
      end if;
      execute v_sql into v_row;
      v_profile := coalesce(v_row,'{}'::jsonb);
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_profile := jsonb_build_object('profile_error', v_err);
    end;

    -- ---------------- orphaned records (single-column FKs) --------
    v_orphans := '[]'::jsonb;
    if v_exact then
      for fk in
        select (x->>'name') as name,
               (x->'columns'->>0) as col,
               (x->>'ref_schema') as ref_schema,
               (x->>'ref_table') as ref_table,
               (x->'ref_columns'->>0) as ref_col,
               jsonb_array_length(x->'columns') as ncols
        from jsonb_array_elements(coalesce(v_fks,'[]'::jsonb)) x
      loop
        exit when v_fk_checked >= p_max_fk_checks;
        continue when fk.ncols <> 1;
        v_fk_checked := v_fk_checked + 1;
        begin
          execute format(
            'select count(*)::bigint from %I.%I c where c.%I is not null and not exists '
            || '(select 1 from %I.%I p where p.%I = c.%I)',
            t.schema_name, t.table_name, fk.col,
            fk.ref_schema, fk.ref_table, fk.ref_col, fk.col)
          into v_orphan_cnt;
          if v_orphan_cnt > 0 then
            v_orphans := v_orphans || jsonb_build_object(
              'constraint', fk.name, 'column', fk.col,
              'ref', fk.ref_schema||'.'||fk.ref_table||'.'||fk.ref_col,
              'orphan_count', v_orphan_cnt);
          end if;
        exception when others then null;
        end;
      end loop;
    end if;

    v_tables := v_tables || jsonb_build_object(
      'schema_name', t.schema_name,
      'table_name',  t.table_name,
      'fingerprint', v_fingerprint,
      'exact_profile', v_exact,
      'est_rows',    t.est_rows,
      'total_bytes', t.total_bytes,
      'heap_bytes',  t.heap_bytes,
      'index_bytes', t.index_bytes,
      'stats', jsonb_build_object(
        'n_live_tup', t.n_live_tup, 'n_dead_tup', t.n_dead_tup,
        'n_tup_ins', t.n_tup_ins, 'n_tup_upd', t.n_tup_upd, 'n_tup_del', t.n_tup_del,
        'seq_scan', t.seq_scan, 'idx_scan', t.idx_scan,
        'last_vacuum', coalesce(t.last_vacuum, t.last_autovacuum),
        'last_analyze', coalesce(t.last_analyze, t.last_autoanalyze)),
      'columns', v_cols,
      'indexes', coalesce(v_idx,'[]'::jsonb),
      'foreign_keys', coalesce(v_fks,'[]'::jsonb),
      'orphans', v_orphans,
      'timestamp_columns', to_jsonb(v_ts_cols),
      'profile', v_profile);
  end loop;

  return jsonb_build_object(
    'collected_at', now(),
    'collection_ms', round(extract(epoch from clock_timestamp() - v_start) * 1000),
    'server_version', current_setting('server_version'),
    'database', current_database(),
    'schemas_requested', to_jsonb(p_schemas),
    'schemas_found', (select coalesce(jsonb_agg(distinct nspname),'[]'::jsonb)
                      from pg_namespace where nspname = any(p_schemas)),
    'db_size_bytes', pg_database_size(current_database()),
    'table_count', jsonb_array_length(v_tables),
    'tables', v_tables);
end $$;

revoke all on function public.mon_collect(text[],int,bigint,int,int,bigint) from public, anon, authenticated;
grant execute on function public.mon_collect(text[],int,bigint,int,int,bigint) to service_role;

comment on function public.mon_collect is
  'Single-round-trip database discovery + data-quality profiling for the n8n Supabase Monitor. Called with the service_role key only.';
