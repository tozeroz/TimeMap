#!/usr/bin/env bash
# ⚠️ 本文件已被**取代**，保留为 tombstone（墓碑），不再执行任何检查。
#
# ## 为什么被取代（审核记录 55 的裁定）
#   本脚本实现的不变量是：
#       「**每个已注册的** HTTP 方法都必须在 CORS 的 allow-methods 里」
#   审核 55 判定它 **过强**：
#     「将来可能存在 server route exists but intentionally not callable from
#       WebView/browser。这时强迫它进入 CORS allow-methods 反而**扩大暴露面**。」
#
#   正确的不变量是：
#       「**每一个被 WebView/browser 客户端实际调用**的 HTTP method，
#         都必须通过**真实 CORS preflight contract**。」
#
#   → 取代者：`scripts/m5/check-cors-contract.sh`
#     · 它从**客户端源码** `app/src/api/client.ts` 提取客户端真正使用的 method
#       （而不是从服务端路由表取）
#     · 对每个这样的 method 发**真实预检**（Origin + Access-Control-Request-Method
#       + Access-Control-Request-Headers），校验：
#         2xx/204 ／ allow-origin 回显 ／ allow-methods 含该方法 ／ allow-headers 含所请求的非简单头
#     · 并有配套敏感度自测 `scripts/m5/selftest-cors-contract.sh`（三种受控破坏必须被检出）
#
# ## 为什么保留成墓碑而不是直接删
#   本项目有过"同一个检查被重写后两个版本并存、后来的人跑错那个"的经历。
#   留一份**说明为什么换掉**的墓碑，比静默删除更能防止回退。
#
# 现在要跑 CORS 检查请执行：
#   bash scripts/m5/check-cors-contract.sh      # 需要 /tmp/client-methods-input.txt（部署侧提供）
#   bash scripts/m5/selftest-cors-contract.sh   # 证明它能红（敏感度）

echo "本脚本已被取代，不再执行任何检查。" >&2
echo "正确的不变量是「客户端实际调用的 method 必须通过真实预检契约」。" >&2
echo "请改用：bash scripts/m5/check-cors-contract.sh（+ selftest-cors-contract.sh）" >&2
exit 2
