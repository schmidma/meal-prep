<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Warning } from '$lib/domain';
  import type { KitchenPlan } from '$lib/kitchen';
  import {
    planChecks,
    checkTime,
    warningKey,
    type CheckAction,
    type ChecksSession,
    type PlanCheck
  } from '$lib/plan-checks';
  import Popover from './Popover.svelte';

  let {
    plan,
    warnings,
    session = $bindable(),
    anchor,
    onnavigate,
    onclose
  }: {
    plan: KitchenPlan;
    warnings: Warning[];
    session: ChecksSession;
    anchor?: HTMLElement | null;
    onnavigate: (
      target: CheckAction,
      originKey: string,
      title: string,
      groupKey: string | null,
      rowLabel: string | null
    ) => void;
    onclose: () => void;
  } = $props();
  const checks = $derived(planChecks(plan, warnings));
  const originCheck = $derived(
    checks.find((check) =>
      session.originGroupKey
        ? check.key === session.originGroupKey
        : check.warningKeys.includes(session.originKey ?? '')
    )
  );
  const originResolved = $derived(
    !!session.originKey &&
      (session.originGroupKey && !session.originRowTitle
        ? !originCheck
        : !warnings.some((warning) => warningKey(warning) === session.originKey))
  );
  const originRow = $derived(
    session.originRowTitle
      ? originCheck?.rows.find((row) => row.key === session.originKey)
      : undefined
  );
  const remainingUses = $derived(
    session.originGroupKey
      ? (checks.find((check) => check.key === session.originGroupKey)?.rows.length ?? 0)
      : 0
  );
  const otherUses = $derived(Math.max(0, remainingUses - (originResolved ? 0 : 1)));
  const returnTitle = $derived(
    originRow?.title ?? session.originRowTitle ?? originCheck?.title ?? session.originTitle
  );
  const returnAt = $derived(originRow?.action?.at ?? session.originAt);
  const returnDate = $derived(returnAt ? checkTime(returnAt) : null);
  const remainingMessage = $derived(
    otherUses === 0
      ? '0 other uses need review'
      : `${otherUses} other ${otherUses === 1 ? 'use still needs' : 'uses still need'} review`
  );
  const categories = $derived([
    { key: 'all' as const, title: 'All', count: warnings.length },
    {
      key: 'food' as const,
      title: 'Food',
      count: checks
        .filter((check) => check.group === 'food')
        .reduce((sum, check) => sum + check.warningKeys.length, 0)
    },
    {
      key: 'schedule' as const,
      title: 'Schedule',
      count: checks
        .filter((check) => check.group === 'schedule')
        .reduce((sum, check) => sum + check.warningKeys.length, 0)
    }
  ]);
  let content: HTMLDivElement;
  let heading: HTMLHeadingElement;
  let returnTitleNode = $state<HTMLSpanElement>();
  let returnTitleOverflow = $state(false);
  $effect(() => {
    const title = returnTitle;
    const node = returnTitleNode;
    returnTitleOverflow = false;
    if (!node || !title) return;
    let mounted = true;
    const measure = () => {
      returnTitleOverflow = node.scrollWidth > node.clientWidth + 1;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    void document.fonts.ready.then(() => {
      if (mounted) measure();
    });
    measure();
    return () => {
      mounted = false;
      observer.disconnect();
    };
  });
  const buttons = () =>
    Array.from(content.querySelectorAll<HTMLButtonElement>('[data-check-focus]')).filter(
      (button) => !button.closest('details:not([open])')
    );
  onMount(() => {
    const body = content.closest('.inspector-body') as HTMLElement;
    let mounted = true;
    const remember = () => {
      session.scrollTop = body.scrollTop;
    };
    void tick().then(() => {
      if (!mounted) return;
      body.scrollTop = session.scrollTop;
      if (session.returning) {
        const actions = buttons();
        const byKey = new Map(actions.map((button) => [button.dataset.checkFocus, button]));
        const index = session.orderedFocusKeys.indexOf(session.focusKey ?? '');
        const neighbors =
          index < 0
            ? []
            : [
                ...session.orderedFocusKeys.slice(index + 1),
                ...session.orderedFocusKeys.slice(0, index).reverse()
              ];
        const target =
          byKey.get(session.focusKey ?? '') ?? neighbors.map((key) => byKey.get(key)).find(Boolean);
        if (target) {
          const area = body.getBoundingClientRect();
          const rect = target.getBoundingClientRect();
          // Move only this scroll container, never the calendar or document.
          const offset = Math.max(
            8,
            Math.min(
              Math.max(session.originRowTitle ? 52 : 8, session.focusOffset ?? rect.top - area.top),
              body.clientHeight - rect.height - 8
            )
          );
          body.scrollTop += rect.top - area.top - offset;
          target.focus({ preventScroll: true });
        } else heading.focus({ preventScroll: true });
      }
      remember();
      body.addEventListener('scroll', remember);
    });
    return () => {
      mounted = false;
      body.removeEventListener('scroll', remember);
    };
  });
  function navigate(
    target: CheckAction,
    key: string,
    title: string,
    focusKey: string,
    groupKey: string | null = null,
    rowTitle: string | null = null
  ) {
    const actions = buttons();
    const button = actions.find((item) => item.dataset.checkFocus === focusKey);
    const body = content.closest('.inspector-body') as HTMLElement;
    session.scrollTop = body.scrollTop;
    session.focusOffset = button
      ? button.getBoundingClientRect().top - body.getBoundingClientRect().top
      : null;
    session.orderedFocusKeys = actions.map((item) => item.dataset.checkFocus!);
    session.focusKey = focusKey;
    onnavigate(target, key, title, groupKey, rowTitle);
  }
  function filter(key: ChecksSession['filter']) {
    session.filter = key;
    session.scrollTop = 0;
    (content.closest('.inspector-body') as HTMLElement).scrollTop = 0;
  }
</script>

<Popover {anchor} label="Things to check" {onclose}>
  {#snippet header()}
    <p class="popover-eyebrow">Whole plan / advisory</p>
    <h2 class="recipe-library-title" tabindex="-1" bind:this={heading}>
      Checks <span class="checks-count">{warnings.length}</span>
    </h2>
    <nav class="check-filters" aria-label="Check categories">
      {#each categories as category}<button
          aria-pressed={session.filter === category.key}
          onclick={() => filter(category.key)}
          >{category.title} <span>{category.count}</span></button
        >{/each}
    </nav>
    {#if session.returning && session.originKey}
      <div class="check-return-status" role="status">
        <div class="check-return-head">
          <strong>{originResolved ? 'Resolved' : 'Still flagged'}:</strong>
          <span class="check-return-title" bind:this={returnTitleNode}>{returnTitle}</span>
        </div>
        {#if returnDate}<span class="check-return-meta"
            >{originResolved ? 'Originally needed' : 'Needed'}: {returnDate}</span
          >{/if}
        {#if session.originRowTitle}<span class="check-return-meta">{remainingMessage}</span>
        {:else if session.originGroupKey}<span class="check-return-meta"
            >{remainingUses}
            {remainingUses === 1 ? 'use still needs' : 'uses still need'} review</span
          >{/if}
        {#if returnTitleOverflow}
          <details class="check-return-identity">
            <summary>Full name</summary>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable content needs keyboard focus -->
            <span tabindex="0" role="region" aria-label="Full name">{returnTitle}</span>
          </details>
        {/if}
      </div>
    {/if}
  {/snippet}
  <div class="checks-overview" bind:this={content}>
    <p class="checks-intro">
      Across your whole plan, not just this week. Checks never block edits.
    </p>
    {#if !warnings.length}
      <section class="checks-clear">
        <h3>All clear</h3>
        <p>No quantity or timing checks in your plan.</p>
      </section>
    {:else if session.filter !== 'all' && !checks.some((check) => check.group === session.filter)}
      <section class="checks-clear">
        <h3>No {session.filter} checks</h3>
        <p>Other categories may still need review. Choose All to see the whole plan.</p>
      </section>
    {:else}
      {#if checks.length !== warnings.length}<p class="checks-summary">
          {warnings.length} checks in {checks.length} cards. Related food timing checks are grouped; every
          affected use is listed.
        </p>{/if}
      {#each [{ key: 'food', title: 'Food quantities & readiness' }, { key: 'schedule', title: 'Schedule to review' }] as group}
        {@const items = checks.filter(
          (check) =>
            check.group === group.key &&
            (session.filter === 'all' || check.group === session.filter)
        )}
        {#if items.length}
          <section class="check-group" aria-label={group.title}>
            <h3>{group.title}</h3>
            {#each items as check (check.key)}
              {@const shortage = check.code.startsWith('OVER_ALLOCATED')}
              <article class="check-card" data-warning-code={check.code} data-check-key={check.key}>
                <h4>{check.title}</h4>
                {#if !shortage}<p class="check-explanation">{check.explanation}</p>{/if}
                {#if check.facts.length}<dl class="check-facts" class:quantity-facts={shortage}>
                    {#each check.facts as fact}<div>
                        <dt>{fact.label}</dt>
                        <dd>{fact.value}</dd>
                      </div>{/each}
                  </dl>{/if}
                {#if check.primary}
                  {@const target = check.primary}
                  <button
                    class="check-primary"
                    data-check-focus={check.key}
                    onclick={() => navigate(target, check.warningKeys[0], check.title, check.key)}
                    >{target.action}</button
                  >
                {/if}
                {#if check.code === 'BEFORE_READY'}{@render sharedActions(check)}{/if}
                {#if check.rows.length}
                  {#if shortage}
                    <details
                      class="check-contributors"
                      open={session.expandedKeys.includes(check.key)}
                      ontoggle={(event) => {
                        if (event.currentTarget.open && !session.expandedKeys.includes(check.key))
                          session.expandedKeys.push(check.key);
                        else if (!event.currentTarget.open)
                          session.expandedKeys = session.expandedKeys.filter(
                            (key) => key !== check.key
                          );
                      }}
                    >
                      <summary
                        >{check.rows.length}
                        {check.rows.length === 1 ? 'assignment' : 'assignments'} / view activities</summary
                      >{@render rows(check)}
                    </details>
                  {:else}{@render rows(check)}{/if}
                {/if}
                {#if check.code !== 'BEFORE_READY'}{@render sharedActions(check)}{/if}
              </article>
            {/each}
          </section>
        {/if}
      {/each}
    {/if}
  </div>
</Popover>

{#snippet sharedActions(check: PlanCheck)}
  {#if check.secondary.length}<div class="check-other-actions">
      {#each check.secondary as target}
        {@const focusKey = `${check.key}:${target.entity.kind}:${target.entity.id}`}
        <button
          class="check-secondary"
          data-check-focus={focusKey}
          onclick={() =>
            navigate(
              target,
              check.warningKeys[0],
              check.title,
              focusKey,
              check.code === 'BEFORE_READY' ? check.key : null
            )}>{target.action}</button
        >
      {/each}
    </div>{/if}
{/snippet}

{#snippet rows(check: PlanCheck)}
  <ul class="check-rows">
    {#each check.rows as row (row.key)}
      {@const focusKey = `${check.key}:row:${row.key}`}
      <li>
        {#if row.action && check.code !== 'BEFORE_READY'}
          {@const target = row.action}
          <button
            class="check-secondary check-row-title"
            aria-label={target.action}
            data-check-focus={focusKey}
            onclick={() => navigate(target, check.warningKeys[0], check.title, focusKey)}
            >{row.title}</button
          >
        {:else}<strong>{row.title}</strong>{/if}
        <span
          >{row.detail}{#if row.evidence}<span class="check-evidence">
              / {row.evidence}</span
            >{/if}</span
        >
        {#if row.action && check.code === 'BEFORE_READY'}
          {@const target = row.action}
          <button
            class="check-primary"
            data-check-focus={focusKey}
            aria-label={`${target.action}: ${row.title}, needed ${target.at ? checkTime(target.at) : (row.evidence ?? 'time unavailable')}`}
            onclick={() => navigate(target, row.key, check.title, focusKey, check.key, row.title)}
            >{target.action}</button
          >
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}
