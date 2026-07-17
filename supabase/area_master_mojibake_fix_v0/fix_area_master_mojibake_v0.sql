-- =============================================================
-- 指示書: エリアマスタ文字化け修正 v0.1 — ①-b/①-c 修正（原本CSV突合で自動生成）
--   ①-b: area_master_staging の破損セル(43件)を原本値へ個別UPDATE。
--        WHERE は intact列（原本CSVで一意を実証済）＋「対象列がU+FFFDを含む」ガード。
--        → ctid非依存・健全行は絶対に触らない（一致キーが違えば0件更新）。
--   ①-c: area_master の破損行(37件)を「U+FFFDを含む行」で DELETE → area_master_load_v0.sql を再実行。
--   src_town_key の中身をパースした自己修復はしていない（原本CSVの該当列を権威として採用）。
-- 実行: Supabase SQL Editor（postgres）。前提: staging を先に直す→area_master DELETE→load 再実行。
--   ★ 生成時に pglite で「実行後 U+FFFD 0件・値一致・健全行不変」を検証済み。
-- =============================================================

begin;

-- ── ①-b staging の破損セルを原本値へ（43件・intact列WHERE＋U+FFFDガード）──
update public.area_master_staging set area = '鳥取県'
  where prefecture = '鳥取県' and municipality = '智頭町' and town = '口宇波' and common_id = 'CHZ_C_105_105' and src_town_key = '鳥取県|智頭町|口宇波' and area like '%' || chr(65533) || '%';  -- (1164,16)
update public.area_master_staging set depot = '福岡県4'
  where prefecture = '福岡県' and municipality = '筑前町' and town = '石櫃' and common_id = 'CZN_C_61_62' and src_town_key = '福岡県|筑前町|石櫃' and depot like '%' || chr(65533) || '%';  -- (1436,21)
update public.area_master_staging set depot = '宮城県'
  where prefecture = '宮城県' and municipality = '石巻市' and town = '川口町' and common_id = 'ISI_C_143_147' and src_town_key = '宮城県|石巻市|川口町' and depot like '%' || chr(65533) || '%';  -- (339,7)
update public.area_master_staging set depot = '秋田県'
  where prefecture = '秋田県' and municipality = 'にかほ市' and town = '象潟町上小坂' and common_id = 'NKH_C_71_72' and src_town_key = '秋田県|にかほ市|象潟町上小坂' and depot like '%' || chr(65533) || '%';  -- (790,45)
update public.area_master_staging set is_valid = '有効'
  where prefecture = '長崎県' and municipality = '壱岐市' and town = '勝本町本宮仲触' and common_id = 'IKI_C_35_36' and src_town_key = '長崎県|壱岐市|勝本町本宮仲触' and is_valid like '%' || chr(65533) || '%';  -- (1112,40)
update public.area_master_staging set is_valid = '有効'
  where prefecture = '富山県' and municipality = '富山市' and town = '中川原台' and common_id = 'TYM_NW_11_15' and src_town_key = '富山県|富山市|中川原台' and is_valid like '%' || chr(65533) || '%';  -- (1300,26)
update public.area_master_staging set is_valid = '有効'
  where prefecture = '岡山県' and municipality = '岡山市北区' and town = '建部町下神目' and common_id = 'OKN_N_16_20' and src_town_key = '岡山県|岡山市北区|建部町下神目' and is_valid like '%' || chr(65533) || '%';  -- (135,9)
update public.area_master_staging set is_valid = '有効'
  where prefecture = '岡山県' and municipality = '新見市' and town = '千屋花見' and common_id = 'NIM_C_101_102' and src_town_key = '岡山県|新見市|千屋花見' and is_valid like '%' || chr(65533) || '%';  -- (152,7)
update public.area_master_staging set is_valid = '有効'
  where prefecture = '滋賀県' and municipality = '近江八幡市' and town = '本町' and common_id = 'OMH_C_26_30' and src_town_key = '滋賀県|近江八幡市|本町' and is_valid like '%' || chr(65533) || '%';  -- (1621,4)
update public.area_master_staging set is_valid = '有効'
  where prefecture = '石川県' and municipality = '金沢市' and town = '増泉' and common_id = 'KNZ_S_16_20' and src_town_key = '石川県|金沢市|増泉' and is_valid like '%' || chr(65533) || '%';  -- (909,33)
update public.area_master_staging set municipality = '塩尻市'
  where prefecture = '長野県' and town = '広丘郷原' and common_id = 'SOJ_C_22_26' and src_town_key = '長野県|塩尻市|広丘郷原' and municipality like '%' || chr(65533) || '%';  -- (1129,47)
update public.area_master_staging set municipality = '朝日町'
  where prefecture = '富山県' and town = '大家庄' and common_id = 'ASA_C_70_70' and src_town_key = '富山県|朝日町|大家庄' and municipality like '%' || chr(65533) || '%';  -- (1351,44)
update public.area_master_staging set municipality = '豊前市'
  where prefecture = '福岡県' and town = '中村' and common_id = 'BZN_C_32_33' and src_town_key = '福岡県|豊前市|中村' and municipality like '%' || chr(65533) || '%';  -- (1453,26)
update public.area_master_staging set municipality = '熊本市東区'
  where prefecture = '熊本県' and town = '八反田' and common_id = 'KCE_C_13_16' and src_town_key = '熊本県|熊本市東区|八反田' and municipality like '%' || chr(65533) || '%';  -- (517,47)
update public.area_master_staging set municipality = '周南市'
  where prefecture = '山口県' and town = '川端町' and common_id = 'SUN_C_21_25' and src_town_key = '山口県|周南市|川端町' and municipality like '%' || chr(65533) || '%';  -- (706,13)
update public.area_master_staging set prefecture = '岐阜県'
  where municipality = '土岐市' and town = '肥田浅野梅ノ木町' and common_id = 'TOK_C_09_12' and src_town_key = '岐阜県|土岐市|肥田浅野梅ノ木町' and prefecture like '%' || chr(65533) || '%';  -- (271,40)
update public.area_master_staging set prefecture = '京都府'
  where municipality = '京都市伏見区' and town = '醍醐東大路町' and common_id = 'KYOF_E_01' and src_town_key = '京都府|京都市伏見区|醍醐東大路町' and prefecture like '%' || chr(65533) || '%';  -- (373,11)
update public.area_master_staging set prefecture = '京都府'
  where municipality = '京都市右京区' and town = '龍安寺山田町' and chome = '全域' and common_id = 'KY3_UKY_101_115' and src_town_key = '京都府|京都市右京区|龍安寺山田町' and prefecture like '%' || chr(65533) || '%';  -- (502,3)
update public.area_master_staging set src_town_key = '千葉県|東庄町|今郡'
  where prefecture = '千葉県' and municipality = '東庄町' and town = '今郡' and common_id = 'THN_C_59_59' and src_town_key like '%' || chr(65533) || '%';  -- (1012,15)
update public.area_master_staging set src_town_key = '大阪府|堺市堺区|築港八幡町'
  where prefecture = '大阪府' and municipality = '堺市堺区' and town = '築港八幡町' and common_id = 'SKS_S_06_10' and src_town_key like '%' || chr(65533) || '%';  -- (1045,22)
update public.area_master_staging set src_town_key = '大分県|国東市|伊達郡国見町伊美'
  where prefecture = '大分県' and municipality = '国東市' and town = '伊達郡国見町伊美' and common_id = 'KNS_C_12_13' and src_town_key like '%' || chr(65533) || '%';  -- (1079,8)
update public.area_master_staging set src_town_key = '東京都|調布市|佐須町'
  where prefecture = '東京都' and municipality = '調布市' and town = '佐須町' and common_id = 'TK8_03_03' and src_town_key like '%' || chr(65533) || '%';  -- (1215,46)
update public.area_master_staging set src_town_key = '富山県|黒部市|中野道'
  where prefecture = '富山県' and municipality = '黒部市' and town = '中野道' and common_id = 'KRB_C_65_67' and src_town_key like '%' || chr(65533) || '%';  -- (1334,30)
update public.area_master_staging set src_town_key = '福井県|越前市|蓑脇町'
  where prefecture = '福井県' and municipality = '越前市' and town = '蓑脇町' and common_id = 'ECZ_C_23_27' and src_town_key like '%' || chr(65533) || '%';  -- (1368,40)
update public.area_master_staging set src_town_key = '福島県|伊達市|保原町東小蓋'
  where prefecture = '福島県' and municipality = '伊達市' and town = '保原町東小蓋' and common_id = 'DTE_C_25_28' and src_town_key like '%' || chr(65533) || '%';  -- (1470,30)
update public.area_master_staging set src_town_key = '兵庫県|神戸市灘区|大石東町'
  where prefecture = '兵庫県' and municipality = '神戸市灘区' and town = '大石東町' and common_id = 'KOBE1_NADA_E_01' and src_town_key like '%' || chr(65533) || '%';  -- (1554,9)
update public.area_master_staging set src_town_key = '兵庫県|明石市|朝霧町'
  where prefecture = '兵庫県' and municipality = '明石市' and town = '朝霧町' and common_id = 'HY4_04' and src_town_key like '%' || chr(65533) || '%';  -- (1570,27)
update public.area_master_staging set src_town_key = '岐阜県|岐阜市|芥見大退'
  where prefecture = '岐阜県' and municipality = '岐阜市' and town = '芥見大退' and common_id = 'GIF_E_16_20' and src_town_key like '%' || chr(65533) || '%';  -- (237,30)
update public.area_master_staging set src_town_key = '宮城県|大崎市|鳴子温泉境松'
  where prefecture = '宮城県' and municipality = '大崎市' and town = '鳴子温泉境松' and common_id = 'OOS_W_124_127' and src_town_key like '%' || chr(65533) || '%';  -- (322,23)
update public.area_master_staging set src_town_key = '京都府|京都市西京区|桂御所町'
  where prefecture = '京都府' and municipality = '京都市西京区' and town = '桂御所町' and common_id = 'KY2_NSK_008' and src_town_key like '%' || chr(65533) || '%';  -- (421,28)
update public.area_master_staging set src_town_key = '京都府|京都市中京区|三坊西洞院町'
  where prefecture = '京都府' and municipality = '京都市中京区' and town = '三坊西洞院町' and common_id = 'KY3_10_10' and src_town_key like '%' || chr(65533) || '%';  -- (486,11)
update public.area_master_staging set src_town_key = '群馬県|前橋市|大渡町'
  where prefecture = '群馬県' and municipality = '前橋市' and town = '大渡町' and common_id = 'GM1_01_01' and src_town_key like '%' || chr(65533) || '%';  -- (551,50)
update public.area_master_staging set src_town_key = '愛媛県|四国中央市|三島宮川'
  where prefecture = '愛媛県' and municipality = '四国中央市' and town = '三島宮川' and common_id = 'SKC_C_01_05' and src_town_key like '%' || chr(65533) || '%';  -- (66,23)
update public.area_master_staging set src_town_key = '山梨県|韮崎市|大草町上條東割'
  where prefecture = '山梨県' and municipality = '韮崎市' and town = '大草町上條東割' and common_id = 'NRZ_C_04_05' and src_town_key like '%' || chr(65533) || '%';  -- (740,11)
update public.area_master_staging set src_town_key = '秋田県|秋田市|八橋南'
  where prefecture = '秋田県' and municipality = '秋田市' and town = '八橋南' and common_id = 'AKT2_C_01_05' and src_town_key like '%' || chr(65533) || '%';  -- (757,3)
update public.area_master_staging set src_town_key = '秋田県|横手市|大雄乗阿気下'
  where prefecture = '秋田県' and municipality = '横手市' and town = '大雄乗阿気下' and common_id = 'YKT_C_46_51' and src_town_key like '%' || chr(65533) || '%';  -- (774,6)
update public.area_master_staging set src_town_key = '新潟県|新潟市秋葉区|出戸'
  where prefecture = '新潟県' and municipality = '新潟市秋葉区' and town = '出戸' and common_id = 'NGA_C_33_37' and src_town_key like '%' || chr(65533) || '%';  -- (807,34)
update public.area_master_staging set src_town_key = '愛媛県|伊予市|双海町大久保'
  where prefecture = '愛媛県' and municipality = '伊予市' and town = '双海町大久保' and common_id = 'IYO_C_69_71' and src_town_key like '%' || chr(65533) || '%';  -- (83,34)
update public.area_master_staging set town = '城見ＭＩＤタワー（３５階）'
  where prefecture = '大阪府' and municipality = '大阪市中央区' and common_id = 'OSC_C_25_31' and src_town_key = '大阪府|大阪市中央区|城見ＭＩＤタワー（３５階）' and town like '%' || chr(65533) || '%';  -- (1028,24)
update public.area_master_staging set town = '平畑'
  where prefecture = '茨城県' and municipality = '龍ケ崎市' and common_id = 'RGS_C_01_05' and src_town_key = '茨城県|龍ケ崎市|平畑' and town like '%' || chr(65533) || '%';  -- (118,5)
update public.area_master_staging set town = '清水'
  where prefecture = '福島県' and municipality = '田村郡三春町' and common_id = 'MHR_C_63_64' and src_town_key = '福島県|田村郡三春町|清水' and town like '%' || chr(65533) || '%';  -- (1487,26)
update public.area_master_staging set town = '稲穂町'
  where prefecture = '愛知県' and municipality = '半田市' and common_id = 'HND_C_23_30' and src_town_key = '愛知県|半田市|稲穂町' and town like '%' || chr(65533) || '%';  -- (17,17)
update public.area_master_staging set town = '北波多大杉'
  where prefecture = '佐賀県' and municipality = '唐津市' and common_id = 'KAR_E_23_26' and src_town_key = '佐賀県|唐津市|北波多大杉' and town like '%' || chr(65533) || '%';  -- (603,15)

-- 検証: staging に U+FFFD が残っていない（0 が期待）
select count(*) as staging_fffd_rows
from public.area_master_staging s
where s.prefecture like '%' || chr(65533) || '%' or s.municipality like '%' || chr(65533) || '%' or s.town like '%' || chr(65533) || '%'
   or s.chome like '%' || chr(65533) || '%' or s.zone_no like '%' || chr(65533) || '%' or s.common_id like '%' || chr(65533) || '%'
   or s.is_valid like '%' || chr(65533) || '%' or s.priority like '%' || chr(65533) || '%' or s.area like '%' || chr(65533) || '%'
   or s.depot like '%' || chr(65533) || '%' or s.src_town_key like '%' || chr(65533) || '%' or s.postal_code like '%' || chr(65533) || '%';
-- 0 を確認したら commit、想定外なら rollback;
commit;

-- ── ①-c area_master の破損行を DELETE（U+FFFDを含む行＝37件。ctid非依存・自己ガード）──
delete from public.area_master a
where a.town_key like '%' || chr(65533) || '%' or a.prefecture like '%' || chr(65533) || '%' or a.municipality like '%' || chr(65533) || '%'
   or a.town like '%' || chr(65533) || '%' or a.chome like '%' || chr(65533) || '%' or a.common_id like '%' || chr(65533) || '%'
   or a.area like '%' || chr(65533) || '%' or a.depot like '%' || chr(65533) || '%' or a.source_town_key like '%' || chr(65533) || '%'
   or a.postal_code like '%' || chr(65533) || '%';
-- 期待: 37行 DELETE。

-- ── ①-c 続き: area_master を「直した staging」から作り直す ──
--   ★ ここで supabase/area_master_v0/area_master_load_v0.sql を実行（A dry-run → B 本実行）。
--     town_key は load が normalize_addr で正しく再生成する。is_valid を直した6行もここで復活する。

-- ── ①-d 検証: detect_mojibake_v0.sql を再実行して area_master/staging とも U+FFFD 0件。
