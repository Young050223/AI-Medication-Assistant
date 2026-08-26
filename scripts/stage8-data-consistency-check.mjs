#!/usr/bin/env node

import {
  assert,
  createAuthedClient,
  ensureRequiredConfig,
  printStep,
  printSuiteHeader,
  readConfig,
  waitUntil,
} from './_stage8_common.mjs';

async function main() {
  const config = readConfig();
  ensureRequiredConfig(config, ['supabaseUrl', 'supabaseAnonKey', 'email', 'password']);

  printSuiteHeader('Stage 8 - 数据一致性测试（云端主存储 + 多端一致）');

  const clientA = createAuthedClient(config);
  const clientB = createAuthedClient(config);

  printStep('1.', '登录设备 A/B');
  const [{ user: userA }, { user: userB }] = await Promise.all([
    clientA.login(),
    clientB.login(),
  ]);
  assert(userA.id === userB.id, 'A/B 登录用户不一致，无法执行一致性测试');
  const userId = userA.id;

  const runTag = `stage8-${Date.now()}`;
  const scheduleId = crypto.randomUUID();
  const reminderId = `${scheduleId}-template-09:00-0`;
  const today = new Date().toISOString().slice(0, 10);
  let feedbackId = null;

  try {
    printStep('2.', '设备 A 新建用药计划，设备 B 校验可见');
    const scheduleInsert = await clientA.client
      .from('medication_schedules')
      .insert({
        id: scheduleId,
        user_id: userId,
        medication_name: `${runTag}-阿莫西林`,
        medication_dosage: '0.5g',
        frequency: 'thriceDaily',
        reminders: [{ id: reminderId, time: '09:00', dosage: '0.5g' }],
        instructions: `${runTag}-init`,
        status: 'active',
        start_date: today,
        allow_window_minutes: 20,
        date_overrides: {},
      })
      .select('id')
      .single();
    if (scheduleInsert.error) {
      throw new Error(`新增计划失败: ${scheduleInsert.error.message}`);
    }

    const foundOnB = await waitUntil(async () => {
      const { data, error } = await clientB.client
        .from('medication_schedules')
        .select('id')
        .eq('id', scheduleId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return false;
      return !!data?.id;
    }, { timeoutMs: 12000, intervalMs: 500 });
    assert(foundOnB, '设备 B 未在时限内读取到设备 A 新增计划');

    printStep('3.', '设备 B 修改计划，设备 A 校验更新同步');
    const patchedInstruction = `${runTag}-updated-by-B`;
    const scheduleUpdate = await clientB.client
      .from('medication_schedules')
      .update({ instructions: patchedInstruction })
      .eq('id', scheduleId)
      .eq('user_id', userId)
      .select('id')
      .single();
    if (scheduleUpdate.error) {
      throw new Error(`设备 B 更新计划失败: ${scheduleUpdate.error.message}`);
    }

    const syncedToA = await waitUntil(async () => {
      const { data, error } = await clientA.client
        .from('medication_schedules')
        .select('instructions')
        .eq('id', scheduleId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return false;
      return data?.instructions === patchedInstruction;
    }, { timeoutMs: 12000, intervalMs: 500 });
    assert(syncedToA, '设备 A 未在时限内读取到设备 B 的计划更新');

    printStep('4.', '验证 medication_logs reminder 维度幂等 upsert');
    const upsertPayloadBase = {
      user_id: userId,
      schedule_id: scheduleId,
      medication_name: `${runTag}-阿莫西林`,
      dosage: '0.5g',
      scheduled_time: '09:00',
      scheduled_date: today,
      reminder_id: reminderId,
      confirmed_by: 'manual',
    };

    const firstUpsert = await clientA.client
      .from('medication_logs')
      .upsert({
        ...upsertPayloadBase,
        status: 'pending',
        taken_at: null,
      }, {
        onConflict: 'user_id,schedule_id,scheduled_date,reminder_id',
      });
    if (firstUpsert.error) {
      throw new Error(`第一次 upsert 打卡失败: ${firstUpsert.error.message}`);
    }

    const secondUpsert = await clientA.client
      .from('medication_logs')
      .upsert({
        ...upsertPayloadBase,
        status: 'taken',
        taken_at: new Date().toISOString(),
        notes: `${runTag}-upsert-overwrite`,
      }, {
        onConflict: 'user_id,schedule_id,scheduled_date,reminder_id',
      });
    if (secondUpsert.error) {
      throw new Error(`第二次 upsert 打卡失败: ${secondUpsert.error.message}`);
    }

    const logQuery = await clientB.client
      .from('medication_logs')
      .select('id,status,notes')
      .eq('user_id', userId)
      .eq('schedule_id', scheduleId)
      .eq('scheduled_date', today)
      .eq('reminder_id', reminderId);
    if (logQuery.error) {
      throw new Error(`查询幂等打卡结果失败: ${logQuery.error.message}`);
    }
    assert(Array.isArray(logQuery.data) && logQuery.data.length === 1, '幂等 upsert 后记录数不是 1');
    assert(logQuery.data[0].status === 'taken', '幂等 upsert 后状态不是 taken');

    printStep('5.', '设备 B 提交反馈，设备 A 校验云端可见');
    const feedbackInsert = await clientB.client
      .from('medication_feedback')
      .insert({
        user_id: userId,
        schedule_id: scheduleId,
        medication_name: `${runTag}-阿莫西林`,
        mood: 'neutral',
        content: `${runTag}-反馈同步校验`,
        side_effects: ['dizziness'],
      })
      .select('id')
      .single();
    if (feedbackInsert.error || !feedbackInsert.data?.id) {
      throw new Error(`插入反馈失败: ${feedbackInsert.error?.message || 'unknown'}`);
    }
    feedbackId = feedbackInsert.data.id;

    const feedbackFoundOnA = await waitUntil(async () => {
      const { data, error } = await clientA.client
        .from('medication_feedback')
        .select('id,content')
        .eq('id', feedbackId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return false;
      return !!data?.id && String(data.content || '').includes(runTag);
    }, { timeoutMs: 12000, intervalMs: 500 });
    assert(feedbackFoundOnA, '设备 A 未在时限内读取到设备 B 提交的反馈');

    printStep('✅', '数据一致性测试通过');
  } finally {
    printStep('6.', '清理测试数据');
    if (feedbackId) {
      await clientA.client.from('medication_feedback').delete().eq('id', feedbackId);
    }

    await clientA.client
      .from('medication_logs')
      .delete()
      .eq('user_id', userId)
      .eq('schedule_id', scheduleId)
      .eq('scheduled_date', today)
      .eq('reminder_id', reminderId);

    await clientA.client
      .from('medication_schedules')
      .delete()
      .eq('id', scheduleId)
      .eq('user_id', userId);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Stage 8 数据一致性测试失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
