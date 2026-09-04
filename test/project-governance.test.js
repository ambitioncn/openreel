import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

test('project ledger unmet items match required non-accepted backlog items', async () => {
  const backlog = await readJson('../docs/libtv-parity-backlog.json');
  const ledger = await readJson('../docs/project-acceptance-ledger.json');
  const expected = backlog.items
    .filter((item) => item.required && item.status !== 'accepted')
    .map((item) => item.id)
    .sort();
  assert.deepEqual([...ledger.unmet].sort(), expected);
});

test('project blockers exactly match current human-gated required backlog items', async () => {
  const backlog = await readJson('../docs/libtv-parity-backlog.json');
  const ledger = await readJson('../docs/project-acceptance-ledger.json');
  const items = new Map(backlog.items.map((item) => [item.id, item]));
  for (const blocker of ledger.blockers) {
    const item = items.get(blocker.id);
    assert.ok(item, `unknown blocker ${blocker.id}`);
    assert.equal(item.required, true);
    assert.equal(item.status, 'human_gated');
    assert.equal(typeof blocker.reason, 'string');
    assert.ok(blocker.reason.length > 0);
  }
  const expectedBlockerIds = backlog.items
    .filter((item) => item.required && item.status === 'human_gated')
    .map((item) => item.id)
    .sort();
  assert.deepEqual(ledger.blockers.map((blocker) => blocker.id).sort(), expectedBlockerIds);
});

test('completed Beijing observability hardening is evidence, not remaining work', async () => {
  const backlog = await readJson('../docs/libtv-parity-backlog.json');
  const security = backlog.items.find((item) => item.id === 'S-01');
  assert.ok(security, 'missing S-01 backlog item');
  assert.ok(security.evidence.some((entry) => entry.includes('cp173-aliyun-nginx-observability-deny')));
  assert.ok(security.evidence.some((entry) => entry.includes('readiness 404') && entry.includes('metrics 404')));
  assert.ok(security.remaining.every((entry) => !entry.includes('Restrict public /health/ready')));
});

test('MiniMax CN music route evidence remains configuration-only after A-01 acceptance', async () => {
  const backlog = await readJson('../docs/libtv-parity-backlog.json');
  const ledger = await readJson('../docs/project-acceptance-ledger.json');
  const evidence = await readJson('../docs/a01-minimax-cn-route-qualification-20260818.json');
  const audio = backlog.items.find((item) => item.id === 'A-01');

  assert.ok(audio, 'missing A-01 backlog item');
  assert.ok(audio.evidence.some((entry) => entry.includes('a01-minimax-cn-route-qualification-20260818.json')));
  assert.equal(evidence.result, 'passed');
  assert.equal(evidence.effectiveRoute.model, 'minimax-portal/music-2.6-free');
  assert.equal(evidence.effectiveRoute.region, 'CN');
  assert.equal(evidence.effectiveRoute.authReferencePresent, true);
  assert.equal(evidence.effectiveRoute.authReferenceValueInspected, false);
  assert.deepEqual(evidence.negativeEvidence, {
    providerGenerationCalls: 0,
    credentialReads: 0,
    credentialWrites: 0,
    paidCalls: 0,
    mediaCreated: 0,
    serviceRestarts: 0,
    deployments: 0,
  });
  assert.match(evidence.boundary, /does not prove that the external credential is accepted/i);
  assert.match(evidence.boundary, /does not prove music generation/i);
  assert.equal(audio.status, 'accepted');
  assert.deepEqual(audio.remaining, []);
  assert.equal(ledger.blockers.some((item) => item.id === 'A-01'), false);
});

test('historical safe-work audit preserves its then-current gates and consumed music authorization cannot be replayed', async () => {
  const audit = await readJson('../docs/local-safe-work-exhaustion-audit-20260816.json');
  const packet = await readJson('../docs/a01-minimax-cn-single-call-authorization-packet.json');
  const outcome = await readJson('../docs/a01-minimax-cn-single-call-cp334-evidence.json');
  const nextChoice = await readJson('../docs/openreel-next-gated-boundary-choice-cp335.json');
  assert.ok(audit.requiredNonAccepted.some((item) => item.id === 'A-01'));
  assert.equal(audit.projectCompletion, 'in_progress');
  assert.equal(packet.status, 'consumed_terminal_failure');
  assert.equal(packet.request.providerModel, 'minimax-portal/music-2.6-free');
  assert.equal(packet.request.providerRequests, 1);
  assert.equal(packet.request.maxRetries, 0);
  assert.equal(packet.request.costCeilingCny, 0);
  assert.equal(packet.request.private, true);
  assert.match(packet.boundary, /grants no retry/i);
  assert.equal(outcome.result, 'failed_insufficient_balance');
  assert.equal(outcome.providerRequests, 1);
  assert.equal(outcome.retries, 0);
  assert.equal(outcome.fallbackRequests, 0);
  assert.equal(outcome.chargeCny, 0);
  assert.equal(outcome.mediaCreated, 0);
  assert.equal(outcome.published, false);
  assert.match(outcome.boundary, /requires a new exact human gate/i);
  assert.equal(audit.latestGatedOutcome.checkpoint, 'cp334');
  assert.equal(audit.recommendedNextGate.packet, 'docs/openreel-next-gated-boundary-choice-cp335.json');
  assert.equal(nextChoice.status, 'awaiting_owner_choice');
  assert.equal(nextChoice.context.authorizationConsumed, true);
  assert.equal(nextChoice.choices.length, 3);
  assert.ok(nextChoice.choices.every((choice) => choice.requiresFollowupGate === true));
  assert.match(nextChoice.boundary, /grants no execution authority/i);
  assert.ok(packet.forbidden.some((entry) => entry.includes('incur any charge')));
  assert.ok(packet.stopConditions.some((entry) => entry.includes('first terminal')));
});

test('updated MiniMax key read-only evidence does not imply music entitlement or renew the consumed gate', async () => {
  const evidence = await readJson('../docs/a01-minimax-key-readonly-qualification-cp336.json');
  const backlog = await readJson('../docs/libtv-parity-backlog.json');
  const audio = backlog.items.find((item) => item.id === 'A-01');

  assert.equal(evidence.observations.authenticatedModelsListHttpStatus, 200);
  assert.equal(evidence.observations.authenticatedModelsListContainsMiniMaxM27, true);
  assert.deepEqual(evidence.observations.authenticatedModelsListMusicModels, []);
  assert.equal(evidence.negativeEvidence.musicGenerationCalls, 0);
  assert.equal(evidence.negativeEvidence.chargesCny, 0);
  assert.equal(evidence.negativeEvidence.credentialWrites, 0);
  assert.match(evidence.conclusion, /neither music entitlement nor account balance/i);
  assert.match(evidence.budgetBoundary, /do(?:es)? not renew/i);
  assert.ok(audio.evidence.some((entry) => entry.includes('a01-minimax-key-readonly-qualification-cp336.json')));
});

test('updated-key MiniMax music call is terminal, zero-cost, and cannot be replayed', async () => {
  const evidence = await readJson('../docs/a01-minimax-updated-key-single-call-cp337-evidence.json');
  const backlog = await readJson('../docs/libtv-parity-backlog.json');
  const audio = backlog.items.find((item) => item.id === 'A-01');

  assert.equal(evidence.authorizationGate, 'cp336');
  assert.equal(evidence.providerModel, 'music-2.6-free');
  assert.equal(evidence.httpStatus, 200);
  assert.equal(evidence.sanitizedProviderCode, 1008);
  assert.equal(evidence.providerRequests, 1);
  assert.equal(evidence.retries, 0);
  assert.equal(evidence.fallbackRequests, 0);
  assert.equal(evidence.chargeCny, 0);
  assert.equal(evidence.purchaseOrSubscription, false);
  assert.equal(evidence.mediaCreated, 0);
  assert.equal(evidence.responseShape.audioUrlPresent, false);
  assert.equal(evidence.responseShape.audioHexPresent, false);
  assert.match(evidence.boundary, /authorization is consumed/i);
  assert.match(evidence.boundary, /grants no retry/i);
  assert.ok(audio.evidence.some((entry) => entry.includes('a01-minimax-updated-key-single-call-cp337-evidence.json')));
});

test('SeedAudio cp343 remains a consumed gate while retained local integration accepts A-01', async () => {
  const evidence = await readJson('../docs/a01-seedaudio-cny10-preflight-cp343.json');
  const backlog = await readJson('../docs/libtv-parity-backlog.json');
  const ledger = await readJson('../docs/project-acceptance-ledger.json');
  const audio = backlog.items.find((item) => item.id === 'A-01');

  assert.equal(evidence.decision.providerRequestSubmitted, true);
  assert.equal(evidence.decision.authorizationConsumed, true);
  assert.equal(evidence.decision.requestCount, 1);
  assert.equal(evidence.decision.retryCount, 0);
  assert.equal(evidence.decision.result, 'success');
  assert.equal(evidence.observations.deploymentChanges, 0);
  assert.equal(evidence.observations.publications, 0);
  assert.match(evidence.replayPolicy, /must not be replayed/i);
  assert.equal(audio.status, 'accepted');
  assert.ok(audio.evidence.some((entry) => entry.includes('a01-seedaudio-cny10-preflight-cp343.json')));
  assert.ok(audio.evidence.some((entry) => entry.includes('a01-cp343-browser-playback.mjs')));
  assert.deepEqual(audio.remaining, []);
  assert.equal(ledger.blockers.some((item) => item.id === 'A-01'), false);
});

test('M-01 vision packet remains exact and bounded after its authority is consumed', async () => {
  const packet = await readJson('../docs/m01-vision-two-call-authorization-packet.json');
  assert.equal(packet.status, 'consumed_terminal_failure');
  assert.equal(packet.authorized, false);
  assert.equal(packet.model, 'embedding-vision');
  assert.deepEqual(packet.calls.map((item) => item.mode), ['image-to-text', 'video-to-text']);
  assert.deepEqual(packet.calls.map((item) => item.count), [1, 1]);
  assert.equal(packet.pricing.maximumReservedUnitsPerCall, 2778);
  assert.equal(packet.pricing.maximumReservedUnitsTotal, 5556);
  assert.equal(packet.pricing.ownerCeilingCny, 4);
  assert.equal(packet.executionLimits.maximumProviderSubmissions, 2);
  assert.equal(packet.executionLimits.automaticRetries, 0);
  assert.equal(packet.executionLimits.stopAfterFirstFailure, true);
  assert.equal(packet.executionLimits.deployOrSwitchTraffic, false);
  assert.equal(packet.executionLimits.publish, false);
  assert.equal(packet.negativeEvidence.providerCalls, 0);
  assert.equal(packet.negativeEvidence.spend, 0);
  assert.ok(packet.stopConditions.some((entry) => entry.includes('exact authorization phrase')));
  assert.ok(packet.notAuthorized.some((entry) => entry.includes('more than two')));
});

test('M-01 failed vision execution stops before the second call and leaves production clean', async () => {
  const evidence = await readJson('../docs/m01-vision-cp3-execution-evidence.json');
  assert.equal(evidence.status, 'terminal_failure_cleanup_complete');
  assert.equal(evidence.observed.providerSubmissions, 1);
  assert.equal(evidence.observed.failedMode, 'image-to-text');
  assert.equal(evidence.observed.videoToTextSubmitted, false);
  assert.equal(evidence.observed.automaticRetries, 0);
  assert.equal(evidence.observed.sanitizedUpstreamStatus, 400);
  assert.equal(evidence.observed.authorizationConsumed, true);
  assert.equal(evidence.cleanup.isolatedPort4373Open, false);
  assert.equal(evidence.cleanup.temporaryFilesRemaining, 0);
  assert.equal(evidence.cleanup.isolatedProcessesRemaining, 0);
  assert.equal(evidence.cleanup.productionService, 'active');
  assert.equal(evidence.cleanup.productionPaidInferenceEnabled, false);
  assert.equal(evidence.negativeEvidence.secondSubmission, false);
  assert.equal(evidence.negativeEvidence.retries, 0);
});

test('M-01 corrected vision packet remains non-replayable, contract-pinned and does not reuse prior authority', async () => {
  const packet = await readJson('../docs/m01-vision-corrected-two-call-authorization-packet.json');
  assert.equal(packet.status, 'consumed_success');
  assert.equal(packet.authorized, false);
  assert.match(packet.supersedesForFutureExecution, /consumed; not replayable/i);
  assert.equal(packet.requestContract.encoding_format, 'float');
  assert.deepEqual(packet.requestContract.image_url, { url: 'private bounded fixture URL' });
  assert.deepEqual(packet.requestContract.video_url, { url: 'private bounded fixture URL' });
  assert.equal(packet.requestContract.rejectLegacyStringMediaFieldsBeforeProvider, true);
  assert.deepEqual(packet.calls.map((item) => item.mode), ['image-to-text', 'video-to-text']);
  assert.equal(packet.calls[1].requiresPriorCaseSuccess, packet.calls[0].caseId);
  assert.equal(packet.executionLimits.maximumProviderSubmissions, 2);
  assert.equal(packet.executionLimits.automaticRetries, 0);
  assert.equal(packet.executionLimits.stopAfterFirstFailure, true);
  assert.equal(packet.pricing.ownerCeilingCny, 4);
  assert.equal(packet.negativeEvidence.providerCallsUnderThisPacket, 2);
  assert.equal(packet.negativeEvidence.spendUnderThisPacket, 2);
  assert.ok(packet.notAuthorized.some((entry) => entry.includes('prior consumed authorization')));
  assert.ok(packet.notAuthorized.some((entry) => entry.includes('video submission after image failure')));
});

test('M-01 corrected vision execution consumes its gate and preserves the private bounded envelope', async () => {
  const packet = await readJson('../docs/m01-vision-corrected-two-call-authorization-packet.json');
  const evidence = await readJson('../docs/m01-vision-corrected-v2-execution-evidence.json');
  assert.equal(packet.status, 'consumed_success');
  assert.equal(packet.authorized, false);
  assert.equal(packet.negativeEvidence.providerCallsUnderThisPacket, 2);
  assert.equal(packet.negativeEvidence.spendUnderThisPacket, 2);
  assert.equal(evidence.status, 'success_cleanup_complete');
  assert.equal(evidence.observed.providerSubmissions, 2);
  assert.deepEqual(evidence.observed.completedModes, ['image-to-text', 'video-to-text']);
  assert.equal(evidence.observed.imageSucceededBeforeVideoSubmission, true);
  assert.equal(evidence.observed.automaticRetries, 0);
  assert.equal(evidence.observed.reservedUnitsAfterRun, 0);
  assert.equal(evidence.observed.billingReconciliationConsistent, true);
  assert.equal(evidence.observed.authorizationConsumed, true);
  assert.equal(evidence.cleanup.productionCodeChanged, false);
  assert.equal(evidence.negativeEvidence.deployments, 0);
  assert.equal(evidence.negativeEvidence.publications, 0);
  assert.equal(evidence.projectCompletion, 'in_progress');
});
