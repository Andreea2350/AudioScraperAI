/** Single source of truth for `<input type="file" accept="…">` (avoids SSR/client drift). */
export const DOCUMENT_FILE_ACCEPT =
    ".pdf,.epub,.docx,.txt,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export const IMAGE_FILE_ACCEPT =
    "image/png,image/jpeg,image/jpg,image/webp,image/gif";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** True for PNG/JPG/WEBP/GIF uploads (used to gate image OCR for guest sessions). */
export function isImageUploadFile(file: File): boolean {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    return type.startsWith("image/") || IMAGE_EXT.test(name);
}
