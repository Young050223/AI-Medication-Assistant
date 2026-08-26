# Agent 后端能力升级实时进度表

最后更新: 2026-03-26 Asia/Shanghai

## 目标

在保留现有首页第一入口和当前 UI 展示结构的前提下，为系统新增 Agent 可调用的后端能力层、快慢思考路由、确认机制、审计机制，以及对外非敏感健康档案投影能力。

## 总览

| 模块 | 目标 | 状态 | 进度 | 备注 |
| --- | --- | --- | --- | --- |
| 进度表与方案固化 | 建立实施基线和可追踪状态 | 已完成 | 100% | 文档已建立并持续更新 |
| Agent 运行时 | 增加快思考/慢思考路由与动作规划 | 已完成 | 92% | 已新增多步变更集规划，并收口“未执行不得声称已执行” |
| Agent 命令层 | 新增 Agent 专用后端命令入口 | 已完成 | 90% | 已支持 `medication_plan.apply_change_set` 事务执行 |
| 确认与审计 | 增加待确认动作、执行日志、上下文访问日志 | 已完成 | 90% | 待确认动作、变更集、上下文访问日志已串联 |
| 前端最小接入 | 聊天页接入待确认弹窗和执行结果回显 | 已完成 | 95% | 已升级为统一变更预览弹窗，并接入执行后刷新 |
| 对外投影接口 | 预留非敏感健康档案接口 | 已完成 | 70% | 已新增默认关闭的投影接口 |
| Agent 状态与后台任务 | 持久化运行态、预热任务、快慢思考偏好并展示到前端 | 已完成 | 85% | `019` 已接入 `agent-runtime`、`agent-chat`、`agent-bootstrap` 与聊天页状态条 |
| 联调与验证 | 回归现有流程并验证 Agent 新能力 | 已完成 | 100% | 已用测试账号完成 runtime、consistency、quality 三条真实联调 |

## 分阶段清单

| 阶段 | 工作项 | 状态 | 输出 |
| --- | --- | --- | --- |
| P0 | 固化方案、建立进度表、确认工作区风险 | 已完成 | 实施基线文档 |
| P1 | 新增数据库迁移：动作请求、动作日志、上下文访问日志 | 已完成 | `017_agent_runtime_actions.sql` |
| P2 | 抽离 Agent runtime 共享模块 | 已完成 | `_shared/agent_runtime/*` |
| P3 | 新增 `agent-command` Edge Function | 已完成 | 命令入口与命令执行骨架 |
| P4 | 升级 `agent-chat`：快慢思考、命令规划、待确认回复 | 已完成 | 新聊天执行链路 |
| P5 | 前端接入确认弹窗与命令调用 API | 已完成 | 新 service/hook/modal |
| P6 | 增加对外非敏感档案投影接口 | 已完成 | `health-profile-public` |
| P7 | 引入“当前用药统一投影”与多步计划变更集 | 已完成 | `018_medication_plan_change_sets.sql`、`medication_plan.apply_change_set` |
| P8 | 联调、验证、更新文档 | 已完成 | runtime / consistency / quality 全部通过 |
| P9 | 接入 Agent runtime state 与后台任务 CRUD | 已完成 | `agent-runtime`、`useAgentRuntimeFeed`、聊天页状态展示 |

## 当前阻塞与风险

| 项目 | 级别 | 说明 | 处理方式 |
| --- | --- | --- | --- |
| 工作区已有大量未提交改动 | 中 | 需要避免覆盖用户已有修改 | 只做增量修改，精确避开无关逻辑 |
| 当前前端大量直连表操作 | 中 | Agent 新命令层与现有手动链路需并存 | 采用“新增命令层”而不是替换 |
| 现有 Agent 返回结构较简单 | 中 | 需要扩展为可表达待确认动作和执行结果 | 同步升级前后端协议 |
| 仓库缺少 `supabase/config.toml` | 中 | 当前无法直接跑 Supabase CLI migration lint | 先做静态校验，后续在可用环境执行真实迁移验证 |
| 当前执行环境到 Supabase Auth 偶发 TLS 抖动 | 中 | `supabase-js` 登录偶发 `ECONNRESET`，会干扰自动化联调 | 已增加 curl 回退与 token 直连模式，联调可继续执行 |

## 最新进展

| 时间 | 进展 |
| --- | --- |
| 2026-03-26 | 完成实施方案确认，建立实时进度表，准备开始代码改造 |
| 2026-03-26 | 完成 Agent 动作迁移表、共享 runtime 类型与确认规则 |
| 2026-03-26 | 完成 `agent-command`、`agent-chat` 快慢思考与待确认动作闭环接入 |
| 2026-03-26 | 完成聊天页确认弹窗接入，并通过 `npm run build`、`deno check` 验证 |
| 2026-03-26 | 完成多步用药计划变更集模型、统一当前用药投影 RPC、Agent 统一变更预览弹窗升级 |
| 2026-03-26 | 收口活跃/历史用药上下文边界，避免已结束疗程继续混入“当前活跃用药”语境 |
| 2026-04-09 | 017/018 已部署后，补充 `stage8-agent-runtime-check.mjs`，覆盖当前用药投影与变更集执行联调链路 |
| 2026-04-09 | 通过 `npm run build`、`npm run stage8:readiness -- --skip-build` 与脚本语法校验 |
| 2026-04-09 | 使用测试账号完成 `stage8:runtime`、`stage8:consistency`、`stage8:quality` 真实联调，三条链路全部通过 |
| 2026-04-09 | 为联调脚本补充 Auth 抖动兜底：curl 回退登录、token 直连模式，以及按“当前有效处方”口径修正质量校验 |
| 2026-05-09 | 从 Agent CRUD 审查断点继续，接入 `019_agent_runtime_state_and_tasks.sql`：新增 `agent-runtime` CRUD、bootstrap 状态落盘、chat/command 生命周期写入、前端 runtime 状态条与快慢思考偏好 |
