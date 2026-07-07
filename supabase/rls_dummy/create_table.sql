-- =============================================================
-- 指示書: ダミーテーブル作成＋RLS動作確認（営業所別アクセス制御）
-- 手順 1/4: テーブル作成
-- 実行: Supabase ダッシュボード → SQL Editor に貼り付けて Run
-- =============================================================
-- ※ 検証専用のダミーテーブルです。本番データとは無関係。
-- ※ 何度実行しても同じ状態になるよう drop から始めます。

drop table if exists public.deliveries cascade;

create table public.deliveries (
  id          bigint generated always as identity primary key,
  office_id   text        not null,                 -- 営業所を示す列（'A' / 'B'）
  title       text        not null,                 -- 案件名（ダミー）
  status      text        not null default 'pending',
  created_at  timestamptz not null default now()
);

comment on table  public.deliveries           is 'RLS検証用ダミー: 営業所別の案件（検証専用・ダミーデータ）';
comment on column public.deliveries.office_id is '営業所コード。RLSでこの値とJWTのoffice_idクレームを突き合わせる';

-- authenticated ロール（=ログインユーザー相当）に閲覧権限を付与する。
-- 行レベルの絞り込みは、この上で RLS ポリシー（手順2）が行う。
grant select on public.deliveries to authenticated;
