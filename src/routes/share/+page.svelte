<script lang="ts">
    import { onMount } from "svelte";
    import { t } from "$lib/i18n/translations";
    import { beforeNavigate, onNavigate } from "$app/navigation";

    import { clearFileStorage } from "$lib/storage/opfs";

    import { getProgress } from "$lib/task-manager/queue";
    import { queueVisible } from "$lib/state/queue-visibility";
    import { currentTasks } from "$lib/state/task-manager/current-tasks";
    import { clearQueue, queue as readableQueue, type TaskItem } from "$lib/state/task-manager/queue";

    import DropReceiver from "$components/misc/DropReceiver.svelte";
    import FileReceiver from "$components/misc/FileReceiver.svelte";
    import SectionHeading from "$components/misc/SectionHeading.svelte";
    import PopoverContainer from "$components/misc/PopoverContainer.svelte";
    import ProcessingStatus from "$components/queue/ProcessingStatus.svelte";
    import ProcessingQueueItem from "$components/queue/ProcessingQueueItem.svelte";
    import ProcessingQueueStub from "$components/queue/ProcessingQueueStub.svelte";

    import IconX from "@tabler/icons-svelte/IconX.svelte";

    let draggedOver = false;
    let files: FileList | undefined;
    let uploading = false;
    let shareCodeResult = "";
    let errorMessage = "";

    let inputCode = "";
    let downloadingCode = false;

    interface ActiveUpload {
        shareCode: string;
        fileName: string;
        expiresAt: number;
        githubUrl: string;
    }

    let activeUploads: ActiveUpload[] = [];
    let showModal = false;
    let timerInterval: any;

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

    const openDB = (): Promise<IDBDatabase> => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("CobaltShareDB", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains("uploads")) {
                    db.createObjectStore("uploads", { keyPath: "shareCode" });
                }
            };
        });
    };

    const saveToIndexedDB = async (item: ActiveUpload) => {
        const db = await openDB();
        const tx = db.transaction("uploads", "readwrite");
        tx.objectStore("uploads").put(item);
    };

    const loadFromIndexedDB = async (): Promise<ActiveUpload[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("uploads", "readonly");
            const request = tx.objectStore("uploads").getAll();
            request.onsuccess = () => {
                const now = Date.now();
                const valid = (request.result || []).filter((i: ActiveUpload) => i.expiresAt > now);
                resolve(valid);
            };
            request.onerror = () => reject(request.error);
        });
    };

    onMount(async () => {
        // clear old files from storage on first page load
        clearFileStorage();

        activeUploads = await loadFromIndexedDB();
        timerInterval = setInterval(() => {
            const now = Date.now();
            activeUploads = activeUploads.filter(i => i.expiresAt > now);
        }, 1000);

        return () => {
            clearInterval(timerInterval);
        };
    });

    const formatTimeRemaining = (expiresAt: number) => {
        const diff = expiresAt - Date.now();
        if (diff <= 0) return "Expired";
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        return `${minutes}m ${seconds < 10 ? '0' : ''}${seconds}s`;
    };

    const createDownloadPipeline = (downloadUrl: string, fileName: string) => {
        const taskId = Math.random().toString(36).substring(2, 9);
        const newTask: TaskItem = {
            id: taskId,
            name: fileName,
            progress: 0,
            status: 'downloading',
            url: downloadUrl
        };

        readableQueue.update(tasks => ({ ...tasks, [taskId]: newTask }));

        (async () => {
            try {
                const response = await fetch(downloadUrl);
                if (!response.ok) throw new Error("Failed to download file");

                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(blobUrl);

                readableQueue.update(tasks => {
                    if (!tasks[taskId]) return tasks;
                    return {
                        ...tasks,
                        [taskId]: { ...tasks[taskId], status: 'completed', progress: 100 }
                    };
                });
            } catch (err: any) {
                readableQueue.update(tasks => {
                    if (!tasks[taskId]) return tasks;
                    return {
                        ...tasks,
                        [taskId]: { ...tasks[taskId], status: 'error' }
                    };
                });
            }
        })();
    };

    const uploadAndShare = async () => {
        if (!files || files.length === 0) return;
        uploading = true;
        errorMessage = "";
        shareCodeResult = "";

        const file = files[0];
        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch("https://cobalt-share.up.railway.app/api/share", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                const exactError = data.details || data.error || "Unknown server error.";
                throw new Error(exactError);
            }

            shareCodeResult = data.shareCode;
            const newUpload: ActiveUpload = {
                shareCode: data.shareCode,
                fileName: file.name,
                expiresAt: Date.now() + 60 * 60 * 1000,
                githubUrl: data.githubUrl
            };

            await saveToIndexedDB(newUpload);
            activeUploads = [newUpload, ...activeUploads.filter(u => u.shareCode !== newUpload.shareCode)];
        } catch (err: any) {
            errorMessage = err.message;
        } finally {
            uploading = false;
            files = undefined;
        }
    };

    const downloadByCode = async () => {
        if (!inputCode.trim()) return;
        downloadingCode = true;
        errorMessage = "";

        const code = inputCode.trim();
        const downloadUrl = `https://cobalt-share.up.railway.app/api/get/${code}`;

        try {
            const checkRes = await fetch(downloadUrl, { method: "HEAD" });
            if (!checkRes.ok) {
                throw new Error("File share code not found or has expired.");
            }

            const foundItem = activeUploads.find(u => u.shareCode === code);
            const fileName = foundItem ? foundItem.fileName : `shared_file_${code}`;

            createDownloadPipeline(downloadUrl, fileName);
            inputCode = "";
        } catch (err: any) {
            errorMessage = err.message || "Failed to retrieve file with that code.";
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
            <h1>share</h1>
            <p>WORK IN PROGRESS, DO NOT DO ANYTHING!</p>
            <p>For your privacy, files are deleted after one hour</p>
            <button class="modal-toggle-btn" onclick={() => showModal = true}>
                View Active Uploads ({activeUploads.length})
            </button>
        </div>

        <div id="share-workspace">
            <div id="share-side-by-side">
                <DropReceiver bind:files bind:draggedOver onDrop={uploadAndShare} id="share-drop-container">
                    <div id="share-open">
                        <div id="share-receiver">
                            <FileReceiver
                                bind:draggedOver
                                bind:files
                                onImport={uploadAndShare}
                                acceptTypes={["*/*"]}
                                acceptExtensions={[]}
                            />
                        </div>
                    </div>
                </DropReceiver>

                <div id="retrieve-section">
                    <h3>download using a code</h3>
                    <div id="retrieve-input-group">
                        <input 
                            type="text" 
                            placeholder="enter share code..." 
                            bind:value={inputCode} 
                            disabled={downloadingCode}
                        />
                        <button onclick={downloadByCode} disabled={downloadingCode || !inputCode.trim()}>
                            {downloadingCode ? "fetching..." : "download"}
                        </button>
                    </div>
                </div>
            </div>

            {#if uploading}
                <p class="status-text">uploading and scanning file...</p>
            {/if}

            {#if shareCodeResult}
                <div class="result-box">
                    <p>Success! Your share code is:</p>
                    <code>{shareCodeResult}</code>
                    <small>files last for one hour</small>
                </div>
            {/if}

            <div class="error-container">
                {#if errorMessage}
                    <p class="error-text">backend: {errorMessage}</p>
                {/if}
            </div>
        </div>
    </main>

    {#if showModal}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="modal-backdrop" role="dialog" aria-modal="true" onclick={() => showModal = false}>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="modal-content" onclick={(e) => e.stopPropagation()}>
                <div class="modal-header">
                    <h2>Active Uploads</h2>
                    <button class="close-btn" onclick={() => showModal = false}>&times;</button>
                </div>
                <div class="modal-body">
                    {#if activeUploads.length === 0}
                        <p class="no-uploads">No active uploads found.</p>
                    {:else}
                        <div class="uploads-list">
                            {#each activeUploads as item}
                                <div class="upload-item">
                                    <div class="upload-info">
                                        <span class="file-name" title={item.fileName}>{item.fileName}</span>
                                        <code class="item-code">{item.shareCode}</code>
                                    </div>
                                    <div class="upload-actions">
                                        <span class="timer">{formatTimeRemaining(item.expiresAt)}</span>
                                        <button 
                                            class="download-link-btn" 
                                            onclick={() => createDownloadPipeline(`https://cobalt-share.up.railway.app/api/get/${item.shareCode}`, item.fileName)}
                                        >
                                            DL
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    {/if}
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

    #share-header h1 {
        font-size: 24px;
        color: var(--secondary);
    }

    #share-header p {
        color: var(--gray);
        font-size: 14px;
    }

    .modal-toggle-btn {
        margin-top: 10px;
        background: var(--sidebar-bg);
        color: var(--secondary);
        border: 1px solid var(--content-border);
        padding: 6px 12px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: bold;
    }

    .modal-toggle-btn:hover {
        background: var(--content-border);
    }

    #share-workspace {
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 100%;
    }

    #share-side-by-side {
        display: flex;
        flex-direction: row;
        gap: 20px;
        width: 100%;
        align-items: stretch;
    }

    :global(#share-drop-container) {
        display: flex;
        justify-content: center;
        align-items: center;
        flex: 1;
    }

    #share-open {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        width: 100%;
    }

    #share-receiver {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--padding);
    }

    .status-text {
        color: var(--secondary);
        font-style: italic;
    }

    .result-box {
        background-color: var(--sidebar-bg);
        padding: 12px;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        border: 1px solid var(--content-border);
    }

    .result-box code {
        font-size: 20px;
        font-weight: bold;
        color: var(--secondary);
        background: var(--primary);
        padding: 4px 8px;
        border-radius: 6px;
        user-select: all;
    }

    .result-box small {
        color: var(--gray);
    }

    #retrieve-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 12px;
        background: var(--sidebar-bg);
        border: 1px solid var(--content-border);
        padding: 20px;
        border-radius: 16px;
    }

    #retrieve-section h3 {
        font-size: 14px;
        color: var(--secondary);
    }

    #retrieve-input-group {
        display: flex;
        gap: 8px;
    }

    #retrieve-input-group input {
        flex: 1;
        background: var(--primary);
        border: 1px solid var(--content-border);
        color: var(--secondary);
        padding: 8px 12px;
        border-radius: 8px;
        outline: none;
    }

    #retrieve-input-group button {
        background: var(--secondary);
        color: var(--primary);
        border: none;
        padding: 8px 16px;
        border-radius: 8px;
        font-weight: bold;
        cursor: pointer;
    }

    #retrieve-input-group button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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

    /* Modal Styles */
    .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    }

    .modal-content {
        background: var(--sidebar-bg);
        border: 1px solid var(--content-border);
        border-radius: 16px;
        width: 90%;
        max-width: 450px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }

    .modal-header {
        padding: 16px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--content-border);
    }

    .modal-header h2 {
        font-size: 16px;
        color: var(--secondary);
        margin: 0;
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--gray);
        font-size: 24px;
        cursor: pointer;
    }

    .modal-body {
        padding: 16px 20px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .no-uploads {
        color: var(--gray);
        font-size: 14px;
        text-align: center;
        padding: 20px 0;
    }

    .uploads-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .upload-item {
        background: var(--primary);
        border: 1px solid var(--content-border);
        padding: 10px 12px;
        border-radius: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
    }

    .upload-info {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        overflow: hidden;
    }

    .file-name {
        font-size: 13px;
        color: var(--secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 220px;
    }

    .item-code {
        font-size: 12px;
        background: var(--sidebar-bg);
        padding: 2px 6px;
        border-radius: 4px;
        color: var(--secondary);
    }

    .upload-actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .timer {
        font-size: 12px;
        color: var(--gray);
        font-variant-numeric: tabular-nums;
    }

    .download-link-btn {
        background: var(--secondary);
        color: var(--primary);
        border: none;
        text-decoration: none;
        font-size: 12px;
        font-weight: bold;
        padding: 4px 8px;
        border-radius: 6px;
        cursor: pointer;
    }
</style>
