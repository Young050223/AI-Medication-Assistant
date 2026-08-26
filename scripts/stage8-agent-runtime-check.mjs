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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dateOffsetKey(days) {
  const date = new Date(`${todayKey()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function main() {
  const config = readConfig();
  ensureRequiredConfig(config, ['supabaseUrl', 'supabaseAnonKey', 'email', 'password']);

  printSuiteHeader('Stage 8 - Agent Runtime 联调测试（017/018 变更集 + 当前用药投影）');

  const auth = createAuthedClient(config);
  const { session, user } = await auth.login();
  const client = auth.client;
  const userId = user.id;
  const token = session.access_token;

  const runTag = `stage8-runtime-${Date.now()}`;
  const activeScheduleId = crypto.randomUUID();
  const expiredScheduleId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const changeSetId = crypto.randomUUID();
  const oldMedicationName = `${runTag}-旧方案`;
  const newMedicationName = `${runTag}-新方案`;
  const editedMedicationName = `${runTag}-新方案-手改`;
  const activeReminderId = `${activeScheduleId}-template-08:00-0`;
  const expiredReminderId = `${expiredScheduleId}-template-21:00-0`;
  const today = todayKey();
  const yesterday = dateOffsetKey(-1);
  const twoDaysAgo = dateOffsetKey(-2);
  let createdScheduleIds = [];

  try {
    printStep('1.', '验证 agent-runtime CRUD：bootstrap/get/update');
    const runtimeBootstrap = await callEdgeFunction(
      config,
      token,
      'agent-runtime',
      {
        action: 'bootstrap',
        contextTags: ['health_profile', 'medication_schedule'],
        triggerSignals: ['stage8_runtime_check'],
        contextSummary: 'Stage 8 runtime CRUD 联调预热',
      },
      `${runTag}-runtime-bootstrap`
    );
    assert(runtimeBootstrap.ok, `agent-runtime(bootstrap) 返回异常: status=${runtimeBootstrap.status}`);
    assert(runtimeBootstrap.data?.success === true, `agent-runtime(bootstrap) success=false: ${runtimeBootstrap.data?.error || 'unknown'}`);
    assert(runtimeBootstrap.data?.runtimeState?.lifecycleStatus === 'ready', 'runtimeState.lifecycleStatus 不是 ready');
    assert(
      Array.isArray(runtimeBootstrap.data?.runtimeState?.lastContextTags)
        && runtimeBootstrap.data.runtimeState.lastContextTags.includes('health_profile'),
      'runtimeState.lastContextTags 未持久化 bootstrap 上下文标签'
    );

    const runtimeUpdate = await callEdgeFunction(
      config,
      token,
      'agent-runtime',
      {
        action: 'update',
        thinkingModePreference: 'slow',
      },
      `${runTag}-runtime-update`
    );
    assert(runtimeUpdate.ok, `agent-runtime(update) 返回异常: status=${runtimeUpdate.status}`);
    assert(runtimeUpdate.data?.success === true, `agent-runtime(update) success=false: ${runtimeUpdate.data?.error || 'unknown'}`);
    assert(runtimeUpdate.data?.runtimeState?.thinkingModePreference === 'slow', 'thinkingModePreference 未更新为 slow');

    const runtimeRestore = await callEdgeFunction(
      config,
      token,
      'agent-runtime',
      {
        action: 'update',
        thinkingModePreference: 'auto',
      },
      `${runTag}-runtime-restore`
    );
    assert(runtimeRestore.ok, `agent-runtime(restore) 返回异常: status=${runtimeRestore.status}`);
    assert(runtimeRestore.data?.runtimeState?.thinkingModePreference === 'auto', 'thinkingModePreference 未恢复为 auto');

    printStep('2.', '准备测试数据：当前活跃计划 + 已结束计划');
    const insertSchedules = await client
      .from('medication_schedules')
      .insert([
        {
          id: activeScheduleId,
          user_id: userId,
          medication_name: oldMedicationName,
          medication_dosage: '1片',
          frequency: 'onceDaily',
          reminders: [{ id: activeReminderId, time: '08:00', dosage: '1片' }],
          instructions: `${runTag}-active-seed`,
          status: 'active',
          start_date: today,
          end_date: null,
          allow_window_minutes: 20,
          date_overrides: {},
        },
        {
          id: expiredScheduleId,
          user_id: userId,
          medication_name: `${runTag}-已结束方案`,
          medication_dosage: '2片',
          frequency: 'onceDaily',
          reminders: [{ id: expiredReminderId, time: '21:00', dosage: '2片' }],
          instructions: `${runTag}-expired-seed`,
          status: 'active',
          start_date: twoDaysAgo,
          end_date: yesterday,
          allow_window_minutes: 20,
          date_overrides: {},
        },
      ])
      .select('id');
    if (insertSchedules.error) {
      throw new Error(`插入测试计划失败: ${insertSchedules.error.message}`);
    }

    printStep('3.', '验证当前用药投影：过期 active 计划不能再算 current');
    const projectionBefore = await client.rpc('get_medication_schedule_projection', {
      target_user_id: userId,
      as_of_date: today,
    });
    if (projectionBefore.error) {
      throw new Error(`调用 get_medication_schedule_projection 失败: ${projectionBefore.error.message}`);
    }

    const beforeRows = Array.isArray(projectionBefore.data) ? projectionBefore.data : [];
    const activeRow = beforeRows.find((item) => item.id === activeScheduleId);
    const expiredRow = beforeRows.find((item) => item.id === expiredScheduleId);
    assert(activeRow, '投影中缺少当前活跃计划');
    assert(expiredRow, '投影中缺少已结束计划');
    assert(activeRow.is_current === true, '当前活跃计划的 is_current 不是 true');
    assert(String(activeRow.effective_status || '') === 'active', '当前活跃计划 effective_status 不是 active');
    assert(expiredRow.is_current === false, '已结束计划的 is_current 不是 false');
    assert(String(expiredRow.effective_status || '') === 'completed', '已结束计划 effective_status 不是 completed');

    printStep('4.', '创建待确认动作与多步变更集');
    const requestInsert = await client
      .from('agent_action_requests')
      .insert({
        id: requestId,
        user_id: userId,
        command_name: 'medication_plan.apply_change_set',
        thinking_mode: 'slow',
        confirmation_state: 'required',
        request_status: 'pending',
        priority: 'high',
        title: `${runTag}-用药变更`,
        summary: '停用旧方案并启用新方案',
        payload: { changeSetId },
        context_snapshot: {
          ui: {
            impactDescription: '联调校验变更集执行链路',
            impactPoints: ['停用旧方案', '创建新方案'],
            previewSections: [
              { title: '将停用的计划', items: [oldMedicationName] },
              { title: '将新增的计划', items: [newMedicationName] },
            ],
            riskLevel: 'medium',
            confirmHint: '仅用于自动化联调验证',
          },
        },
        requires_confirmation: true,
      })
      .select('id')
      .single();
    if (requestInsert.error) {
      throw new Error(`插入 agent_action_requests 失败: ${requestInsert.error.message}`);
    }

    const changeSetInsert = await client
      .from('medication_plan_change_sets')
      .insert({
        id: changeSetId,
        user_id: userId,
        request_id: requestId,
        title: `${runTag}-change-set`,
        summary: 'runtime 联调测试',
        effective_date: today,
        change_status: 'pending',
        preview_payload: {
          previewSections: [
            { title: '将停用的计划', items: [oldMedicationName] },
            { title: '将新增的计划', items: [newMedicationName] },
          ],
        },
      })
      .select('id')
      .single();
    if (changeSetInsert.error) {
      throw new Error(`插入 medication_plan_change_sets 失败: ${changeSetInsert.error.message}`);
    }

    const changeItemsInsert = await client
      .from('medication_plan_change_items')
      .insert([
        {
          change_set_id: changeSetId,
          user_id: userId,
          sort_order: 0,
          operation_kind: 'archive',
          target_schedule_id: activeScheduleId,
          medication_name: oldMedicationName,
          reminder_times: [],
          end_date: today,
          status_after: 'completed',
          notes: '归档旧方案',
        },
        {
          change_set_id: changeSetId,
          user_id: userId,
          sort_order: 1,
          operation_kind: 'create',
          medication_name: newMedicationName,
          medication_dosage: '0.5片',
          frequency: 'twiceDaily',
          instructions: `${runTag}-create-new`,
          reminder_times: ['09:00', '21:00'],
          start_date: today,
          end_date: null,
          status_after: 'active',
          notes: '启用新方案',
        },
      ])
      .select('id');
    if (changeItemsInsert.error) {
      throw new Error(`插入 medication_plan_change_items 失败: ${changeItemsInsert.error.message}`);
    }
    const insertedChangeItems = Array.isArray(changeItemsInsert.data) ? changeItemsInsert.data : [];

    printStep('5.', '调用 agent-command，先带编辑稿确认执行变更集');
    const confirmResult = await callEdgeFunction(
      config,
      token,
      'agent-command',
      {
        action: 'confirm',
        requestId,
        editedPlan: {
          effectiveDate: today,
          operations: [
            {
              changeItemId: insertedChangeItems[0]?.id,
              operationKind: 'archive',
              targetScheduleId: activeScheduleId,
              targetMedicationName: oldMedicationName,
              medicationName: oldMedicationName,
              endDate: today,
              notes: '归档旧方案',
            },
            {
              changeItemId: insertedChangeItems[1]?.id,
              operationKind: 'create',
              medicationName: editedMedicationName,
              medicationDosage: '1片',
              frequency: 'twiceDaily',
              instructions: `${runTag}-edited-create`,
              reminderTimes: ['10:00', '22:00'],
              startDate: today,
              notes: '使用手动编辑后的最终版本',
            },
          ],
        },
      },
      `${runTag}-confirm`
    );
    assert(confirmResult.ok, `agent-command 返回异常: status=${confirmResult.status}`);
    assert(confirmResult.data?.success === true, `agent-command success=false: ${confirmResult.data?.error || 'unknown'}`);
    assert(confirmResult.data?.status === 'succeeded', `agent-command 执行状态异常: ${confirmResult.data?.status || 'empty'}`);

    printStep('6.', '校验请求状态、变更集状态与计划落库结果');
    const requestQuery = await client
      .from('agent_action_requests')
      .select('request_status, confirmation_state')
      .eq('id', requestId)
      .eq('user_id', userId)
      .maybeSingle();
    if (requestQuery.error) {
      throw new Error(`查询 agent_action_requests 失败: ${requestQuery.error.message}`);
    }
    assert(requestQuery.data?.request_status === 'succeeded', 'agent_action_requests.request_status 不是 succeeded');
    assert(requestQuery.data?.confirmation_state === 'confirmed', 'agent_action_requests.confirmation_state 不是 confirmed');

    const changeSetQuery = await client
      .from('medication_plan_change_sets')
      .select('change_status, execution_result')
      .eq('id', changeSetId)
      .eq('user_id', userId)
      .maybeSingle();
    if (changeSetQuery.error) {
      throw new Error(`查询 medication_plan_change_sets 失败: ${changeSetQuery.error.message}`);
    }
    assert(changeSetQuery.data?.change_status === 'applied', 'medication_plan_change_sets.change_status 不是 applied');

    const allTaggedSchedules = await client
      .from('medication_schedules')
      .select('id, medication_name, status, start_date, end_date')
      .eq('user_id', userId)
      .like('medication_name', `${runTag}%`);
    if (allTaggedSchedules.error) {
      throw new Error(`查询变更后计划失败: ${allTaggedSchedules.error.message}`);
    }

    const taggedSchedules = Array.isArray(allTaggedSchedules.data) ? allTaggedSchedules.data : [];
    createdScheduleIds = taggedSchedules.map((item) => item.id);
    const archivedOld = taggedSchedules.find((item) => item.id === activeScheduleId);
    const createdNew = taggedSchedules.find((item) => item.medication_name === editedMedicationName);
    assert(archivedOld?.status === 'completed', '旧方案状态未被归档为 completed');
    assert(!!createdNew?.id, '未找到新创建的计划');
    assert(createdNew?.status === 'active', '新创建计划状态不是 active');

    printStep('7.', '再次验证当前用药投影：新方案 current=true，旧方案 current=false');
    const projectionAfter = await client.rpc('get_medication_schedule_projection', {
      target_user_id: userId,
      as_of_date: today,
    });
    if (projectionAfter.error) {
      throw new Error(`再次调用投影 RPC 失败: ${projectionAfter.error.message}`);
    }

    const afterRows = Array.isArray(projectionAfter.data) ? projectionAfter.data : [];
    const oldAfter = afterRows.find((item) => item.id === activeScheduleId);
    const newAfter = afterRows.find((item) => item.medication_name === editedMedicationName);
    assert(oldAfter?.is_current === false, '旧方案在变更后仍被视为 current');
    assert(String(oldAfter?.effective_status || '') === 'completed', '旧方案 effective_status 不是 completed');
    assert(newAfter?.is_current === true, '新方案在变更后未被视为 current');
    assert(String(newAfter?.effective_status || '') === 'active', '新方案 effective_status 不是 active');

    printStep('✅', '017/018 Agent Runtime 联调测试通过');
  } finally {
    printStep('8.', '清理联调测试数据');

    if (createdScheduleIds.length > 0) {
      await client
        .from('medication_schedules')
        .delete()
        .eq('user_id', userId)
        .in('id', createdScheduleIds);
    } else {
      await client
        .from('medication_schedules')
        .delete()
        .eq('user_id', userId)
        .in('id', [activeScheduleId, expiredScheduleId]);
    }

    await client
      .from('medication_plan_change_sets')
      .delete()
      .eq('id', changeSetId)
      .eq('user_id', userId);

    await client
      .from('agent_action_requests')
      .delete()
      .eq('id', requestId)
      .eq('user_id', userId);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Stage 8 Agent Runtime 联调测试失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
