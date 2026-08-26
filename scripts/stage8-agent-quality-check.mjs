#!/usr/bin/env node

import {
  assert,
  callEdgeFunction,
  createAuthedClient,
  ensureRequiredConfig,
  printStep,
  printSuiteHeader,
  readConfig,
} from './_stage8_common.mjs';

function parseTagList(raw, fallback) {
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(raw, defaultValue = false) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

async function main() {
  const config = readConfig();
  ensureRequiredConfig(config, ['supabaseUrl', 'supabaseAnonKey', 'email', 'password']);

  const strictMode = parseBoolean(process.env.STAGE8_QUALITY_STRICT, true);
  const requiredTags = parseTagList(
    process.env.STAGE8_REQUIRED_TAGS,
    ['doctor_prescription', 'health_profile', 'medication_schedule', 'medication_logs', 'medication_feedback']
  );
  const requiredTagGroups = [
    ['chat_history', 'conversation_summary'],
  ];
  const optionalTagGroups = [
    ['drug_label_api', 'drug_knowledge_rag'],
  ];

  printSuiteHeader('Stage 8 - Agent 质量测试（上下文命中 + 回答质量）');
  printStep('配置', `strictMode=${strictMode ? 'ON' : 'OFF'}`);

  const auth = createAuthedClient(config);
  const { session, user } = await auth.login();
  const client = auth.client;
  const token = session.access_token;
  const tracePrefix = `stage8-quality-${Date.now()}`;

  let conversationId = null;
  const tagUnion = new Set();

  try {
    printStep('0.', '预检查测试账号的处方数据可用性');
    const projectedSchedules = await client.rpc('get_medication_schedule_projection', {
      target_user_id: user.id,
      as_of_date: new Date().toISOString().slice(0, 10),
    });
    const currentDoctorPrescriptionCount = Array.isArray(projectedSchedules.data)
      ? projectedSchedules.data.filter((item) => item?.is_current === true && !!item?.source_record_id).length
      : 0;
    const hasDoctorPrescriptionData = currentDoctorPrescriptionCount > 0;
    printStep('0.', `当前有效处方数据可用: ${hasDoctorPrescriptionData ? 'YES' : 'NO'} (count=${currentDoctorPrescriptionCount})`);

    printStep('1.', '检查 agent-bootstrap 个性化问题生成');
    const suggestionEndpoints = [
      'agent-bootstrap',
      'agent-presets',
      'generate-agent-suggestions',
    ];
    let bootstrap = null;
    let bootstrapEndpoint = '';

    for (const endpoint of suggestionEndpoints) {
      const result = await callEdgeFunction(
        config,
        token,
        endpoint,
        { language: 'zh-CN', forceRefresh: true },
        `${tracePrefix}-${endpoint}`
      );
      if (result.ok) {
        bootstrap = result;
        bootstrapEndpoint = endpoint;
        break;
      }
      printStep('1.', `${endpoint} 不可用，status=${result.status}，尝试下一个入口`);
    }

    assert(bootstrap, '建议问题入口全部不可用');
    assert(bootstrap.ok, `${bootstrapEndpoint} 返回异常: status=${bootstrap.status}`);
    printStep('1.', `建议问题入口命中: ${bootstrapEndpoint}`);
    assert(bootstrap.data?.success === true, `agent-bootstrap success=false: ${bootstrap.data?.error || 'unknown'}`);
    assert(Array.isArray(bootstrap.data?.questions), 'agent-bootstrap questions 不是数组');
    const questionCount = bootstrap.data.questions.length;
    assert(questionCount >= 3 && questionCount <= 4, `agent-bootstrap 问题数量异常: ${questionCount}`);

    printStep('2.', '首轮 agent-chat（触发完整上下文编排）');
    const firstChat = await callEdgeFunction(
      config,
      token,
      'agent-chat',
      {
        conversationId: undefined,
        language: 'zh-CN',
        medications: [],
        message: '请结合我的健康档案、处方、用药记录、反馈和计划，给我今天的服药重点，并指出风险。',
      },
      `${tracePrefix}-chat-1`
    );
    assert(firstChat.ok, `agent-chat(1) 返回异常: status=${firstChat.status}`);
    assert(firstChat.data?.success === true, `agent-chat(1) success=false: ${firstChat.data?.error || 'unknown'}`);
    conversationId = firstChat.data?.conversationId || null;
    assert(conversationId, 'agent-chat(1) 未返回 conversationId');

    const firstReply = String(firstChat.data?.reply || '');
    assert(firstReply.length >= 20, 'agent-chat(1) 回复内容过短');
    const firstTags = Array.isArray(firstChat.data?.contextUsed?.sourceTags)
      ? firstChat.data.contextUsed.sourceTags.map((item) => String(item))
      : [];
    assert(firstTags.length > 0, 'agent-chat(1) 缺少 contextUsed.sourceTags');
    assert(!/(依据|依據|basis)\s*[:：]/i.test(firstReply), 'agent-chat(1) 仍包含旧式“依据:”文本段落');
    firstTags.forEach((tag) => tagUnion.add(tag));

    printStep('3.', '第二轮 agent-chat（验证会话上下文延续）');
    const secondChat = await callEdgeFunction(
      config,
      token,
      'agent-chat',
      {
        conversationId,
        language: 'zh-CN',
        medications: [],
        message: '继续上一个回答，告诉我今天最优先的两个执行动作。',
      },
      `${tracePrefix}-chat-2`
    );
    assert(secondChat.ok, `agent-chat(2) 返回异常: status=${secondChat.status}`);
    assert(secondChat.data?.success === true, `agent-chat(2) success=false: ${secondChat.data?.error || 'unknown'}`);
    const secondReply = String(secondChat.data?.reply || '');
    assert(secondReply.length >= 12, 'agent-chat(2) 回复内容过短');
    const secondTags = Array.isArray(secondChat.data?.contextUsed?.sourceTags)
      ? secondChat.data.contextUsed.sourceTags.map((item) => String(item))
      : [];
    secondTags.forEach((tag) => tagUnion.add(tag));

    printStep('4.', '检查 chat-history 元数据持久化');
    const messagesRes = await callEdgeFunction(
      config,
      token,
      'chat-history',
      {
        action: 'messages',
        conversationId,
      },
      `${tracePrefix}-history`
    );
    assert(messagesRes.ok, `chat-history(messages) 返回异常: status=${messagesRes.status}`);
    assert(messagesRes.data?.success === true, `chat-history(messages) success=false: ${messagesRes.data?.error || 'unknown'}`);

    const allMessages = Array.isArray(messagesRes.data?.messages) ? messagesRes.data.messages : [];
    const assistantMessages = allMessages.filter((item) => item?.role === 'assistant');
    assert(assistantMessages.length >= 1, 'chat-history 未返回 assistant 消息');
    const persistedTagHit = assistantMessages.some(
      (item) => Array.isArray(item?.contextUsed?.sourceTags) && item.contextUsed.sourceTags.length > 0
    );
    assert(persistedTagHit, 'chat-history 的 assistant 消息缺少 contextUsed.sourceTags 持久化');

    const tagList = Array.from(tagUnion);
    printStep('标签', `本轮命中标签: ${tagList.join(', ') || '(空)'}`);

    if (strictMode) {
      const effectiveRequiredTags = hasDoctorPrescriptionData
        ? requiredTags
        : requiredTags.filter((tag) => tag !== 'doctor_prescription');
      const missingSingles = effectiveRequiredTags.filter((tag) => !tagUnion.has(tag));
      assert(missingSingles.length === 0, `缺少关键上下文标签: ${missingSingles.join(', ')}`);

      const missingGroups = requiredTagGroups.filter(
        (group) => !group.some((tag) => tagUnion.has(tag))
      );
      assert(
        missingGroups.length === 0,
        `缺少关键标签组命中: ${missingGroups.map((group) => `[${group.join(' | ')}]`).join(', ')}`
      );

      const missingOptionalGroups = optionalTagGroups.filter(
        (group) => !group.some((tag) => tagUnion.has(tag))
      );
      if (missingOptionalGroups.length > 0) {
        printStep(
          '提示',
          `未命中可选药物知识标签组: ${missingOptionalGroups.map((group) => `[${group.join(' | ')}]`).join(', ')}`
        );
      }
    }

    printStep('✅', `Agent 质量测试通过（用户 ${user.id}）`);
  } finally {
    if (conversationId) {
      await callEdgeFunction(
        config,
        token,
        'chat-history',
        {
          action: 'delete',
          conversationId,
        },
        `${tracePrefix}-cleanup`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Stage 8 Agent 质量测试失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
