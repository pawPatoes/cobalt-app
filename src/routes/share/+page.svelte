<script>
    import { t } from "$lib/i18n/translations";
    import Meowbalt from "$components/misc/Meowbalt.svelte";
</script>

<svelte:head>
    <title>{$t("general.cobalt")} - {$t("tabs.share")}</title>
    <meta property="og:title" content={$t("tabs.share")} />
</svelte:head>

<div id="cobalt-share-container" class="center-column-container" tabindex="-1" data-first-focus>
    <main id="cobalt-share">
        <Meowbalt emotion="think" />
        <h1>{$t("tabs.share")}</h1>
        <p>{$t("share.description")}</p>
    </main>
</div>

<style>
    #cobalt-share-container {
        padding: var(--padding);
        overflow: hidden;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    #cobalt-share {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        gap: 15px;
        text-align: center;
    }

    h1 {
        font-size: 24px;
        color: var(--secondary);
    }

    p {
        color: var(--gray);
    }
</style>
