<script lang="ts">
    import { t } from "$lib/i18n/translations";
    import Meowbalt from "$components/misc/Meowbalt.svelte";
    import DropReceiver from "$components/misc/DropReceiver.svelte";
    import FileReceiver from "$components/misc/FileReceiver.svelte";

    let draggedOver = false;
    let files: FileList | undefined;
    let uploading = false;
    let shareCodeResult = "";
    let errorMessage = "";

    let inputCode = "";
    let downloadingCode = false;

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
                throw new Error(data.error || "Failed to upload file.");
            }

            shareCodeResult = data.shareCode;
        } catch (err: any) {
            errorMessage = err.message || "An error occurred during upload.";
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

            const link = document.createElement("a");
            link.href = downloadUrl;
            link.download = "";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

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

<div id="cobalt-share-container" class="center-column-container" tabindex="-1" data-first-focus>
    <main id="cobalt-share">
        <Meowbalt emotion="question" />
        
        <div id="share-header">
            <h1>share</h1>
            <p>WORK IN PROGRESS, DO NOT DO ANYTHING!</p>
            <p>For your privacy, files are deleted after 1 hour</p>
        </div>

        <div id="share-workspace">
            <DropReceiver bind:files bind:draggedOver onDrop={uploadAndShare} id="share-drop-container">
                <div id="share-open">
                    <div id="share-receiver">
                        <FileReceiver
                            bind:draggedOver
                            bind:files
                            onImport={uploadAndShare}
                            acceptTypes={["*/*"]}
                            acceptExtensions={["*"]}
                        />
                    </div>
                </div>
            </DropReceiver>

            {#if uploading}
                <p class="status-text">uploading and scanning file...</p>
            {/if}

            {#if shareCodeResult}
                <div class="result-box">
                    <p>Success! Your share code is:</p>
                    <code>{shareCodeResult}</code>
                    <small>files last for 1 hour</small>
                </div>
            {/if}

            <div id="retrieve-section">
                <h3>download using a code</h3>
                <div id="retrieve-input-group">
                    <input 
                        type="text" 
                        placeholder="enter share code..." 
                        bind:value={inputCode} 
                        disabled={downloadingCode}
                    />
                    <button on:click={downloadByCode} disabled={downloadingCode || !inputCode.trim()}>
                        {downloadingCode ? "fetching..." : "download"}
                    </button>
                </div>
            </div>

            {#if errorMessage}
                <p class="error-text">{errorMessage}</p>
            {/if}
        </div>
    </main>
</div>

<style>
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
        max-width: 500px;
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

    #share-workspace {
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 100%;
    }

    :global(#share-drop-container) {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
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
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
        border-top: 1px solid var(--content-border);
        padding-top: 16px;
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

    .error-text {
        color: #ff5555;
        font-size: 13px;
    }
</style>
