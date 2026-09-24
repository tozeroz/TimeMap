#!/usr/bin/env bash
# E1 AUTH_HYGIENE_AUDIT —— 认证相关表的**状态分布**审计（只读，不清理）
#
# ## 为什么先做这个，而不是先写清理
#
# 审核记录 39 明确反对"用总行数当不变量"：
#   sessions=122 可能是"120 条早已过期的垃圾"，也可能是"122 条仍合法的活跃 session"
#   —— **这两个语义完全不同，总行数不是正确的 invariant**。
# 所以第一步必须是**把状态分布量出来**，然后才能按 schema 已有的语义
# 定义"什么算**确定已经死亡**的数据"。
#
# ## 本脚本只读
# 全部是 select；**不做任何 delete / update**。
#
# ## schema 依据（来自迁移文件，非猜测）
#   sessions(002_identity.sql):
#     id, user_id, token_hash, created_at, expires_at, revoked_at
#     CHECK revoked_at IS NULL OR revoked_at >= created_at
#     CHECK expires_at > created_at
#   login_challenges(005_phone_otp_identity.sql):
#     id, phone_e164, code_hmac, created_at, expires_at, consumed_at, attempts
#     CHECK expires_at > created_at ; CHECK consumed_at IS NULL OR consumed_at >= created_at
set -u
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== E1 AUTH_HYGIENE_AUDIT ==="
echo "时间: $(date -Is)"
echo

echo "########## sessions ##########"
echo "--- 总数 ---"
PSQL "select count(*) from sessions"
echo
echo "--- 状态分布（**互斥分类**，按优先级：revoked 优先于 expired）---"
PSQL "
select 'revoked            = ' || count(*) from sessions where revoked_at is not null
union all
select 'expired(未撤销)    = ' || count(*) from sessions where revoked_at is null and expires_at <= now()
union all
select 'active(未撤销未过期) = ' || count(*) from sessions where revoked_at is null and expires_at > now()
order by 1"
echo
echo "--- 更细的交叉表（revoked × expired）---"
PSQL "
select k || ' = ' || count(*) from (
  select case when revoked_at is null then 'not_revoked' else 'revoked' end
         || ' / ' ||
         case when expires_at <= now() then 'expired' else 'valid' end as k
  from sessions) t
group by k order by k"
echo
echo "--- age 分布（按 created_at 距今天数分桶）---"
PSQL "
select bucket || ' = ' || count(*) from (
  select case
    when now() - created_at < interval '1 hour' then 'a) <1h'
    when now() - created_at < interval '1 day'  then 'b) 1h..1d'
    when now() - created_at < interval '7 days' then 'c) 1d..7d'
    when now() - created_at < interval '30 days' then 'd) 7d..30d'
    else 'e) >=30d' end as bucket
  from sessions) t
group by bucket order by bucket"
echo
echo "--- 过期多久了（仅 expired 行；用于定 retention grace）---"
PSQL "
select bucket || ' = ' || count(*) from (
  select case
    when now() - expires_at < interval '1 hour' then 'a) 过期<1h'
    when now() - expires_at < interval '1 day'  then 'b) 1h..1d'
    when now() - expires_at < interval '7 days' then 'c) 1d..7d'
    else 'd) >=7d' end as bucket
  from sessions where expires_at <= now()) t
group by bucket order by bucket"
echo
echo "--- 会话有效期（expires_at - created_at）分布：确认 TTL 语义 ---"
PSQL "
select bucket || ' = ' || count(*) from (
  select case
    when expires_at - created_at < interval '1 hour' then 'a) <1h'
    when expires_at - created_at < interval '1 day'  then 'b) 1h..1d'
    when expires_at - created_at < interval '7 days' then 'c) 1d..7d'
    else 'd) >=7d' end as bucket
  from sessions) t
group by bucket order by bucket"
echo
echo "--- 每个用户的会话数（看是否有异常集中）---"
PSQL "
select 'sessions_per_user: max=' || max(c) || ' avg=' || round(avg(c),2) || ' users=' || count(*)
from (select user_id, count(*) c from sessions group by user_id) t"

echo
echo "########## login_challenges ##########"
echo "--- 总数 ---"
PSQL "select count(*) from login_challenges"
echo
echo "--- 状态分布（**互斥分类**：consumed 优先于 expired）---"
PSQL "
select 'consumed           = ' || count(*) from login_challenges where consumed_at is not null
union all
select 'expired-pending    = ' || count(*) from login_challenges where consumed_at is null and expires_at <= now()
union all
select 'valid-pending      = ' || count(*) from login_challenges where consumed_at is null and expires_at > now()
order by 1"
echo
echo "--- 更细的交叉表（consumed × expired）---"
PSQL "
select k || ' = ' || count(*) from (
  select case when consumed_at is null then 'not_consumed' else 'consumed' end
         || ' / ' ||
         case when expires_at <= now() then 'expired' else 'valid' end as k
  from login_challenges) t
group by k order by k"
echo
echo "--- age 分布 ---"
PSQL "
select bucket || ' = ' || count(*) from (
  select case
    when now() - created_at < interval '1 hour' then 'a) <1h'
    when now() - created_at < interval '1 day'  then 'b) 1h..1d'
    when now() - created_at < interval '7 days' then 'c) 1d..7d'
    else 'd) >=7d' end as bucket
  from login_challenges) t
group by bucket order by bucket"
echo
echo "--- 挑战有效期（expires_at - created_at）分布：确认 OTP TTL 语义 ---"
PSQL "
select bucket || ' = ' || count(*) from (
  select case
    when expires_at - created_at < interval '1 minute' then 'a) <1min'
    when expires_at - created_at < interval '10 minutes' then 'b) 1..10min'
    else 'c) >=10min' end as bucket
  from login_challenges) t
group by bucket order by bucket"
echo
echo "--- attempts 分布（看是否有暴力尝试堆积）---"
PSQL "
select 'attempts=' || attempts || ' → ' || count(*) from login_challenges group by attempts order by attempts"

echo
echo "########## 清理候选测算（仅统计，不删除）##########"
for GRACE in '1 hour' '1 day' '7 days'; do
  echo "--- retention grace = $GRACE ---"
  PSQL "
  select '  expired session   (expires_at  < now() - $GRACE) = ' || count(*) from sessions where expires_at  < now() - interval '$GRACE'
  union all
  select '  revoked session   (revoked_at  < now() - $GRACE) = ' || count(*) from sessions where revoked_at is not null and revoked_at < now() - interval '$GRACE'
  union all
  select '  expired challenge (expires_at  < now() - $GRACE) = ' || count(*) from login_challenges where expires_at  < now() - interval '$GRACE'
  union all
  select '  consumed challenge(consumed_at < now() - $GRACE) = ' || count(*) from login_challenges where consumed_at is not null and consumed_at < now() - interval '$GRACE'
  order by 1"
done

echo
echo "########## 必须**绝不**被误删的集合（规模）##########"
PSQL "
select '  active sessions           = ' || count(*) from sessions where revoked_at is null and expires_at > now()
union all
select '  valid pending challenges  = ' || count(*) from login_challenges where consumed_at is null and expires_at > now()
order by 1"

echo
echo "########## 与其它表的关联（防删除破坏外键）##########"
echo "--- sessions.user_id → users(id) ON DELETE CASCADE：删 session 不影响 user ---"
PSQL "select 'users 总数 = ' || count(*) from users"
echo "--- 其它表是否引用 sessions / login_challenges ---"
PSQL "
select 'referencing_tables = ' || coalesce(string_agg(distinct conrelid::regclass::text, ','), '(无)')
from pg_constraint
where confrelid in ('sessions'::regclass, 'login_challenges'::regclass)"

echo
echo "AUTH_HYGIENE_AUDIT: DONE（只读，未修改任何数据）"
