# Give the production ADMIN account a password, then PROVE the password logs in.
#
# WHY A PASSWORD AT ALL (short version; the long version is in migration 017)
#   The admin account originally had no credential of its own: the only way in was the
#   student OTP path (SMS). That makes every admin capability depend on one third-party
#   channel -- and that channel did fail in production (503 sms_delivery_failed). This
#   script restores a credential the operator controls.
#
# WHAT IT DELIBERATELY DOES NOT DO
#   * It does not create an account and does not promote anyone. server/src/admin-entry.ts
#     refuses set-password unless the phone already belongs to role=admin, and this script
#     relays that refusal instead of working around it.
#   * It has no default password and no backdoor. If -Password is omitted the password is
#     generated on THIS machine from a CSPRNG, shown once, and never written to disk.
#
# WHY IT VERIFIES WITH A REAL LOGIN
#   "I ran set-password" is not evidence that anyone can log in (the phone could be wrong,
#   the row could be the wrong account, the hash format could be broken). So the last step
#   is a real POST /api/auth/admin-login followed by an authenticated admin request.
#   If verification fails the script says so loudly -- it does not print OK anyway.
#
# USAGE (run in YOUR terminal, from the repo root)
#   & .\tools\set-admin-password.ps1
#   & .\tools\set-admin-password.ps1 -Password 'SomeLongPassword123'
#   & .\tools\set-admin-password.ps1 -Phone '+8613800000001'
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 parses a BOM-less UTF-8 .ps1 with
# the local ANSI codepage and mis-decoded non-ASCII breaks PARSING, not just messages.
param(
  [string]$Phone = '+8613800000001',
  [string]$Password = '',
  [string]$Key = '',
  [string]$Target = 'root@8.148.156.146',
  [string]$Base = 'https://8.148.156.146'
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

function Step($n, $msg) { Write-Host "=== $n) $msg ===" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "SET_ADMIN_PASSWORD: FAILED - $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- key resolution
function Find-StagedKey {
  $candidates = @(
    $env:TMPDIR, $env:TEMP, $env:TMP,
    (Join-Path $env:USERPROFILE 'AppData\Local\Temp'),
    'C:\Users\Lenovo\AppData\Local\Temp'
  ) | Where-Object { $_ } | Select-Object -Unique
  foreach ($c in $candidates) {
    $p = Join-Path $c 'timemap-ssh\id_timemap.pem'
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}
if (-not $PSBoundParameters.ContainsKey('Key') -or -not $Key) {
  $staged = Find-StagedKey
  if ($staged) {
    $Key = $staged
    Write-Host "using hardened deploy key: $Key"
  } else {
    $Key = Join-Path $root 'TimeMap.pem'
    Write-Host "  ! no hardened key found; falling back to $Key"
    Write-Host "    if ssh reports UNPROTECTED PRIVATE KEY FILE, run tools\setup-deploy-key.ps1 first"
  }
}
$SSH_OPTS = @('-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes')

# ---------------------------------------------------------------- 1) password
Step 1 'Password to set'
$generated = $false
if (-not $Password) {
  $bytes = New-Object 'byte[]' 16
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $Password = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $generated = $true
  Write-Host '  generated a 16-byte random password (shown once at the end)'
} else {
  Write-Host '  using the password you supplied (it will NOT be echoed back)'
}
if ($Password.Length -lt 10) {
  # The authoritative minimum is PASSWORD_MIN in server/src/password.ts (currently 10).
  # This check must not be STRICTER than the server's without saying so: an earlier version of
  # this script required 12 and its message claimed the server did too, which was simply wrong --
  # the failure then looked like a client bug rather than a policy choice.
  Fail "password must be at least 10 characters (PASSWORD_MIN in server/src/password.ts)"
}
if ($Password.Length -lt 12 -or $Password -match '^(0123456789|1234567890|password|admin)') {
  # NOTE: PowerShell's -match is case-insensitive by default (-cmatch is the sensitive one).
  Write-Host '  ! WARNING: this password is weak (short and/or a predictable sequence).' -ForegroundColor Yellow
  Write-Host '    The endpoint is rate limited and always answers 401 uniformly, but a guessable' -ForegroundColor Yellow
  Write-Host '    password is still the weakest link on a public host. Change it with:' -ForegroundColor Yellow
  Write-Host '      tools\set-admin-password.ps1 -Password <a longer one>' -ForegroundColor Yellow
}
# The password travels to the server inside a bash script, so restrict it to characters that
# need no quoting there. Refusing loudly beats a half-escaped password that silently changes.
if ($Password -notmatch '^[A-Za-z0-9._~!@#%^*+=:-]+$') {
  Fail "password may only contain A-Z a-z 0-9 . _ ~ ! @ # % ^ * + = : - (no quotes, spaces, backslash, dollar or backtick; those would be re-interpreted by the remote shell)"
}

# ---------------------------------------------------------------- 2) remote set-password
Step 2 "Run admin.mjs set-password on $Target (must already be role=admin)"
# Placeholders + a single-quoted here-string so PowerShell never interprets the script body.
$remoteSh = @'
set -euo pipefail
PHONE='__PHONE__'
PW='__PW__'

if [ ! -s /srv/campus/server.env ]; then
  echo "  ! /srv/campus/server.env missing"
  exit 1
fi
DB="$(sed -n 's/^DATABASE_URL=//p' /srv/campus/server.env | head -1)"
if [ -z "$DB" ]; then
  echo "  ! DATABASE_URL not found in /srv/campus/server.env"
  exit 1
fi

# Take the node binary from the running service instead of assuming a path.
NODE="$(systemctl cat campus-backend.service 2>/dev/null | sed -n 's/^ExecStart=\([^ ]*\).*/\1/p' | head -1)"
if [ ! -x "$NODE" ]; then
  NODE=/opt/node-v24.21.0-linux-x64/bin/node
fi
if [ ! -x "$NODE" ]; then
  echo "  ! node binary not found (tried the unit's ExecStart and /opt/node-v24.21.0-linux-x64/bin/node)"
  exit 1
fi
echo "  node: $NODE"

if [ ! -f /srv/campus/server/dist/admin.mjs ]; then
  echo "  ! /srv/campus/server/dist/admin.mjs missing -- deploy the backend first"
  exit 1
fi

cd /srv/campus/server/dist
sudo -u campus env DATABASE_URL="$DB" "$NODE" admin.mjs set-password "$PHONE" "$PW"
echo "  --- account after the change ---"
sudo -u campus env DATABASE_URL="$DB" "$NODE" admin.mjs list-users | grep -F "$PHONE" || true
'@
$remoteSh = $remoteSh.Replace('__PHONE__', $Phone).Replace('__PW__', $Password)
$enc = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteSh))
$out = & ssh -i $Key @SSH_OPTS $Target "echo '$enc' | base64 -d | bash" 2>&1
$code = $LASTEXITCODE
$out | ForEach-Object { Write-Host "  $_" }
if ($code -ne 0) {
  Fail "remote set-password failed (exit $code). Nothing was verified; the account may still have no password."
}

# ---------------------------------------------------------------- 3) prove the login works
Step 3 'Verify with a REAL admin login over the public HTTPS endpoint'
# NOTE: node is used for the HTTP calls so that a self-signed private-CA certificate does not
# matter here; NODE_TLS_REJECT_UNAUTHORIZED is scoped to this single child process only.
$verifyJs = Join-Path $env:TEMP ('timemap-admin-verify-' + [guid]::NewGuid().ToString('N') + '.mjs')
$js = @'
const [base, phone, password] = process.argv.slice(2)
const login = await fetch(`${base}/api/auth/admin-login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone, password }),
})
const loginText = await login.text()
let loginJson = null
try { loginJson = JSON.parse(loginText) } catch {}
console.log(`  POST /api/auth/admin-login -> ${login.status}`)
if (login.status !== 200) {
  console.log(`  body: ${loginText.slice(0, 300)}`)
  process.exit(1)
}
const token = loginJson?.token ?? loginJson?.accessToken
if (!token) {
  console.log(`  ! 200 but no token in the response: ${loginText.slice(0, 300)}`)
  process.exit(1)
}
const who = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
const whoJson = await who.json().catch(() => null)
console.log(`  GET /api/auth/me -> ${who.status}  role=${whoJson?.role}  phone=${whoJson?.phone ?? whoJson?.phoneE164}  displayName=${whoJson?.displayName}`)
if (who.status !== 200 || whoJson?.role !== 'admin') {
  console.log('  ! the session does not resolve to an admin account')
  process.exit(1)
}
const reports = await fetch(`${base}/api/admin/reports`, { headers: { authorization: `Bearer ${token}` } })
console.log(`  GET /api/admin/reports -> ${reports.status}`)
if (reports.status !== 200) process.exit(1)
console.log('  VERIFIED_ADMIN_LOGIN: PASS')
'@
[IO.File]::WriteAllText($verifyJs, $js, (New-Object Text.UTF8Encoding($false)))
$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
$vout = & node $verifyJs $Base $Phone $Password 2>&1
$vcode = $LASTEXITCODE
Remove-Item -LiteralPath $verifyJs -Force -ErrorAction SilentlyContinue
Remove-Item Env:\NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
$vout | ForEach-Object { Write-Host "  $_" }
if ($vcode -ne 0) {
  Fail 'the password was set but a real admin login did NOT succeed -- treat the admin login as broken'
}

Write-Host ''
Write-Host 'SET_ADMIN_PASSWORD: OK' -ForegroundColor Green
Write-Host "  phone    : $Phone"
if ($generated) {
  Write-Host "  password : $Password" -ForegroundColor Yellow
  Write-Host '  ^ save this now: it is not stored anywhere and will not be shown again.' -ForegroundColor Yellow
} else {
  Write-Host '  password : (the one you supplied)'
}
Write-Host '  verified : real admin login + authenticated admin request both succeeded'
exit 0
