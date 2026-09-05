import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { redactFooterTracking } from "./redact-footer.ts";

const originalFooter =
  "http://www.print-gakufu.com/    2026-03-01 11:00:00    0000000000000000000a000000010000    [SL]";

describe("redactFooterTracking", () => {
  it("replaces the footer tracking fields in their original content stream", async () => {
    const document = await PDFDocument.create({ updateMetadata: false });
    const page = document.addPage();
    const streamReference = document.context.register(
      document.context.flateStream(`BT <${encodeHex(originalFooter)}> Tj ET`),
    );
    page.node.set(PDFName.of("Contents"), document.context.obj([streamReference]));

    expect(redactFooterTracking(document)).toBe(1);

    const contents = page.node.Contents();
    expect(contents).toBeInstanceOf(PDFArray);
    const stream = (contents as PDFArray).lookup(0, PDFRawStream);
    const text = bytesToLatin1(decodePDFRawStream(stream).decode());
    expect(text).not.toContain("2026-03-01 11:00:00");
    expect(text).not.toContain("0000000000000000000a000000010000");
    expect(bytesToLatin1(decodeHex(text.match(/<([\da-f]+)>/i)?.[1] ?? ""))).toContain(
      "0000-00-00 00:00:00    00000000000000000000000000000000",
    );
  });

  it("also replaces a hexadecimal string inside a TJ array", async () => {
    const document = await PDFDocument.create({ updateMetadata: false });
    const page = document.addPage();
    const streamReference = document.context.register(
      document.context.flateStream(`BT [<${encodeHex(originalFooter)}>] TJ ET`),
    );
    page.node.set(PDFName.of("Contents"), streamReference);

    expect(redactFooterTracking(document)).toBe(1);

    const stream = page.node.Contents();
    expect(stream).toBeInstanceOf(PDFRawStream);
    const text = bytesToLatin1(decodePDFRawStream(stream as PDFRawStream).decode());
    expect(bytesToLatin1(decodeHex(text.match(/<([\da-f]+)>/i)?.[1] ?? ""))).toContain(
      "0000-00-00 00:00:00    00000000000000000000000000000000",
    );
  });
});

function bytesToLatin1(bytes: Uint8Array) {
  return String.fromCharCode(...bytes);
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
