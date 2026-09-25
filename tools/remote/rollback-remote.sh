#!/usr/bin/env bash
# TimeMap P0 回滚的**服务器侧**实现（由 tools/rollback-server.ps1 scp 上来执行）
#
# ⚠️ 为什么服务器侧逻辑单独成文件（与 tools/remote/web-deploy-remote.sh 同一理由）：
#   ① PowerShell 5.1 对**无 BOM 的 UTF-8 .ps1** 会按本地代码页（GBK）解析 ⇒ 中文注释变乱码，
#      而且不只是难看：实测有一次乱码注释吞掉了后一行赋值，变量为空、部署报
#      `mkdir: cannot create directory ''`。
#   ② bash 读 UTF-8 没有这个问题。
#
# ════════════════════════════════════════════════════════════════════════════
# 回滚要恢复的三件事（缺一不可 —— 只恢复其中一部分会得到"半新半旧"的状态）
# ════════════════════════════════════════════════════════════════════════════
#   ① 数据库：P0 的迁移 016 会**改表结构**（users.role、posts.status/place_id 相关列等）。
#      只回滚代码不回滚库，旧代码会面对一个新 schema；只回滚库不回滚代码，新代码会
#      在缺少 016 列的库上跑 —— 两种都是坏的，所以默认两者一起回。
#   ② 后端产物：/srv/campus/server/dist/*.mjs（5 个单文件包）
#   ③ 前端静态 + 上传媒体：/srv/campus/web/ 与 /srv/campus/uploads/
#      （打包在同一个 tar 里，因为它们是同时被 P0 改动的"对外可见面"）
#
# ════════════════════════════════════════════════════════════════════════════
# 为什么必须**先停服务再 pg_restore**
# ════════════════════════════════════════════════════════════════════════════
#   pg_restore --clean 会 DROP 掉正在被连接使用的表。若此时 campus-backend 仍在跑：
#     · 要么 restore 因"表被占用"失败（拿到半截状态）
#     · 要么 restore 成功，但应用进程持有的是**已被删除对象的旧缓存/旧连接**，
#       之后的行为不可预测
#   ⇒ 因此顺序固定为：停服 → 恢复库 → 恢复文件 → 起服 → 验证。
#
# ⚠️ 本脚本**不删任何备份**，也不动 server.env / operator.env / .db_password /
#    .login_code_hmac_key（机密文件永不进备份、也永不被回滚覆盖）。
set -uo pipefail

# ⚠️ 总超时兜底：本脚本会在**停服状态**下执行，任何一步卡住都等于延长停机。
#   用后台看门狗强制整个脚本在 N 秒内结束（默认 600s，可用 ROLLBACK_TIMEOUT_S 覆盖）。
#   超时后走 EXIT trap，把服务拉回来 —— 宁可"回滚未完成但服务在跑"，也不要"卡住且停机"。
ROLLBACK_TIMEOUT_S="${ROLLBACK_TIMEOUT_S:-600}"
( sleep "$ROLLBACK_TIMEOUT_S"; echo "  ✗ 看门狗：超过 ${ROLLBACK_TIMEOUT_S}s，强制终止（可能处于部分回滚状态）" >&2; kill -TERM $$ 2>/dev/null ) &
WATCHDOG_PID=$!

BACKUP_DIR="${1:?用法: rollback-remote.sh <backup-dir> [all|db|files] [--yes]}"
MODE="${2:-all}"
CONFIRM="${3:-}"

WEB=/srv/campus/web
UPLOADS=/srv/campus/uploads
DIST=/srv/campus/server/dist
DB=campus
DBUSER=campus
SERVICE=campus-backend.service

echo "=== 回滚参数 ==="
echo "  备份目录: $BACKUP_DIR"
echo "  模式:     $MODE"
echo "  目标:     库=$DB  后端=$DIST  前端=$WEB  媒体=$UPLOADS"

# ── 0) 幂等 / 安全前置检查（失败就**什么都不做**）────────────────────────
if [ ! -d "$BACKUP_DIR" ]; then
  echo "  ✗ 备份目录不存在: $BACKUP_DIR"
  exit 2
fi

NEED_DB=0
NEED_FILES=0
case "$MODE" in
  all) NEED_DB=1; NEED_FILES=1 ;;
  db)  NEED_DB=1 ;;
  files) NEED_FILES=1 ;;
  *) echo "  ✗ 模式只能是 all|db|files"; exit 2 ;;
esac

if [ "$NEED_DB" = 1 ] && [ ! -s "$BACKUP_DIR/campus-db.dump" ]; then
  echo "  ✗ 缺少 campus-db.dump（无法恢复数据库）"; exit 2
fi
if [ "$NEED_FILES" = 1 ] && [ ! -s "$BACKUP_DIR/dist-web-uploads.tar.gz" ]; then
  echo "  ✗ 缺少 dist-web-uploads.tar.gz（无法恢复文件）"; exit 2
fi

echo
echo "=== 1) 校验备份完整性（SHA256SUMS）==="
if [ -s "$BACKUP_DIR/SHA256SUMS" ]; then
  # SHA256SUMS 里的路径是**绝对路径**（生成时就在这个目录），所以进目录后用文件名比对
  ( cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS 2>&1 | sed 's/^/  /' )
  RC=${PIPESTATUS[0]}
  if [ "$RC" != 0 ]; then
    echo "  ✗ 校验失败 ⇒ 拒绝用这份备份回滚（宁可不动，也不要把损坏的数据推上去）"
    exit 3
  fi
  echo "  ✓ 全部文件校验通过"
else
  echo "  ⚠️ 没有 SHA256SUMS，跳过校验（无法证明备份未被损坏）"
fi

# ── 2) 确认这是**格式合法**的 pg_dump 归档 ──────────────────────────────
if [ "$NEED_DB" = 1 ]; then
  echo
  echo "=== 2) 检查 dump 格式与**可读性** ==="
  # ⚠️ 可读性必须先查：备份文件的属主是 root（-rw-------），而 pg_restore 要以 postgres 身份跑。
  #    第一次真实回滚就死在这里：pg_restore: could not open input file: Permission denied
  #    ⇒ 因此改为**经 stdin 喂数据**（见第 5 步），本步只做"格式可解析"的判定。
  if pg_restore --list "$BACKUP_DIR/campus-db.dump" >/dev/null 2>&1; then
    TABLES=$(pg_restore --list "$BACKUP_DIR/campus-db.dump" 2>/dev/null | grep -c 'TABLE DATA' || true)
    echo "  ✓ 归档可解析；含 $TABLES 个 TABLE DATA 条目"
  else
    echo "  ✗ pg_restore 无法解析该 dump ⇒ 拒绝继续（回滚到一个读不出来的库比不回滚更糟）"
    exit 3
  fi
fi

if [ "$CONFIRM" != "--yes" ]; then
  echo
  echo "  ⚠️ 未带 --yes：以上是**预检结果**，没有做任何改动。"
  echo "     确认无误后重新执行并在末尾加 --yes。"
  exit 10
fi

# ⚠️⚠️ 服务已被停掉之后的**任何**退出路径都必须把服务拉回来。
#   第一次真实回滚失败时没有这个 trap，结果是"回滚失败 + 线上服务停着"——
#   把一次可恢复的失败放大成了停机。失败要能安全收场，而不是把系统留在半途。
SERVICE_GUARD=0
restore_service_on_exit() {
  local rc=$?
  # 无论成功失败都收掉看门狗（否则它会一直挂到超时）
  if [ -n "${WATCHDOG_PID:-}" ]; then kill "$WATCHDOG_PID" 2>/dev/null || true; fi
  if [ "$SERVICE_GUARD" = 1 ]; then
    echo
    echo "  ⚠️ 检测到非正常退出（rc=$rc）—— 尝试把服务拉回来，避免留下停机状态"
    systemctl start "$SERVICE" 2>/dev/null || true
    for i in $(seq 1 60); do
      if curl -sf -m 2 http://127.0.0.1:3001/api/ready >/dev/null 2>&1; then
        echo "  ✓ 服务已恢复（${i}s）"
        break
      fi
      sleep 1
    done
    echo "    当前状态: $(systemctl is-active "$SERVICE" 2>&1)"
    echo "    ⚠️ 注意：库/文件可能处于**部分恢复**状态，请按上面的输出人工确认"
  fi
}
trap restore_service_on_exit EXIT

# ── 3) 记录回滚前状态（用于事后对比 / 证明状态真的变了）─────────────────
echo
echo "=== 3) 回滚前状态快照 ==="
BEFORE_MIG=$(sudo -u postgres psql -w -Atc \
  "select count(*) from schema_migrations" -d "$DB" 2>/dev/null || echo '?')
BEFORE_POSTS=$(sudo -u postgres psql -w -Atc "select count(*) from posts" -d "$DB" 2>/dev/null || echo '?')
BEFORE_DIST=$(ls -1 "$DIST"/*.mjs 2>/dev/null | wc -l)
echo "  迁移条数=$BEFORE_MIG  posts 行数=$BEFORE_POSTS  dist 包数=$BEFORE_DIST"

# ── 4) 停服 ─────────────────────────────────────────────────────────────
echo
echo "=== 4) 停止 $SERVICE ==="
systemctl stop "$SERVICE"
sleep 1
echo "  is-active: $(systemctl is-active "$SERVICE" 2>&1)"
# 从这里开始，任何异常退出都要把服务拉回来（见上面的 trap）
SERVICE_GUARD=1

# ── 5) 恢复数据库 ───────────────────────────────────────────────────────
if [ "$NEED_DB" = 1 ]; then
  echo
  echo "=== 5) 恢复数据库（重建 schema + pg_restore + 属主交接）==="
  # ⚠️ 为什么经 **stdin** 而不是把路径交给 pg_restore（第一次真实回滚死在这）：
  #   备份文件属主是 root、权限 600，而 pg_restore 要以 postgres 身份运行
  #   ⇒ 传路径会 "could not open input file: Permission denied"。
  # ⚠️ 为什么**先探测 stdin**：改成 stdin 后第二次仍报
  #   `could not open input file "-"` —— 说明有两种可能：
  #     (a) 重定向确实没把数据接上；(b) 这个 pg_restore 版本对 `-` 的语义与我预期不同。
  #   与其再猜，先显式测一次"stdin 到底有没有数据"，把判据摆出来。
  echo "  --- stdin 探测（前 5 字节应可读且非空）---"
  STDIN_PROBE=$(head -c 5 < "$BACKUP_DIR/campus-db.dump" | od -An -tc | tr -s ' ')
  echo "    head -c 5 | od:${STDIN_PROBE:-<空>}"
  if [ -z "$(echo "$STDIN_PROBE" | tr -d ' ')" ]; then
    echo "  ✗ 重定向取不到数据 ⇒ 这份 dump 无法经 stdin 读取，停止（不改动数据库）"
    exit 4
  fi

  # --clean --if-exists：先 DROP 再建。--no-owner 避免 dump 里的属主与当前角色不一致而报错。
  #
  # ── 恢复策略（**先清空再恢复**，而不是直接 --clean）──────────────────
  # ⚠️ 为什么必须先把 public schema 清空重建：
  #   实测 `pg_restore --clean --if-exists` 在一个"已被改过"的库上会留下冲突对象
  #   （COPY 撞主键、ADD CONSTRAINT 撞已有主键，15 个被忽略的错误），结果是**半恢复**。
  #   `drop schema public cascade; create schema public;` 给出一个**确定干净**的落点，
  #   之后 pg_restore 不需要 drop 任何东西，冲突面最小。
  # ⚠️ 为什么**不能**用 `--no-owner` 就完事：
  #   --no-owner 只是让对象归**执行恢复的身份**（postgres）。而应用连的是 campus 用户，
  #   campus 不是属主 ⇒ 服务端会报 "must be owner of table schema_migrations"，/api/ready 变 applied=0。
  #   ⇒ 恢复完必须显式 `REASSIGN OWNED BY postgres TO campus` + 把 public schema 的权限给 campus。
  #   （这也解释了备份里那张表为什么是 campus 所有：备份前它是正常的。）

  # 记录 public schema 原本的属主，恢复后要还原成同一个
  SCHEMA_OWNER_BEFORE=$(sudo -u postgres psql -w -Atc \
    "select pg_get_userbyid(nspowner) from pg_namespace where nspname='public'" -d "$DB" 2>/dev/null | tr -d '[:space:]')
  echo "  · public schema 原属主: ${SCHEMA_OWNER_BEFORE:-未知}"

  TMPDUMP=/tmp/rollback-db-$$.dump
  # ⚠️ 注释里**不要**出现反引号：这是双引号字符串，反引号会被 shell 当命令替换执行
  #   （实测报错 `/tmp/rollback-remote.sh: line 198: -: command not found` —— 只是噪音，
  #    但会污染输出，让人以为脚本坏了）。
  echo "  · 取备份：cp 成临时副本，chown 给 postgres（pg_restore 以 postgres 身份读）"
  if ! cp "$BACKUP_DIR/campus-db.dump" "$TMPDUMP"; then
    echo "  ✗ 无法创建临时副本 ⇒ 停止（不改动数据库）"
    exit 4
  fi
  # ⭐ 关键：pg_restore 以 postgres 身份跑，临时副本必须 postgres 可读。
  #    少了这一步就会 "could not open input file: Permission denied"（实测踩过）。
  chown postgres:postgres "$TMPDUMP" 2>/dev/null || true
  chmod 600 "$TMPDUMP"

  # ⭐⭐ 恢复前先给"当前库"做一份**二次保险快照**。
  #   为什么必须有（2026-09-26 的真实数据损失）：上一次流程在"drop schema cascade"之后
  #   恢复失败，而失败路径又允许流程继续 ⇒ 服务端重启后从**空库**重建 ⇒ P0 之前的历史
  #   帖子/用户/地点丢了。**不可逆动作之前必须先留退路。**
  SAFETY_DUMP=/tmp/pre-rollback-safety-$$.dump
  echo "  · 二次保险：先给当前库做一份快照（失败时不至于无可挽回）"
  if sudo -u postgres pg_dump -Fc -d "$DB" -f "$SAFETY_DUMP" 2>/tmp/rollback-safety.log; then
    chmod 600 "$SAFETY_DUMP"
    echo "    ✓ 快照已生成: $SAFETY_DUMP ($(stat -c%s "$SAFETY_DUMP" 2>/dev/null || echo '?') 字节)"
  else
    echo "    ⚠️ 快照生成失败（日志尾部）："
    tail -n 5 /tmp/rollback-safety.log | sed 's/^/      /'
    echo "    ⇒ 拒绝继续：没有退路就不做不可逆操作"
    exit 4
  fi

  echo "  · 清空并重建 public schema（给出确定性落点）"
  if ! sudo -u postgres psql -w -v ON_ERROR_STOP=1 -q -d "$DB" \
       -c 'drop schema public cascade; create schema public;'; then
    echo "  ✗ 无法重建 public schema ⇒ 停止"
    exit 4
  fi
  # ⚠️ 这里把 schema 属主设成**应用角色**（DBUSER），不是 SCHEMA_OWNER_BEFORE。
  #    原因：PG15 里 public schema 的属主显示为系统角色 pg_database_owner，
  #    拿它 set owner 只会报 "role pg_database_owner does not exist"（或角色名不匹配），
  #    而且后面 pg_restore 需要能在这个 schema 里建对象。
  sudo -u postgres psql -w -q -d "$DB" -c "alter schema public owner to \"$DBUSER\"" 2>&1 | sed 's/^/    /' || true

  echo "  · pg_restore（从临时副本）"
  PG_TRY_OK=0
  if sudo -u postgres pg_restore -d "$DB" --clean --if-exists --no-owner "$TMPDUMP" \
       > /tmp/rollback-pgrestore.log 2>&1; then
    PG_TRY_OK=1
    echo "    ✓ pg_restore 退出码 0"
  else
    echo "    ✗ pg_restore 非 0 —— 这表示数据**没有完整恢复**"
    echo "      日志里的致命错误："
    grep -iE 'could not (open|connect)|FATAL|permission denied' /tmp/rollback-pgrestore.log | head -5 | sed 's/^/        /' || true
    echo "      错误总条数: $(grep -c '^pg_restore: error' /tmp/rollback-pgrestore.log 2>/dev/null || echo '?')"
    echo "      日志尾部："
    tail -n 8 /tmp/rollback-pgrestore.log | sed 's/^/        /'
    # ⭐⭐⭐ 立即停止，**绝不让流程继续**。
    #   上一次就是因为"把 pg_restore 的非 0 当非致命、继续往下走"，
    #   导致 schema 已被 drop、数据却没回来，最终服务端从空库重建 ⇒ 历史数据丢失。
    #   ⇒ 这里先尝试用二次保险快照把库还原回去，再退出。
    echo
    echo "  ⚠️ 正在用二次保险快照回滚这次失败的恢复（避免留下半恢复状态）..."
    if sudo -u postgres pg_restore -d "$DB" --clean --if-exists --no-owner "$SAFETY_DUMP" \
         > /tmp/rollback-safety-restore.log 2>&1; then
      # 快照还原后同样要交属主（否则应用仍报 must be owner）。
      # 用 DBUSER（应用角色），不要用 SCHEMA_OWNER_BEFORE（那可能是系统角色 pg_database_owner）。
      sudo -u postgres psql -w -q -d "$DB" \
        -c "alter schema public owner to \"$DBUSER\"" \
        -c "grant all on schema public to \"$DBUSER\"" \
        -c "grant all on all tables in schema public to \"$DBUSER\"" \
        -c "grant all on all sequences in schema public to \"$DBUSER\"" 2>&1 | sed 's/^/      /' || true
      sudo -u postgres psql -w -q -d "$DB" -c "
        do \$\$
        declare r record;
        begin
          for r in select tablename from pg_tables where schemaname='public' loop
            execute format('alter table public.%I owner to %I', r.tablename, '$DBUSER');
          end loop;
          for r in select sequencename from pg_sequences where schemaname='public' loop
            execute format('alter sequence public.%I owner to %I', r.sequencename, '$DBUSER');
          end loop;
        end
        \$\$;
      " 2>&1 | sed 's/^/      /' || true
      echo "    ✓ 已用快照还原（库回到本次回滚之前的状态）"
    else
      echo "    ✗ 快照还原也失败 —— 手工介入：sudo -u postgres pg_restore -d $DB --clean --if-exists $SAFETY_DUMP"
      tail -n 8 /tmp/rollback-safety-restore.log | sed 's/^/      /'
    fi
    echo "    · 快照保留在 $SAFETY_DUMP（确认无误后可自行删除）"
    rm -f "$TMPDUMP"
    exit 4
  fi
  rm -f "$TMPDUMP"

  # ── 属主/权限交接（**这一步决定应用能不能用**）────────────────────────
  # ⚠️⚠️ 教训（2026-09-26 实测）：
  #   ① 不能拿 `pg_get_userbyid(nspowner)` 当"应用角色"：PG15 里 public schema 的属主
  #      显示为系统角色 `pg_database_owner`，对它 `sudo -u` 会报
  #      `sudo: user 'pg_database_owner' not found`。应用角色是 DBUSER（campus）。
  #   ② 不能用 `reassign owned by postgres to campus`：它会试图转移**系统所需对象**
  #      而整体报错 `cannot reassign ownership of objects owned by role postgres because
  #      they are required by the database system` —— 整条语句失败，一张表也没改成。
  #   ⇒ 正确做法：**逐个** ALTER ... OWNER TO campus（系统对象不在 public 的普通表里，
  #      因此逐表改不会撞上那个限制），schema 与序列也一并交出去。
  APP_ROLE="$DBUSER"
  echo "  · 交接属主与权限给应用角色: $APP_ROLE"
  if ! sudo -u postgres psql -w -Atc "select 1 from pg_roles where rolname='$APP_ROLE'" -d "$DB" | grep -q 1; then
    echo "  ✗ 角色 $APP_ROLE 不存在 ⇒ 无法交接（回滚后应用会读不到表）"
    exit 4
  fi

  # schema 属主 + 权限（PG15 的 public schema 默认不允许普通角色 CREATE）
  sudo -u postgres psql -w -q -d "$DB" \
    -c "alter schema public owner to \"$APP_ROLE\"" \
    -c "grant all on schema public to \"$APP_ROLE\"" 2>&1 | sed 's/^/    /' || true

  # 逐表 / 逐序列改属主（用 psql 生成语句再执行，避免手写循环漏掉对象类型）
  echo "  · 逐表改属主..."
  sudo -u postgres psql -w -q -d "$DB" -c "
    do \$\$
    declare r record;
    begin
      for r in select tablename from pg_tables where schemaname='public' loop
        execute format('alter table public.%I owner to %I', r.tablename, '$APP_ROLE');
      end loop;
      for r in select sequencename from pg_sequences where schemaname='public' loop
        execute format('alter sequence public.%I owner to %I', r.sequencename, '$APP_ROLE');
      end loop;
      for r in select viewname from pg_views where schemaname='public' loop
        execute format('alter view public.%I owner to %I', r.viewname, '$APP_ROLE');
      end loop;
    end
    \$\$;
  " 2>&1 | sed 's/^/    /' || true

  # 兜底权限（属主通常已够，但显式给一遍更稳）
  sudo -u postgres psql -w -q -d "$DB" \
    -c "grant all on all tables in schema public to \"$APP_ROLE\"" \
    -c "grant all on all sequences in schema public to \"$APP_ROLE\"" \
    -c "grant all on all functions in schema public to \"$APP_ROLE\"" \
    -c "alter default privileges in schema public grant all on tables to \"$APP_ROLE\"" \
    -c "alter default privileges in schema public grant all on sequences to \"$APP_ROLE\"" \
    2>&1 | sed 's/^/    /' || true

  # ⭐ 判据：**以应用角色身份**读迁移表。这才是"应用能不能用"的证明，
  #    不是 pg_restore 的退出码，也不是 pg_restore 有没有打 warning。
  MIG_AS_APP=$(sudo -u "$APP_ROLE" psql -w -Atc "select count(*) from schema_migrations" -d "$DB" 2>&1 | tr -d '[:space:]')
  echo "    · 以 $APP_ROLE 身份读 schema_migrations -> $MIG_AS_APP（应为数字）"
  case "$MIG_AS_APP" in
    ''|*[!0-9]*)
      echo "    ✗ 应用身份仍读不到迁移表 ⇒ 属主交接未成功"
      echo "      手工修：sudo -u postgres psql -d $DB -c \"alter table schema_migrations owner to $APP_ROLE\""
      exit 4
      ;;
    *) echo "    ✓ 应用身份可读（$MIG_AS_APP 条迁移）" ;;
  esac

  # ⚠️ 到这里只可能是"成功"：pg_restore 失败与属主交接失败都已在上面 exit。
  #   这里以前有一段"判定为非致命（仅 warning）⇒ 继续"的逻辑 ——
  #   正是它把一次失败的恢复放行，最终导致 schema 被 drop 而数据没回来、历史数据丢失。
  #   ⇒ 已删除。恢复要么完整成功，要么停下并用快照还原。
  echo "  ✓ 数据库恢复成功（schema 与表属主已交接给 $APP_ROLE）"
fi

# ── 6) 恢复文件（dist + web + uploads）──────────────────────────────────
if [ "$NEED_FILES" = 1 ]; then
  echo
  echo "=== 6) 恢复文件 ==="
  EXTRACT=/tmp/rollback-extract-$$
  mkdir -p "$EXTRACT"
  if ! tar -xzf "$BACKUP_DIR/dist-web-uploads.tar.gz" -C "$EXTRACT"; then
    echo "  ✗ 解包失败 ⇒ 数据库已恢复但文件没恢复，状态不一致，请人工介入"
    exit 5
  fi
  echo "  · 归档内容（顶层）："
  ls -1 "$EXTRACT" | sed 's/^/    /'

  # ⚠️⚠️ 归档布局**在真实备份里是带前缀的**：顶层是 `srv/`，
  #   真实路径为 srv/campus/server/dist、srv/campus/web、srv/campus/uploads。
  #   第一版只找 server/dist / web / uploads ⇒ 一条都没恢复（而且当时还会静默跳过）。
  #   ⇒ 现在把"解包根"探测出来（支持带前缀与不带前缀两种），再按绝对目标映射。
  SRV_ROOT=""
  for cand in "$EXTRACT/srv/campus" "$EXTRACT/campus" "$EXTRACT"; do
    if [ -d "$cand/server/dist" ] || [ -d "$cand/web" ] || [ -d "$cand/uploads" ]; then
      SRV_ROOT="$cand"
      break
    fi
  done
  echo "  · 解包根（自动探测）: ${SRV_ROOT:-未找到}"
  if [ -z "$SRV_ROOT" ]; then
    echo "  ✗ 归档里找不到可识别的目录结构 ⇒ 文件未恢复"
    echo "    顶层内容："
    ls -1 "$EXTRACT" | sed 's/^/      /'
    exit 5
  fi

  restored=""
  if [ -d "$SRV_ROOT/server/dist" ]; then
    install -d -o campus -g campus -m 0750 "$DIST"
    cp -a "$SRV_ROOT/server/dist/." "$DIST/"
    chown campus:campus "$DIST"/*.mjs 2>/dev/null || true
    chmod 0750 "$DIST"/*.mjs 2>/dev/null || true
    restored="$restored dist"
    echo "  ✓ 后端包已恢复（$(ls -1 "$DIST"/*.mjs 2>/dev/null | wc -l) 个）"
  else
    echo "  ⚠️ 归档里没有 server/dist ⇒ 后端包**未**恢复"
  fi

  if [ -d "$SRV_ROOT/web" ]; then
    # 前端沿用**原子替换**（同 web-deploy-remote.sh 的做法）：先解到暂存目录再 mv，
    # 避免"先删后传"造成站点空窗。
    STAGE="${WEB}.rb.$$"
    rm -rf "$STAGE"
    cp -a "$SRV_ROOT/web" "$STAGE"
    if [ -f "$STAGE/index.html" ]; then
      OLD="${WEB}.old.$$"
      [ -d "$WEB" ] && mv "$WEB" "$OLD"
      mv "$STAGE" "$WEB"
      [ -d "$OLD" ] && rm -rf "$OLD"
      chown -R campus:campus "$WEB"
      find "$WEB" -type d -exec chmod 755 {} \;
      find "$WEB" -type f -exec chmod 644 {} \;
      restored="$restored web"
      echo "  ✓ 前端已原子替换（$(find "$WEB" -type f | wc -l) 个文件）"
    else
      rm -rf "$STAGE"
      echo "  ⚠️ 归档里的 web 没有 index.html ⇒ 拒绝切换（保留现有前端）"
    fi
  else
    echo "  ⚠️ 归档里没有 web ⇒ 前端**未**恢复"
  fi

  if [ -d "$SRV_ROOT/uploads" ]; then
    install -d -o campus -g campus -m 0755 "$UPLOADS"
    cp -a "$SRV_ROOT/uploads/." "$UPLOADS/"
    chown -R campus:campus "$UPLOADS"
    restored="$restored uploads"
    echo "  ✓ 上传媒体已恢复（$(find "$UPLOADS" -type f | wc -l) 个文件）"
  else
    echo "  ⚠️ 归档里没有 uploads ⇒ 媒体**未**恢复"
  fi

  rm -rf "$EXTRACT"
  echo "  · 已恢复的部分:${restored:-（无 —— 归档布局与预期不符，请人工检查归档内容）}"
  if [ -z "$restored" ]; then
    echo "  ⚠️ 一条都没恢复：解包目录的顶层是 ——"
    ls -1 "$EXTRACT" 2>/dev/null | sed 's/^/      /' || true
    echo "     （若归档结构与脚本假设不同，需要按实际布局调整 rollback-remote.sh）"
  fi
fi

# ── 7) 起服 + 等待就绪（轮询，不用固定 sleep）───────────────────────────
echo
echo "=== 7) 启动服务并等待就绪 ==="
systemctl start "$SERVICE"
READY=0
for i in $(seq 1 240); do
  if curl -sf -m 2 http://127.0.0.1:3001/api/ready >/dev/null 2>&1; then
    echo "  ✓ /api/ready 200（耗时 ${i}s）"
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" = 1 ]; then
  # 服务已在跑 ⇒ 后续即使验证失败也不需要 trap 再拉一次
  SERVICE_GUARD=0
fi
if [ "$READY" != 1 ]; then
  echo "  ✗ 240s 内未就绪 —— 现场信息："
  echo "    is-active: $(systemctl is-active "$SERVICE" 2>&1)"
  echo "    --- journalctl (last 30) ---"
  journalctl -u "$SERVICE" -n 30 --no-pager 2>&1 | sed 's/^/    /'
  exit 6
fi

# ── 8) 验证（回滚是否**真的**生效）─────────────────────────────────────
echo
echo "=== 8) 回滚后验证 ==="
FAIL=0
p() { printf '  %-34s %s\n' "$1" "$2"; }
code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$1"; }

r=$(code http://127.0.0.1:3001/api/health); p "后端 /api/health" "$r"; [ "$r" = 200 ] || FAIL=1
r=$(code http://127.0.0.1/api/health);      p "经 nginx /api/health" "$r"; [ "$r" = 200 ] || FAIL=1
r=$(code http://127.0.0.1/);                p "前端首页 /" "$r"; [ "$r" = 200 ] || FAIL=1
r=$(code http://127.0.0.1/nope/should-404); p "未知路径应 404" "$r"; [ "$r" = 404 ] || FAIL=1

AFTER_MIG=$(sudo -u postgres psql -w -Atc \
  "select count(*) from schema_migrations" -d "$DB" 2>/dev/null || echo '?')
AFTER_POSTS=$(sudo -u postgres psql -w -Atc "select count(*) from posts" -d "$DB" 2>/dev/null || echo '?')
echo "  --- 回滚前后对比（证明状态确实变了，而不是"什么都没做也算成功"）---"
p "迁移条数" "$BEFORE_MIG -> $AFTER_MIG"
p "posts 行数" "$BEFORE_POSTS -> $AFTER_POSTS"
p "dist 包数" "$BEFORE_DIST -> $(ls -1 "$DIST"/*.mjs 2>/dev/null | wc -l)"

# ⭐ 关键判据：备份是 P0 **之前**的状态 ⇒ 016 不该在迁移表里。
#    这一条比"服务能起来"更有判别力：service 起来不代表库回到了旧结构。
HAS016=$(sudo -u postgres psql -w -Atc \
  "select count(*) from schema_migrations where version like '016%'" -d "$DB" 2>/dev/null || echo '?')
p "迁移表里是否还有 016" "$HAS016（期望 0）"
if [ "$HAS016" != "0" ]; then
  echo "  ⚠️ 016 仍在迁移表里 —— 数据库**没有**回到 P0 之前的状态（回滚不完整）"
  FAIL=1
fi

# 旧代码下的 schema 印记：P0 之前没有 users.role / posts.client_request_id
HAS_ROLE=$(sudo -u postgres psql -w -Atc \
  "select count(*) from information_schema.columns where table_name='users' and column_name='role'" \
  -d "$DB" 2>/dev/null || echo '?')
p "users.role 是否仍存在" "$HAS_ROLE（期望 0）"
if [ "$HAS_ROLE" != "0" ]; then
  echo "  ⚠️ users.role 仍存在 ⇒ schema 未回到 P0 之前"
  FAIL=1
fi

echo
if [ "$FAIL" = 0 ]; then
  echo "ROLLBACK: PASS"
  # 成功路径也要收掉看门狗（EXIT trap 里会做，这里显式一次让日志更清楚）
  [ -n "${WATCHDOG_PID:-}" ] && kill "$WATCHDOG_PID" 2>/dev/null || true
  exit 0
else
  echo "ROLLBACK: FAIL（请人工检查上面的 FAIL 项）"
  exit 1
fi
