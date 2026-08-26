# Stage 8 测试、灰度与上线 Runbook

## 1. 目标
- 完成三类测试：数据一致性、Agent 质量、上线回滚演练。
- 提供可配置灰度策略：先放开云端主存储 + suggestions，再放开完整个性化回答。
- 确保出现异常时可在分钟级回滚。

## 2. 环境变量（Supabase Edge Functions）
- `AGENT_ROLLOUT_STAGE`
  - `off`：关闭 Agent（仅保留基础页面）。
  - `cloud_storage`：仅基础链路，建议配合 suggestions 开关使用。
  - `suggestions`：开放建议问题生成，不开放完整个性化上下文编排。
  - `personalized`：开放完整个性化回答（默认阶段）。
- `FEATURE_AGENT_CHAT_ENABLED`
  - `false` 时，`agent-chat` 返回 503（紧急止血开关）。
- `FEATURE_AGENT_SUGGESTIONS_ENABLED`
  - 控制 `agent-bootstrap` / `generate-agent-suggestions`。
- `FEATURE_AGENT_PERSONALIZED_CONTEXT_ENABLED`
  - 控制 `agent-chat` 是否启用完整六段式上下文编排。

## 3. 自动化脚本

### 3.1 数据一致性测试
```bash
npm run stage8:consistency
```
覆盖点：
- 计划跨设备可见与更新同步。
- `medication_logs` 在 `user_id,schedule_id,scheduled_date,reminder_id` 维度幂等 upsert。
- 反馈跨设备可见。

### 3.2 Agent 质量测试
```bash
npm run stage8:quality
```
覆盖点：
- suggestions 返回 4-6 条问题。
- agent-chat 返回有效回复，且通过结构化 `contextUsed.sourceTags` 暴露来源。
- `contextUsed.sourceTags` 命中关键上下文。
- chat-history 中 assistant 消息保留 `contextUsed` 元数据。
- agent-runtime 可完成 bootstrap/get/update，前端可展示运行状态与快慢思考模式。

可选配置：
- `STAGE8_QUALITY_STRICT=true|false`（默认 true）
- `STAGE8_REQUIRED_TAGS=doctor_prescription,health_profile,...`

### 3.3 发布就绪总检查
```bash
# 仅构建 + 静态就绪检查
npm run stage8:readiness

# 加跑联调脚本
npm run stage8:readiness -- --with-consistency --with-quality
```

## 4. 灰度步骤

### 阶段 A（灰度）
目标：先验证云端主存储与问题建议稳定性。

建议配置：
- `AGENT_ROLLOUT_STAGE=suggestions`
- `FEATURE_AGENT_SUGGESTIONS_ENABLED=true`
- `FEATURE_AGENT_PERSONALIZED_CONTEXT_ENABLED=false`
- `FEATURE_AGENT_CHAT_ENABLED=true`

观测重点：
- 首页/计划页/反馈页/病历页数据展示是否一致。
- Agent 入场建议问题是否稳定生成，延迟是否可接受。

### 阶段 B（全量）
目标：开放完整个性化回答。

建议配置：
- `AGENT_ROLLOUT_STAGE=personalized`
- `FEATURE_AGENT_PERSONALIZED_CONTEXT_ENABLED=true`
- `FEATURE_AGENT_SUGGESTIONS_ENABLED=true`
- `FEATURE_AGENT_CHAT_ENABLED=true`

观测重点：
- `contextUsed.sourceTags` 是否覆盖预期上下文源。
- 前端展示的来源标签、思考模式与用户状态是否一致。
- `agent_runtime_states` 是否记录最新生命周期、上下文标签与待确认动作数量。

## 5. 回滚策略

### 5.1 软回滚（保留 Agent 壳）
- 将 `FEATURE_AGENT_PERSONALIZED_CONTEXT_ENABLED=false`
- 保留 suggestions，回退到基础回答链路。

### 5.2 中级回滚（仅关闭 suggestions）
- 将 `FEATURE_AGENT_SUGGESTIONS_ENABLED=false`
- 前端会收到稳定兜底问题，不阻断入口。

### 5.3 紧急回滚（全关闭）
- 将 `FEATURE_AGENT_CHAT_ENABLED=false`
- `agent-chat` 直接返回 503，避免错误扩散。

## 6. 手动验收清单（模拟器）
- 登录后在首页查看下一次服药、依从率、风险摘要。
- 在计划页确认“来源/同步状态”可见。
- 在反馈页确认云端历史可见。
- 在病历上传页确认“已保存处方”可见且可刷新。
- 进入 Agent 前看到动态建议问题。
- 发送问题后，页面展示快/慢思考标签与结构化参考来源。
- 切换自动/快/慢思考偏好后，下一轮回答按偏好更新。
- 退出并重新登录后，关键数据不丢失、跨页一致。

## 7. 失败处理
- 若脚本失败：先记录 trace id，再按回滚策略降级。
- 若页面数据显示不一致：优先核查 Supabase RLS、网络异常和 feature flag 配置。
- 若 Agent 回复质量下降：先关 `FEATURE_AGENT_PERSONALIZED_CONTEXT_ENABLED`，保留 suggestions。
