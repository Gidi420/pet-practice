// tests.js — answer-file import/validation, PDF matching, and the question pool.

import * as db from './db.js';
import { isPassageTopic } from './config.js';

export const EXPECTED_SECTION_IDS = ['verbal-1', 'verbal-2', 'quant-1', 'quant-2'];

const SEASONS = {
  winter: ['winter', 'חורף'],
  spring: ['spring', 'אביב'],
  summer: ['summer', 'קיץ'],
  autumn: ['autumn', 'fall', 'סתיו'],
};

// Parse a testId like "nite-2025-winter-he" -> { year, season }.
export function parseTestId(testId) {
  const m = /(\d{4}).*?(winter|spring|summer|autumn)/i.exec(testId)
    || /(winter|spring|summer|autumn).*?(\d{4})/i.exec(testId);
  if (!m) return { year: null, season: null };
  const year = /\d{4}/.exec(testId)?.[0] || null;
  const season = (m[1] && /[a-z]/i.test(m[1]) ? m[1] : m[2]).toLowerCase();
  return { year: year ? Number(year) : null, season };
}

// Derive a { season, year } key from any filename (or sourcePdf string).
export function seasonYearFromName(name) {
  const lower = String(name).toLowerCase();
  const yearM = /(20\d{2}|19\d{2})/.exec(lower);
  const year = yearM ? Number(yearM[1]) : null;
  let season = null;
  for (const [canon, words] of Object.entries(SEASONS)) {
    if (words.some((w) => lower.includes(w))) { season = canon; break; }
  }
  return { season, year };
}

function keyOf(season, year) {
  return season && year ? `${season}-${year}` : null;
}

// ---- validation ------------------------------------------------------------

export function validateAnswerSheet(sheet) {
  const errors = [];
  if (!sheet || typeof sheet !== 'object') return { ok: false, errors: ['קובץ לא תקין'] };
  if (sheet.type !== 'answer-sheet') errors.push('type אינו "answer-sheet"');
  if (!sheet.id) errors.push('חסר id');
  const sections = Array.isArray(sheet.sections) ? sheet.sections : [];
  if (sections.length !== 4) errors.push(`מצופים 4 פרקים, נמצאו ${sections.length}`);

  sections.forEach((sec) => {
    const tag = sec?.id || '?';
    const qc = sec?.questionCount;
    if (!Array.isArray(sec?.answers) || sec.answers.length !== qc) {
      errors.push(`פרק ${tag}: answers.length ≠ questionCount`);
    } else if (!sec.answers.every((a) => Number.isInteger(a) && a >= 1 && a <= 4)) {
      errors.push(`פרק ${tag}: תשובות חייבות להיות 1–4`);
    }
    if (!Array.isArray(sec?.questionPages) || sec.questionPages.length !== qc) {
      errors.push(`פרק ${tag}: questionPages.length ≠ questionCount`);
    }
    // topics must cover every question 1..qc
    if (Array.isArray(sec?.topics) && qc) {
      const covered = new Array(qc + 1).fill(false);
      for (const tp of sec.topics) {
        for (let i = tp.from; i <= tp.to; i++) if (i >= 1 && i <= qc) covered[i] = true;
      }
      const uncovered = [];
      for (let i = 1; i <= qc; i++) if (!covered[i]) uncovered.push(i);
      if (uncovered.length) errors.push(`פרק ${tag}: נושאים אינם מכסים שאלות ${uncovered.join(',')}`);
    } else {
      errors.push(`פרק ${tag}: חסרים נושאים`);
    }
  });

  if (!sheet.scoring || !sheet.scoring.rawToScaled) errors.push('חסרה טבלת ניקוד');
  return { ok: errors.length === 0, errors };
}

// ---- import answer files ---------------------------------------------------

export async function importAnswerFiles(fileList) {
  const result = { imported: [], rejected: [] };
  for (const file of fileList) {
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      const v = validateAnswerSheet(obj);
      if (!v.ok) { result.rejected.push({ name: file.name, errors: v.errors }); continue; }
      await db.putAnswerSheet(obj);
      result.imported.push({ id: obj.id, title: obj.title });
    } catch (e) {
      result.rejected.push({ name: file.name, errors: [String(e.message || e)] });
    }
  }
  return result;
}

// ---- PDF matching ----------------------------------------------------------

// Try to match a PDF (by filename + page count) to one of the answer sheets.
// Returns { testId, confident, pageMismatch, candidates } .
export function matchPdf(fileName, pageCount, answerSheets) {
  const fileKeyParts = seasonYearFromName(fileName);
  const fileKey = keyOf(fileKeyParts.season, fileKeyParts.year);

  const withKeys = answerSheets.map((s) => {
    const fromSrc = seasonYearFromName(s.sourcePdf || '');
    const fromId = parseTestId(s.id);
    const season = fromSrc.season || fromId.season;
    const year = fromSrc.year || fromId.year;
    return { sheet: s, key: keyOf(season, year), pageCount: s.pdfPageCount };
  });

  let candidates = [];
  if (fileKey) candidates = withKeys.filter((w) => w.key === fileKey);

  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      testId: c.sheet.id,
      confident: true,
      pageMismatch: c.pageCount != null && pageCount != null && c.pageCount !== pageCount,
      candidates: withKeys.map((w) => w.sheet),
    };
  }

  // Fall back to unique page-count match.
  if (pageCount != null) {
    const byPages = withKeys.filter((w) => w.pageCount === pageCount);
    if (byPages.length === 1) {
      return { testId: byPages[0].sheet.id, confident: false, pageMismatch: false, candidates: withKeys.map((w) => w.sheet) };
    }
  }

  return { testId: null, confident: false, pageMismatch: false, candidates: answerSheets };
}

// Store a PDF against a known testId. `arrayBuffer` is the raw bytes.
export async function storePdf(testId, fileName, arrayBuffer, pageCount) {
  await db.putPdf({ testId, name: fileName, bytes: arrayBuffer, pageCount });
}

// ---- test status / list ----------------------------------------------------

export async function listTests() {
  const [sheets, pdfMeta] = await Promise.all([db.getAllAnswerSheets(), db.getAllPdfMeta()]);
  const pdfByTest = new Map(pdfMeta.map((p) => [p.testId, p]));
  const rows = sheets.map((s) => {
    const pdf = pdfByTest.get(s.id);
    const { year, season } = parseTestId(s.id);
    return {
      id: s.id, title: s.title, year, season,
      hasAnswers: true, hasPdf: !!pdf, pdfName: pdf?.name, pdfSize: pdf?.size || 0,
      pageCount: s.pdfPageCount,
      ready: !!pdf,
      sectionIds: (s.sections || []).map((x) => x.id),
    };
  });
  // PDFs with no answer sheet (orphans)
  for (const p of pdfMeta) {
    if (!sheets.some((s) => s.id === p.testId)) {
      rows.push({ id: p.testId, title: p.name, hasAnswers: false, hasPdf: true, pdfName: p.name, pdfSize: p.size, ready: false });
    }
  }
  rows.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  return rows;
}

export async function deleteTest(testId) {
  await Promise.all([db.deleteAnswerSheet(testId), db.deletePdf(testId)]);
}

export async function getReadyTests() {
  const rows = await listTests();
  const ready = rows.filter((r) => r.ready);
  const sheets = await db.getAllAnswerSheets();
  const byId = new Map(sheets.map((s) => [s.id, s]));
  return ready.map((r) => byId.get(r.id)).filter(Boolean);
}

// ---- question pool ---------------------------------------------------------

// Expand one answer sheet into question descriptors.
export function questionsForSheet(sheet) {
  const out = [];
  const { year, season } = parseTestId(sheet.id);
  for (const sec of sheet.sections || []) {
    const topicBlocks = sec.topics || [];
    for (let i = 0; i < sec.questionCount; i++) {
      const n = i + 1;
      const block = topicBlocks.find((tp) => n >= tp.from && n <= tp.to);
      const topic = block ? block.topic : 'unknown';
      out.push({
        questionId: `${sheet.id}/${sec.id}/${n}`,
        testId: sheet.id,
        sectionId: sec.id,
        domain: sec.domain,
        topic,
        n,
        questionCount: sec.questionCount,
        page: sec.questionPages[i],
        pdfFirst: sec.pdfPages?.first,
        pdfLast: sec.pdfPages?.last,
        topicFrom: block?.from ?? n,
        topicTo: block?.to ?? n,
        passageStartPage: block ? sec.questionPages[block.from - 1] : sec.questionPages[i],
        isPassage: isPassageTopic(topic),
        answer: sec.answers[i],
        year, season,
      });
    }
  }
  return out;
}

// Build the full pool from all ready tests, applying filters.
// filters: { domain, topic, year } — any may be null/'all'.
export async function buildPool(filters = {}) {
  const sheets = await getReadyTests();
  let pool = sheets.flatMap(questionsForSheet);
  if (filters.domain && filters.domain !== 'all') pool = pool.filter((q) => q.domain === filters.domain);
  if (filters.topic && filters.topic !== 'all') pool = pool.filter((q) => q.topic === filters.topic);
  if (filters.year && filters.year !== 'all') pool = pool.filter((q) => String(q.year) === String(filters.year));
  return pool;
}

// Distinct topics / years currently available (for filter chips).
export async function availableFacets() {
  const sheets = await getReadyTests();
  const pool = sheets.flatMap(questionsForSheet);
  const topics = [...new Set(pool.map((q) => q.topic))];
  const years = [...new Set(pool.map((q) => q.year).filter(Boolean))].sort((a, b) => b - a);
  return { topics, years, count: pool.length };
}
