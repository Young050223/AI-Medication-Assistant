import { readFileSync } from 'node:fs';

const pageSource = readFileSync('src/pages/AgentChatPage.tsx', 'utf8');
const cssSource = readFileSync('src/pages/AgentChatPage.css', 'utf8');
const agentStyleSource = readFileSync('supabase/functions/_shared/agent_style.ts', 'utf8');

const checks = [
  {
    ok: pageSource.includes("from 'react-markdown'"),
    message: 'AgentChatPage should render assistant replies with react-markdown.',
  },
  {
    ok: pageSource.includes("from 'remark-gfm'"),
    message: 'AgentChatPage should enable remark-gfm for lists, tables, and emphasis.',
  },
  {
    ok: /<ReactMarkdown[\s\S]*remarkPlugins=\{\[remarkGfm\]\}/.test(pageSource),
    message: 'Assistant reply renderer should pass remarkGfm to ReactMarkdown.',
  },
  {
    ok: /<ReactMarkdown[\s\S]*skipHtml/.test(pageSource),
    message: 'Assistant reply renderer should skip raw HTML for safety.',
  },
  {
    ok: /msg\.role === 'assistant'[\s\S]*renderAssistantMessageContent\(msg\.content\)/.test(pageSource),
    message: 'Assistant messages should use the structured markdown renderer.',
  },
  {
    ok: cssSource.includes('.assistant-markdown h2') && cssSource.includes('.assistant-markdown li'),
    message: 'Assistant markdown should have dedicated heading and list styles.',
  },
  {
    ok: !agentStyleSource.includes('不要使用 Markdown'),
    message: 'Agent style prompt should no longer forbid Markdown layout.',
  },
  {
    ok: agentStyleSource.includes('使用有限 Markdown 排版'),
    message: 'Agent style prompt should request lightweight Markdown layout.',
  },
];

const failures = checks.filter((check) => !check.ok);

if (failures.length > 0) {
  console.error('Agent message layout check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.message}`);
  }
  process.exit(1);
}

process.stdout.write('Agent message layout check passed.\n');
