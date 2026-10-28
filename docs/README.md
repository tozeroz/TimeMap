# TimeMap 项目文档

日常开发先看[开发、Git 协作与服务器发布](public/development-and-deployment.md)，文档维护遵循[文档管理约定](public/文档管理约定.md)。整理日期：2026-10-27。

| 目录 | 用途 |
| --- | --- |
| [public/](public) | 需求、设计、项目说明和长期维护的公共文档 |
| [test/](test) | 测试说明、验收报告、审计资料和原版行为基线 |
| [zwf/](zwf/README.md) | zwf 的个人模块分析、草稿和开发记录；有协作价值的资料可提交 |
| `local/` | 仅本机的草稿、截图、日志与备份；整体被 Git 忽略 |
| [archive/](archive/README.md) | 早期阶段规范、设计和评审资料；不作为当前任务指令 |

## 公共文档

- [开发、Git 协作与服务器发布](public/development-and-deployment.md)
- [完整本地测试环境](public/local-testing.md)
- [需求分析与产品设计](public/BJTUTimeMap需求分析与产品设计文档.md)
- [详细功能设计](public/product/BJTU%20TimeMap详细功能设计文档.md)
- [地图地标地点清单](public/地图地标地点清单.md)
- [HTTPS 证书说明](public/TLS-IP-CERTIFICATE.md)
- [第三方资产来源登记](public/LICENSING-NOTES.md)

## 测试与验收

- [测试文档入口](test/README.md)
- [P0 交付与验证报告](test/TIMEMAP-P0-REPORT.md)
- [设备端验收](test/device-walkthrough.md)
- [一致性对比报告](test/comparison.md)
- [原版交互清单](test/original-interaction-map.md)
- [M0–M4 审计](test/AUDIT-M0-M4.md)
- [设备测试协作注意事项](test/DISCIPLINE-device-concurrency.md)
- [原版行为基线及证据](test/original-baseline)
- [一致性核查记录](test/conformance)

## 历史资料与本次清理

历史资料入口见[历史资料分类](archive/README.md)及[公共文档归档](public/archive/README.md)。上次已删除 116 份无引用阶段输出或过期提示；此次将原 `pending/` 移入 `archive/legacy-development/`，并将 7 份旧公共资料移入 `public/archive/`。相应链接和脚本引用已更新。测试基线继续保留在 `test/`。

历史报告中的“通过”“待办”“已部署”只代表记录当时的状态，不能用来判断当前线上版本。旧目录迁移关系见[文档迁移清单](public/archive/文档迁移清单.json)。本机备份、删除和本次分类清单位于 `docs/local/backups/`，不提交 Git；团队成员也可通过 Git 历史追溯已提交的旧资料。
