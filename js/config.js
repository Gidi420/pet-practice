// config.js — static configuration: topic labels, domains, default timings,
// exam date, i18n strings. No side effects beyond reading localStorage.

export const APP_VERSION = '1.0.3';

export const DOMAINS = ['verbal', 'quant'];

// 20 tests * (23+23+20+20) = 1720 questions total.
export const TOTAL_QUESTIONS = 1720;

// Known topic codes -> Hebrew / English labels.
// Answer files may also carry free-form Hebrew topic strings (e.g. "קטע א"),
// which are shown verbatim (see topicLabel()).
export const TOPIC_LABELS = {
  analogies: { he: 'אנלוגיות', en: 'Analogies' },
  logic:     { he: 'הבנה והסקה', en: 'Logic & inference' },
  reading:   { he: 'הבנת הנקרא', en: 'Reading comprehension' },
  graphs:    { he: 'הסקה מתרשים', en: 'Graph inference' },
  problems:  { he: 'שאלות ובעיות', en: 'Problems' },
};

export const DOMAIN_LABELS = {
  verbal: { he: 'מילולי', en: 'Verbal' },
  quant:  { he: 'כמותי', en: 'Quantitative' },
};

// Topics that open on a passage/chart page before the question page.
export function isPassageTopic(topic) {
  if (!topic) return false;
  return topic === 'reading' || topic === 'graphs' || topic.startsWith('קטע');
}

export function topicLabel(topic, lang = getLang()) {
  if (!topic) return '';
  const known = TOPIC_LABELS[topic];
  if (known) return known[lang] || known.he;
  return topic; // free-form Hebrew label, show as-is
}

export function domainLabel(domain, lang = getLang()) {
  const d = DOMAIN_LABELS[domain];
  return d ? (d[lang] || d.he) : domain;
}

// ---- Settings (localStorage) -----------------------------------------------

const LS_KEY = 'pet.settings.v1';

const DEFAULT_SETTINGS = {
  lang: 'he',                 // 'he' | 'en'
  theme: 'auto',              // 'auto' | 'light' | 'dark'
  invertPdfInDark: false,     // invert rendered PDF page in dark mode
  examDate: '2026-12-01',     // ISO date of the exam
  timePerVerbal: 52,          // seconds, timed-question mode
  timePerQuant: 60,           // seconds, timed-question mode
  weakTopicWeighting: true,   // smart randomisation toward weak topics
};

let _settings = null;

export function getSettings() {
  if (_settings) return _settings;
  try {
    const raw = localStorage.getItem(LS_KEY);
    _settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    _settings = { ...DEFAULT_SETTINGS };
  }
  return _settings;
}

export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  _settings = s;
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
  document.dispatchEvent(new CustomEvent('settings-changed', { detail: s }));
  return s;
}

export function getLang() { return getSettings().lang; }

// ---- i18n ------------------------------------------------------------------

const STRINGS = {
  // tabs
  'tab.practice': { he: 'תרגול', en: 'Practice' },
  'tab.timed':    { he: 'מתוזמן', en: 'Timed' },
  'tab.sim':      { he: 'סימולציה', en: 'Simulation' },
  'tab.stats':    { he: 'סטטיסטיקה', en: 'Stats' },
  'tab.settings': { he: 'הגדרות', en: 'Settings' },

  // generic
  'app.name':   { he: 'תרגול פסיכומטרי', en: 'PET Practice' },
  'common.cancel': { he: 'ביטול', en: 'Cancel' },
  'common.save':   { he: 'שמירה', en: 'Save' },
  'common.delete': { he: 'מחיקה', en: 'Delete' },
  'common.close':  { he: 'סגירה', en: 'Close' },
  'common.next':   { he: 'הבא', en: 'Next' },
  'common.back':   { he: 'חזרה', en: 'Back' },
  'common.done':   { he: 'סיום', en: 'Done' },
  'common.all':    { he: 'הכל', en: 'All' },
  'common.yes':    { he: 'כן', en: 'Yes' },
  'common.no':     { he: 'לא', en: 'No' },
  'common.seconds':{ he: 'שנ׳', en: 's' },

  // onboarding / empty
  'onboard.title': { he: 'ברוכים הבאים לתרגול הפסיכומטרי', en: 'Welcome to PET Practice' },
  'onboard.body':  { he: 'ייבאו את קובצי התשובות ואת קובצי ה־PDF של מת״ל כדי להתחיל.',
                     en: 'Import your answer files and NITE PDFs to start.' },
  'onboard.note':  { he: 'שימו לב: אפליקציה שהותקנה למסך הבית שומרת נתונים בנפרד מ־Safari, לכן יש לבצע את הייבוא מתוך האפליקציה המותקנת.',
                     en: 'Note: a home-screen app has its own storage, separate from Safari, so import the files from inside the installed app.' },
  'onboard.cta':   { he: 'מעבר לייבוא', en: 'Go to import' },

  // practice / question view
  'q.question':  { he: 'שאלה', en: 'Question' },
  'q.page':      { he: 'עמוד', en: 'Page' },
  'q.chapter':   { he: 'פרק', en: 'Chapter' },
  'q.flag':      { he: 'סימון', en: 'Flag' },
  'q.flagged':   { he: 'מסומן', en: 'Flagged' },
  'q.backToQuestion': { he: 'חזרה לעמוד השאלה', en: 'Back to question page' },
  'q.goToQuestion':   { he: 'מעבר לשאלה', en: 'Go to question' },
  'q.showPassage':    { he: 'הצגת הקטע', en: 'Show passage' },
  'q.correct':   { he: 'נכון', en: 'Correct' },
  'q.wrong':     { he: 'שגוי', en: 'Wrong' },
  'q.correctIs': { he: 'התשובה הנכונה', en: 'Correct answer' },
  'q.timedOut':  { he: 'הזמן נגמר', en: 'Timed out' },
  'q.noQuestions': { he: 'אין שאלות זמינות. ייבאו מבחן מוכן תחילה.', en: 'No questions available. Import a ready test first.' },

  // session counter
  'sess.answered': { he: 'נענו', en: 'Answered' },
  'sess.correct':  { he: 'נכונות', en: 'Correct' },
  'sess.streak':   { he: 'רצף', en: 'Streak' },

  // filters
  'filter.domain': { he: 'תחום', en: 'Domain' },
  'filter.topic':  { he: 'נושא', en: 'Topic' },
  'filter.year':   { he: 'שנה', en: 'Year' },

  // timed
  'timed.title': { he: 'תרגול מתוזמן', en: 'Timed practice' },

  // simulation
  'sim.title':      { he: 'סימולציה', en: 'Simulation' },
  'sim.pickTest':   { he: 'בחרו מבחן', en: 'Pick a test' },
  'sim.pickSection':{ he: 'בחרו פרק', en: 'Pick a section' },
  'sim.fullTest':   { he: 'מבחן מלא', en: 'Full test' },
  'sim.resume':     { he: 'המשך סימולציה', en: 'Resume simulation' },
  'sim.resumeBody': { he: 'יש סימולציה פעילה שלא הושלמה.', en: 'There is an unfinished simulation.' },
  'sim.discard':    { he: 'התחלה מחדש', en: 'Start over' },
  'sim.submit':     { he: 'הגשה', en: 'Submit' },
  'sim.submitConfirm': { he: 'להגיש את הפרק? לא ניתן לשנות לאחר ההגשה.', en: 'Submit this section? You cannot change answers after submitting.' },
  'sim.break':      { he: 'הפסקה קצרה', en: 'Short break' },
  'sim.breakBody':  { he: 'הפרק הבא יתחיל כשתהיו מוכנים.', en: 'The next section starts when you are ready.' },
  'sim.startNext':  { he: 'התחלת הפרק הבא', en: 'Start next section' },
  'sim.grid':       { he: 'מפת שאלות', en: 'Question map' },
  'sim.answered':   { he: 'נענו', en: 'Answered' },
  'sim.unanswered': { he: 'ללא מענה', en: 'Unanswered' },
  'sim.timeUp':     { he: 'הזמן נגמר — הפרק הוגש אוטומטית', en: 'Time is up — section auto-submitted' },

  // results
  'res.title':      { he: 'תוצאות', en: 'Results' },
  'res.raw':        { he: 'ציון גולמי', en: 'Raw score' },
  'res.percent':    { he: 'אחוז נכונות', en: '% correct' },
  'res.timeUsed':   { he: 'זמן שנוצל', en: 'Time used' },
  'res.avgTime':    { he: 'זמן ממוצע לשאלה', en: 'Avg time / question' },
  'res.byTopic':    { he: 'פילוח לפי נושא', en: 'By topic' },
  'res.review':     { he: 'סקירת שאלות', en: 'Review' },
  'res.yourAnswer': { he: 'תשובתך', en: 'Your answer' },
  'res.practiceWrong': { he: 'תרגול השגויות', en: 'Practise the wrong ones' },
  'res.scaledV':    { he: 'ציון מילולי מוערך', en: 'Est. verbal score' },
  'res.scaledQ':    { he: 'ציון כמותי מוערך', en: 'Est. quant score' },
  'res.general':    { he: 'ציון כללי מוערך', en: 'Est. general score' },
  'res.genTwoDomain': { he: 'רב־תחומי', en: 'Multi-domain' },
  'res.genVerbal':  { he: 'הדגשה מילולית', en: 'Verbal emphasis' },
  'res.genQuant':   { he: 'הדגשה כמותית', en: 'Quant emphasis' },
  'res.estimate':   { he: 'הערכה', en: 'estimate' },
  'res.writingNote':{ he: 'ההערכה אינה כוללת את מטלת הכתיבה.', en: 'Estimate excludes the writing task.' },

  // review mistakes
  'review.title':  { he: 'חזרה על טעויות', en: 'Review mistakes' },
  'review.empty':  { he: 'אין טעויות לחזרה. כל הכבוד!', en: 'No mistakes to review. Nice work!' },
  'review.remaining': { he: 'נותרו', en: 'Remaining' },

  // stats
  'stats.title':    { he: 'סטטיסטיקה', en: 'Stats' },
  'stats.overall':  { he: 'כללי', en: 'Overall' },
  'stats.totalAnswered': { he: 'סה״כ נענו', en: 'Total answered' },
  'stats.accuracy': { he: 'דיוק', en: 'Accuracy' },
  'stats.avgTime':  { he: 'זמן ממוצע', en: 'Avg time' },
  'stats.streakDays': { he: 'רצף ימים', en: 'Day streak' },
  'stats.studyTime':{ he: 'זמן לימוד', en: 'Study time' },
  'stats.byDomain': { he: 'לפי תחום', en: 'By domain' },
  'stats.byTopic':  { he: 'לפי נושא', en: 'By topic' },
  'stats.trend':    { he: 'מגמה', en: 'Trend' },
  'stats.trend14':  { he: '14 יום', en: '14 days' },
  'stats.trend30':  { he: '30 יום', en: '30 days' },
  'stats.simHistory': { he: 'היסטוריית סימולציות', en: 'Simulation history' },
  'stats.slowest':  { he: 'נושאים איטיים', en: 'Slowest topics' },
  'stats.coverage': { he: 'כיסוי שאלות', en: 'Question coverage' },
  'stats.examCountdown': { he: 'ספירה לאחור למבחן', en: 'Exam countdown' },
  'stats.daysLeft': { he: 'ימים', en: 'days' },
  'stats.resetStats': { he: 'איפוס סטטיסטיקה', en: 'Reset stats' },
  'stats.resetConfirm': { he: 'לאפס את כל ההיסטוריה והסטטיסטיקה? פעולה זו אינה הפיכה. המבחנים שיובאו יישמרו.', en: 'Reset all history and stats? This cannot be undone. Imported tests are kept.' },
  'stats.noData':   { he: 'עדיין אין נתונים. התחילו לתרגל!', en: 'No data yet. Start practising!' },
  'stats.weakestFirst': { he: 'מהחלש לחזק', en: 'Weakest first' },

  // settings
  'set.title':      { he: 'הגדרות', en: 'Settings' },
  'set.tests':      { he: 'מבחנים', en: 'Tests' },
  'set.testsDesc':  { he: 'ייבוא קובצי תשובות ו־PDF', en: 'Import answer files and PDFs' },
  'set.appearance': { he: 'מראה', en: 'Appearance' },
  'set.language':   { he: 'שפה', en: 'Language' },
  'set.theme':      { he: 'ערכת נושא', en: 'Theme' },
  'set.theme.auto': { he: 'אוטומטי', en: 'Auto' },
  'set.theme.light':{ he: 'בהיר', en: 'Light' },
  'set.theme.dark': { he: 'כהה', en: 'Dark' },
  'set.invertPdf':  { he: 'היפוך צבעי PDF במצב כהה', en: 'Invert PDF in dark mode' },
  'set.timings':    { he: 'זמנים', en: 'Timing' },
  'set.timeVerbal': { he: 'שניות לשאלה מילולית', en: 'Seconds / verbal question' },
  'set.timeQuant':  { he: 'שניות לשאלה כמותית', en: 'Seconds / quant question' },
  'set.weakWeight': { he: 'שקלול נושאים חלשים', en: 'Weight toward weak topics' },
  'set.examDate':   { he: 'תאריך המבחן', en: 'Exam date' },
  'set.data':       { he: 'נתונים', en: 'Data' },
  'set.export':     { he: 'ייצוא גיבוי', en: 'Export backup' },
  'set.import':     { he: 'ייבוא גיבוי', en: 'Import backup' },
  'set.exportDesc': { he: 'קובץ JSON עם הגדרות, היסטוריה וקובצי התשובות (ללא ה־PDF).', en: 'A JSON file with settings, history and answer files (without the PDFs).' },
  'set.storage':    { he: 'אחסון', en: 'Storage' },
  'set.about':      { he: 'אודות', en: 'About' },
  'set.version':    { he: 'גרסה', en: 'Version' },

  // tests management
  'tests.title':    { he: 'ניהול מבחנים', en: 'Tests' },
  'tests.importAnswers': { he: 'ייבוא קובצי תשובות (JSON)', en: 'Import answer files (JSON)' },
  'tests.importPdfs':    { he: 'ייבוא קובצי PDF', en: 'Import PDFs' },
  'tests.ready':    { he: 'מוכן', en: 'Ready' },
  'tests.pdfMissing': { he: 'חסר PDF', en: 'PDF missing' },
  'tests.answersMissing': { he: 'חסר קובץ תשובות', en: 'Answer file missing' },
  'tests.empty':    { he: 'עדיין לא יובאו מבחנים.', en: 'No tests imported yet.' },
  'tests.deleteConfirm': { he: 'למחוק את המבחן הזה (קובץ התשובות וה־PDF)?', en: 'Delete this test (answer file and PDF)?' },
  'tests.matchPrompt': { he: 'לא ניתן להתאים את הקובץ אוטומטית. לאיזה מבחן הוא שייך?', en: 'Could not auto-match this file. Which test is it?' },
  'tests.bestScore': { he: 'תוצאה מיטבית', en: 'Best score' },
  'tests.importedN': { he: 'יובאו', en: 'Imported' },
  'tests.rejected':  { he: 'נדחו', en: 'Rejected' },
  'tests.pageCountWarn': { he: 'אזהרה: מספר העמודים אינו תואם לקובץ התשובות.', en: 'Warning: page count does not match the answer file.' },
};

export function t(key, lang = getLang()) {
  const s = STRINGS[key];
  if (!s) return key;
  return s[lang] || s.he || key;
}
