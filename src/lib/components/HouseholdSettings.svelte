<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { confirmAction } from '$lib/confirmation';
  import { Ellipsis, Copy, Trash2 } from '@lucide/svelte';
  import SignOut from './SignOut.svelte';
  import { accountFetch } from '$lib/household-client';
  import { onMount } from 'svelte';
  import type { Account } from '$lib/account';
  let { account, unsaved = false }: { account: Account; unsaved?: boolean } = $props();
  let members = $state<{ id: string; email: string; role: string }[]>([]);
  const ownerCount = $derived(members.filter((member) => member.role === 'owner').length);
  let name = $state('');
  let invitations = $state<{ id: string; expires: number; token: string | null }[]>([]);
  const inviteUrl = (token: string) => `${location.origin}/join/${token}`;
  let busy = $state(false);
  let error = $state('');
  let message = $state('');
  onMount(() => {
    name = account.household?.name ?? '';
    void refresh().catch(() => (error = i18n.t('household-settings.unableToLoadHouseholdMembers')));
  });
  async function refresh() {
    const r = await accountFetch(account)('/api/household');
    if (r.ok) {
      const result = await r.json();
      members = result.members;
      invitations = result.invitations;
    } else throw new Error(i18n.t('household-settings.unableToLoadHouseholdMembers'));
  }
  async function action(action: string, target = '') {
    busy = true;
    error = '';
    message = '';
    try {
      const r = await accountFetch(account)('/api/household', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, target })
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      if (action === 'invite' || action === 'revoke-invite') {
        await refresh();
        message =
          action === 'invite'
            ? i18n.t('household-settings.invitationCreated')
            : i18n.t('household-settings.invitationRevoked');
      } else if (
        action === 'remove' ||
        ((action === 'promote' || action === 'demote') && target !== account.user.id)
      ) {
        await refresh();
        message =
          action === 'remove'
            ? i18n.t('household-settings.memberRemoved')
            : i18n.t('household-settings.memberRoleUpdated');
      } else location.reload();
    } catch (cause) {
      error =
        cause instanceof Error
          ? i18n.error(cause.message)
          : i18n.t('household-settings.unableToUpdateHousehold');
    } finally {
      busy = false;
    }
  }
  function closeMemberMenus(event: MouseEvent | KeyboardEvent) {
    if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
    document.querySelectorAll<HTMLDetailsElement>('.wp-member-manage[open]').forEach((menu) => {
      if (event instanceof KeyboardEvent || !menu.contains(event.target as Node)) menu.open = false;
    });
  }
  async function copyInvitation(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      message = i18n.t('household-settings.linkCopied');
    } catch {
      message = i18n.t('household-settings.selectAndCopyTheLinkText');
    }
  }
</script>

<svelte:window onclick={closeMemberMenus} onkeydown={closeMemberMenus} />

<section class="wp-household-settings">
  <h2>{i18n.t('household-settings.household')}</h2>
  {#if error}<p role="alert" class="wp-alert">{error}</p>{/if}{#if message}<p role="status">
      {message}
    </p>{/if}
  <section class="wp-household-block" aria-labelledby="household-name-heading">
    <h3 id="household-name-heading">{i18n.t('planner.name')}</h3>
    {#if account.household?.role === 'owner'}
      <form
        class="wp-inline-add"
        onsubmit={(e) => {
          e.preventDefault();
          void action('rename', name);
        }}
      >
        <input
          aria-label={i18n.t('household-settings.householdName')}
          bind:value={name}
          maxlength="80"
          required
        /><button disabled={busy || name.trim() === account.household.name}
          >{i18n.t('planner.save')}</button
        >
      </form>
    {:else}<p>{account.household?.name}</p>{/if}
  </section>
  <section class="wp-household-block" aria-labelledby="household-members-heading">
    <h3 id="household-members-heading">
      {i18n.t('household-settings.members')} <span>{members.length}</span>
    </h3>
    <ul class="wp-members">
      {#each members as member}<li>
          <span class="wp-account-avatar" aria-hidden="true"
            >{member.email.slice(0, 1).toUpperCase()}</span
          >
          <div class="wp-member-identity">
            <strong>{member.email}</strong><small
              >{member.role === 'owner'
                ? i18n.t('household-settings.owner')
                : i18n.t('household-settings.member')}{member.id === account.user.id
                ? i18n.t('household.you')
                : ''}</small
            >
          </div>
          {#if account.household?.role === 'owner'}<details
              class="wp-member-manage"
              name="member-actions"
            >
              <summary
                aria-label={i18n.t('household.manageMember', { email: member.email })}
                title={i18n.t('household-settings.manageMember')}
                ><Ellipsis size={20} aria-hidden="true" /></summary
              >
              <div class="wp-member-actions">
                <button
                  class="wp-secondary"
                  disabled={busy || (member.role === 'owner' && ownerCount < 2)}
                  title={member.role === 'owner' && ownerCount < 2
                    ? i18n.t('household-settings.makeAnotherMemberAnOwnerFirst')
                    : undefined}
                  onclick={async () => {
                    const promote = member.role !== 'owner';
                    if (
                      await confirmAction(
                        promote
                          ? i18n.t('household.promoteQuestion', { email: member.email })
                          : i18n.t('household.demoteQuestion', { email: member.email }),
                        promote
                          ? i18n.t('household-settings.makeOwner')
                          : i18n.t('household-settings.makeMember'),
                        promote
                          ? i18n.t('household-settings.addAnOwner')
                          : i18n.t('household-settings.changeToMember')
                      )
                    )
                      void action(promote ? 'promote' : 'demote', member.id);
                  }}
                  >{member.role === 'owner'
                    ? i18n.t('household-settings.makeMember')
                    : i18n.t('household-settings.makeOwner')}</button
                >
                {#if member.id !== account.user.id}<button
                    class="wp-secondary"
                    disabled={busy}
                    onclick={async () => {
                      if (
                        await confirmAction(
                          i18n.t('household.removeQuestion', { email: member.email }),
                          i18n.t('household-settings.removeMember'),
                          i18n.t('household-settings.removeMember2')
                        )
                      )
                        void action('remove', member.id);
                    }}>{i18n.t('planner.remove')}</button
                  >{/if}
              </div>
            </details>{/if}
        </li>{/each}
    </ul>
  </section>
  {#if account.household?.role === 'owner'}<section
      class="wp-household-block"
      aria-labelledby="household-invite-heading"
    >
      <div class="wp-invite-heading">
        <div>
          <h3 id="household-invite-heading">{i18n.t('household-settings.invitations')}</h3>
          <p class="wp-household-hint">
            {i18n.t('household-settings.singleuseLinksValidForSevenDays')}
          </p>
        </div>
        <button class="wp-secondary" disabled={busy} onclick={() => action('invite')}
          >{i18n.t('household-settings.createInviteLink')}</button
        >
      </div>
      {#if invitations.length}<ul class="wp-invite-list">
          {#each invitations as invitation, index (invitation.id)}<li>
              <div>
                <small
                  >{i18n.t('household.expires', {
                    date: i18n.date(new Date(invitation.expires), {
                      month: 'short',
                      day: 'numeric'
                    })
                  })}</small
                >
                {#if invitation.token}<span
                    class="wp-invite-url"
                    title={inviteUrl(invitation.token)}>{inviteUrl(invitation.token)}</span
                  >
                {:else}<small
                    >{i18n.t('household-settings.previouslySharedLinkURLUnavailable')}</small
                  >{/if}
              </div>
              {#if invitation.token}<button
                  class="wp-icon-button"
                  aria-label={i18n.t('household.copyNumberedLink', {
                    number: invitations.length - index
                  })}
                  title={i18n.t('household-settings.copyLink')}
                  onclick={() => copyInvitation(invitation.token!)}
                  ><Copy size={17} aria-hidden="true" /></button
                >{/if}
              <button
                class="wp-icon-button wp-danger"
                disabled={busy}
                aria-label={i18n.t('household.revokeNumberedLink', {
                  number: invitations.length - index
                })}
                title={i18n.t('household-settings.revokeLink')}
                onclick={async () => {
                  if (
                    await confirmAction(
                      i18n.t('household-settings.anyoneWithThisLinkWillNoLonger'),
                      i18n.t('household-settings.revokeLink'),
                      i18n.t('household-settings.revokeInvitation')
                    )
                  )
                    void action('revoke-invite', invitation.id);
                }}><Trash2 size={17} aria-hidden="true" /></button
              >
            </li>{/each}
        </ul>{/if}
    </section>
  {/if}
  <section
    class="wp-household-block wp-household-account"
    aria-labelledby="household-account-heading"
  >
    <h3 id="household-account-heading">{i18n.t('household-settings.yourAccount')}</h3>
    <p class="wp-household-hint">{account.user.email}</p>
    <div class="wp-household-account-actions">
      {#if account.household?.role !== 'owner' || ownerCount > 1}<button
          class="wp-secondary wp-danger"
          disabled={busy}
          onclick={async () => {
            if (
              await confirmAction(
                i18n.t('household-settings.leaveThisHouseholdYouWillNeedAn'),
                i18n.t('household-settings.leaveHousehold'),
                i18n.t('household-settings.leaveHousehold2')
              )
            )
              void action('leave');
          }}>{i18n.t('household-settings.leaveHousehold')}</button
        >{/if}
      <SignOut {unsaved} disabled={busy} />
    </div>
    {#if account.household?.role === 'owner' && ownerCount === 1}<p class="wp-modal-help">
        {i18n.t('household-settings.makeAnotherMemberAnOwnerBeforeStepping')}
      </p>{/if}
  </section>
</section>
