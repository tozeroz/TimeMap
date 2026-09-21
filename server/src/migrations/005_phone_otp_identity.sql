-- 005_phone_otp_identity：把公开身份凭证换成「手机号 + 一次性验证码」（M3 Slice 0B）
--
-- 依据：docs/review-log/08-m3-preflight-slice0a-verdict.md（Slice 0B 的三处开工前修订）
--       与 docs/m3/SLICE0-LOGIN-SEMANTICS.md（原版登录语义实测）
--
-- 审核裁定把认证拆成三层：
--   Session / authorization  → **保留 M2 的全部机制**（opaque token、只存 hash、过期、撤销、Bearer）
--   Credential / identity    → **被新证据 supersede**：原版没有密码
--   Product identity         → 冻结为 手机号 + 一次性验证码
--
-- 因此这里做两件事：
--   1) 给 users 增加 phone_e164 作为**唯一身份标识**
--   2) **退休密码凭证**：删掉 password_hash
--      为什么删而不是留着：它已经成为一条"谁也不该再用"的凭证材料。
--      留着它只会诱使后来者重新接一条密码登录路径 —— 而原版并不存在这种登录方式。
--      （M2 关于 scrypt / 密码登录的历史事实仍然保留在 docs/review-log/06 与 docs/m2/ 里，
--       那是审计历史，不代表当前产品要永久兼容它。）

-- ---------------------------------------------------------------------------
-- 身份：手机号（E.164）
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 text;

-- 唯一：一个手机号只对应一个账号。
-- PostgreSQL 的 UNIQUE 允许多个 NULL，所以历史账号（还没有手机号）不会互相冲突。
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_e164_uniq ON users (phone_e164);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_e164_format;
ALTER TABLE users ADD CONSTRAINT users_phone_e164_format
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

-- 退休密码凭证。password_hash 在 002 里是 NOT NULL，这里整列删除。
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;

-- handle 不再是登录凭证（不再有按 handle 查用户再验密码的路径），
-- 但仍是展示用的稳定标识，保留；只是它的唯一索引不再承担"登录标识"的职责。
COMMENT ON COLUMN users.handle IS
  '展示用标识。**不再是登录凭证**：M3 起登录只有「手机号 + 一次性验证码」一条路径';
COMMENT ON COLUMN users.phone_e164 IS
  '登录身份（E.164，例如 +8613800000000）。来源：原版登录页实测为「手机号 + 短信验证码」';

-- ---------------------------------------------------------------------------
-- 一次性登录验证码
--
-- 存的是 **keyed HMAC-SHA256(server_key, code)**，不是裸 hash（审核记录 08 第 2 点）。
-- 原因：验证码只有 6 位，搜索空间才 10^6 —— 裸 SHA-256 被拿到库就能秒破；
-- 加了服务端密钥的 HMAC，攻击者还要同时拿到密钥才有意义。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_challenges (
  id          uuid PRIMARY KEY,
  phone_e164  text NOT NULL,
  code_hmac   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts    smallint NOT NULL DEFAULT 0,
  CONSTRAINT login_challenges_phone_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT login_challenges_code_not_blank CHECK (length(btrim(code_hmac)) > 0),
  CONSTRAINT login_challenges_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT login_challenges_consumed_after_created CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT login_challenges_attempts_nonneg CHECK (attempts >= 0)
);

-- 取"某手机号最近一条未消费的挑战"是热路径
CREATE INDEX IF NOT EXISTS login_challenges_phone_created_idx
  ON login_challenges (phone_e164, created_at DESC);

COMMENT ON TABLE login_challenges IS
  '一次性登录验证码。code_hmac = HMAC-SHA256(服务端密钥, code)，密钥不在库里（见 server.env 的 LOGIN_CODE_HMAC_KEY）';
COMMENT ON COLUMN login_challenges.attempts IS
  '校验失败次数；超过阈值即视为已失效，防止对 6 位码暴力穷举';
