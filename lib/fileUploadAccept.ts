/**
 * Tipurile de fisiere acceptate la upload, definite intr-un singur loc.
 * Le folosesc in atributul "accept" al input-urilor; tinandu-le aici evit diferente intre SSR si client.
 */

/** Documentele acceptate: PDF, EPUB, DOCX, TXT (si extensiile, si content-type-urile lor). */
export const DOCUMENT_FILE_ACCEPT =
    ".pdf,.epub,.docx,.txt,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

/** Imaginile acceptate pentru OCR prin Gemini (PNG, JPEG, WEBP, GIF). */
export const IMAGE_FILE_ACCEPT =
    "image/png,image/jpeg,image/jpg,image/webp,image/gif";

// Regex pentru extensiile de imagine, folosit cand content-type-ul lipseste.
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** Verific daca un fisier e imagine; il folosesc ca sa blochez OCR-ul pentru oaspeti. */
export function isImageUploadFile(file: File): boolean {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    // E imagine fie dupa content-type ("image/..."), fie dupa extensie.
    return type.startsWith("image/") || IMAGE_EXT.test(name);
}
