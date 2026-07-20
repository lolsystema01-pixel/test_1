-- =============================================================
-- 指示書: エリアマスタ／共通ID語彙の是正 → address_master 撤去 v0.1
--   ④ 依存3関数を area_master 参照へ書換
--
-- 対象: zone_rank(text,text) ／ dispatch_build(date) ／ delivery_status_public(text)
--   市名lookupの
--     select am.municipality from public.address_master am where am.common_id = X limit 1
--   を
--     select am.municipality from public.area_master am
--      where am.common_id = X and am.is_valid
--      order by am.priority asc nulls last, am.town_key limit 1
--   に置換する。**変更はこの lookup 部分のみ**。他のロジック（隣接判定・分割閾値・
--   配分ループ・返却キー）は一切変えない。
--
-- 性質: create or replace のみ（データ無変更）。冪等。**可逆**＝問題があれば
--       dispatch_v0/dispatch_v0.sql（zone_rank・dispatch_build）と
--       ai_status_reply_v0/delivery_status_rpc_v0.sql（delivery_status_public）を
--       再実行すれば元に戻る（address_master は⑤まで残っているため完全に復元できる）。
-- 実行: Supabase SQL Editor（postgres）で本ファイルを丸ごと Run。
--
-- 【固定の前提】新基盤(Supabase+SvelteKit+Cloud Run)・検証環境のみ・本番/現行GASは触らない・
--   全テーブルRLS・秘密情報は環境変数・SQLは人手でコピペ実行（渡す前に pglite で E2E 検証）。
--
-- 【is_valid ＋ 決定的 order by が必須の理由（指示書④⚠・実測）】
--   common_id が複数自治体にまたがる実データが3件ある（2026-07-17 ゲート seq 9）:
--     GM2_07_07（安中市・藤岡市）／HY4_12（加古川市・加古郡播磨町）／
--     KY3_NAK_186_195（京都市上京区・中京区）。
--   order by 無しの limit 1 は非決定＝同じ問合番号で市名が揺れる。
--   priority asc nulls last → town_key で常に同じ1件に決める。
--
-- 【転記について（重要）】
--   create or replace は関数本体を丸ごと書き直すため、変更しない部分も**原本から完全転記**
--   している。転記の正確さは pglite テスト（pglite_test_migrate_functions.mjs）が
--   「原本 prosrc ＋想定置換 == 移行後 prosrc」の文字単位照合で機械検証済み。
--   原本: dispatch_v0/dispatch_v0.sql:104-123（zone_rank）・127-294（dispatch_build）／
--         ai_status_reply_v0/delivery_status_rpc_v0.sql:14-35（delivery_status_public）。
--   3関数とも定義場所はこの2ファイルのみ（他モジュールによる再定義なし・2026-07-17 全文検索で確認）。
--
-- 【⚠ 関数本体（$$〜$$）内に旧テーブル名を書かないこと】
--   監査ゲート（audit §1-1／recheck seq 3）は pg_proc.prosrc の全文検索。
--   本体内にコメントとしてでも旧名を残すと、参照が消えたのに ✗ が出続ける。
--   ④の解説はすべて本体の外（このヘッダと各節コメント）に置いてある。
--
-- 【性能】area_master.common_id には idx_area_master_common が既存
--   （area_master_v0/area_master_schema_v0.sql:47）。lookup は index scan＋
--   common_id あたり最大 ~100行のソートで、dispatch の実機性能への影響は軽微の見込み。
--   実機確認（下記 §5）で体感を確認する。
-- =============================================================


-- =============================================================
-- §0. 安全ガード: ③完了（旧語彙0件）を実行のたびに機械で確かめる
--   旧語彙の荷物が残ったまま書き換えると、その荷物の市名lookupが NULL を返し、
--   「エラー無しで市名欠落・同一市判定不成立」という静かな劣化になる（指示書B.）。
-- =============================================================
do $$
declare v_old int; v_new int;
begin
  select count(*) into v_old
  from public.deliveries d
  where d.common_id is not null
    and not exists (select 1 from public.area_master am
                     where am.common_id = d.common_id and am.is_valid);
  if v_old > 0 then
    raise exception
      '中断: deliveries に旧語彙（area_master 有効行に無い common_id）が % 件残っています。'
      '③（purge_old_vocab_deliveries_v0.sql）を先に完了し、'
      'recheck_vocab_gates_v0.sql の seq 6 = 0 を確認してから④を実行してください。', v_old;
  end if;

  select count(*) into v_new
  from public.area_master where is_valid and common_id is not null;
  if v_new = 0 then
    raise exception
      '中断: area_master に有効行がありません。書き換えると全 lookup が NULL になります。'
      'area_master の取込（area_master_v0）を先に確認してください。';
  end if;
end $$;


-- =============================================================
-- §1. zone_rank — 隣接ランク（1=同一ゾーン / 2=同一市 / 3=隣接 / 99=対象外）
--   原本: dispatch_v0.sql:104-123。変更＝市名lookup 2箇所のみ。
--   隣接判定（rank3）は従来どおり zone_plan.adjacent_zones（②で新語彙分は NULL＝
--   新語彙同士の rank3 は発火しない。決定事項C・隣接再構築は別タスク）。
-- =============================================================
create or replace function public.zone_rank(a text, b text)
returns integer language sql stable as $$
  select case
    when a = b then 1
    when (select am.municipality from public.area_master am
           where am.common_id = a and am.is_valid
           order by am.priority asc nulls last, am.town_key limit 1)
       = (select am.municipality from public.area_master am
           where am.common_id = b and am.is_valid
           order by am.priority asc nulls last, am.town_key limit 1)
      then 2
    when b = any (
        select trim(x) from unnest(
          string_to_array(coalesce((select zp.adjacent_zones from public.zone_plan zp where zp.common_id = a), ''), ',')
        ) as x )
      then 3
    when a = any (
        select trim(x) from unnest(
          string_to_array(coalesce((select zp.adjacent_zones from public.zone_plan zp where zp.common_id = b), ''), ',')
        ) as x )
      then 3
    else 99
  end;
$$;


-- =============================================================
-- §2. dispatch_build — 配車計算本体
--   原本: dispatch_v0.sql:127-294。変更＝(2)の市名lookup 1箇所のみ。
--   (1)(3)(4)(5) は原本の完全転記（1文字も変えていない）。
-- =============================================================
create or replace function public.dispatch_build(p_date date)
returns void language plpgsql as $$
declare
  v_office text;
  v_driver record;
  v_grp    record;
  v_main   text;
  v_adj    text;
  v_remaining integer;
  v_take   integer;
  v_vnum   integer := 0;
  v_vid    text;
begin
  -- 当日分の作業テーブルをリセット（冪等）
  delete from public.dispatch_assignments where run_date = p_date;
  delete from public.dispatch_zones       where run_date = p_date;
  delete from public.dispatch_drivers     where run_date = p_date;

  -- (1) 実ドライバーを動的構築：cap＝スキル×稼働時間。承認済み稼働予定のみ。
  insert into public.dispatch_drivers (run_date, office_code, driver_id, driver_kind, skill, hours, cap, assigned_qty)
  select p_date, d.office_code, d.driver_id, '実',
         d.skill_per_hour, sh.hours, (d.skill_per_hour * sh.hours)::int, 0
  from public.work_schedules ws
  join public.drivers     d  on d.driver_id  = ws.driver_id
  join public.shift_hours sh on sh.work_type = ws.work_type
  where ws.work_date = p_date
    and ws.application_status = '承認';

  -- (2) ゾーン候補：共通ID別荷量＋分割（閾値・1.8倍・2.6倍・以降ceil）
  --     ※対象は「当日(delivery_date=p_date)の未配車」のみ。別日の在庫は対象外。
  insert into public.dispatch_zones (run_date, office_code, common_id, municipality, qty, threshold, split_count)
  select p_date, dv.office_code, dv.common_id,
         (select am.municipality from public.area_master am
           where am.common_id = dv.common_id and am.is_valid
           order by am.priority asc nulls last, am.town_key limit 1),
         count(*)::int,
         coalesce(zp.split_threshold, 170),
         case
           when count(*) <= coalesce(zp.split_threshold,170)         then 1
           when count(*) <= 1.8 * coalesce(zp.split_threshold,170)   then 2
           when count(*) <= 2.6 * coalesce(zp.split_threshold,170)   then 3
           else ceil(count(*)::numeric / coalesce(zp.split_threshold,170))::int
         end
  from public.deliveries dv
  left join public.zone_plan zp on zp.common_id = dv.common_id
  where dv.status = '未配車' and dv.common_id is not null and dv.delivery_date = p_date
  group by dv.office_code, dv.common_id, zp.split_threshold;

  -- (3) 処理能力優先で配分：営業所ごと、cap の大きい実ドライバーから
  for v_office in
    select distinct office_code from public.dispatch_drivers where run_date = p_date and driver_kind = '実'
  loop
    for v_driver in
      select * from public.dispatch_drivers
      where run_date = p_date and office_code = v_office and driver_kind = '実'
      order by cap desc, driver_id
    loop
      v_remaining := v_driver.cap;

      -- Phase1: 主担当ゾーン＝残荷量が最大のゾーンを1本
      select z.common_id into v_main
      from public.dispatch_zones z
      where z.run_date = p_date and z.office_code = v_office
        and ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
                                where a.run_date = p_date and a.common_id = z.common_id), 0) ) > 0
      order by ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
                                   where a.run_date = p_date and a.common_id = z.common_id), 0) ) desc,
               z.common_id
      limit 1;

      if v_main is null then
        continue;  -- このドライバーに割り当てる荷物が無い
      end if;

      with picked as (
        select d.tracking_number
        from public.deliveries d
        where d.status = '未配車' and d.delivery_date = p_date and d.office_code = v_office and d.common_id = v_main
          and not exists (select 1 from public.dispatch_assignments a
                          where a.run_date = p_date and a.tracking_number = d.tracking_number)
        order by d.tracking_number
        limit v_remaining
      )
      insert into public.dispatch_assignments (run_date, tracking_number, office_code, common_id, driver_id, driver_kind, assign_rank)
      select p_date, p.tracking_number, v_office, v_main, v_driver.driver_id, '実', 1 from picked p;
      get diagnostics v_take = row_count;
      v_remaining := v_remaining - v_take;

      -- Phase2: 主担当に対し隣接ランク≤3のゾーンを積み増し（cap充填）
      loop
        exit when v_remaining <= 0;

        select z.common_id into v_adj
        from public.dispatch_zones z
        where z.run_date = p_date and z.office_code = v_office
          and public.zone_rank(v_main, z.common_id) <= 3
          and ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
                                  where a.run_date = p_date and a.common_id = z.common_id), 0) ) > 0
        order by public.zone_rank(v_main, z.common_id),
                 ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
                                     where a.run_date = p_date and a.common_id = z.common_id), 0) ) desc,
                 z.common_id
        limit 1;

        exit when v_adj is null;

        with picked as (
          select d.tracking_number
          from public.deliveries d
          where d.status = '未配車' and d.delivery_date = p_date and d.office_code = v_office and d.common_id = v_adj
            and not exists (select 1 from public.dispatch_assignments a
                            where a.run_date = p_date and a.tracking_number = d.tracking_number)
          order by d.tracking_number
          limit v_remaining
        )
        insert into public.dispatch_assignments (run_date, tracking_number, office_code, common_id, driver_id, driver_kind, assign_rank)
        select p_date, p.tracking_number, v_office, v_adj, v_driver.driver_id, '実',
               public.zone_rank(v_main, v_adj) from picked p;
        get diagnostics v_take = row_count;
        exit when v_take = 0;          -- 念のため無限ループ防止
        v_remaining := v_remaining - v_take;
      end loop;
    end loop;
  end loop;

  -- (4) 仮ドライバー：残った未配車を 営業所×共通ID でまとめ、推奨枠200個で区切る
  for v_grp in
    select d.office_code, d.common_id
    from public.deliveries d
    where d.status = '未配車' and d.common_id is not null and d.delivery_date = p_date
      and not exists (select 1 from public.dispatch_assignments a
                      where a.run_date = p_date and a.tracking_number = d.tracking_number)
    group by d.office_code, d.common_id
    order by d.office_code, d.common_id
  loop
    loop
      select count(*) into v_take
      from public.deliveries d
      where d.status = '未配車' and d.delivery_date = p_date and d.office_code = v_grp.office_code and d.common_id = v_grp.common_id
        and not exists (select 1 from public.dispatch_assignments a
                        where a.run_date = p_date and a.tracking_number = d.tracking_number);
      exit when v_take = 0;

      v_vnum := v_vnum + 1;
      v_vid  := '仮' || v_vnum;

      insert into public.dispatch_drivers (run_date, office_code, driver_id, driver_kind, skill, hours, cap, assigned_qty)
      values (p_date, v_grp.office_code, v_vid, '仮', null, null, 200, 0);

      with picked as (
        select d.tracking_number
        from public.deliveries d
        where d.status = '未配車' and d.delivery_date = p_date and d.office_code = v_grp.office_code and d.common_id = v_grp.common_id
          and not exists (select 1 from public.dispatch_assignments a
                          where a.run_date = p_date and a.tracking_number = d.tracking_number)
        order by d.tracking_number
        limit 200
      )
      insert into public.dispatch_assignments (run_date, tracking_number, office_code, common_id, driver_id, driver_kind, assign_rank)
      select p_date, p.tracking_number, v_grp.office_code, v_grp.common_id, v_vid, '仮', 1 from picked p;
    end loop;
  end loop;

  -- (5) 割当個数を集計して記録
  update public.dispatch_drivers dd
  set assigned_qty = coalesce((select count(*) from public.dispatch_assignments a
                               where a.run_date = p_date and a.driver_id = dd.driver_id), 0)
  where dd.run_date = p_date;
end;
$$;


-- =============================================================
-- §3. delivery_status_public — 公開ステータス（anon・SECURITY DEFINER）
--   原本: delivery_status_rpc_v0.sql:14-35。変更＝市名lookup 1箇所のみ。
--   ⚠ 属性（stable / security definer / set search_path = public）を必ず再指定する。
--     create or replace で書き漏らすと属性が既定に戻り、definer が消えると
--     anon から RLS 越しに荷物が見えなくなる（＝受付UI・AI応答が静かに壊れる）。
-- =============================================================
create or replace function public.delivery_status_public(p_tracking_number text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tracking_number', d.tracking_number,
    'status',          d.status,             -- 6.10: 未配車/配車済/仕分済/配送中/完了/不在
    'delivery_date',   d.delivery_date,      -- 配達予定日
    'time_window',     d.time_window,        -- 時間帯
    'delivery_order',  d.delivery_order,     -- 配達順（おおよその順番）
    'municipality',    (select am.municipality          -- 市レベルのみ（詳細住所は返さない）
                          from public.area_master am
                          where am.common_id = d.common_id and am.is_valid
                          order by am.priority asc nulls last, am.town_key
                          limit 1)
  )
  from public.deliveries d
  where d.tracking_number = p_tracking_number
  limit 1
$$;

-- 実行権限を再表明（replace では権限は保持されるが、単独実行にも耐えるよう明示）。
revoke execute on function public.delivery_status_public(text) from public;
grant  execute on function public.delivery_status_public(text) to anon, authenticated;


-- =============================================================
-- §4. 検証（1画面・judge付き）
-- =============================================================
with
resolved as (   -- 各共通IDが「決定的に」解決する市名（④と同じ order by）
  select distinct on (am.common_id) am.common_id, am.municipality
  from public.area_master am
  where am.is_valid and am.common_id is not null
  order by am.common_id, am.priority asc nulls last, am.town_key
),
same_city_pair as (   -- 同一市に解決する異なる共通IDのペア（rank2 の実地確認用）
  select a.common_id as ca, b.common_id as cb
  from resolved a join resolved b
    on a.municipality = b.municipality and a.common_id < b.common_id
  where a.municipality is not null
  limit 1
),
any_id as (select common_id from resolved limit 1),
sample_dlv as (   -- 実在する荷物1件（公開ステータスの実地確認用）
  select tracking_number from public.deliveries
  where common_id is not null
  order by tracking_number limit 1
),
refcount as (
  select count(*)::int as n
  from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
  where ns.nspname not in ('pg_catalog','information_schema')
    and pr.prosrc ilike '%address_master%'
),
attrs as (
  select pr.prosecdef, pr.provolatile::text as provolatile,
         coalesce(array_to_string(pr.proconfig, ','), '') as config
  from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
  where ns.nspname = 'public' and pr.proname = 'delivery_status_public'
)
select seq, item, actual, judge from (
  select 1 as seq, '旧マスタを参照する関数（audit §1-1 と同式）' as item,
         (select n::text from refcount) as actual,
         case when (select n from refcount) = 0
              then '✅ 0件＝⑤の前提（参照なし）成立'
              else '✗ まだ参照が残っている（本ファイルの適用漏れ？）' end as judge
  union all
  select 2, 'zone_rank(同一ID)＝1',
         (select public.zone_rank(common_id, common_id)::text from any_id),
         case when (select public.zone_rank(common_id, common_id) from any_id) = 1
              then '✅' else '✗' end
  union all
  select 3, 'zone_rank(同一市の異なるID)＝2（新語彙で同一市判定が復活）',
         coalesce((select public.zone_rank(ca, cb)::text from same_city_pair), '(対象ペアなし)'),
         case when (select public.zone_rank(ca, cb) from same_city_pair) = 2 then '✅'
              when (select count(*) from same_city_pair) = 0 then '⚠ 対象なし（データ確認）'
              else '✗' end
  union all
  select 4, 'delivery_status_public が市名を返す（実在荷物1件）',
         coalesce((select (public.delivery_status_public(tracking_number)->>'municipality')
                   from sample_dlv), '(荷物なし)'),
         case when (select public.delivery_status_public(tracking_number)->>'municipality'
                    from sample_dlv) is not null then '✅ 市名が取れる'
              when (select count(*) from sample_dlv) = 0 then '⚠ 荷物なし'
              else '✗ NULL（lookup失敗）' end
  union all
  select 5, 'delivery_status_public の属性維持（definer/stable/search_path）',
         (select prosecdef::text || ' / ' || provolatile || ' / ' || config from attrs),
         case when (select prosecdef and provolatile = 's'
                          and config like '%search_path=public%' from attrs)
              then '✅ 維持' else '✗ 属性が落ちた（§3を確認）' end
  union all
  select 6, 'anon が delivery_status_public を実行できる',
         has_function_privilege('anon', 'public.delivery_status_public(text)', 'execute')::text,
         case when has_function_privilege('anon', 'public.delivery_status_public(text)', 'execute')
              then '✅' else '✗ grant が落ちた' end
) t order by seq;

-- 【読み方】
--   seq 1 = 0 ✅ … recheck_vocab_gates_v0.sql の seq 3 が「⏸」→「✅ ⑤drop可」に変わる。
--   seq 3 = 2 ✅ … 旧実装では新語彙の市名が引けず 99 だった判定が、④で復活した証拠。
--   seq 4     … anon 実経路の確認は §5 の実機確認で（ここは postgres での関数疎通）。

-- =============================================================
-- §5. 実機確認（【人】・指示書④の合格条件）
--   0) まず対象日を現物で確認する（日付をハードコードしない。
--      ※ /demo README の 2026-06-29 は当時の日付で、実データの delivery_date とは異なる）:
--        select delivery_date,
--               count(*) filter (where status = '未配車' and common_id is not null) as dispatchable
--        from public.deliveries group by delivery_date order by delivery_date;
--   1) 配車:
--      ・dispatchable > 0 の日付があれば（リセット不要・deliveries 無変更）:
--          select public.dispatch_build(date '<その日付>');
--      ・全日付 dispatchable = 0 なら、データのある日付で /demo →「リセット」→「④ 配車開始」
--        （demo_reset は配車・採番前に戻すだけ。②の common_id/zone_no は残る）。
--      裏取り（0 が合格）:
--        select count(*) as zones,
--               count(*) filter (where municipality is null) as muni_null
--        from public.dispatch_zones where run_date = date '<その日付>';
--      ※ dispatch_build はその日付の作業テーブルを作り直すだけ（冪等・deliveries 非破壊）。
--   2) 公開ステータス: 受付UI または curl（anonキー）で delivery_status_public を
--      実在の問合番号で呼び、municipality に市名が入ること・氏名/詳細住所が無いことを確認。
--   3) recheck_vocab_gates_v0.sql を再実行し、seq 3 が「✅ ⑤drop可」であること。
-- =============================================================
