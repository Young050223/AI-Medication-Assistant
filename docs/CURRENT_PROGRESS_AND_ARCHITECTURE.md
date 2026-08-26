# Current Progress and Architecture Handoff

Last updated: 2026-08-26

## Purpose

This document is a fast handoff snapshot for continuing development on another device. It summarizes what has been built, how the main pieces fit together, and which commands to run after cloning or pulling the repository.

## Current Product State

- The app is a Vite + React 19 + TypeScript medication assistant with a Capacitor iOS shell.
- The primary user surface is a 4-tab mobile-style app: home, AI agent, medication schedule, and profile/settings.
- Supabase is the backend boundary. The browser client calls Supabase tables and project-owned Edge Functions, not third-party AI providers directly.
- The medication schedule flow supports local/cloud persistence, per-date overrides, confirmation windows, taken/missed logs, and generated schedules from saved prescription records.
- The Agent flow has moved beyond simple chat. It now supports context-aware answers, suggested questions, voice transcription, runtime state, background tasks, and user-confirmed actions.
- Stage 8 rollout assets exist for data consistency checks, Agent runtime checks, Agent quality checks, and staged feature-flag rollout.

## Main Frontend Architecture

### App Shell

- `src/App.tsx` is the top-level page state machine.
- It keeps the current page and bottom tab in local React state.
- It prewarms Agent runtime and suggested questions once the user is authenticated.
- It routes between login/register, health profile, home, medical record upload, schedule, feedback, Agent chat, and settings.

### Pages

- `src/pages/LandingPage.tsx`
  - Home dashboard for next dose, adherence, risk summary, quick schedule entry, and Agent entry.
  - Uses `useMedicationSchedule`, `useMedicationInsights`, and `useHealthProfile`.
- `src/pages/MedicationSchedulePage.tsx`
  - Schedule management, date-specific edits, delete-scope handling, reminders, and taken/missed state.
- `src/pages/MedicationFeedbackPage.tsx`
  - Medication feedback capture and cloud/local history.
- `src/pages/MedicalRecordUploadPage.tsx`
  - Medical record and prescription input flow.
  - Saves prescriptions and can generate medication schedules from prescription items.
- `src/pages/AgentChatPage.tsx`
  - Main Agent interface.
  - Shows suggested prompts, markdown replies, thinking mode, runtime state, voice input, conversation history, and pending action confirmation.
- `src/pages/SettingsPage.tsx`
  - Language, theme, font size, Agent style, profile entry, and logout controls.

### Shared UI

- `src/components/Icons.tsx` contains custom project icons.
- `src/components/BottomNavBar.tsx` implements the mobile bottom navigation.
- `src/components/ConfirmDoseModal.tsx` and `src/components/PreDoseInstructionModal.tsx` handle medication confirmation UX.
- `src/components/AgentActionConfirmModal.tsx` handles pending Agent actions, including editable medication plan change previews.

### Hooks and Client State

- `src/context/AuthContext.tsx` wraps Supabase Auth and exposes app-level user state.
- `src/hooks/user/useAuth.ts` consumes auth context.
- `src/hooks/user/useHealthProfile.ts` stores and syncs health profile data, and vectorizes profile content for Agent context.
- `src/hooks/user/useAgentPreferences.ts` manages Agent response style preferences.
- `src/hooks/medication/useMedicationSchedule.ts` is the main schedule model for local/cloud schedules, reminders, date overrides, logs, and invalidation events.
- `src/hooks/medication/useMedicationFeedback.ts` manages medication feedback and local-to-cloud migration.
- `src/hooks/medication/useMedicationInsights.ts` derives home-dashboard medication insights.
- `src/hooks/agent/useAgentChat.ts` owns the current chat session, local chat cache, backend calls, pending action state, and confirmation/cancel flow.
- `src/hooks/agent/useConversationHistory.ts` lists, loads, and deletes saved conversations.
- `src/hooks/agent/useAgentRuntimeFeed.ts` polls Agent runtime state, events, tasks, memory highlights, and pending actions.
- `src/hooks/common/useAudioRecorder.ts`, `useCamera.ts`, `useSpeechRecognition.ts`, and `useLocalStorage.ts` isolate native/browser capabilities.

## Frontend Service Boundary

- `src/services/supabase.ts`
  - Creates the Supabase client and mock-mode fallback checks.
- `src/services/agentApi.ts`
  - Calls project-owned Edge Functions:
    - `analyze-drug`
    - `check-risks`
    - `generate-embedding`
    - `vectorize-document`
    - `voice-feedback-assist`
    - `agent-voice-transcribe`
    - `chat-history`
    - `agent-runtime`
    - `agent-bootstrap`
    - `generate-agent-suggestions`
    - `agent-presets`
    - `agent-chat`
- `src/services/agentCommandApi.ts`
  - Confirms, cancels, or fetches pending Agent action requests through `agent-command`.
- `src/services/medicalRecordApi.ts`
  - Saves medical records and prescription items.
  - Generates medication schedules from prescription items with repeat-safe replacement per source record.

## Backend and Data Architecture

### Existing Core Tables

- User and health profiles are defined in early migrations.
- Medication schedules, logs, and feedback support the core medication workflow.
- Chat conversations and messages support persistent Agent conversation history.
- RAG documents and vector embeddings support semantic recall.
- Medical records and prescription items support prescription capture and schedule generation.
- Drug knowledge cache supports medication safety lookups.

### Agent Runtime Tables

- `supabase/migrations/017_agent_runtime_actions.sql`
  - Adds Agent action request, action log, and context access log tables.
  - This is the audit and confirmation foundation for Agent-triggered operations.
- `supabase/migrations/018_medication_plan_change_sets.sql`
  - Adds medication plan change sets and change items.
  - Adds transactional apply behavior for multi-step plan updates.
- `supabase/migrations/019_agent_runtime_state_and_tasks.sql`
  - Adds Agent runtime state, background tasks, memory facts, and runtime events.
  - Tracks lifecycle status, fast/slow thinking preference, context tags, trigger signals, task counts, pending action counts, and visible Agent events.

### Edge Functions

- `supabase/functions/agent-chat/index.ts`
  - Main Agent orchestration endpoint.
  - Selects fast/slow thinking policy, gathers context, plans confirmed actions, writes conversation history, and updates runtime state.
- `supabase/functions/agent-command/index.ts`
  - Executes confirmed Agent actions.
  - Currently supports the medication plan change-set path and updates action/runtime status.
- `supabase/functions/agent-runtime/index.ts`
  - Bootstrap/feed/CRUD endpoint for runtime state, tasks, events, memory, and pending actions.
- `supabase/functions/agent-bootstrap/index.ts`
  - Prewarms Agent state and suggested question context.
- `supabase/functions/generate-agent-suggestions/index.ts`
  - Generates or returns suggested Agent questions with rollout-aware fallback behavior.
- `supabase/functions/agent-voice-transcribe/index.ts`
  - Agent chat voice transcription endpoint.
- `supabase/functions/voice-feedback-assist/index.ts`
  - Medication feedback voice assist endpoint.
- `supabase/functions/health-profile-public/index.ts`
  - Non-sensitive health profile projection endpoint, intended to remain feature-gated/controlled.
- `supabase/functions/analyze-drug`, `check-risks`, `generate-embedding`, and `vectorize-document`
  - Drug analysis, risk checks, embedding, and RAG ingestion utilities.

## Rollout and Verification Assets

- `docs/AGENT_BACKEND_EXECUTION_PROGRESS.md`
  - Detailed Agent backend progress tracker.
- `docs/release/STAGE8_ROLLOUT_RUNBOOK.md`
  - Rollout, rollback, feature flags, and manual acceptance checklist.
- `scripts/stage8-data-consistency-check.mjs`
  - Cross-device schedule/log/feedback consistency checks.
- `scripts/stage8-agent-runtime-check.mjs`
  - Runtime, current medication projection, and change-set execution checks.
- `scripts/stage8-agent-quality-check.mjs`
  - Agent suggestions, context source tags, history metadata, runtime bootstrap, and quality checks.
- `scripts/stage8-release-readiness.mjs`
  - Build and static release-readiness runner with optional consistency and quality checks.
- `scripts/maestro/agent-login-and-chat.yaml`
  - Mobile automation script for login and Agent chat smoke testing.

## How To Continue On Another Device

1. Clone or pull the repository:

   ```bash
   git clone https://github.com/Young050223/AI-Medication-Assistant.git
   cd AI-Medication-Assistant
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create local environment files as needed. Do not commit them:

   ```bash
   cp .env.example .env.local
   ```

   If `.env.example` does not exist yet, create `.env.local` manually with at least:

   ```bash
   VITE_SUPABASE_URL=<your-supabase-url>
   VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
   ```

4. Run the web app:

   ```bash
   npm run dev
   ```

5. Verify the current codebase:

   ```bash
   npm run build
   npm run stage8:readiness
   ```

6. If continuing iOS work:

   ```bash
   npm run ios:rebuild
   ```

7. If Supabase migrations/functions need to be applied from the new device, use the Supabase project credentials and deploy in order:

   ```bash
   supabase db push
   supabase functions deploy
   ```

## Important Environment Variables

### Frontend

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Supabase Edge Functions

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Provider keys used by project-owned Edge Functions, such as OpenAI/Qwen/OpenFDA keys where configured.
- `AGENT_ROLLOUT_STAGE`
- `FEATURE_AGENT_CHAT_ENABLED`
- `FEATURE_AGENT_SUGGESTIONS_ENABLED`
- `FEATURE_AGENT_PERSONALIZED_CONTEXT_ENABLED`

## Current Known Risks

- The repository still contains development logging in multiple frontend and Edge Function files. CLI scripts also intentionally print progress with `console.log`.
- The project does not currently expose a dedicated `npm test` script. The available verification path is build plus Stage 8 scripts.
- Some Supabase validation depends on real project credentials and deployed migrations/functions.
- iOS simulator parity depends on running `npm run ios:rebuild` after frontend or asset changes.
- `README.md` is still the default Vite template and should be replaced with a project-specific README when time allows.

## Recommended Next Work

- Replace the template `README.md` with project-specific setup and architecture notes.
- Add a formal test runner, most likely Vitest plus focused hook/service tests.
- Decide which runtime logging should stay in Edge Functions and remove leftover frontend debugging logs.
- Finish Supabase deployment documentation, including migration order, function deploy list, and required secrets.
- Run the Stage 8 scripts against the deployed Supabase project after every backend-affecting change.
