import assert from 'node:assert/strict'
import {
  deriveProcessMaintenanceRunPresentation,
  isActionableProcessMaintenanceRun,
  parseProcessMaintenanceRunHistory,
  parseProcessMaintenanceRunLedgerItem,
} from '../src/lib/processMaintenanceRunHistory.ts'

const proposal = {
  runId: 'run-proposal',
  capability: 'process-maintenance',
  procesId: 'service-aanvraag',
  processRevision: 7,
  status: 'completed',
  resultaatStatus: 'voorstel',
  provider: 'OpenAI',
  model: 'gpt-test',
  gestartDoor: 'beheerder@example.test',
  gestartOp: '2026-07-28T10:00:00.000Z',
  afgerondOp: '2026-07-28T10:00:03.250Z',
  duurMs: 3250,
  inputHash: 'sha256:input',
  outputHash: 'sha256:output',
  vraagAantal: 0,
  issueAantal: 2,
  wijzigingAantal: 1,
}

const accepted = {
  ...proposal,
  runId: 'run-accepted',
  feedback: {
    beslissing: 'accepted',
    reden: 'Getoetst met de proceseigenaar.',
    geaccepteerdeWijzigingIds: ['change-1'],
    doorGebruiker: 'proceseigenaar@example.test',
    op: '2026-07-28T10:05:00+02:00',
  },
}

const issueOnlyProposal = {
  ...proposal,
  runId: 'run-issue-only',
  issueAantal: 1,
  wijzigingAantal: 0,
}

const runningBeforeProvider = {
  runId: 'run-running',
  capability: 'process-maintenance',
  procesId: 'service-aanvraag',
  processRevision: 7,
  status: 'running',
  provider: null,
  model: null,
  gestartDoor: 'beheerder@example.test',
  gestartOp: '2026-07-28T10:10:00Z',
  vraagAantal: 0,
  issueAantal: 0,
  wijzigingAantal: 0,
}

const cancelled = {
  ...runningBeforeProvider,
  runId: 'run-cancelled',
  status: 'cancelled',
  afgerondOp: '2026-07-28T10:11:00Z',
  foutcode: 'cancelled-by-user',
}

const parsed = parseProcessMaintenanceRunHistory([
  proposal,
  accepted,
  issueOnlyProposal,
  runningBeforeProvider,
  cancelled,
])
assert.equal(parsed.length, 5)
assert.equal(parsed[3].provider, null)
assert.equal(deriveProcessMaintenanceRunPresentation(parsed[0]), 'voorstel')
assert.equal(deriveProcessMaintenanceRunPresentation(parsed[1]), 'geaccepteerd')
assert.equal(deriveProcessMaintenanceRunPresentation(parsed[2]), 'voorstel')
assert.equal(deriveProcessMaintenanceRunPresentation(parsed[3]), 'bezig')
assert.equal(deriveProcessMaintenanceRunPresentation(parsed[4]), 'geannuleerd')
assert.equal(isActionableProcessMaintenanceRun(parsed[0], 7), true)
assert.equal(isActionableProcessMaintenanceRun(parsed[0], 8), false)
assert.equal(isActionableProcessMaintenanceRun(parsed[1], 7), false)
assert.equal(
  isActionableProcessMaintenanceRun(parsed[2], 7),
  false,
  'een voorstel zonder wijzigingen is zichtbaar maar niet toepasbaar',
)

assert.throws(
  () => parseProcessMaintenanceRunLedgerItem({
    ...proposal,
    prompt: 'dit veld hoort nooit in de ledger',
  }),
  /onbekende velden: prompt/,
)
assert.throws(
  () => parseProcessMaintenanceRunLedgerItem({
    ...proposal,
    rawModelOutput: { geheim: true },
  }),
  /onbekende velden: rawModelOutput/,
)
assert.throws(
  () => parseProcessMaintenanceRunLedgerItem({
    ...proposal,
    feedback: {
      beslissing: 'rejected',
      geaccepteerdeWijzigingIds: ['change-1'],
      doorGebruiker: 'tester',
      op: '2026-07-28T10:05:00Z',
    },
  }),
  /afwijzing mag geen geaccepteerde wijzigingen/,
)
assert.throws(
  () => parseProcessMaintenanceRunLedgerItem({
    ...proposal,
    feedback: {
      beslissing: 'accepted',
      geaccepteerdeWijzigingIds: [],
      doorGebruiker: 'tester',
      op: '2026-07-28T10:05:00Z',
    },
  }),
  /acceptatie vereist minimaal één wijziging-id/,
)
assert.throws(
  () => parseProcessMaintenanceRunLedgerItem({
    ...proposal,
    wijzigingAantal: 21,
    feedback: {
      beslissing: 'accepted',
      geaccepteerdeWijzigingIds: Array.from(
        { length: 21 },
        (_, index) => `change-${index}`,
      ),
      doorGebruiker: 'tester',
      op: '2026-07-28T10:05:00Z',
    },
  }),
  /meer dan 20 waarden/,
)
assert.throws(
  () => parseProcessMaintenanceRunLedgerItem({
    ...proposal,
    feedback: {
      beslissing: 'rejected',
      reden: 'x'.repeat(501),
      geaccepteerdeWijzigingIds: [],
      doorGebruiker: 'tester',
      op: '2026-07-28T10:05:00Z',
    },
  }),
  /maximaal 160 tekens/,
)
assert.throws(
  () => parseProcessMaintenanceRunHistory([proposal, proposal]),
  /dubbele run-id’s/,
)
assert.throws(
  () => parseProcessMaintenanceRunLedgerItem({
    ...runningBeforeProvider,
    resultaatStatus: 'voorstel',
    issueAantal: 1,
  }),
  /alleen bij een voltooide run/,
)
assert.equal(
  JSON.stringify(parsed).includes('prompt'),
  false,
  'de veilige frontendrepresentatie bevat geen promptvelden',
)

console.log(JSON.stringify({
  ok: true,
  checks: {
    exactLedgerParser: true,
    lifecycleAndResultStatusSeparated: true,
    issueOnlyProposalSupported: true,
    nullableProviderSupported: true,
    rawPromptsRejected: true,
    feedbackConstraints: true,
    revisionPinnedActionability: true,
  },
}))
