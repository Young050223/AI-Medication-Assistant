#!/usr/bin/env node
/**
 * @file run-ios-agent-e2e.mjs
 * @description 以 iOS 调用路径为基准的 Edge Function 自动化验收脚本
 * 目标: 使用中文药名验证翻译 → RxNorm → DailyMed/OpenFDA → OpenAI 总结链路
 *
 * 用法:
 *   node scripts/run-ios-agent-e2e.mjs
 *
 * 环境变量:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 */

import { readFileSync } from 'fs';

// 读取 .env 作为兜底（不打印）
function loadEnv() {
  try {
    const text = readFileSync('.env', 'utf-8');
    const get = (key) => {
      const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
      return m ? m[1].trim() : undefined;
    };
    return {
      url: get('VITE_SUPABASE_URL'),
      anonKey: get('VITE_SUPABASE_ANON_KEY'),
    };
  } catch {
    return {};
  }
}

const env = loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.url;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.anonKey;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ 缺少 Supabase URL 或 anon key，请配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const testCases = [
  { zh: '布洛芬', expect: 'ibuprofen' },
  { zh: '对乙酰氨基酚', expect: 'acetaminophen' },
  { zh: '阿莫西林', expect: 'amoxicillin' },
  { zh: '阿司匹林', expect: 'aspirin' },
  { zh: '地奈德乳膏', expect: 'desonide' },
  { zh: '左氧氟沙星片', expect: 'levofloxacin' },
  { zh: '奥美拉唑', expect: 'omeprazole' },
  { zh: '二甲双胍', expect: 'metformin' },
  { zh: '氯雷他定', expect: 'loratadine' },
];

function includesIgnoreCase(text, target) {
  return (text || '').toLowerCase().includes(target.toLowerCase());
}

function renderOverviewTable(items = []) {
  if (!items || items.length === 0) return '';
  const headers = ['步骤', '状态', '详情'];
  const rows = items.map((i) => [
    i.step,
    i.status,
    i.detail,
  ]);

  const all = [headers, ...rows];
  const widths = all[0].map((_, col) => Math.max(...all.map((row) => (row[col] ? String(row[col]).length : 0))));

  const line = (row) =>
    row
      .map((cell, idx) => {
        const text = cell ? String(cell) : '';
        return text + ' '.repeat(widths[idx] - text.length);
      })
      .join(' | ');

  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

async function runCase(idx, item) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };

  const url = `${SUPABASE_URL}/functions/v1/analyze-drug`;
  const body = { drugName: item.zh, language: 'zh-CN' };

  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - start;

  let json;
  try {
    json = await res.json();
  } catch {
    json = { success: false, error: '响应解析失败' };
  }

  const success = !!json.success;
  const normalized = json.data?.normalizedName || '';
  const rxcui = json.data?.rxcui || 'N/A';
  const aiOverview = json.data?.aiSummary?.overview || '';

  const nameMatched = includesIgnoreCase(normalized, item.expect);
  const translationLog = (json.workflowLogs || []).find((l) => l.step === 'step0.align' && l.status === 'success');
  const errors = (json.workflowLogs || []).filter((l) => l.status === 'error');
  const overviewTable = renderOverviewTable(json.workflowOverview);

  const pass = success && nameMatched;

  const status = pass ? '✅' : '❌';
  const detailParts = [
    `期望: ${item.expect}`,
    `标准名: ${normalized || '无'}`,
    `RxCUI: ${rxcui}`,
    `耗时: ${elapsed}ms`,
  ];
  if (translationLog?.meta?.rxcui) {
    detailParts.push(`对齐RxCUI: ${translationLog.meta.rxcui}`);
  }
  if (aiOverview) {
    detailParts.push(`AI概述: ${aiOverview.substring(0, 40)}…`);
  }

  const message = `${status} 用例${idx + 1}: 「${item.zh}」 → ${detailParts.join(' | ')}`;

  if (!pass) {
    const failReasons = [];
    if (!success) failReasons.push(`接口失败: ${json.error || '未知错误'}`);
    if (success && !nameMatched) failReasons.push('标准名未匹配期望');
    console.log(message);
    console.log(`    原始返回: ${JSON.stringify(json.data || json.error || json, null, 2).substring(0, 400)}${json.data ? '...' : ''}`);
    if (failReasons.length) {
      console.log(`    失败原因: ${failReasons.join('; ')}`);
    }
    if (overviewTable) {
      console.log('    概览表:');
      console.log(overviewTable.split('\n').map((l) => `    ${l}`).join('\n'));
    }
    if (errors.length) {
      console.log(`    监控错误: ${errors.map((e) => `${e.step}: ${e.message}`).join(' | ')}`);
    }
  } else {
    console.log(message);
    if (overviewTable) {
      console.log('    概览表:');
      console.log(overviewTable.split('\n').map((l) => `    ${l}`).join('\n'));
    }
    if (errors.length) {
      console.log(`    监控错误: ${errors.map((e) => `${e.step}: ${e.message}`).join(' | ')}`);
    }
  }

  return pass;
}

async function main() {
  console.log('================ iOS Agent 自动化验收（Edge Function 调用） ================');
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`用例数: ${testCases.length}`);
  console.log('--------------------------------------------------------------------------');

  let passed = 0;
  for (let i = 0; i < testCases.length; i++) {
    try {
      const ok = await runCase(i, testCases[i]);
      if (ok) passed += 1;
    } catch (e) {
      console.log(`❌ 用例${i + 1}: 「${testCases[i].zh}」 异常: ${e.message || e}`);
    }
  }

  console.log('--------------------------------------------------------------------------');
  console.log(`总结: ${passed}/${testCases.length} 通过`);
  if (passed === testCases.length) {
    console.log('🎉 全部通过');
  } else {
    console.log('⚠️ 存在失败用例，请检查以上日志');
  }
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(1);
});
