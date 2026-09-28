import { describe, expect, it, vi } from 'vitest';
import { createKitchenPlan, type KitchenPlan } from './kitchen';
import {
  PlanSync,
  SaveConflict,
  httpPlanTransport,
  type DraftStorage,
  type PlanTransport
} from './plan-sync';
import { planKey, parsePlanDocument, type PlanDocument } from './plan-document';

const initial = (): PlanDocument => ({
  schemaVersion: 2,
  revision: 0,
  updatedAt: '2026-09-23T12:00:00.000Z',
  plan: createKitchenPlan('2026-09-21')
});
const changed = (quantity: number) => {
  const plan = initial().plan;
  plan.ingredients[0].quantity = quantity;
  return plan;
};
const legacy = (plan: KitchenPlan) => {
  const { recipes: _recipes, activityRequirements: _requirements, ...old } = plan;
  return old;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let document = initial();
  let raw: string | null = null;
  const drafts: DraftStorage = {
    read: () => raw,
    write: (value) => {
      raw = value;
    },
    remove: () => {
      raw = null;
    }
  };
  const transport: PlanTransport = {
    load: vi.fn(async () => structuredClone(document)),
    save: vi.fn(async (request) => {
      if (planKey(request.plan) === planKey(document.plan)) return structuredClone(document);
      if (request.revision !== document.revision) throw new SaveConflict();
      document = {
        ...document,
        revision: document.revision + 1,
        plan: structuredClone(request.plan)
      };
      return structuredClone(document);
    })
  };
  const hydrate = vi.fn();
  const sync = new PlanSync({ drafts, transport, onHydrate: hydrate, onState: () => {} });
  return {
    sync,
    transport,
    drafts,
    hydrate,
    document: () => document,
    raw: () => raw,
    replace: (next: PlanDocument) => {
      document = next;
    }
  };
}
const saved = (sync: PlanSync) =>
  vi.waitFor(() => expect(sync.state).toMatchObject({ phase: 'saved', dirty: false }));

describe('serialized autosave and recovery', () => {
  it('coalesces edits behind one request without hydrating stale acknowledgements', async () => {
    const f = fixture();
    await f.sync.start();
    const pending = deferred<PlanDocument>();
    vi.mocked(f.transport.save).mockImplementationOnce(() => pending.promise);
    f.sync.change(changed(3));
    f.sync.change(changed(4));
    f.sync.change(changed(5));
    expect(f.transport.save).toHaveBeenCalledTimes(1);
    const acknowledged = { ...initial(), revision: 1, plan: changed(3) };
    f.replace(acknowledged);
    pending.resolve(acknowledged);
    await saved(f.sync);
    expect(f.transport.save).toHaveBeenCalledTimes(2);
    expect(f.document().plan.ingredients[0].quantity).toBe(5);
    expect(f.hydrate).toHaveBeenCalledTimes(1);
    expect(f.raw()).toBeNull();
  });
  it('retries an ambiguous write before applying an undo to the old saved plan', async () => {
    const f = fixture();
    await f.sync.start();
    const original = f.transport.save;
    vi.mocked(f.transport.save).mockImplementationOnce(async (request) => {
      f.replace({ ...initial(), revision: 1, plan: request.plan });
      throw new Error('Response lost');
    });
    f.sync.change(changed(8));
    await vi.waitFor(() => expect(f.sync.state.phase).toBe('error'));
    f.sync.change(initial().plan);
    expect(f.sync.state.dirty).toBe(true);
    await f.sync.retry();
    await saved(f.sync);
    expect(original).toHaveBeenCalledTimes(3);
    expect(f.document().plan).toEqual(initial().plan);
    expect(f.document().revision).toBe(2);
  });
  it('restores an unresolved attempt even when latest equals the GET response', async () => {
    const f = fixture();
    f.drafts.write(
      JSON.stringify({
        draftVersion: 1,
        baseRevision: 0,
        latest: legacy(initial().plan),
        attempted: { schemaVersion: 1, revision: 0, plan: legacy(changed(8)) }
      })
    );
    await f.sync.start();
    await saved(f.sync);
    expect(f.transport.save).toHaveBeenCalledTimes(2);
    expect(f.document().plan).toEqual(initial().plan);
    expect(f.document().revision).toBe(2);
  });
  it('recovers newer queued changes when the attempted snapshot was already saved', async () => {
    const f = fixture();
    f.replace({ ...initial(), revision: 1, plan: changed(4) });
    f.drafts.write(
      JSON.stringify({
        draftVersion: 1,
        baseRevision: 0,
        latest: legacy(changed(6)),
        attempted: { schemaVersion: 1, revision: 0, plan: legacy(changed(4)) }
      })
    );
    await f.sync.start();
    await saved(f.sync);
    expect(f.document().plan.ingredients[0].quantity).toBe(6);
    expect(f.transport.save).toHaveBeenCalledTimes(1);
  });
  it('preserves conflicts across refresh without automatically rebasing', async () => {
    const f = fixture();
    await f.sync.start();
    f.replace({ ...initial(), revision: 1, plan: changed(7) });
    f.sync.change(changed(8));
    await vi.waitFor(() => expect(f.sync.state.phase).toBe('conflict'));
    await f.sync.retry();
    expect(f.transport.save).toHaveBeenCalledTimes(1);
    f.sync.dispose();
    const recovered = new PlanSync({
      drafts: f.drafts,
      transport: f.transport,
      onState: () => {},
      onHydrate: () => {}
    });
    await recovered.start();
    expect(recovered.state.phase).toBe('conflict');
    expect(JSON.parse(recovered.recoveryFile()).plan.ingredients[0].quantity).toBe(8);
    expect(f.document().plan.ingredients[0].quantity).toBe(7);
    await recovered.reloadSaved();
    expect(recovered.state.phase).toBe('saved');
    expect(f.raw()).toBeNull();
  });
  it('does not discard a conflict if reloading the server copy fails', async () => {
    const f = fixture();
    await f.sync.start();
    f.replace({ ...initial(), revision: 1, plan: changed(7) });
    f.sync.change(changed(8));
    await vi.waitFor(() => expect(f.sync.state.phase).toBe('conflict'));
    vi.mocked(f.transport.load).mockRejectedValueOnce(new Error('Offline'));
    await f.sync.reloadSaved();
    expect(f.sync.state.phase).toBe('conflict');
    expect(JSON.parse(f.sync.recoveryFile()).plan.ingredients[0].quantity).toBe(8);
    await f.sync.reloadSaved();
    expect(f.sync.state.phase).toBe('saved');
  });
  it('does not label a wrong-plan acknowledgement as saved', async () => {
    const f = fixture();
    await f.sync.start();
    vi.mocked(f.transport.save).mockResolvedValueOnce({ ...initial(), revision: 1 });
    f.sync.change(changed(9));
    await vi.waitFor(() => expect(f.sync.state.phase).toBe('error'));
    expect(f.sync.state.dirty).toBe(true);
    expect(f.raw()).not.toBeNull();
  });
  it('ignores late completion after disposal and retains the recovery copy', async () => {
    const f = fixture();
    await f.sync.start();
    const pending = deferred<PlanDocument>();
    vi.mocked(f.transport.save).mockImplementationOnce(() => pending.promise);
    f.sync.change(changed(9));
    f.sync.dispose();
    const raw = f.raw();
    pending.resolve({ ...initial(), revision: 1, plan: changed(9) });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.raw()).toBe(raw);
    expect(f.hydrate).toHaveBeenCalledTimes(1);
  });
  it.each(['offline', 'malformed response'])(
    'keeps recovery downloadable and warns before closing when GET returns %s',
    async (failure) => {
      const f = fixture();
      const raw = JSON.stringify({
        draftVersion: 1,
        baseRevision: 0,
        latest: legacy(changed(8)),
        attempted: { schemaVersion: 1, revision: 0, plan: legacy(changed(8)) }
      });
      f.drafts.write(raw);
      if (failure === 'offline')
        vi.mocked(f.transport.load).mockRejectedValueOnce(new Error('Offline'));
      else
        vi.mocked(f.transport.load).mockResolvedValueOnce({
          invalid: true
        } as unknown as PlanDocument);
      await f.sync.start();
      expect(f.sync.state).toMatchObject({ loaded: false, dirty: true, phase: 'error' });
      expect(f.sync.recoveryFile()).toBe(raw);
      expect(f.hydrate).not.toHaveBeenCalled();
      expect(f.transport.save).not.toHaveBeenCalled();
      f.sync.dispose();
      expect(f.raw()).toBe(raw);
    }
  );
  it('preserves malformed recovery bytes until an explicit discard', async () => {
    const f = fixture();
    f.drafts.write('{broken');
    await f.sync.start();
    expect(f.sync.state.phase).toBe('recovery-error');
    expect(f.hydrate).not.toHaveBeenCalled();
    expect(f.sync.recoveryFile()).toBe('{broken');
    expect(f.raw()).toBe('{broken');
    await f.sync.reloadSaved();
    expect(f.sync.state.phase).toBe('saved');
    expect(f.raw()).toBeNull();
  });
  it.each([false, true])(
    'migrates legacy recovery before/after an acknowledged attempt (committed=%s)',
    async (committed) => {
      const f = fixture();
      if (committed) f.replace({ ...initial(), revision: 1, plan: changed(8) });
      f.drafts.write(
        JSON.stringify({
          draftVersion: 1,
          baseRevision: 0,
          latest: legacy(changed(8)),
          attempted: { schemaVersion: 1, revision: 0, plan: legacy(changed(8)) }
        })
      );
      await f.sync.start();
      await saved(f.sync);
      expect(f.transport.save).toHaveBeenCalledTimes(committed ? 0 : 1);
      expect(f.document().plan).toEqual(changed(8));
      expect(f.raw()).toBeNull();
      for (const [request] of vi.mocked(f.transport.save).mock.calls)
        expect(request.schemaVersion).toBe(2);
    }
  );
  it('persists only current drafts while retrying a migrated ambiguous attempt before queued edits', async () => {
    const f = fixture();
    f.drafts.write(
      JSON.stringify({
        draftVersion: 1,
        baseRevision: 0,
        latest: legacy(changed(9)),
        attempted: { schemaVersion: 1, revision: 0, plan: legacy(changed(8)) }
      })
    );
    vi.mocked(f.transport.save).mockRejectedValueOnce(new Error('Offline'));
    await f.sync.start();
    await vi.waitFor(() => expect(f.sync.state.phase).toBe('error'));
    expect(JSON.parse(f.raw()!)).toEqual({
      draftVersion: 2,
      baseRevision: 0,
      latest: changed(9),
      attempted: { schemaVersion: 2, revision: 0, plan: changed(8) }
    });
    f.sync.change(initial().plan);
    await f.sync.retry();
    await saved(f.sync);
    expect(
      vi
        .mocked(f.transport.save)
        .mock.calls.map(([request]) => [
          request.schemaVersion,
          request.plan.ingredients[0].quantity
        ])
    ).toEqual([
      [2, 8],
      [2, 8],
      [2, 2]
    ]);
    expect(f.document().revision).toBe(2);
  });
  it('migrates a legacy conflict without rebasing its old base revision across refresh', async () => {
    const f = fixture();
    f.replace({ ...initial(), revision: 3, plan: changed(7) });
    f.drafts.write(
      JSON.stringify({
        draftVersion: 1,
        baseRevision: 0,
        latest: legacy(changed(9)),
        attempted: { schemaVersion: 1, revision: 0, plan: legacy(changed(8)) }
      })
    );
    await f.sync.start();
    expect(f.sync.state.phase).toBe('conflict');
    expect(JSON.parse(f.raw()!)).toMatchObject({
      draftVersion: 2,
      baseRevision: 0,
      latest: changed(9)
    });
    expect(f.transport.save).not.toHaveBeenCalled();
    f.sync.dispose();
    const recovered = new PlanSync({
      drafts: f.drafts,
      transport: f.transport,
      onState: () => {},
      onHydrate: () => {}
    });
    await recovered.start();
    expect(recovered.state.phase).toBe('conflict');
    expect(JSON.parse(f.raw()!).baseRevision).toBe(0);
    recovered.dispose();
  });
  it.each([
    { draftVersion: 3, baseRevision: 0, latest: changed(8), attempted: null },
    { draftVersion: 1, baseRevision: 0, latest: changed(8), attempted: null },
    { draftVersion: 2, baseRevision: 0, latest: legacy(changed(8)), attempted: null },
    {
      draftVersion: 1,
      baseRevision: 0,
      latest: legacy(changed(8)),
      attempted: { schemaVersion: 2, revision: 0, plan: changed(8) }
    },
    {
      draftVersion: 2,
      baseRevision: 0,
      latest: changed(8),
      attempted: { schemaVersion: 1, revision: 0, plan: legacy(changed(8)) }
    },
    {
      draftVersion: 1,
      baseRevision: 0,
      latest: legacy(changed(8)),
      attempted: { schemaVersion: 1, revision: 1, plan: legacy(changed(8)) }
    }
  ])('retains invalid/mixed/future recovery bytes without hydration: %#', async (draft) => {
    const f = fixture();
    const raw = JSON.stringify(draft, null, 2);
    f.drafts.write(raw);
    await f.sync.start();
    expect(f.sync.state.phase).toBe('recovery-error');
    expect(f.sync.recoveryFile()).toBe(raw);
    expect(f.raw()).toBe(raw);
    expect(f.hydrate).not.toHaveBeenCalled();
    expect(f.transport.save).not.toHaveBeenCalled();
    f.sync.dispose();
    expect(f.raw()).toBe(raw);
  });
  it('accepts normalized HTTP responses on the second parse and sends only current writes', async () => {
    const original = initial();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'GET')
        return Response.json({ ...original, schemaVersion: 1, plan: legacy(original.plan) });
      const request = JSON.parse(init!.body as string);
      expect(request.schemaVersion).toBe(2);
      return Response.json({ ...original, revision: 1, plan: request.plan });
    });
    const transport = httpPlanTransport(fetcher);
    const loaded = await transport.load(new AbortController().signal);
    expect(parsePlanDocument(loaded)).toEqual(original);
    const f = fixture();
    const sync = new PlanSync({
      drafts: f.drafts,
      transport,
      onState: () => {},
      onHydrate: () => {}
    });
    await sync.start();
    sync.change(changed(8));
    await saved(sync);
    sync.dispose();
  });
  it('reports unavailable recovery storage while still saving to the server', async () => {
    const f = fixture();
    f.drafts.write = () => {
      throw new Error('Quota exceeded');
    };
    f.drafts.remove = () => {
      throw new Error('Blocked');
    };
    await f.sync.start();
    f.sync.change(changed(10));
    await saved(f.sync);
    expect(f.sync.state.recoveryUnavailable).toBe(true);
    expect(f.document().plan.ingredients[0].quantity).toBe(10);
  });
  it('does not save no-op edits or replace the plan after a failed load', async () => {
    const f = fixture();
    vi.mocked(f.transport.load).mockRejectedValueOnce(new Error('Offline'));
    await f.sync.start();
    expect(f.sync.state).toMatchObject({ phase: 'error', loaded: false });
    expect(f.hydrate).not.toHaveBeenCalled();
    expect(() => f.sync.change(changed(3))).toThrow();
    await f.sync.retry();
    f.sync.change(initial().plan);
    expect(f.transport.save).not.toHaveBeenCalled();
    expect(f.sync.state.dirty).toBe(false);
  });
});
