# AI Medication Assistant - 开发日志

## 2026-03-07 — 服药计划编辑修复 + RAG/对话历史基础设施

### Bug修复
- **服药计划编辑保存后不生效** — 修复 `MedicationSchedulePage.tsx` `doSave` 函数中的多处关键Bug：
  - 修复未定义变量 `targetDateKey`、`targetSource` 导致运行时崩溃
  - 修复"仅今天"范围在所有提醒过期时静默丢弃编辑
  - 修复"未来所有"范围今天的 dateOverride 使用旧值而非编辑后新值
  - **重写编辑保存逻辑**：简化为直接覆盖模式 — "仅今天"写入 dateOverride，"未来所有"冻结过去日期并更新 base schedule
- 修复 `useMedicationSchedule` Hook 中 taken 状态泄漏到所有日期的 Bug（引入按日期隔离的 `takenRecords`）

### 新增功能
- **RAG 文档基础设施** — 新增 `007_rag_documents.sql` 迁移（统一向量存储表）
- **对话历史 Hook** — 新增 `useConversationHistory.ts`
- **日期工具库** — 新增 `src/utils/dateKey.ts`（本地日期格式化/解析，避免 UTC 漂移）
- **向量化文档 Edge Function** — 新增 `supabase/functions/vectorize-document/`
- **对话历史 Edge Function** — 新增 `supabase/functions/chat-history/`

### 优化
- Agent 聊天页面 UI 改版（`AgentChatPage.tsx` + CSS）
- 确认服药弹窗优化（`ConfirmDoseModal.tsx`）
- 底部导航栏样式调整
- 设置页面样式更新

---

## 2026-03-05 — 用药计划增强

### 新增功能
- **按日期服药记录隔离** — 引入 `TakenRecords` 按日期+提醒ID隔离服药状态，修复 taken 状态泄漏到所有日期的 Bug
- **编辑范围确认弹窗** — 编辑计划保存时弹出「仅今天 / 未来全部」范围选择对话框
- **状态切换弹窗** — 已服用/已错过状态标签可点击弹出切换弹窗
- **确认时间窗口** — 新增 `graceMinutes` 表单字段，可配置确认按钮的 ±时间窗口

### 优化
- 反馈按钮改用统一 `ConfirmDoseModal` 组件
- 状态弹窗、编辑按钮、删除按钮 UI 优化
- 去除首页闹钟 emoji
- 新增相关 i18n 翻译键

---

## 2026-02-14 — Phase 2：Agent 对话 + 日历 + 设计系统重构

### 新增功能
- **Agent 对话模块**
  - 新增 `agent-chat` Edge Function（GPT-5.3 多轮对话）
  - 新增 `useAgentChat` Hook 和 `AgentChatPage`（Gemini 风格 UI）
  - 新增 `chat_conversations` & `chat_messages` 数据库表（迁移 006）

- **自定义 Apple 风格日历** — `MedicationSchedulePage` 集成月视图日历，用药日标注圆点

- **设置页面** — 新增 `SettingsPage`（语言/主题/个人资料/会员区）

### 设计系统重构
- **Warm Minimalist 设计语言** — 莫兰迪色调、Nunito 字体、双主题支持
- **SVG 图标系统** — 新增 `Icons.tsx` 包含 35 个 Feather 风格 SVG 图标，替换全部 emoji
- **全局 CSS 重构** — 毛玻璃效果、平滑渐变、微动画
- OpenAI 模型升级：gpt-5.3（对话）、gpt-5.2（分析）

---

## 2026-02-10 — M7 AI Agent 药物分析模块 + 项目重构

### 新增功能
- **M7 AI Agent 药物分析模块**
  - 新增 `AgentAnalysisPage` — AI药物分析页面，支持药物信息查询、风险检测
  - 新增 `AgentAnalysisPage.css` — 药物分析页面样式
  - 新增 `src/types/Agent.types.ts` — Agent模块类型定义
  - 新增 `src/services/agentApi.ts` — Agent API服务层
  - 新增 `src/hooks/agent/useAgentAnalysis.ts` — Agent分析业务Hook

- **Supabase Edge Functions（AI后端）**
  - 新增 `supabase/functions/analyze-drug/` — 药物分析Edge Function
  - 新增 `supabase/functions/check-risks/` — 风险检测Edge Function
  - 新增 `supabase/functions/generate-embedding/` — 向量嵌入生成Edge Function
  - 新增 `supabase/functions/_shared/` — 共享工具模块

- **数据库迁移**
  - 新增 `supabase/migrations/005_vector_embeddings.sql` — 向量嵌入表

### 重构优化
- **Hooks目录结构重组**
  - 将hooks按功能模块分类：`agent/`、`common/`、`medication/`
  - 新增 `src/hooks/common/useCamera.ts` — 相机Hook
  - 新增 `src/hooks/medication/useMedicationExtractor.ts` — 药物提取Hook
  - 新增 `src/hooks/medication/useMedicationFeedback.ts` — 用药反馈Hook
  - 新增 `src/hooks/medication/useMedicationSchedule.ts` — 用药计划Hook

- **页面模块重写**（移除.bak备份文件）
  - 重写 `MedicalRecordUploadPage` — 病历上传页面
  - 重写 `MedicationSchedulePage` — 用药计划页面

- **路由更新** — `App.tsx` 新增Agent分析页面路由
- **i18n翻译扩展** — 新增Agent模块中英文翻译键
- **首页导航优化** — `LandingPage.tsx` 新增AI分析入口
- **用药反馈优化** — `MedicationFeedbackPage.tsx` 业务逻辑优化

### 安全改进
- `.gitignore` 新增 `.env`、`.bak`、`supabase/.temp/` 排除规则
- 从Git追踪中移除 `.env` 文件（含API密钥）

### Bug修复（同日晚间）
- 优化药物分析翻译逻辑，修复中文药名到英文的翻译链路
- 新增 E2E 测试脚本

---

## 2026-02-03 — M9 多语言支持 + 翻译Bug修复

### 新增功能
- 实现i18next国际化框架集成
- 支持中英文自动切换（基于系统语言检测）
- 全模块翻译覆盖：首页、病历、用药计划、反馈、Agent分析

### Bug修复
- 修复中文药名未正确翻译为英文导致的药物识别错误

---

## 2026-01-30 — 首页数据同步修复

### Bug修复
- 修复首页用药计划数据不同步问题
- 优化 `useMedicationSchedule` Hook数据刷新逻辑

---

## 2026-01-28 — M5 用药反馈模块

### 新增功能
- 实现语音输入用药反馈（Capacitor Speech Recognition插件）
- 新增 `MedicationFeedbackPage` 页面
- 适老化UI设计（大字体、高对比度）

---

## 2026-01-27 — M3 病例识别 + M4 服药计划

### 新增功能
- **M3 病历识别模块** — OCR拍照识别病历信息
- **M4 服药计划管理** — 自动生成用药计划、提醒设置
- **首页Landing Page** — 底部导航栏、功能入口
- **M1 用户认证** — Supabase Auth登录/注册
- **M2 健康档案** — 用户健康信息管理
