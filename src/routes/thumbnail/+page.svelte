<script lang="ts">
    import { onMount } from "svelte";
    import { t } from "$lib/i18n/translations";
    import { beforeNavigate, onNavigate } from "$app/navigation";

    import { clearFileStorage } from "$lib/storage/opfs";

    import { getProgress } from "$lib/task-manager/queue";
    import { queueVisible } from "$lib/state/queue-visibility";
    import { currentTasks } from "$lib/state/task-manager/current-tasks";
    import { clearQueue, queue as readableQueue, type TaskItem } from "$lib/state/task-manager/queue";

    import SectionHeading from "$components/misc/SectionHeading.svelte";
    import PopoverContainer from "$components/misc/PopoverContainer.svelte";
    import ProcessingStatus from "$components/queue/ProcessingStatus.svelte";
    import ProcessingQueueItem from "$components/queue/ProcessingQueueItem.svelte";
    import ProcessingQueueStub from "$components/queue/ProcessingQueueStub.svelte";
    import Meowbalt from "$components/misc/Meowbalt.svelte";

    import IconX from "@tabler/icons-svelte/IconX.svelte";
    import IconLink from "@tabler/icons-svelte/IconLink.svelte";
    import IconClipboard from "@tabler/icons-svelte/IconClipboard.svelte";

    let inputCode = $state("");
    let downloadingCode = $state(false);
    let errorMessage = $state("");

    const popoverAction = () => {
        $queueVisible = !$queueVisible;
    };

    let queueList = $derived(Object.entries($readableQueue));

    let totalProgress = $derived(queueList.length ? queueList.map(
        ([, item]) => getProgress(item, $currentTasks) * 100
    ).reduce((a, b) => a + b) / (100 * queueList.length) : 0);

    let indeterminate = $derived(queueList.length > 0 && totalProgress === 0);

    onNavigate(() => {
        $queueVisible = false;
    });

    beforeNavigate((event) => {
        if (event.type === "leave" && (totalProgress > 0 && totalProgress < 1)) {
            event.cancel();
        }
    });

    onMount(async () => {
        clearFileStorage();
    });

    const pasteFromClipboard = async () => {
        try {
            if (navigator.clipboard && navigator.clipboard.readText) {
                const text = await navigator.clipboard.readText();
                if (text) {
                    inputCode = text.trim();
                }
            }
        } catch (err) {
            console.error("Failed to read clipboard contents: ", err);
        }
    };

    const extractYouTubeId = (url: string): string | null => {
        try {
            const parsed = new URL(url);
            if (parsed.hostname === 'youtu.be') {
                return parsed.pathname.slice(1);
            }
            if (parsed.hostname.includes('youtube.com')) {
                if (parsed.pathname.startsWith('/embed/')) {
                    return parsed.pathname.split('/')[2];
                }
                return parsed.searchParams.get('v');
            }
        } catch {
            // Fallback regex if URL parsing fails
        }
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    };

    const updateQueueStore = (updater: (tasks: Record<string, TaskItem>) => Record<string, TaskItem>) => {
        if (readableQueue && typeof readableQueue.update === 'function') {
            readableQueue.update(updater);
        } else {
            readableQueue.set(updater($readableQueue));
        }
    };

    const triggerDownload = (downloadUrl: string, fileName: string) => {
        const taskId = Math.random().toString(36).substring(2, 9);
        const newTask: TaskItem = {
            id: taskId,
            name: fileName,
            progress: 0,
            status: 'downloading',
            url: downloadUrl
        };

        updateQueueStore(tasks => ({ ...tasks, [taskId]: newTask }));

        (async () => {
            try {
                const response = await fetch(downloadUrl);
                if (!response.ok) throw new Error("Failed to download thumbnail image");

                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(blobUrl);

                updateQueueStore(tasks => {
                    if (!tasks[taskId]) return tasks;
                    return {
                        ...tasks,
                        [taskId]: { ...tasks[taskId], status: 'completed', progress: 100 }
                    };
                });
            } catch (err: any) {
                updateQueueStore(tasks => {
                    if (!tasks[taskId]) return tasks;
                    return {
                        ...tasks,
                        [taskId]: { ...tasks[taskId], status: 'error' }
                    };
                });
                throw new Error(err.message || "Failed to download thumbnail");
            }
        })();
    };

    const downloadByCode = async () => {
        if (!inputCode.trim() || downloadingCode) return;
        downloadingCode = true;
        errorMessage = "";

        try {
            const videoId = extractYouTubeId(inputCode.trim());
            if (!videoId) {
                throw new Error("Invalid YouTube URL provided.");
            }

            const thumbnailUrls = [
                `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                `https://img.youtube.com/vi/${videoId}/default.jpg`
            ];

            let validUrl = "";
            for (const url of thumbnailUrls) {
                try {
                    const checkRes = await fetch(url, { method: "HEAD", mode: "no-cors" });
                    if (checkRes) {
                        validUrl = url;
                        break;
                    }
                } catch {
                    // try next
                }
            }

            if (!validUrl) {
                validUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
            }

            triggerDownload(validUrl, `${videoId}_thumbnail.jpg`);
            inputCode = "";
        } catch (err: any) {
            errorMessage = err.message || "Failed to retrieve thumbnail.";
        } finally {
            downloadingCode = false;
        }
    };
</script>

<svelte:head>
    <title>share ~ {$t("general.cobalt")}</title>
    <meta property="og:title" content="share ~ cobalt" />
</svelte:head>

<div id="processing-queue">
    <ProcessingStatus
        progress={totalProgress * 100}
        {indeterminate}
        expandAction={popoverAction}
    />

    <PopoverContainer
        id="processing-popover"
        expanded={$queueVisible}
        expandStart="right"
    >
        <div id="processing-header">
            <div class="header-top">
                <SectionHeading
                    title={$t("queue.title")}
                    sectionId="queue"
                    beta
                    nolink
                />
                <div class="header-buttons">
                    {#if queueList.length}
                        <button
                            class="clear-button"
                            onclick={clearQueue}
                            tabindex={!$queueVisible ? -1 : undefined}
                        >
                            <IconX />
                            {$t("button.clear")}
                        </button>
                    {/if}
                </div>
            </div>
        </div>

        <div id="processing-list" role="list" aria-labelledby="queue-title">
            {#each queueList as [id, item]}
                <ProcessingQueueItem {id} info={item} />
            {/each}
            {#if queueList.length === 0}
                <ProcessingQueueStub />
            {/if}
        </div>
    </PopoverContainer>
</div>

<div id="cobalt-share-container" class="center-column-container" tabindex="-1" data-first-focus>
    <main id="cobalt-share">
        <div id="share-header">
            <Meowbalt emotion="smile" />
            <p>Download thumbnails of youtube videos</p>
        </div>

        <div id="share-workspace">
            <div class="input-card-wrapper">
                <div class="input-card">
                    <div class="input-main-row">
                        <div class="input-field-container">
                            <IconLink class="input-icon" />
                            <input 
                                type="text" 
                                placeholder="enter youtube link..." 
                                bind:value={inputCode} 
                                disabled={downloadingCode}
                                onkeydown={(e) => e.key === 'Enter' && downloadByCode()}
                            />
                        </div>
                        <button class="download-action-btn" onclick={downloadByCode} disabled={downloadingCode || !inputCode.trim()}>
                            {downloadingCode ? "fetching..." : "download"}
                        </button>
                    </div>
                    <div class="input-sub-row">
                        <div class="left-actions"></div>
                        <button class="pill-btn paste-btn" onclick={pasteFromClipboard}>
                            <IconClipboard class="pill-icon" />
                            <span>paste</span>
                        </button>
                    </div>
                </div>
            </div>

            <div class="error-container">
                {#if errorMessage}
                    <p class="error-text">backend: {errorMessage}</p>
                {/if}
            </div>
        </div>
    </main>
</div>

<style>
    #processing-queue {
        --holder-padding: 12px;
        position: absolute;
        right: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        justify-content: end;
        z-index: 9;
        pointer-events: none;
        padding: var(--holder-padding);
        width: calc(100% - var(--holder-padding) * 2);
    }

    #processing-queue :global(#processing-popover) {
        gap: 12px;
        padding: 16px;
        padding-bottom: 0;
        width: calc(100% - 16px * 2);
        max-width: 425px;
    }

    #processing-header {
        display: flex;
        flex-direction: column;
        flex-wrap: wrap;
        gap: 3px;
    }

    .header-top {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
    }

    .header-buttons {
        display: flex;
        flex-direction: row;
        gap: var(--padding);
    }

    .header-buttons button {
        font-size: 13px;
        font-weight: 500;
        padding: 0;
        background: none;
        box-shadow: none;
        text-align: left;
        border-radius: 3px;
        outline-offset: 5px;
    }

    .header-buttons button :global(svg) {
        height: 16px;
        width: 16px;
    }

    .clear-button {
        color: var(--medium-red);
    }

    #processing-list {
        display: flex;
        flex-direction: column;
        max-height: 65vh;
        overflow-y: scroll;
        overflow-x: hidden;
    }

    @media screen and (max-width: 535px) {
        #processing-queue {
            --holder-padding: 8px;
            padding-top: 4px;
            top: env(safe-area-inset-top);
        }
    }

    #cobalt-share-container {
        padding: var(--padding);
        overflow-y: auto;
        overflow-x: hidden;
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
        max-width: 750px;
        gap: 20px;
        text-align: center;
        padding-bottom: 20px;
    }

    #share-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 15px;
    }

    #share-header p {
        color: var(--gray);
        font-size: 14px;
    }

    #share-workspace {
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 100%;
        align-items: center;
    }

    .input-card-wrapper {
        width: 100%;
        display: flex;
        justify-content: center;
    }

    .input-card {
        background: var(--sidebar-bg, #121212);
        border: 1px solid var(--content-border, #262626);
        border-radius: 16px;
        padding: 12px;
        width: 100%;
        max-width: 640px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }

    .input-main-row {
        display: flex;
        gap: 8px;
        width: 100%;
        align-items: center;
    }

    .input-field-container {
        flex: 1;
        background: var(--primary, #0a0a0a);
        border: 1px solid var(--content-border, #262626);
        border-radius: 10px;
        display: flex;
        align-items: center;
        padding: 0 12px;
        gap: 8px;
    }

    .input-field-container :global(svg.input-icon) {
        width: 18px;
        height: 18px;
        color: var(--gray, #707070);
    }

    .input-field-container input {
        flex: 1;
        background: transparent;
        border: none;
        color: var(--secondary, #fff);
        padding: 10px 0;
        font-size: 14px;
        outline: none;
        font-family: inherit;
    }

    .download-action-btn {
        background: var(--secondary, #fff);
        color: var(--primary, #000);
        border: none;
        padding: 0 18px;
        height: 40px;
        border-radius: 10px;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        transition: opacity 0.2s;
    }

    .download-action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .input-sub-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 2px;
    }

    .pill-btn {
        background: var(--primary, #0a0a0a);
        border: 1px solid var(--content-border, #262626);
        color: var(--secondary, #fff);
        padding: 6px 12px;
        border-radius: 8px;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        transition: background 0.2s;
    }

    .pill-btn:hover {
        background: var(--content-border, #262626);
    }

    .pill-btn :global(svg.pill-icon) {
        width: 14px;
        height: 14px;
    }

    .error-container {
        min-height: 24px;
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
    }

    .error-text {
        color: #ff5555;
        font-size: 13px;
    }
</style>
