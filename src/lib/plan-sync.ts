import type { KitchenPlan } from './kitchen';
import {
  PLAN_SCHEMA_VERSION,
  parseKitchenPlan,
  migrateV1KitchenPlan,
  parseV1RecoverySaveRequest,
  parsePlanDocument,
  parseSaveRequest,
  planKey,
  type PlanDocument,
  type SaveRequest
} from './plan-document';

export type SyncPhase = 'loading' | 'saved' | 'saving' | 'error' | 'conflict' | 'recovery-error';
export type SyncState = {
  phase: SyncPhase;
  loaded: boolean;
  dirty: boolean;
  recoveryUnavailable: boolean;
};
export type DraftStorage = { read(): string | null; write(value: string): void; remove(): void };
export type PlanTransport = {
  load(signal: AbortSignal): Promise<PlanDocument>;
  save(request: SaveRequest, signal: AbortSignal): Promise<PlanDocument>;
};
type Draft = {
  draftVersion: 2;
  baseRevision: number;
  latest: KitchenPlan;
  attempted: SaveRequest | null;
};
export class SaveConflict extends Error {}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (a: KitchenPlan, b: KitchenPlan) => planKey(a) === planKey(b);

function parseDraft(raw: string): Draft {
  const value = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join(',') !== 'attempted,baseRevision,draftVersion,latest' ||
    (value.draftVersion !== 1 && value.draftVersion !== 2) ||
    !Number.isSafeInteger(value.baseRevision) ||
    value.baseRevision < 0
  )
    throw new Error('Invalid recovery copy');
  const legacy = value.draftVersion === 1;
  const latest = legacy ? migrateV1KitchenPlan(value.latest) : parseKitchenPlan(value.latest);
  const attempted =
    value.attempted === null
      ? null
      : legacy
        ? parseV1RecoverySaveRequest(value.attempted)
        : parseSaveRequest(value.attempted);
  if (attempted && attempted.revision !== value.baseRevision)
    throw new Error('Invalid recovery revision');
  return { draftVersion: 2, baseRevision: value.baseRevision, latest, attempted };
}

/** Acknowledgements advance the saved baseline, never the live editor. */
export class PlanSync {
  private document?: PlanDocument;
  private latest?: KitchenPlan;
  private attempted: SaveRequest | null = null;
  private phase: SyncPhase = 'loading';
  private loaded = false;
  private conflicted = false;
  private recoveryUnavailable = false;
  private rawDraft: string | null = null;
  private busy: Promise<void> | null = null;
  private active?: AbortController;
  private disposed = false;

  constructor(
    private readonly options: {
      transport: PlanTransport;
      drafts: DraftStorage;
      onState(state: SyncState): void;
      onHydrate(plan: KitchenPlan): void;
    }
  ) {}

  get state(): SyncState {
    return {
      phase: this.phase,
      loaded: this.loaded,
      dirty: this.loaded
        ? this.conflicted ||
          !!this.attempted ||
          !!(this.latest && this.document && !same(this.latest, this.document.plan))
        : this.rawDraft !== null,
      recoveryUnavailable: this.recoveryUnavailable
    };
  }
  private publish() {
    if (!this.disposed) this.options.onState(this.state);
  }
  private persist() {
    if (!this.loaded || !this.latest || !this.document) return;
    try {
      if (!this.state.dirty) {
        this.options.drafts.remove();
        this.rawDraft = null;
      } else {
        this.rawDraft = JSON.stringify({
          draftVersion: 2,
          baseRevision: this.document.revision,
          latest: this.latest,
          attempted: this.attempted
        } satisfies Draft);
        this.options.drafts.write(this.rawDraft);
      }
      this.recoveryUnavailable = false;
    } catch {
      this.recoveryUnavailable = true;
    }
  }
  private run(operation: () => Promise<void>): Promise<void> {
    if (this.busy) return this.busy;
    this.busy = operation().finally(() => {
      this.busy = null;
      if (!this.disposed && this.phase === 'saving') void this.pump();
    });
    return this.busy;
  }

  start(): Promise<void> {
    return this.load(false);
  }
  private load(discard: boolean): Promise<void> {
    if (this.disposed || this.busy) return this.busy ?? Promise.resolve();
    return this.run(async () => {
      this.phase = 'loading';
      // Recovery must remain downloadable even when the server cannot be reached.
      if (!discard) {
        try {
          this.rawDraft = this.options.drafts.read();
          this.recoveryUnavailable = false;
        } catch {
          this.recoveryUnavailable = true;
        }
      }
      this.publish();
      this.active = new AbortController();
      try {
        const document = parsePlanDocument(await this.options.transport.load(this.active.signal));
        if (this.disposed) return;
        let draft: Draft | null = null;
        if (!discard) {
          if (this.rawDraft !== null) {
            try {
              draft = parseDraft(this.rawDraft);
            } catch {
              this.phase = 'recovery-error';
              this.publish();
              return;
            }
          }
        }
        this.document = copy(document);
        this.latest = copy(draft?.latest ?? document.plan);
        this.attempted = null;
        this.conflicted = false;
        if (draft) {
          const unresolved = draft.attempted && document.revision <= draft.attempted.revision;
          if (unresolved && document.revision === draft.baseRevision)
            this.attempted = copy(draft.attempted);
          else if (!unresolved && same(document.plan, draft.latest)) {
            /* already saved */
          } else if (
            document.revision === draft.baseRevision ||
            (draft.attempted && !unresolved && same(document.plan, draft.attempted.plan))
          ) {
            /* safe continuation */
          } else this.conflicted = true;
          // A conflict's draft must retain its old base, not quietly rebase on a new GET.
          if (this.conflicted) this.document = { ...document, revision: draft.baseRevision };
        }
        this.loaded = true;
        this.phase = this.conflicted
          ? 'conflict'
          : this.attempted || !same(this.latest, document.plan)
            ? 'saving'
            : 'saved';
        this.options.onHydrate(copy(this.latest));
        this.persist();
        this.publish();
      } catch {
        if (!this.disposed) {
          this.phase = discard ? (this.loaded ? 'conflict' : 'recovery-error') : 'error';
          this.publish();
        }
      }
    });
  }

  change(input: KitchenPlan): void {
    if (!this.loaded || this.phase === 'loading' || this.disposed)
      throw new Error('Wait for the saved plan to load.');
    this.latest = copy(parseKitchenPlan(input));
    this.persist();
    if (this.phase !== 'error' && this.phase !== 'conflict')
      this.phase = this.state.dirty ? 'saving' : 'saved';
    this.publish();
    if (this.phase === 'saving') void this.pump();
  }
  retry(): Promise<void> {
    if (!this.loaded) return this.start();
    if (this.conflicted || this.disposed) return Promise.resolve();
    this.phase = 'saving';
    this.publish();
    return this.pump();
  }
  /** Only definitive conflicts or unreadable recovery copies can be discarded.
   * Ambiguous failed writes must be retried, never aborted then replaced by a GET. */
  reloadSaved(): Promise<void> {
    if (this.busy || (!this.conflicted && this.phase !== 'recovery-error'))
      return this.busy ?? Promise.resolve();
    return this.load(true);
  }
  private pump(): Promise<void> {
    if (this.busy || this.disposed || !this.loaded || this.conflicted)
      return this.busy ?? Promise.resolve();
    return this.run(async () => {
      while (!this.disposed && this.latest && this.document && !this.conflicted) {
        if (!this.attempted && same(this.latest, this.document.plan)) {
          this.phase = 'saved';
          this.persist();
          this.publish();
          return;
        }
        this.attempted ??= {
          schemaVersion: PLAN_SCHEMA_VERSION,
          revision: this.document.revision,
          plan: copy(this.latest)
        };
        const attempt = this.attempted;
        this.phase = 'saving';
        this.persist();
        this.publish();
        this.active = new AbortController();
        try {
          const saved = parsePlanDocument(
            await this.options.transport.save(copy(attempt), this.active.signal)
          );
          if (this.disposed) return;
          if (saved.revision < attempt.revision || !same(saved.plan, attempt.plan))
            throw new Error('Invalid save acknowledgement');
          this.document = copy(saved);
          this.attempted = null;
          this.persist();
        } catch (error) {
          if (this.disposed) return;
          if (error instanceof SaveConflict) {
            this.conflicted = true;
            this.attempted = null;
            this.phase = 'conflict';
          } else this.phase = 'error';
          this.persist();
          this.publish();
          return;
        }
      }
    });
  }
  recoveryFile(): string {
    if (this.latest && this.document)
      return JSON.stringify(
        {
          schemaVersion: PLAN_SCHEMA_VERSION,
          revision: this.document.revision,
          updatedAt: this.document.updatedAt,
          plan: this.latest
        },
        null,
        2
      );
    return this.rawDraft ?? '';
  }
  dispose(): void {
    this.persist();
    this.disposed = true;
    this.active?.abort();
  }
}

export function httpPlanTransport(fetcher: typeof fetch = fetch): PlanTransport {
  async function request(method: 'GET' | 'PUT', signal: AbortSignal, value?: SaveRequest) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(abort, 10_000);
    try {
      const response = await fetcher('/api/plan', {
        method,
        cache: 'no-store',
        signal: controller.signal,
        ...(value
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }
          : {})
      });
      if (response.status === 409) throw new SaveConflict('Changed on another device');
      if (!response.ok) throw new Error('Plan request failed');
      return parsePlanDocument(await response.json());
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  return {
    load: (signal) => request('GET', signal),
    save: (value, signal) => request('PUT', signal, value)
  };
}
