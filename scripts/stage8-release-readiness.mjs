#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';

function hasArg(flag) {
  return process.argv.includes(flag);
}

function runCommand(label, command, args) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} 失败 (exit=${result.status ?? 'unknown'})`);
  }
}

function readText(filePath) {
  return readFileSync(filePath, 'utf-8');
}

function assertStatic(condition, message, failures) {
  if (condition) {
    console.log(`✅ ${message}`);
    return;
  }
  console.log(`❌ ${message}`);
  failures.push(message);
}

function runStaticChecks() {
  console.log('\n▶ 静态就绪检查（灰度与回滚资产）');
  const failures = [];

  const requiredFiles = [
    'supabase/functions/_shared/feature_rollout.ts',
    'supabase/functions/agent-chat/index.ts',
    'supabase/functions/agent-runtime/index.ts',
    'supabase/functions/_shared/agent_suggestions.ts',
    'scripts/stage8-data-consistency-check.mjs',
    'scripts/stage8-agent-runtime-check.mjs',
    'scripts/stage8-agent-quality-check.mjs',
    'docs/release/STAGE8_ROLLOUT_RUNBOOK.md',
  ];

  requiredFiles.forEach((file) => {
    assertStatic(existsSync(file), `文件存在: ${file}`, failures);
  });

  if (existsSync('supabase/functions/_shared/feature_rollout.ts')) {
    const rolloutCode = readText('supabase/functions/_shared/feature_rollout.ts');
    assertStatic(rolloutCode.includes('AGENT_ROLLOUT_STAGE'), '定义 AGENT_ROLLOUT_STAGE 开关', failures);
    assertStatic(rolloutCode.includes('FEATURE_AGENT_SUGGESTIONS_ENABLED'), '定义 suggestions 开关', failures);
    assertStatic(rolloutCode.includes('FEATURE_AGENT_PERSONALIZED_CONTEXT_ENABLED'), '定义 personalized 开关', failures);
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(readText('package.json'));
    const scripts = pkg.scripts || {};
    assertStatic(!!scripts['stage8:consistency'], 'package.json 含 stage8:consistency', failures);
    assertStatic(!!scripts['stage8:runtime'], 'package.json 含 stage8:runtime', failures);
    assertStatic(!!scripts['stage8:quality'], 'package.json 含 stage8:quality', failures);
    assertStatic(!!scripts['stage8:readiness'], 'package.json 含 stage8:readiness', failures);
  }

  return failures;
}

function printRollbackHint() {
  console.log('\nRollback/Gray 发布提示:');
  console.log('- 灰度阶段1: AGENT_ROLLOUT_STAGE=suggestions');
  console.log('- 灰度阶段1: FEATURE_AGENT_PERSONALIZED_CONTEXT_ENABLED=false');
  console.log('- 灰度阶段1: FEATURE_AGENT_SUGGESTIONS_ENABLED=true');
  console.log('- 全量阶段: AGENT_ROLLOUT_STAGE=personalized');
  console.log('- 回滚阶段: FEATURE_AGENT_CHAT_ENABLED=false（紧急止血）');
}

function main() {
  const runBuild = !hasArg('--skip-build');
  const runConsistency = hasArg('--with-consistency');
  const runQuality = hasArg('--with-quality');

  console.log('================================================================');
  console.log('Stage 8 发布就绪检查');
  console.log('================================================================');

  if (runBuild) {
    runCommand('构建检查', 'npm', ['run', 'build']);
  }

  const failures = runStaticChecks();
  if (failures.length > 0) {
    throw new Error(`静态检查失败 (${failures.length} 项)`);
  }

  if (runConsistency) {
    runCommand('数据一致性测试', 'node', ['scripts/stage8-data-consistency-check.mjs']);
  } else {
    console.log('\nℹ 未执行数据一致性测试（可加 --with-consistency）');
  }

  if (runQuality) {
    runCommand('Agent 质量测试', 'node', ['scripts/stage8-agent-quality-check.mjs']);
  } else {
    console.log('ℹ 未执行 Agent 质量测试（可加 --with-quality）');
  }

  printRollbackHint();
  console.log('\n✅ Stage 8 发布就绪检查通过');
}

try {
  main();
  process.exit(0);
} catch (error) {
  console.error('\n❌ Stage 8 发布就绪检查失败:', error instanceof Error ? error.message : error);
  process.exit(1);
}
