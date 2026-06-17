/** Lista unica de tipuri acceptate la upload document (evita diferente SSR/client). */
export const DOCUMENT_FILE_ACCEPT =
    ".pdf,.epub,.docx,.txt,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

/** Tipuri acceptate pentru upload imagini (OCR prin Gemini). */
export const IMAGE_FILE_ACCEPT =
    "image/png,image/jpeg,image/jpg,image/webp,image/gif";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** Verific daca fisierul e imagine (folosit pentru a bloca OCR la oaspeti). */
export function isImageUploadFile(file: File): boolean {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    return type.startsWith("image/") || IMAGE_EXT.test(name);
}
