import QRCode from 'qrcode';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import type { Exam } from '../../../packages/contracts/src/index.js';
import { requireCondition } from '../domain/errors.js';
import { stable } from '../services/imports.js';

const WIDTH = 1000;
const HEIGHT = 1414;
const PER_PAGE = 4;
// jsQR ships a CommonJS callable with an ESM-shaped .d.ts file.
const jsQR = createRequire(import.meta.url)('jsqr') as typeof import('jsqr')['default'];
export interface Identity { studentId: string; examId: string; attemptId: string }
export function pageCount(exam: Exam) { return Math.ceil(exam.questions.length / PER_PAGE); }
function qrPayload(exam: Exam, identity: Identity, pageNumber: number) {
  return { v: 1, template: 'answer-sheet-1', examRevision: exam.revision,
    studentId: identity.studentId, examId: identity.examId, attemptId: identity.attemptId, pageNumber };
}
function regions(exam: Exam, pageNumber: number) {
  return exam.questions.slice((pageNumber - 1) * PER_PAGE, pageNumber * PER_PAGE).map((question, index) => ({
    questionId: question.id, x: 80, y: 300 + index * 260, width: 840, height: 215,
  }));
}
const escape = (text: string) => text.replace(/[<>&"']/g, value => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[value]!));
export async function answerSheets(exam: Exam, identity: Identity) {
  requireCondition(pageCount(exam) <= 4, 'SCAN_EXAM_TOO_LARGE', 'Scanning currently supports up to 16 questions');
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pageCount(exam); pageNumber++) {
    const qr = await QRCode.toDataURL(stable(qrPayload(exam, identity, pageNumber)), { width: 180, margin: 2, errorCorrectionLevel: 'M' });
    const boxes = regions(exam, pageNumber);
    // Printable answer paper is a backend artifact, independent of the website UI.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<rect width="100%" height="100%" fill="white"/><image href="${qr}" x="60" y="60" width="180" height="180"/>
<g font-family="sans-serif" fill="black"><text x="280" y="100" font-size="24">MyTalents answer sheet</text>
<text x="280" y="145" font-size="16">Exam: ${escape(exam.id)} / Student: ${escape(identity.studentId)}</text>
<text x="280" y="175" font-size="16">Attempt: ${escape(identity.attemptId)} / Page ${pageNumber} of ${pageCount(exam)}</text>
<text x="280" y="210" font-size="14">Keep the whole page visible, upright and flat.</text>
${boxes.map(box => `<text x="80" y="${box.y - 15}" font-size="18">Question ${escape(box.questionId)}</text><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="black" stroke-width="2"/>`).join('\n')}</g></svg>`;
    pages.push({ pageNumber, width: WIDTH, height: HEIGHT, mimeType: 'image/svg+xml', svg, regions: boxes });
  }
  return { templateVersion: 'answer-sheet-1', ...identity, examRevision: exam.revision, pages };
}
export async function cropAnswers(encoded: string, exam: Exam, identity: Identity, pageNumber: number) {
  requireCondition(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0, 'INVALID_IMAGE', 'Provide plain base64 PNG or JPEG bytes');
  const bytes = Buffer.from(encoded, 'base64');
  requireCondition(bytes.length <= 6_000_000, 'IMAGE_TOO_LARGE', 'Page must be at most 6 MB', 413);
  let pixels: Buffer;
  let width: number;
  let height: number;
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
    requireCondition(['png', 'jpeg'].includes(metadata.format ?? ''), 'INVALID_IMAGE', 'Only PNG and JPEG scans are supported');
    const image = await sharp(bytes, { limitInputPixels: 20_000_000 }).rotate().resize({ width: 1600, withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    pixels = image.data; width = image.info.width; height = image.info.height;
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error;
    requireCondition(false, 'INVALID_IMAGE', 'Image could not be decoded');
  }
  requireCondition(width! >= 700 && Math.abs(width! / height! - WIDTH / HEIGHT) < 0.02, 'PAGE_ALIGNMENT_REQUIRED', 'Use an upright, full-page scan of the generated answer sheet');
  const decoded = jsQR(new Uint8ClampedArray(pixels!), width!, height!);
  requireCondition(decoded, 'QR_NOT_FOUND', 'No readable answer-sheet QR code was found');
  let identityFromQr: unknown;
  try { identityFromQr = JSON.parse(decoded.data); } catch { requireCondition(false, 'QR_MISMATCH', 'Unrecognized answer-sheet QR code'); }
  requireCondition(stable(identityFromQr) === stable(qrPayload(exam, identity, pageNumber)), 'QR_MISMATCH', 'QR does not match this student, exam revision, attempt and page');
  const { topLeftCorner: tl, topRightCorner: tr, bottomLeftCorner: bl, bottomRightCorner: br } = decoded.location;
  const cx = (tl.x + tr.x + bl.x + br.x) / 4 / width!;
  const cy = (tl.y + tr.y + bl.y + br.y) / 4 / height!;
  requireCondition(Math.abs(cx - 150 / WIDTH) < 0.015 && Math.abs(cy - 150 / HEIGHT) < 0.015 &&
    Math.abs(tl.y - tr.y) / height! < 0.008 && Math.abs(tl.x - bl.x) / width! < 0.008 &&
    Math.abs((tr.x - tl.x) / width! - 0.166) < 0.02,
  'PAGE_ALIGNMENT_REQUIRED', 'Page is cropped, skewed or misaligned; rescan it flat and complete');
  const crops = [];
  for (const region of regions(exam, pageNumber)) {
    const crop = await sharp(pixels!, { raw: { width: width!, height: height!, channels: 4 } }).extract({
      left: Math.round((region.x + 3) * width! / WIDTH), top: Math.round((region.y + 3) * height! / HEIGHT),
      width: Math.floor((region.width - 6) * width! / WIDTH), height: Math.floor((region.height - 6) * height! / HEIGHT),
    }).png().toBuffer();
    crops.push({ questionId: region.questionId, imageBase64: crop.toString('base64'), mimeType: 'image/png' as const });
  }
  return crops;
}
