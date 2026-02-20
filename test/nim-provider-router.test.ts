import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  NimProviderRouter,
  parseNimModelRef,
  type NimProviderDriver,
} from '../packages/nim-core/src/index.ts';

test('nim provider router parses model refs and rejects malformed refs', () => {
  const parsed = parseNimModelRef('anthropic/claude-3-haiku-20240307');
  assert.equal(parsed.providerId, 'anthropic');
  assert.equal(parsed.providerModelId, 'claude-3-haiku-20240307');

  assert.throws(
    () => {
      parseNimModelRef('anthropic' as `${string}/${string}`);
    },
    {
      message: 'invalid model ref: anthropic',
    },
  );
});

test('nim provider router resolves provider metadata and optional driver', () => {
  const router = new NimProviderRouter();
  router.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  const withoutDriver = router.resolveModel('anthropic/claude-3-haiku-20240307');
  assert.equal(withoutDriver.provider.id, 'anthropic');
  assert.equal(withoutDriver.parsedModel.providerModelId, 'claude-3-haiku-20240307');
  assert.equal(withoutDriver.driver, undefined);

  const driver: NimProviderDriver = {
    providerId: 'anthropic',
    async *runTurn() {
      yield {
        type: 'provider.turn.finished',
        finishReason: 'stop',
      };
    },
  };

  router.registerDriver(driver);
  const withDriver = router.resolveModel('anthropic/claude-3-haiku-20240307');
  assert.equal(withDriver.driver === driver, true);
});

test('nim provider router fails for unknown provider and unsupported model', () => {
  const router = new NimProviderRouter();
  router.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  assert.throws(
    () => {
      router.resolveModel('openai/gpt-4o-mini');
    },
    {
      message: 'provider not registered: openai',
    },
  );

  assert.throws(
    () => {
      router.resolveModel('anthropic/claude-3-5-haiku-latest');
    },
    {
      message: 'model not registered for provider anthropic: anthropic/claude-3-5-haiku-latest',
    },
  );
});
