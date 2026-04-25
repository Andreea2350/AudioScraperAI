/** Single source of truth for `<input type="file" accept="…">` (avoids SSR/client drift). */
export const DOCUMENT_FILE_ACCEPT =
    ".pdf,.epub,.docx,.txt,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export const IMAGE_FILE_ACCEPT =
    "image/png,image/jpeg,image/jpg,image/webp,image/gif";
