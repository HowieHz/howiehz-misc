import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";

const FOOTER_TRACKING_PATTERN = /\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b(\s+)[\da-f]{32}\b/i;
const PDF_HEX_STRING_PATTERN = /<([\da-f]+)>/gi;
const ZERO_TIMESTAMP = "0000-00-00 00:00:00";
const ZERO_IDENTIFIER = "00000000000000000000000000000000";

/** Replace the known footer's timestamp and 32-character identifier in PDF text streams. */
export function redactFooterTracking(document: PDFDocument): number {
  return document.getPages().reduce((count, page) => count + redactPageFooterTracking(document, page), 0);
}

function redactPageFooterTracking(document: PDFDocument, page: ReturnType<PDFDocument["getPages"]>[number]) {
  const contents = page.node.Contents();
  if (contents instanceof PDFArray) {
    let count = 0;
    for (let index = 0; index < contents.size(); index += 1) {
      const stream = contents.lookupMaybe(index, PDFRawStream);
      if (!stream) {
        continue;
      }

      const redacted = redactContentStream(stream);
      if (!redacted) {
        continue;
      }

      const streamReference = contents.get(index);
      const replacement = document.context.flateStream(redacted);
      if (streamReference instanceof PDFRef) {
        document.context.assign(streamReference, replacement);
      } else {
        contents.set(index, replacement);
      }
      count += 1;
    }
    return count;
  }

  if (!(contents instanceof PDFRawStream)) {
    return 0;
  }

  const redacted = redactContentStream(contents);
  if (!redacted) {
    return 0;
  }

  const contentsReference = page.node.get(PDFName.of("Contents"));
  const replacement = document.context.flateStream(redacted);
  if (contentsReference instanceof PDFRef) {
    document.context.assign(contentsReference, replacement);
  } else {
    page.node.set(PDFName.of("Contents"), replacement);
  }
  return 1;
}

function redactContentStream(stream: PDFRawStream) {
  const source = bytesToLatin1(decodePDFRawStream(stream).decode());
  let replacements = 0;
  const redacted = source.replace(PDF_HEX_STRING_PATTERN, (match, hexText: string) => {
    const text = bytesToLatin1(decodeHex(hexText));
    const replacement = text.replace(FOOTER_TRACKING_PATTERN, (_tracking, whitespace: string) => {
      replacements += 1;
      return `${ZERO_TIMESTAMP}${whitespace}${ZERO_IDENTIFIER}`;
    });
    return replacement === text ? match : `<${encodeHex(replacement)}>`;
  });
  return replacements > 0 ? latin1ToBytes(redacted) : undefined;
}

function bytesToLatin1(bytes: Uint8Array) {
  let result = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    result += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return result;
}

function latin1ToBytes(value: string) {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function decodeHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function encodeHex(value: string) {
  return Array.from(value, (character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
