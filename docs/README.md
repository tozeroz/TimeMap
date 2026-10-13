# 项目文档入口

文档存放和维护请遵循 [文档管理约定](public/文档管理约定.md)。

| 目录 | 用途 |
| --- | --- |
| [public/](public/) | 需求、设计、项目说明和长期维护的公共文档 |
| [test/](test/) | 测试说明、验收报告、审计资料和原版行为基线 |
| [pending/](pending/) | 作者尚未确认的工作记录、AI 续作资料和阶段文档，待队友认领 |
| `姓名或统一缩写/` | 认领后的个人模块分析和草稿，例如 `zwf/` |
| `local/` | 无需提交的本地草稿、日志和临时产物，已加入 `.gitignore` |

## 公共文档

- [需求分析与产品设计](public/BJTUTimeMap需求分析与产品设计文档.md)
- [详细功能设计](public/product/BJTU%20TimeMap详细功能设计文档.md)
- [页面地图](public/page-map.md)
- [地图、发帖和摄像头能力说明](public/real-map-and-posting.md)
- [网页端说明](public/WEB-FRONTEND.md)
- [真机安装与登录](public/PHONE-INSTALL.md)
- [HTTPS 证书说明](public/TLS-IP-CERTIFICATE.md)
- [第三方资产来源登记](public/LICENSING-NOTES.md)

## 测试与验收

- [P0 交付与验证报告](test/TIMEMAP-P0-REPORT.md)
- [设备端验收](test/device-walkthrough.md)
- [一致性对比报告](test/comparison.md)
- [原版交互清单](test/original-interaction-map.md)
- [M0–M4 审计](test/AUDIT-M0-M4.md)
- [设备测试协作注意事项](test/DISCIPLINE-device-concurrency.md)
- [原版行为基线及证据](test/original-baseline/)
- [一致性核查记录](test/conformance/)

## 待认领资料

认领方式见 [pending/README.md](pending/README.md)。阶段文档中的测试证据暂时随原工作记录一起保留，认领后再区分正式测试资料和个人过程记录。

本次整理日期：2026-10-12。原路径与新路径的对应关系见 [文档迁移清单](public/文档迁移清单.json)。整理仅调整位置和路径引用，未重新核实历史文档中的实现状态或验收结论。
