<script lang="ts">
  import { page } from '$app/stores';
</script>

<svelte:head>
  <title>Error — Bulk Order Co-op</title>
</svelte:head>

<div class="text-center animate-in">
  <h1 class="display-font" style="font-size: 6rem; line-height: 1;">
    {$page.status}
  </h1>
  <p>{$page.error?.message ?? 'Something went wrong'}</p>

  <div role="group">
    <a href="/" role="button">Return home</a>
    <button class="outline" onclick={() => history.back()}>Go back</button>
  </div>
</div>
