/**
 * Thin wrapper around the Anthropic SDK for the browser.
 *
 * The key is the user's own and is read from localStorage on this device.
 * `dangerouslyAllowBrowser` is deliberate: this is a personal, single-user
 * page with no server to proxy through, so the key stays on the device that
 * typed it. Don't reuse this pattern for a site with other people's keys.
 */

import { Anthropic } from './vendor/anthropic-sdk.esm.js';
import { store } from './store.js';

export const MODELS = [
  { id: 'claude-opus-5',   label: 'Opus 5 — sharpest',        note: 'Best at conversation and games.' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced',      note: 'Quicker and cheaper per message.' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest',     note: 'Snappiest replies, lightest touch.' },
];

let client = null;
let clientKey = null;

function getClient() {
  const { apiKey } = store.get();
  if (!apiKey) throw new MissingKeyError();
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = apiKey;
  }
  return client;
}

export class MissingKeyError extends Error {
  constructor() {
    super('No API key yet. Add one under “You” to bring your companion online.');
    this.name = 'MissingKeyError';
  }
}

/** Turn an SDK error into something worth showing a person. */
export function describeError(err) {
  if (err instanceof MissingKeyError) return err.message;
  if (err?.name === 'AbortError') return 'Stopped.';

  if (err instanceof Anthropic.AuthenticationError) {
    return 'That API key was rejected. Check it under “You”.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'This key is not allowed to use that model. Try another model under “You”.';
  }
  if (err instanceof Anthropic.NotFoundError) {
    return 'That model is not available on this key. Pick a different one under “You”.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Rate limited — give it a few seconds and try again.';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the API. Check your connection.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `The request was rejected: ${err.message}`;
  }
  if (err instanceof Anthropic.APIError) {
    return `API error (${err.status ?? '?'}): ${err.message}`;
  }
  return err?.message || 'Something went wrong.';
}

/** Effort presets. Chat stays low so replies feel immediate. */
const EFFORT = { fast: 'low', thoughtful: 'high' };

/**
 * Stream a reply, calling onText with each new chunk.
 * Returns the full text.
 */
export async function streamReply({ system, messages, onText, signal, thoughtful = false }) {
  const { model } = store.get();
  const stream = getClient().messages.stream(
    {
      model,
      max_tokens: 16000,
      system,
      messages,
      output_config: { effort: thoughtful ? EFFORT.thoughtful : EFFORT.fast },
    },
    { signal },
  );

  let full = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      full += event.delta.text;
      onText?.(event.delta.text, full);
    }
  }

  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    throw new Error("I'd rather not answer that one. Try asking a different way.");
  }
  return full;
}

/**
 * Ask for one JSON object matching `schema`. Used by the games, where a
 * loose paragraph of prose would be useless — we need a move, not a story.
 */
export async function askJSON({ system, messages, schema, thoughtful = false, signal }) {
  const { model } = store.get();
  const res = await getClient().messages.create(
    {
      model,
      max_tokens: 4000,
      system,
      messages,
      output_config: {
        effort: thoughtful ? EFFORT.thoughtful : EFFORT.fast,
        format: { type: 'json_schema', schema },
      },
    },
    { signal },
  );

  if (res.stop_reason === 'refusal') {
    throw new Error("I'd rather sit this round out. Start a new one?");
  }

  const block = res.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Got an empty response — try again.');
  return JSON.parse(block.text);
}

/** A short helper for one-off prose (no streaming, no schema). */
export async function askText({ system, messages, thoughtful = false, signal }) {
  const { model } = store.get();
  const res = await getClient().messages.create(
    {
      model,
      max_tokens: 2000,
      system,
      messages,
      output_config: { effort: thoughtful ? EFFORT.thoughtful : EFFORT.fast },
    },
    { signal },
  );
  if (res.stop_reason === 'refusal') throw new Error('Skipping that one.');
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export function hasKey() {
  return Boolean(store.get().apiKey);
}

/** Verify a key works, without committing to a long generation. */
export async function testKey(apiKey, model) {
  const probe = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  await probe.messages.create({
    model,
    max_tokens: 8,
    messages: [{ role: 'user', content: 'Say OK.' }],
    output_config: { effort: 'low' },
  });
  return true;
}
