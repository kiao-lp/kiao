/** Triggers a browser download for generated text content. */
export const downloadTextFile = (content: string, fileName: string, mimeType: string): void => {
    const url = `data:${mimeType};charset=utf-8,` + encodeURIComponent(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
