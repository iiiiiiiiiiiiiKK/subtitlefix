/// <reference lib="webworker" />
import { parseSubtitles } from '../core/parse';
import { serializeSubtitles } from '../core/serialize';
import type { ParseOptions } from '../core/parse';
import type { Doc } from '../core/types';

/**
 * Worker entry point.
 *
 * Parsing and serialisation are pure functions, so they run unchanged both on
 * the main thread (small files, tests) and here (large files). Only the message
 * plumbing differs; the caller decides when to offload based on file size.
 */

export type WorkerRequest =
  | { id: number; kind: 'parse'; text: string; options: ParseOptions }
  | { id: number; kind: 'serialize'; doc: Doc; newline?: '\n' | '\r\n'; format?: 'srt' | 'vtt' };

export type WorkerResponse =
  | { id: number; ok: true; kind: 'parse'; doc: Doc; ms: number }
  | { id: number; ok: true; kind: 'serialize'; text: string; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const started = performance.now();
  try {
    if (request.kind === 'parse') {
      const doc = parseSubtitles(request.text, request.options);
      const response: WorkerResponse = {
        id: request.id,
        ok: true,
        kind: 'parse',
        doc,
        ms: performance.now() - started,
      };
      self.postMessage(response);
      return;
    }
    const text = serializeSubtitles(request.doc, {
      ...(request.format ? { format: request.format } : {}),
      ...(request.newline ? { newline: request.newline } : {}),
    });
    const response: WorkerResponse = {
      id: request.id,
      ok: true,
      kind: 'serialize',
      text,
      ms: performance.now() - started,
    };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
