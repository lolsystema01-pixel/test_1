-- =============================================================
-- 手順 3/4: 2営業所分（A・B）のダミーデータ投入
-- 実行: SQL Editor に貼り付けて Run（rls_policy.sql の後）
-- =============================================================
-- 何度実行しても重複しないよう、対象データを一旦消してから入れる。
-- ※ この SQL Editor は管理者権限（RLS無視）で動くため、削除・投入が可能。

delete from public.deliveries where office_id in ('A', 'B');

insert into public.deliveries (office_id, title, status) values
  ('A', '営業所A 案件001', 'pending'),
  ('A', '営業所A 案件002', 'done'),
  ('A', '営業所A 案件003', 'pending'),
  ('B', '営業所B 案件001', 'pending'),
  ('B', '営業所B 案件002', 'done');

-- 投入結果: 営業所A = 3件 / 営業所B = 2件（合計5件）
-- ※ 件数を A≠B にしているのは、見える件数の違いを分かりやすくするため。

-- 確認（管理者権限なので全件＝5件見えるはず）
select office_id, count(*) as cnt
from public.deliveries
group by office_id
order by office_id;
