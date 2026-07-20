-- =============================================================
-- 指示書: エリアマスタ／共通ID語彙の是正 → address_master 撤去 v0.1
--   ⑤ address_master を drop（＋案a: 旧 zone_plan 行の掃除）
--
-- 性質: DROP / DELETE を含む（破壊的・不可逆）。冪等（対象が無ければ何もしない）。
-- 実行: Supabase SQL Editor（postgres）で本ファイルを丸ごと Run。
--       ※ §0 のガードを全て通らないと以降は実行されない（トランザクション外なので
--          raise exception 時点で停止＝それ以前の §0 は読むだけなので副作用なし）。
--
-- 【固定の前提】新基盤(Supabase+SvelteKit+Cloud Run)・検証環境のみ・本番/現行GASは触らない・
--   全テーブルRLS・秘密情報は環境変数・SQLは人手でコピペ実行（渡す前に pglite で E2E 検証）。
--
-- 【⚠ この操作が危険な理由（指示書B.・監査の結論）】
--   PostgreSQL は関数本体のテーブル参照を pg_depend に記録しない。
--   → 参照が残っていても drop table は【エラー無しで成功】し、次の配車実行・顧客照会で
--     初めて落ちる（時限爆弾）。
--   → だから §0 で pg_proc.prosrc の全文検索により参照0件を機械確認してから落とす。
--     ここを飛ばしてはいけない。
--
-- 【指示書からの差分＝案a（業務A承認済み 2026-07-17）】
--   指示書⑤の前提は「§2〜§4 の語彙ゲート全合格」だが、§3（ゲート seq 7・8）は
--   決定事項C「zone_plan の旧語彙行は削除しない（追加のみ）」により構造的に 0 にできない。
--   一方、決定事項Cの理由は
--     「address_master.common_id → zone_plan.common_id の FK があり、drop 前に消すと孤児になる」
--   ＝**FK がある間の時限つき制約**であり、本ファイルの §2 で FK ごと消える。
--   → 案a: ⑤で drop した【後】に旧 zone_plan 行を掃除する（§3）。
--      ⑤の前提からは §3 を外し、掃除後の確認項目（§5 の seq 7・8 = 0）に格上げする。
--   理由: 「赤いまま放置され皆が無視するゲート」はゲートが無いより有害。掃除して正直に緑にすれば
--         以後の ✗ は全て本物の signal になる。消す旧行は master_zoneplan_v0/load_master_v0.sql:30-41
--         にハードコードされた愛知ダミー由来＝再実行で完全復元可能（情報の損失なし）。
--
-- 【残すもの】
--   ・zoneplan_staging … dispatch_v0.sql:33-36 が分割閾値の読込で参照する（指示書⚠のとおり残す）。
--   ・zone_plan の新語彙行（②で入れた1,653件）。
--
-- 【本ファイルの範囲外】
--   ソースファイルの retire 表明（create_schema_v0 / rls_v0 / master_zoneplan_v0 /
--   address_match_v0 / unregistered_address_v0 の記述整合）と docs 更新は別途（文書作業）。
-- =============================================================


-- =============================================================
-- §0. 安全ガード（★ここが本体。全て読むだけ）
-- =============================================================
do $$
declare
  v_fn int; v_view int; v_old int; v_fk_zp int; v_orphan int;
  v_fn_list text;
begin
  -- (1) ★最重要: address_master を本文で参照する関数が0件か（pg_depend では検知不能）
  select count(*), coalesce(string_agg(pr.proname, ' / ' order by pr.proname), '')
    into v_fn, v_fn_list
  from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
  where ns.nspname not in ('pg_catalog','information_schema')
    and pr.prosrc ilike '%address_master%';
  if v_fn > 0 then
    raise exception
      '中断: address_master を参照する関数が % 件残っています（%）。'
      'このまま drop すると【エラー無しで成功し】次の配車実行・顧客照会で落ちます（時限爆弾）。'
      '④（migrate_functions_to_area_master_v0.sql）を先に完了し、'
      'recheck_vocab_gates_v0.sql の seq 3 =「✅ ⑤drop可」を確認してください。', v_fn, v_fn_list;
  end if;

  -- (2) ビュー/マテビューからの参照が0件か
  select count(*) into v_view from (
    select viewname as o from pg_views
     where definition ilike '%address_master%' and schemaname not in ('pg_catalog','information_schema')
    union all
    select matviewname from pg_matviews where definition ilike '%address_master%'
  ) t;
  if v_view > 0 then
    raise exception '中断: address_master を参照するビュー/マテビューが % 件あります。', v_view;
  end if;

  -- (3) ③完了＝旧語彙の荷物が0件か（掃除後に解決不能な荷物を作らないため）
  select count(*) into v_old
  from public.deliveries d
  where d.common_id is not null
    and not exists (select 1 from public.area_master am
                     where am.common_id = d.common_id and am.is_valid);
  if v_old > 0 then
    raise exception
      '中断: deliveries に旧語彙が % 件残っています。③を先に完了してください'
      '（recheck の seq 6 = 0）。', v_old;
  end if;

  -- (4) 案a の前提: 掃除対象の旧 zone_plan 行を参照する荷物が居ないこと
  select count(*) into v_orphan
  from public.deliveries d
  join public.zone_plan zp on zp.common_id = d.common_id
  where not exists (select 1 from public.area_master am
                     where am.common_id = zp.common_id and am.is_valid);
  if v_orphan > 0 then
    raise exception
      '中断: 掃除対象の旧 zone_plan 行を参照する荷物が % 件あります（§3 で消すと参照先を失う）。', v_orphan;
  end if;

  -- (5) 案a の前提: zone_plan を参照する FK が address_master 以外に無いこと
  --   ※ 'public.address_master'::regclass と書くと、drop 済み（＝再実行時）に
  --     キャスト自体が落ちる。to_regclass（無ければ NULL）＋ is distinct from で冪等にする。
  select count(*) into v_fk_zp
  from pg_constraint c
  where c.confrelid = 'public.zone_plan'::regclass and c.contype = 'f'
    and c.conrelid is distinct from to_regclass('public.address_master');
  if v_fk_zp > 0 then
    raise exception
      '中断: zone_plan を参照する FK が address_master 以外に % 件あります。'
      '§3 の掃除が FK違反になるため、対象を再検討してください。', v_fk_zp;
  end if;

  raise notice 'ガード通過: 参照関数0 / ビュー0 / 旧語彙0 / 孤児化0 / 他FK0 → drop に進みます';
end $$;


-- =============================================================
-- §1. drop 前の状態（記録用・Messages ペインに出る）
--   ※ 素の select で public.address_master を参照すると、drop 済み（＝再実行時）に
--     パース時点で落ちる。動的SQLにして冪等にする。
-- =============================================================
do $$
declare v_am text; v_zp int; v_old int; v_pol int;
begin
  if to_regclass('public.address_master') is null then
    v_am := '(既に drop 済み)';
  else
    execute 'select count(*)::text from public.address_master' into v_am;
  end if;

  select count(*) into v_zp from public.zone_plan;
  select count(*) into v_old from public.zone_plan zp
   where not exists (select 1 from public.area_master am
                      where am.common_id = zp.common_id and am.is_valid);
  select count(*) into v_pol from pg_policies
   where schemaname = 'public' and tablename = 'address_master';

  raise notice 'before: address_master=% 行 / zone_plan=% 行（うち旧語彙=% 行が §3 の掃除対象）/ policy=%',
    v_am, v_zp, v_old, v_pol;
end $$;


-- =============================================================
-- §2. address_master を drop
--   policy address_master_hq（rls_v0.sql:142）・GRANT・comment・index は
--   テーブルと共に自動削除される。
--   cascade は使わない：想定外の依存があれば【エラーで止まる】方が安全
--   （§0(5) で zone_plan 側の FK は確認済み。address_master 自身が持つ
--     common_id → zone_plan の FK は「外向き」なので drop の妨げにならない）。
-- =============================================================
drop table if exists public.address_master;


-- =============================================================
-- §3. 【案a】旧 zone_plan 行の掃除
--   §2 で FK が消えたので、ここで初めて安全に削除できる（決定事項Cの制約が期限切れ）。
--   対象＝area_master(有効) に無い common_id の行（＝ゲート seq 7 が数えている行そのもの）。
--   §0(4) で「これらを参照する荷物が0件」を確認済み。
-- =============================================================
delete from public.zone_plan zp
where not exists (select 1 from public.area_master am
                   where am.common_id = zp.common_id and am.is_valid);


-- =============================================================
-- §3-2.【案a】生き残った行の「宙ぶらりんの隣接定義」を外す
--   §3 で旧語彙行を消しても、**新旧に共通する共通ID**（実測 overlap=1・OKZ_W_13_18）は
--   新語彙なので残る。ところがその adjacent_zones は旧語彙を指したままで、
--   参照先の行は §3 で消えている＝宙ぶらりん。
--   ・決定事項C「新語彙分の adjacent_zones は NULL」との一貫性も欠く（この行だけ旧語彙の隣接を持つ）。
--   ・ゲート seq 8 もこの行のせいで 0 にならない。
--   → 解決できない隣接IDだけを外す（**解決できるIDは残す**外科的処理）。全部消えたら NULL。
--   ※ zone_rank の rank3 は adjacent_zones の文字列一致で判定するため、
--     存在しないIDが残っていても発火はしない（＝実害はない）が、
--     「赤いまま放置され皆が無視するゲート」を作らないために掃除する。
-- =============================================================
update public.zone_plan zp
set adjacent_zones = nullif(
      (select string_agg(trim(adj), ',' order by trim(adj))
         from unnest(string_to_array(zp.adjacent_zones, ',')) as adj
        where trim(adj) <> ''
          and exists (select 1 from public.area_master am
                       where am.common_id = trim(adj) and am.is_valid)), '')
where zp.adjacent_zones is not null
  and exists (
    select 1 from unnest(string_to_array(zp.adjacent_zones, ',')) as adj
     where trim(adj) <> ''
       and not exists (select 1 from public.area_master am
                        where am.common_id = trim(adj) and am.is_valid));


-- =============================================================
-- §4. master_staging の drop（指示書「drop候補」・任意）
--   旧マスタ専用のCSV取込バッファ（master_zoneplan_v0/create_master_v0.sql:40）。
--   address_master が無くなれば用途が無い。
--   ⚠ zoneplan_staging は残す（dispatch_v0.sql:33-36 が分割閾値の読込で参照）。
--   ※ 参照している関数が無いことを確認してから落とす（address_master と同じ理由）。
--   不要なら §4 全体をコメントアウトして実行してよい（⑤の合格条件には含まれない）。
-- =============================================================
do $$
declare v_fn int;
begin
  if to_regclass('public.master_staging') is null then
    raise notice 'master_staging は存在しません（スキップ）';
    return;
  end if;

  select count(*) into v_fn
  from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
  where ns.nspname not in ('pg_catalog','information_schema')
    and pr.prosrc ilike '%master_staging%'
    and pr.prosrc not ilike '%area_master_staging%';   -- 別テーブルの誤検出を除く
  if v_fn > 0 then
    raise notice 'master_staging を参照する関数が % 件あるため drop しません（要調査）', v_fn;
    return;
  end if;

  drop table public.master_staging;
  raise notice 'master_staging を drop しました';
end $$;


-- =============================================================
-- §5. 検証（⑤の合格条件＋案aの確認項目）
-- =============================================================
with
refcount as (
  select count(*)::int as n
  from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
  where ns.nspname not in ('pg_catalog','information_schema')
    and pr.prosrc ilike '%address_master%'
),
sample_dlv as (
  select tracking_number from public.deliveries
  where common_id is not null order by tracking_number limit 1
),
pair as (
  select a.common_id as ca, b.common_id as cb from (
    select distinct on (common_id) common_id, municipality from public.area_master
    where is_valid and common_id is not null and municipality is not null
    order by common_id, priority asc nulls last, town_key
  ) a join (
    select distinct on (common_id) common_id, municipality from public.area_master
    where is_valid and common_id is not null and municipality is not null
    order by common_id, priority asc nulls last, town_key
  ) b on a.municipality = b.municipality and a.common_id < b.common_id
  limit 1
)
select seq, item, expected, actual, judge from (
  select 1 as seq, 'address_master が存在しない' as item, '無し' as expected,
         coalesce(to_regclass('public.address_master')::text, '(無し)') as actual,
         case when to_regclass('public.address_master') is null then '✅ drop 完了'
              else '✗ 残っている' end as judge
  union all
  select 2, 'address_master の policy が消えた（テーブルと共に自動削除）', '0',
         (select count(*)::text from pg_policies
           where schemaname='public' and tablename='address_master'),
         case when (select count(*) from pg_policies
                     where schemaname='public' and tablename='address_master') = 0
              then '✅' else '✗' end
  union all
  select 3, '【案a】旧 zone_plan 行の掃除（ゲート seq 7 と同式）', '0',
         (select count(*)::text from public.zone_plan zp
           where not exists (select 1 from public.area_master am
                              where am.common_id = zp.common_id and am.is_valid)),
         case when (select count(*) from public.zone_plan zp
                     where not exists (select 1 from public.area_master am
                                        where am.common_id = zp.common_id and am.is_valid)) = 0
              then '✅ seq 7 が 0 になる' else '✗' end
  union all
  select 4, '【案a】隣接の未知ID（ゲート seq 8 と同式）', '0',
         (select count(distinct trim(adj))::text
            from public.zone_plan zp,
                 unnest(string_to_array(coalesce(zp.adjacent_zones,''), ',')) as adj
           where trim(adj) <> ''
             and not exists (select 1 from public.area_master am
                              where am.common_id = trim(adj) and am.is_valid)),
         case when (select count(distinct trim(adj))
                      from public.zone_plan zp,
                           unnest(string_to_array(coalesce(zp.adjacent_zones,''), ',')) as adj
                     where trim(adj) <> ''
                       and not exists (select 1 from public.area_master am
                                        where am.common_id = trim(adj) and am.is_valid)) = 0
              then '✅ seq 8 も 0 になる' else '✗' end
  union all
  select 5, '新語彙の zone_plan 行は残っている', '1653',
         (select count(*)::text from public.zone_plan),
         case when (select count(*) from public.zone_plan)
                 = (select count(distinct common_id) from public.area_master
                     where is_valid and common_id is not null)
              then '✅ 新語彙のみ' else '⚠ 件数が新語彙と一致しない' end
  union all
  select 6, '★時限爆弾が無いこと: 荷物が解決不能になっていない', '0',
         (select count(*)::text from public.deliveries d
           where d.common_id is not null
             and not exists (select 1 from public.zone_plan zp
                              where zp.common_id = d.common_id)),
         case when (select count(*) from public.deliveries d
                     where d.common_id is not null
                       and not exists (select 1 from public.zone_plan zp
                                        where zp.common_id = d.common_id)) = 0
              then '✅' else '✗ 掃除で参照先を失った荷物がある' end
  union all
  select 7, '★drop 後も delivery_status_public が動く（anon公開API）', '市名が返る',
         coalesce((select public.delivery_status_public(tracking_number)->>'municipality'
                   from sample_dlv), '(荷物なし)'),
         case when (select public.delivery_status_public(tracking_number)->>'municipality'
                    from sample_dlv) is not null then '✅ 落ちていない'
              when (select count(*) from sample_dlv) = 0 then '⚠ 荷物なし'
              else '✗ NULL' end
  union all
  select 8, '★drop 後も zone_rank が動く（同一市判定＝2）', '2',
         coalesce((select public.zone_rank(ca, cb)::text from pair), '(ペアなし)'),
         case when (select public.zone_rank(ca, cb) from pair) = 2 then '✅ 落ちていない'
              when (select count(*) from pair) = 0 then '⚠ ペアなし'
              else '✗' end
  union all
  select 9, 'zoneplan_staging は残っている（dispatch_v0 が参照）', '有り',
         coalesce(to_regclass('public.zoneplan_staging')::text, '(無し)'),
         case when to_regclass('public.zoneplan_staging') is not null then '✅ 残存'
              else '✗ 消してはいけない表が消えた' end
  union all
  select 10, '旧マスタ参照関数（audit §1-1）', '0',
         (select n::text from refcount),
         case when (select n from refcount) = 0 then '✅' else '✗' end
) t order by seq;

-- 【読み方】
--   ・seq 7・8 が ✅ … drop 後も 3関数が動く＝**時限爆弾が無かった**ことの実証。
--     ここが ✗ なら④の適用漏れ（ただし drop 済みなので復旧は area_master 側で対応）。
--   ・seq 3・4 が ✅ … 案aの掃除完了。recheck_vocab_gates_v0.sql の seq 7・8 も 0 になり、
--     ゲートが**全て緑**になる（以後の ✗ は本物の signal）。
--   ・seq 6 が ✅ … 掃除で参照先を失った荷物が無い。
--
-- 【次のステップ】
--   1) recheck_vocab_gates_v0.sql を再実行 → seq 3・6・7・8 が全て ✅ / seq 9 は ⚠（本物の複数自治体・想定内）
--   2) 実機確認: 配車（dispatchable > 0 の日付で dispatch_build → muni_null = 0）／
--      受付UI・AI応答の照会が実行時エラーにならないこと
--   3) ソースファイルの retire 表明と docs 更新（範囲外・別途）
-- =============================================================
