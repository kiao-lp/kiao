/** Browser clipboard helpers, independent of Dashboard services. */
export { setClipboardHtml, setClipboardPng as setClipboardImageFromSvg } from './svgClipboard';

export const setClipboard = async (content: string) => {
    return await navigator.clipboard.writeText(content);
}

export const getClipboardText = async (): Promise<string> => {
    try {
        return await navigator.clipboard.readText();
    } catch (error) {
        console.error("Please allow clipboard access in your browser.");
        throw error;
    }
}

export const getClipboardImage = async (): Promise<string | undefined> => {
    try {
        const clipboardItems = await navigator.clipboard.read();

        for (const clipboardItem of clipboardItems) {
            for (const type of clipboardItem.types) {
                if (type.startsWith("image/")) {
                    const blob = await clipboardItem.getType(type);

                    return await resizeImageToBase64(blob, 1000, 1000);
                }
            }
        }
    } catch (error) {
        console.error("Please allow clipboard access in your browser.");
        throw error;
    }
}

function resizeImageToBase64(blob: Blob, boxWidth: number, boxHeight: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = function () {
            const w = boxWidth / img.width;
            const h = boxHeight / img.height;
            const r = Math.min(Math.min(w, h), 1.0);

            const width = img.width * r;
            const height = img.height * r;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = width;
            canvas.height = height;

            ctx!.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL());
        };

        img.onerror = function () {
            reject("Failed to load image from blob.");
        };

        img.src = URL.createObjectURL(blob);
    });
}
