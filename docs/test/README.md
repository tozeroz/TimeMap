# 测试与验收资料

## 功能测试

- [本地测试环境与验证命令](../public/local-testing.md)
- [发布流程检查](publish-flow-audit-2026-10-13.md)
- [发布流程回归结果](publish-v02-regression-results.json)
- [P0 交付与验证报告](TIMEMAP-P0-REPORT.md)

运行命令前先确认接口地址和账号属于本地测试环境。发布、点赞、删除等检查可能写入数据，不能直接在正式环境运行。

## 历史验收与实现依据

- [设备端验收](device-walkthrough.md)
- [界面一致性对比](comparison.md)
- [原版交互清单](original-interaction-map.md)
- [M0–M4 审计](AUDIT-M0-M4.md)
- [设备并发测试注意事项](DISCIPLINE-device-concurrency.md)
- [原版行为基线](original-baseline)
- [一致性核查记录](conformance)

`original-baseline/` 内的清单、截图、控件树和补采文件仍被验证脚本及代码引用，属于测试输入，不能作为临时截图清空。历史报告只证明记录当时的版本；当前版本测试应另行记录日期、提交和环境。

新增共享证据应能从报告找到；临时截图、重复运行日志和个人排查输出放在 `docs/local/` 或 `.local/`。
