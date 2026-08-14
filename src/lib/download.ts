import { get } from "svelte/store";

import settings from "$lib/state/settings";

import { device } from "$lib/device";
import { t } from "$lib/i18n/translations";
import { createDialog } from "$lib/state/dialogs";

import type { DialogInfo } from "$lib/types/dialog";
import type { CobaltFileUrlType } from "$lib/types/api";

type DownloadFileParams = {
    url?: string,
    file?: File,
    urlType?: CobaltFileUrlType,
}

type SavingDialogParams = {
    url?: string,
    file?: File,
    body?: string,
    urlType?: CobaltFileUrlType,
}

export const playSuccessSound = () => {
    try {
        const audio = new Audio();
        audio.volume = 0.6;
        
        // Check session storage; if not set, roll 1 in 10. If true, refresh page.
        let psecret = sessionStorage.getItem('psecret');
        if (psecret === null) {
            const rolledTrue = Math.random() < 1;
            psecret = rolledTrue ? 'true' : 'false';
            sessionStorage.setItem('psecret', psecret);
            
            if (rolledTrue) {
                window.location.reload();
                return;
            }
        }
        const isSecretActive = psecret === 'true';

        audio.src = isSecretActive ? '/sounds/syippe.mp3' : '/sounds/yippe.mp3';

        // Inject global screen-shake style if it doesn't already exist
        if (!document.getElementById('screen-shake-style')) {
            const style = document.createElement('style');
            style.id = 'screen-shake-style';
            style.innerHTML = `
                @keyframes screenShake {
                    0% { transform: translate(0, 0) rotate(0deg); }
                    20% { transform: translate(-10px, 8px) rotate(-2deg); }
                    40% { transform: translate(10px, -8px) rotate(2deg); }
                    60% { transform: translate(-8px, -6px) rotate(-1deg); }
                    80% { transform: translate(8px, 6px) rotate(1deg); }
                    100% { transform: translate(0, 0) rotate(0deg); }
                }
                .is-shaking {
                    animation: screenShake 0.15s ease-in-out infinite;
                }
            `;
            document.head.appendChild(style);
        }

        // Trigger visual effects precisely when audio playback successfully starts
        audio.onplaying = () => {
            document.body.classList.add('is-shaking');
            setTimeout(() => {
                document.body.classList.remove('is-shaking');
            }, 1000);

            const img = document.createElement('img');
            img.src = isSecretActive ? '/meowbalt/ssmile.png' : '/meowbalt/smile.png';
            img.style.position = 'fixed';
            img.style.top = '0';
            img.style.left = '0';
            img.style.width = '100vw';
            img.style.height = '100vh';
            img.style.objectFit = 'contain';
            img.style.zIndex = '999999';
            img.style.transition = 'opacity 1.5s ease-in-out';
            img.style.opacity = '1';
            
            document.body.appendChild(img);

            setTimeout(() => {
                img.style.opacity = '0';
            }, 1000);

            setTimeout(() => {
                img.remove();
            }, 2500);
        };

        audio.play().catch(() => {
            // Fallback if audio play gets restricted: trigger visuals immediately anyway
            audio.onplaying?.(new Event('playing'));
        });

    } catch (e) {
        console.log("Audio/Image error:", e);
    }
};

const openSavingDialog = ({ url, file, body, urlType }: SavingDialogParams) => {
    const dialogData: DialogInfo = {
        type: "saving",
        id: "saving",
        file,
        url,
        urlType,
    }
    if (body) dialogData.bodyText = body;

    createDialog(dialogData)
}

export const openFile = (file: File) => {
    playSuccessSound();
    const a = document.createElement("a");
    const url = URL.createObjectURL(file);

    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const shareFile = async (file: File) => {
    playSuccessSound();
    return await navigator?.share({
        files: [ file ],
    });
}

export const openURL = (url: string, hasDialog = false) => {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) {
        return alert('error: invalid url!');
    }

    const open = window.open(url, "_blank", "noopener,noreferrer");

    /* if new tab got blocked by user agent, show a saving dialog */
    if (!open && !hasDialog) {
        return openSavingDialog({
            url,
            body: get(t)("dialog.saving.blocked")
        });
    }
    playSuccessSound();
}

export const shareURL = async (url: string) => {
    playSuccessSound();
    return await navigator?.share({ url });
}

export const copyURL = async (url: string) => {
    playSuccessSound();
    return await navigator?.clipboard?.writeText(url);
}

export const downloadFile = ({ url, file, urlType }: DownloadFileParams) => {
    if (!url && !file) throw new Error("attempted to download void");

    const pref = get(settings).save.savingMethod;

    if (pref === "ask") {
        return openSavingDialog({ url, file, urlType });
    }

    /*
        user actions (such as invoke share, open new tab) have expiration.
        in webkit, for example, that timeout is 5 seconds.
        https://github.com/WebKit/WebKit/blob/b838f8bb/Source/WebCore/page/LocalDOMWindow.cpp#L167

        navigator.userActivation.isActive makes sure that we're still able to
        invoke an action without the user agent interrupting it.
        if not, we show a saving dialog for user to re-invoke that action.

        if browser is old or doesn't support this API, we just assume that it expired.
    */
    if (!navigator?.userActivation?.isActive) {
        return openSavingDialog({
            url,
            file,
            body: get(t)("dialog.saving.timeout"),
            urlType
        });
    }

    try {
        if (file) {
            // 256mb cuz ram limit per tab is 384mb,
            // and other stuff (such as libav) might have used some ram too
            const iosFileShareSizeLimit = 1024 * 1024 * 256;

            // this is required because we can't share big files
            // on ios due to a very low ram limit
            if (device.is.iOS) {
                if (file.size < iosFileShareSizeLimit) {
                    return shareFile(file);
                } else {
                    return openFile(file);
                }
            }

            if (pref === "share" && device.supports.share) {
                return shareFile(file);
            } else if (pref === "download") {
                return openFile(file);
            }
        }

        if (url) {
            if (pref === "share" && device.supports.share) {
                return shareURL(url);
            } else if (pref === "download" && device.supports.directDownload
                    && !(device.is.iOS && urlType === "redirect")) {
                return openURL(url);
            } else if (pref === "copy" && !file) {
                return copyURL(url);
            }
        }
    } catch { /* catch & ignore */ }

    return openSavingDialog({ url, file, urlType });
}
