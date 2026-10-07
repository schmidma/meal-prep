<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { useI18n } from '$lib/i18n/context.svelte';
  import { bookRequest } from '$lib/recipe-books-client';
  import type { RecipeCatalog } from '$lib/recipe-books';
  import { confirmAction } from '$lib/confirmation';
  import Icon from './Icon.svelte';
  const i18n = useI18n();
  let {
    catalog,
    selected,
    onChange,
    onClose
  }: {
    catalog: RecipeCatalog;
    selected: string;
    onChange: (value: RecipeCatalog) => void;
    onClose: () => void;
  } = $props();
  let id = $state(untrack(() => selected || catalog.defaultBookId || catalog.books[0]?.id || ''));
  let name = $state('');
  let creating = $state(false);
  let busy = $state(false);
  let error = $state('');
  let copied = $state('');
  let permission = $state('contribute');
  let details = $state<{
    access: { household: string; name: string; permission: string }[];
    invitations: { id: string; token: string; permission: string; expires: number }[];
  }>({ access: [], invitations: [] });
  const book = $derived(catalog.books.find((b) => b.id === id));
  let dialog: HTMLDialogElement;
  async function load() {
    error = '';
    details = { access: [], invitations: [] };
    name = catalog.books.find((b) => b.id === id)?.name ?? '';
    const requested = id;
    if (catalog.books.find((b) => b.id === id)?.access !== 'owner') return;
    try {
      const result = await bookRequest<typeof details>(
        undefined,
        `?book=${encodeURIComponent(id)}`
      );
      if (id === requested) details = result;
    } catch (cause) {
      error = i18n.error((cause as Error).message);
    }
  }
  onMount(() => {
    dialog.showModal();
    void load();
  });
  async function canLeave() {
    return (
      !(creating ? name.trim() : name !== (book?.name ?? '')) ||
      (await confirmAction(i18n.t('planner.discardTheseUnsavedEdits')))
    );
  }
  async function close() {
    if (!busy && (await canLeave())) onClose();
  }
  async function change(action: string, value?: string) {
    if (busy) return;
    if (!['create', 'rename'].includes(action) && !(await canLeave())) return;
    busy = true;
    error = '';
    try {
      const previous = new Set(catalog.books.map((b) => b.id));
      const next = await bookRequest({ action, book: id, value });
      onChange(next);
      if (action === 'create') id = next.books.find((b) => !previous.has(b.id))?.id ?? '';
      else if (!next.books.some((b) => b.id === id))
        id = next.defaultBookId || next.books[0]?.id || '';
      creating = false;
      await load();
    } catch (cause) {
      error = i18n.error((cause as Error).message);
    } finally {
      busy = false;
    }
  }
  async function remove(action: 'delete' | 'leave') {
    if (
      await confirmAction(
        i18n.t(action === 'delete' ? 'books.deletePrompt' : 'books.leavePrompt'),
        i18n.t(action === 'delete' ? 'books.delete' : 'books.leave'),
        book?.name ?? ''
      )
    )
      await change(action);
  }
  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/books/join/${token}`);
      copied = token;
    } catch {
      error = i18n.t('books.copyManually');
    }
  }
</script>

<dialog
  class="wp-dialog wp-book-dialog"
  bind:this={dialog}
  aria-labelledby="book-manager-title"
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
  onclick={(e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        close();
    }
  }}
>
  <header>
    <!-- svelte-ignore a11y_autofocus -->
    <h2 id="book-manager-title" tabindex="-1" autofocus>{i18n.t('books.manage')}</h2>
  </header>
  <div class="wp-book-body">
    <div class="wp-book-toolbar">
      <select
        aria-label={i18n.t('books.choose')}
        value={id}
        disabled={busy || creating}
        onchange={async (e) => {
          const next = e.currentTarget.value;
          e.currentTarget.value = id;
          if (await canLeave()) {
            id = next;
            await load();
          }
        }}
      >
        {#each catalog.books as item}<option value={item.id}>{item.name}</option>{/each}
      </select>
      <button
        type="button"
        class="wp-secondary"
        disabled={busy}
        onclick={async () => {
          if (!(await canLeave())) return;
          creating = !creating;
          name = creating ? '' : (book?.name ?? '');
        }}>{creating ? i18n.t('planner.cancel') : i18n.t('books.create')}</button
      >
    </div>
    {#if creating || book?.access === 'owner'}
      <form
        class="wp-book-toolbar"
        onsubmit={(e) => {
          e.preventDefault();
          change(creating ? 'create' : 'rename', name);
        }}
      >
        <label class="wp-field"
          >{i18n.t('books.name')}<input
            bind:value={name}
            maxlength="80"
            required
            disabled={busy}
          /></label
        >
        <button
          class="wp-primary"
          disabled={busy || !name.trim() || (!creating && name.trim() === book?.name)}
          >{i18n.t(creating ? 'books.create' : 'planner.save')}</button
        >
      </form>
    {/if}
    {#if !creating && book}
      <p class="wp-book-hint">
        {i18n.t(book.access === 'view' ? 'books.viewHint' : 'books.contributeHint')}
      </p>
      {#if book.access !== 'view'}
        <button
          class="wp-secondary"
          disabled={busy || catalog.defaultBookId === id}
          onclick={() => change('default')}
          >{i18n.t(catalog.defaultBookId === id ? 'books.default' : 'books.makeDefault')}</button
        >
      {/if}
      {#if book.access === 'owner'}
        <section class="wp-book-sharing">
          <h3>{i18n.t('books.sharing')}</h3>
          <p>{i18n.t('books.sharingHint')}</p>
          <div class="wp-book-toolbar">
            <select aria-label={i18n.t('books.permission')} bind:value={permission} disabled={busy}>
              <option value="contribute">{i18n.t('books.contribute')}</option><option value="view"
                >{i18n.t('books.view')}</option
              >
            </select>
            <button
              class="wp-secondary"
              disabled={busy}
              onclick={() => change('invite', permission)}
              ><Icon name="link" size={16} />{i18n.t('books.invite')}</button
            >
          </div>
          {#each details.invitations as invite}<div class="wp-book-access-row">
              <div>
                <a href={`/books/join/${invite.token}`}
                  >{location.origin}/books/join/{invite.token}</a
                ><small
                  >{i18n.t(invite.permission === 'view' ? 'books.view' : 'books.contribute')} · {i18n.t(
                    'books.expires',
                    {
                      date: i18n.date(new Date(invite.expires), { month: 'short', day: 'numeric' })
                    }
                  )}</small
                >
              </div>
              <button
                class="wp-icon-button"
                disabled={busy}
                aria-label={i18n.t('books.copyLink')}
                title={i18n.t('books.copyLink')}
                onclick={() => copy(invite.token)}
                ><Icon name={copied === invite.token ? 'check' : 'link'} size={17} /></button
              >
              <button
                class="wp-icon-button wp-delete"
                disabled={busy}
                aria-label={i18n.t('books.revokeInvite')}
                title={i18n.t('books.revokeInvite')}
                onclick={() => change('revoke-invite', invite.id)}
                ><Icon name="trash" size={17} /></button
              >
            </div>{/each}
          {#each details.access as access}<div class="wp-book-access-row">
              <div>
                <strong>{access.name}</strong><small
                  >{i18n.t(access.permission === 'view' ? 'books.view' : 'books.contribute')}</small
                >
              </div>
              <button
                class="wp-icon-button wp-delete"
                disabled={busy}
                aria-label={i18n.t('books.revokeAccess', { name: access.name })}
                onclick={async () => {
                  if (
                    await confirmAction(
                      i18n.t('books.revokePrompt', { name: access.name }),
                      i18n.t('planner.remove'),
                      i18n.t('books.sharing')
                    )
                  )
                    change('revoke', access.household);
                }}><Icon name="trash" size={17} /></button
              >
            </div>{/each}
        </section>
      {/if}
      <button
        class="wp-delete"
        disabled={busy}
        onclick={() => remove(book!.access === 'owner' ? 'delete' : 'leave')}
        ><Icon name="trash" size={17} />{i18n.t(
          book.access === 'owner' ? 'books.delete' : 'books.leave'
        )}</button
      >
    {/if}
    {#if error}<p class="wp-alert" role="alert">{error}</p>{/if}
  </div>
  <footer>
    <div>
      <button class="wp-secondary" disabled={busy} onclick={close}>{i18n.t('books.done')}</button>
    </div>
  </footer>
</dialog>
