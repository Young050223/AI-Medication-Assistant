#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { assert, printStep, printSuiteHeader } from './_stage8_common.mjs';

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), 'utf-8');
}

function fileExists(path) {
  return existsSync(join(root, path));
}

printSuiteHeader('Stage 8 - Agent Runtime Phase 1 contract check');

printStep('1.', '检查数据库 runtime substrate');
const migration = read('supabase/migrations/019_agent_runtime_state_and_tasks.sql');
assert(migration.includes('CREATE TABLE IF NOT EXISTS agent_runtime_states'), '缺少 agent_runtime_states');
assert(migration.includes('CREATE TABLE IF NOT EXISTS agent_background_tasks'), '缺少 agent_background_tasks');
assert(migration.includes('CREATE TABLE IF NOT EXISTS agent_memory_facts'), '缺少 agent_memory_facts');
assert(migration.includes('CREATE TABLE IF NOT EXISTS agent_runtime_events'), '缺少 agent_runtime_events');
assert(migration.includes('confidence'), 'agent_memory_facts 缺少 confidence');
assert(migration.includes('acknowledged_at'), 'agent_runtime_events 缺少 acknowledged_at');

printStep('2.', '检查 thinking policy');
assert(fileExists('supabase/functions/_shared/agent_runtime/thinking_policy.ts'), '缺少 thinking_policy.ts');
const policy = read('supabase/functions/_shared/agent_runtime/thinking_policy.ts');
assert(policy.includes('selectAgentThinkingPolicy'), 'thinking policy 缺少 selectAgentThinkingPolicy');
assert(policy.includes('reasonCodes'), 'thinking policy 缺少可审计 reasonCodes');
assert(!policy.includes('chainOfThought'), '禁止落库或返回隐藏 chain-of-thought');

printStep('3.', '检查 runtime Edge Function CRUD');
assert(fileExists('supabase/functions/agent-runtime/index.ts'), '缺少 agent-runtime Edge Function');
const runtimeFunction = read('supabase/functions/agent-runtime/index.ts');
['bootstrap', 'update_state', 'create_task', 'ack_event', 'create_memory', 'revoke_memory'].forEach((action) => {
  assert(runtimeFunction.includes(action), `agent-runtime 缺少 ${action} action`);
});

printStep('4.', '检查 agent-chat 接入 policy 与 runtime 状态');
const chat = read('supabase/functions/agent-chat/index.ts');
assert(chat.includes('selectAgentThinkingPolicy'), 'agent-chat 未接入 selectAgentThinkingPolicy');
assert(chat.includes('thinkingPolicy'), 'agent-chat 响应缺少 thinkingPolicy 摘要');
assert(chat.includes('modelReasoningEffort'), 'agent-chat 未把 policy 映射到模型 reasoning effort');

printStep('5.', '检查 Agent 动作 payload 契约');
const command = read('supabase/functions/agent-command/index.ts');
assert(chat.includes('normalizeAgentActionPlan(parsed)'), 'agent-chat 未在落库前归一化动作 payload');
assert(chat.includes('medication_feedback.create payload'), 'agent-chat 动作规划提示缺少反馈创建 payload schema');
assert(command.includes('normalizeMedicationFeedbackPayload(payload)'), 'agent-command 未归一化反馈 payload 后再入库');
assert(command.includes('payload.medication_name'), 'agent-command 未兼容 planner 可能输出的 snake_case 药名字段');
assert(command.includes('payload.feedbackContent'), 'agent-command 未兼容 planner 可能输出的反馈正文别名');

printStep('6.', '检查用药计划待确认流程契约');
assert(chat.includes('normalizeMedicationPlanChangeSetPlan(parsed'), 'agent-chat 未归一化用药计划变更日期，可能生成历史计划');
assert(chat.includes('用户没有明确指定开始日期'), '用药计划规划提示缺少默认从今天开始的约束');
assert(chat.includes('shouldSuppressTextReplyForPendingPreview'), 'agent-chat 创建预览弹窗时未抑制聊天追问');
assert(chat.includes('shouldPersistAssistantReply'), 'agent-chat 未跳过空回复落库');
const useAgentChat = read('src/hooks/agent/useAgentChat.ts');
assert(useAgentChat.includes('assistantReply'), 'useAgentChat 未跳过空 Agent 回复气泡');

printStep('7.', '检查前端 runtime feed');
assert(fileExists('src/hooks/agent/useAgentRuntimeFeed.ts'), '缺少 useAgentRuntimeFeed hook');
const agentApi = read('src/services/agentApi.ts');
assert(agentApi.includes('fetchAgentRuntimeBootstrap'), 'agentApi 缺少 fetchAgentRuntimeBootstrap');
assert(agentApi.includes('ackAgentRuntimeEvent'), 'agentApi 缺少 ackAgentRuntimeEvent');
const agentPage = read('src/pages/AgentChatPage.tsx');
assert(agentPage.includes('useAgentRuntimeFeed'), 'AgentChatPage 未展示 runtime feed');

printStep('✅', 'Agent Runtime Phase 1 contract check passed');
