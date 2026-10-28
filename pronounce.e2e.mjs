// End-to-end test for pronunciation practice, driving the real extension page
// in a real Chrome. Run: node pronounce.e2e.mjs
//
// Two things are stubbed, and only two:
//
// 1. The microphone, with a real MediaStream fed by an oscillator. It is a
//    genuine audio stream, so the real voice-activity detector, the real
//    MediaRecorder and the real wav encoder all run - the test only controls
//    when sound starts and stops.
// 2. Azure's HTTP reply, with responses captured from the live service. The
//    scoring itself is not simulated; the real parser and the real UI run on
//    the real response shape, without spending an API call per run.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT_DIR = dirname(fileURLToPath(import.meta.url));

// Chrome for Testing, not installed Chrome: released Chrome ignores
// --load-extension, so the extension would never load.
function findChrome() {
  if (process.env.CHROME_FOR_TESTING) return process.env.CHROME_FOR_TESTING;
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root).sort().reverse()) {
    for (const name of ['Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome', 'chrome-linux64/chrome']) {
      for (const mid of ['chrome-mac-arm64', 'chrome-mac-x64', 'chrome-linux64', '']) {
        const p = join(root, dir, mid, name);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

// Chrome derives an unpacked extension's id from the absolute path.
const EXT_ID = [...createHash('sha256').update(EXT_DIR).digest('hex').slice(0, 32)]
  .map((d) => String.fromCharCode(97 + parseInt(d, 16)))
  .join('');

const CHROME = findChrome();
if (!CHROME) {
  console.log('SKIP: Chrome for Testing not found. Install it with:');
  console.log('  npx -y @puppeteer/browsers install chrome@stable');
  console.log('or set CHROME_FOR_TESTING=/path/to/chrome');
  process.exit(0);
}
const PORT = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
}

// ---------- CDP ----------
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('ws failed'));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      }),
  };
}

// Responses captured from the live Azure endpoint. Trimmed to the fields the
// extension reads, with the real nesting and the real numbers.
const STUB = `
window.__azure = 'goodWord';
window.__azureStatus = 200;
window.__azureCalls = [];
(() => {
  const ph = (p, s, nb) => ({ Phoneme: p, AccuracyScore: s, NBestPhonemes: nb.map(([q, v]) => ({ Phoneme: q, Score: v })) });
  const syl = (g, s, sc) => ({ Grapheme: g, Syllable: s, AccuracyScore: sc });
  const word = (t, sc, err, sound) => ({
    Word: t, AccuracyScore: sc, ErrorType: err,
    Syllables: sound ? [syl(t, sound, sc)] : [],
    Phonemes: sound ? [...sound].map((p) => ph(p, sc, [[p, 100]])) : [],
  });

  const REPLIES = {
    // "definition", said well. The final /n/ came out weak at 66.
    goodWord: { RecognitionStatus: 'Success', NBest: [{
      Display: 'Definition.', Confidence: 0.994, AccuracyScore: 98, FluencyScore: 100,
      ProsodyScore: 90.4, CompletenessScore: 100, PronScore: 95.8,
      Words: [{ Word: 'definition', AccuracyScore: 98, ErrorType: 'None',
        Syllables: [syl('def','d\\u025bf',100), syl('i','\\u0259',100), syl('ni','n\\u026a',100), syl('tion','\\u0283\\u0259n',93)],
        Phonemes: [
          ph('d',100,[['d',100],['t',16]]), ph('\\u025b',100,[['\\u025b',100],['d',23]]),
          ph('f',100,[['f',100],['\\u0259',3]]), ph('\\u0259',100,[['\\u0259',100],['\\u026a',1]]),
          ph('n',100,[['n',100],['\\u0259',77]]), ph('\\u026a',100,[['\\u026a',100],['\\u0283',0]]),
          ph('\\u0283',100,[['\\u0283',100],['\\u026a',47]]), ph('\\u0259',100,[['\\u0259',100],['n',16]]),
          ph('n',66,[['n',100],['\\u0259',1]]),
        ] }] }] },
    // "banana" said at a card asking for "definition".
    wrongWord: { RecognitionStatus: 'Success', NBest: [{
      Display: 'Definition.', AccuracyScore: 20, FluencyScore: 0, ProsodyScore: 56.8,
      CompletenessScore: 0, PronScore: 15.4,
      Words: [{ Word: 'definition', AccuracyScore: 20, ErrorType: 'Mispronunciation',
        Syllables: [syl('def','d\\u025bf',0), syl('i','\\u0259',72), syl('ni','n\\u026a',26), syl('tion','\\u0283\\u0259n',0)],
        Phonemes: [
          ph('d',0,[['b',100],['s',90]]), ph('\\u025b',0,[['b',100],['p',44]]),
          ph('f',0,[['\\u0259',100],['b',100]]), ph('\\u0259',72,[['\\u0259',100],['b',15]]),
          ph('n',35,[['n',100],['\\u00e6',100]]), ph('\\u026a',0,[['\\u00e6',100],['n',1]]),
          ph('\\u0283',0,[['\\u00e6',100],['n',99]]), ph('\\u0259',0,[['n',100],['\\u00e6',15]]),
          ph('n',0,[['n',100],['\\u0259',0]]),
        ] }] }] },
    // "the cat sat on the mat" read against "the cat sat down on the warm mat".
    sentence: { RecognitionStatus: 'Success', NBest: [{
      Display: 'The cat sat on the mat.', AccuracyScore: 71, FluencyScore: 100,
      ProsodyScore: 90.9, CompletenessScore: 75, PronScore: 81.6,
      Words: [
        word('the',80,'None','\\u00f0\\u0259'), word('cat',100,'None','k\\u00e6t'),
        word('sat',100,'None','s\\u00e6t'), word('down',0,'Omission'),
        word('on',97,'None','\\u0251n'), word('the',91,'None','\\u00f0\\u028c'),
        word('warm',0,'Omission'), word('mat',100,'None','m\\u00e6t'),
      ] }] },
    silence: { RecognitionStatus: 'InitialSilenceTimeout' },
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const href = typeof url === 'string' ? url : url.url;
    if (href.includes('stt.speech.microsoft.com')) {
      // Prove the request really carries the assessment config we think it does.
      const header = (opts.headers || {})['Pronunciation-Assessment'];
      window.__azureCalls.push(header ? JSON.parse(atob(header)) : null);
      if (window.__azureStatus !== 200) {
        return new Response('bad key', { status: window.__azureStatus });
      }
      return new Response(JSON.stringify(REPLIES[window.__azure]), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (href.includes('api.dictionaryapi.dev')) {
      return new Response(JSON.stringify([{
        word: 'revamp',
        phonetic: '/\u0279i\u02d0\u02c8vamp/',
        phonetics: [
          { text: '/\u0279i\u02d0\u02c8vamp/', audio: '' },
          { text: '/\u0279i\u02c8v\u00e6mp/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/revamp-us.mp3' },
        ],
        meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To revise something.', example: 'They revamped the site.' }] }],
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (href.includes('api.openai.com')) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"feedback":"Nice work. Round your lips a little more on the last sound."}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, opts);
  };

  // A real audio stream, so the real voice-activity detector runs. It starts
  // silent - the detector learns the room's noise floor from the first frames,
  // and would read an immediately loud stream as the floor itself.
  window.__speak = null;
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__denyMic) { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; }
    const ctx = new AudioContext();
    // A context can start suspended, and a suspended one emits pure silence -
    // the detector then correctly reports "I did not hear anything" and the
    // whole suite fails for a reason that has nothing to do with the code.
    if (ctx.state === 'suspended') await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const dest = ctx.createMediaStreamDestination();
    osc.frequency.value = 180;
    osc.connect(gain).connect(dest);
    osc.start();
    window.__speak = (on) => { gain.gain.value = on ? 0.4 : 0; };
    // The tone must not start until the detector has finished learning the
    // room's noise floor from its first frames. 700ms looked like enough and
    // was not: opening the context sometimes takes longer than that, the floor
    // is then measured on the tone itself, the threshold rises above it, and
    // the attempt fails with "I did not hear anything" perhaps one run in
    // three. The wait before the first word is 10s, so this is cheap insurance.
    const SPEAK_AT = 1500;
    if (window.__gap) {
      // Speak, pause for two seconds the way a learner breathes between
      // phrases, then speak again.
      setTimeout(() => window.__speak && window.__speak(true), SPEAK_AT);
      setTimeout(() => window.__speak && window.__speak(false), SPEAK_AT + 1000);
      setTimeout(() => window.__speak && window.__speak(true), SPEAK_AT + 3000);
      setTimeout(() => window.__speak && window.__speak(false), SPEAK_AT + 4300);
    } else if (!window.__staySilent) {
      setTimeout(() => window.__speak && window.__speak(true), SPEAK_AT);
      setTimeout(() => window.__speak && window.__speak(false), SPEAK_AT + 1700);
    }
    return dest.stream;
  };
})();
`;

const SEED = `(async () => {
  await chrome.storage.local.set({
    settings: { dailyGoal: 5, apiKey: 'test-openai-key', azureKey: 'test-azure-key', azureRegion: 'eastus' },
    items: [
      { id:'w1', type:'word', text:'definition', meaning:'(noun) what a word means',
        phonetic:'/\\u02ccd\\u025bf\\u026a\\u02c8n\\u026a\\u0283\\u0259n/', audio:'', example:'Read the definition.',
        examples:['Read the definition.'], chat:[], note:'', date:new Date().toISOString().slice(0,10), createdAt:Date.now() },
      { id:'w2', type:'word', text:'posterity', meaning:'(noun) future generations', phonetic:'', audio:'',
        example:'', examples:[], chat:[], note:'', date:new Date().toISOString().slice(0,10), createdAt:Date.now()-1000 },
      { id:'s1', type:'sentence', text:'the cat sat down on the warm mat', meaning:'A cat sat.', phonetic:'', audio:'',
        example:'', examples:[], chat:[], note:'', date:new Date().toISOString().slice(0,10), createdAt:Date.now()-2000 }
    ]
  });
  return 'seeded';
})()`;

const PANEL = (term) => `(() => {
  const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('.term')?.textContent === ${JSON.stringify(term)});
  if (!card) return { missing: true, terms: [...document.querySelectorAll('.card .term')].map(t=>t.textContent) };
  const p = card.querySelector('.practice');
  if (!p) return { noPanel: true };
  const units = (sel) => [...p.querySelectorAll(sel + ' span')].filter(s => !s.classList.contains('sep') && !s.classList.contains('slash'))
    .map(s => ({ text: s.textContent, ok: s.classList.contains('ok'), title: s.title }));
  const ipaRows = {};
  for (const r of p.querySelectorAll('.result > .ipa-row')) {
    ipaRows[r.querySelector('.ipa-label').textContent] = r.querySelector('.ipa').textContent;
  }
  return {
    panelEchoesWord: !!p.querySelector('.pron-target'),
    cardIpa: card.querySelector('.phonetic')?.textContent ?? null,
    ipaRows,
    spokenUnits: units('.result > .ipa-row .ipa.pron-line'),
    syllables: units('.result > .pron-line.syllables'),
    words: units('.pron-line.words'),
    buttons: [...p.querySelectorAll('button')].map(b => b.textContent.trim()),
    status: p.querySelector('.pron-status')?.textContent ?? null,
    countdown: p.querySelector('.pron-countdown')?.textContent ?? null,
    bars: p.querySelectorAll('.meter .bar').length,
    score: p.querySelector('.pron-score')?.textContent ?? null,
    scoreClass: p.querySelector('.pron-score')?.className ?? null,
    label: p.querySelector('.pron-label')?.textContent ?? null,
    pte: [...p.querySelectorAll('.pte-row')].map(r => ({
      label: r.querySelector('.pte-label').textContent,
      num: r.querySelector('.pte-num').textContent,
      note: r.querySelector('.pte-note').textContent,
      width: r.querySelector('.pte-fill').style.width,
    })),
    detail: p.querySelector('.word-detail')?.textContent ?? '',
    detailIpa: [...(p.querySelectorAll('.word-detail .ipa-row') || [])].map(r =>
      [r.querySelector('.ipa-label').textContent, r.querySelector('.ipa').textContent]),
    heard: p.querySelector('.pron-heard')?.textContent ?? null,
    error: p.querySelector('.pron-error')?.textContent ?? null,
    feedback: p.querySelector('.tutor-feedback')?.textContent ?? null,
  };
})()`;

const CLICK = (term, text) => `(() => {
  const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('.term')?.textContent === ${JSON.stringify(term)});
  const btn = [...card.querySelectorAll('button')].find(b => b.textContent.trim().includes(${JSON.stringify(text)}));
  if (!btn) return 'NO BUTTON: ' + [...card.querySelectorAll('button')].map(b=>b.textContent.trim()).join('|');
  btn.click(); return 'clicked';
})()`;

const CLICK_WORD = (term, word) => `(() => {
  const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('.term')?.textContent === ${JSON.stringify(term)});
  const span = [...card.querySelectorAll('.pron-line.words span')].find(s => s.textContent === ${JSON.stringify(word)});
  if (!span) return 'NO WORD';
  span.click(); return 'clicked';
})()`;

const profile = mkdtempSync(join(tmpdir(), 'pron-ui-'));
let chrome;
let cdp;
let sid;

const ev = (expr) =>
  cdp
    .send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid)
    .then((r) => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
      return r.result.value;
    });

// Poll until the panel satisfies a predicate, so tests never race the UI.
async function until(term, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await ev(PANEL(term));
    if (predicate(last)) return last;
    await sleep(120);
  }
  const trace = await ev('JSON.stringify({ trace: window.__trace, peak: window.__peak })');  // what the session actually did
  throw new Error(`timeout waiting for ${label};\n        trace = ${trace}\n        last = ${JSON.stringify(last)}`);
}

const TRACE = `(() => {
  if (window.__traced) return 'already';
  window.__traced = true;
  window.__trace = [];
  const t0 = Date.now();
  const real = PRON.createSession;
  PRON.createSession = (target, handlers = {}) => {
    window.__trace.push([0, 'session(' + JSON.stringify(target) + ')']);
    const wrapped = {};
    for (const k of ['onState', 'onDone', 'onLevel', 'onTick']) {
      wrapped[k] = (...a) => {
        if (k === 'onLevel') window.__peak = Math.max(window.__peak || 0, a[0]);
        else window.__trace.push([Date.now() - t0, k + ' ' + JSON.stringify(a[0] && a[0].audio ? { audio: a[0].audio.size } : a[0])]);
        if (handlers[k]) return handlers[k](...a);
      };
    }
    return real(target, wrapped);
  };
  return 'traced';
})()`;

async function scenario(reply, extra = '') {
  await ev('location.reload()');
  await sleep(1400);
  await ev(TRACE);
  // After the reload: the injected stub runs on every new document and would
  // overwrite these.
  await ev(`window.__azure = ${JSON.stringify(reply)}; window.__azureStatus = 200; window.__azureCalls = []; ${extra}`);
}

// Say a word, wait for the verdict.
async function attempt(term, reply, extra) {
  await scenario(reply, extra);
  await ev(CLICK(term, 'Start speaking'));
  return until(term, (s) => s.score !== null || s.error !== null, 20000, 'a verdict');
}

try {
  chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--use-fake-device-for-media-capture',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      // Without these, Chrome throttles setInterval to once a second the
      // moment this window falls behind another, and the microphone's
      // 50ms detector loop silently becomes a 1s one. That broke the suite
      // in a different place on every run, depending on where the window
      // happened to be. Puppeteer passes all three by default; this suite
      // builds its own argument list and so has to pass them itself.
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: 'ignore' }
  );

  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
      break;
    } catch {
      await sleep(500);
    }
  }
  cdp = await connect(wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${EXT_ID}/app.html` });
  sid = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Page.bringToFront', {}, sid);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB }, sid);
  await sleep(800);

  check('extension page loads', (await ev('document.title')) === 'English Learner');
  check('storage seeds', (await ev(SEED)) === 'seeded');
  await ev('location.reload()');
  await sleep(1500);

  // ===== idle =====
  let p = await ev(PANEL('definition'));
  check('practice panel renders on a word card', !p.missing && !p.noPanel, JSON.stringify(p).slice(0, 180));
  check('dictionary IPA is shown on the card', (p.cardIpa || '').includes('ˈn'), `cardIpa=${p.cardIpa}`);
  check('idle offers Start and Hear it', p.buttons.join('|').includes('Start speaking') && p.buttons.join('|').includes('Hear it'), p.buttons.join('|'));
  check('no score before an attempt', p.score === null, `score=${p.score}`);

  // ===== a word, said well =====
  p = await attempt('definition', 'goodWord');
  check(
    'a good attempt is scored',
    p.score === '96%',
    `score=${p.score} error=${p.error}\n        trace=${await ev('JSON.stringify(window.__trace)')}`
  );
  check('score is styled for the top band', (p.scoreClass || '').includes('great'), p.scoreClass);
  check('label reads Excellent', p.label === 'Excellent', `label=${p.label}`);

  check(
    'the target IPA is the dictionary one, with its stress marks',
    p.ipaRows.Target === '/ˌdɛfɪˈnɪʃən/',
    `Target=${p.ipaRows.Target}`
  );
  check(
    'the IPA the user actually produced is shown back to them',
    p.ipaRows['You said'] === '/dɛfənɪʃən/',
    `You said=${p.ipaRows['You said']}`
  );
  check(
    'each sound is coloured on its own, not the whole line',
    p.spokenUnits.length === 9 && p.spokenUnits.filter((u) => u.ok).length === 8,
    JSON.stringify(p.spokenUnits.map((u) => [u.text, u.ok]))
  );
  check(
    'the one weak sound is the red one, and says what was expected',
    p.spokenUnits[8] && !p.spokenUnits[8].ok && /66\/100/.test(p.spokenUnits[8].title),
    JSON.stringify(p.spokenUnits[8])
  );
  check(
    'syllables are shown by their letters, and rebuild the word',
    p.syllables.map((s) => s.text).join('') === 'definition',
    JSON.stringify(p.syllables)
  );
  check(
    'the panel never echoes the word already in the card title',
    p.panelEchoesWord === false,
    'the card title sits directly above the panel'
  );
  check('Try again is offered after a result', p.buttons.some((b) => b.includes('Try again')), p.buttons.join('|'));
  check('the listening UI is gone once scored', p.bars === 0, `meter bars still on screen: ${p.bars}`);

  const sent = await ev('window.__azureCalls[0]');
  check('the request asked Azure for IPA, not its default alphabet', sent?.PhonemeAlphabet === 'IPA', JSON.stringify(sent));
  check('the request asked what was said, not just whether it was right', sent?.NBestPhonemeCount >= 1, JSON.stringify(sent));
  check('prosody was requested', sent?.EnableProsodyAssessment === true, JSON.stringify(sent));
  check('miscue is off for a single word', sent?.EnableMiscue === false, JSON.stringify(sent));
  check('the reference text is the word on the card', sent?.ReferenceText === 'definition', JSON.stringify(sent));

  p = await until('definition', (s) => s.feedback && !/Writing/.test(s.feedback), 8000, 'coach feedback');
  check('the coach turns the numbers into advice', /Round your lips/.test(p.feedback), `feedback=${p.feedback}`);

  // ===== a word, said wrong =====
  p = await attempt('definition', 'wrongWord');
  check('a wrong word scores low', p.score === '15%', `score=${p.score} error=${p.error}`);
  check('score is styled for the bottom band', (p.scoreClass || '').includes('poor'), p.scoreClass);
  check(
    'the IPA shows the sounds that really came out, not the target',
    p.ipaRows['You said'] === '/bənæn/',
    `You said=${p.ipaRows['You said']}`
  );
  check(
    'every sound of a wrong word is red',
    p.spokenUnits.length && p.spokenUnits.every((u) => !u.ok),
    JSON.stringify(p.spokenUnits.map((u) => [u.text, u.ok]))
  );
  check(
    'a red sound names the sound that belonged there',
    /expected d/.test(p.spokenUnits[0].title || ''),
    `title=${p.spokenUnits[0].title}`
  );
  check(
    'the target IPA still stands next to it for comparison',
    p.ipaRows.Target === '/ˌdɛfɪˈnɪʃən/',
    `Target=${p.ipaRows.Target}`
  );

  // ===== a word with no dictionary IPA falls back to Azure's =====
  p = await attempt('posterity', 'goodWord');
  check('a word with no dictionary IPA still gets a target', !!p.ipaRows.Target, JSON.stringify(p.ipaRows));
  check(
    "the fallback is Azure's own reference sounds, dotted by syllable",
    p.ipaRows.Target === '/dɛf.ə.nɪ.ʃən/',
    `Target=${p.ipaRows.Target}`
  );
  check('the card itself shows no IPA for that word', p.cardIpa === null, `cardIpa=${p.cardIpa}`);

  // ===== a sentence, judged like a PTE answer =====
  await scenario('sentence');
  await ev(`document.querySelector('.tabs button[data-tab="sentence"]').click()`);
  await sleep(400);
  const TERM = 'the cat sat down on the warm mat';
  let s = await ev(PANEL(TERM));
  check('sentence card has a practice panel', !s.missing && !s.noPanel, JSON.stringify(s).slice(0, 180));
  check('sentence card echoes nothing either', s.panelEchoesWord === false, 'the sentence is already the card title');

  await ev(CLICK(TERM, 'Start speaking'));
  s = await until(TERM, (x) => x.score !== null || x.error !== null, 20000, 'a sentence verdict');
  check('the sentence gets one overall score', s.score === '82%', `score=${s.score} error=${s.error}`);
  check('the overall score is labelled', /Overall/.test(s.label || ''), `label=${s.label}`);

  const byLabel = Object.fromEntries(s.pte.map((r) => [r.label, r]));
  check(
    'it is marked on the PTE dimensions',
    ['Content', 'Pronunciation', 'Fluency'].every((k) => byLabel[k]),
    JSON.stringify(s.pte.map((r) => r.label))
  );
  check('Content is the share of the sentence actually said', byLabel.Content?.num === '75', JSON.stringify(byLabel.Content));
  check('Content says in words what was missed', /2 words not said/.test(byLabel.Content?.note || ''), JSON.stringify(byLabel.Content));
  check('Pronunciation is the per-word sound accuracy', byLabel.Pronunciation?.num === '71', JSON.stringify(byLabel.Pronunciation));
  check('Fluency is reported', byLabel.Fluency?.num === '100', JSON.stringify(byLabel.Fluency));
  check('Prosody is reported as well', byLabel.Prosody?.num === '91', JSON.stringify(byLabel.Prosody));
  check('each bar is drawn to its score', byLabel.Content?.width === '75%', `width=${byLabel.Content?.width}`);

  check(
    'every word of the sentence is shown',
    s.words.map((w) => w.text).join(' ') === TERM,
    JSON.stringify(s.words.map((w) => w.text))
  );
  check(
    'the two skipped words are the red ones',
    s.words.filter((w) => !w.ok).map((w) => w.text).join(',') === 'down,warm',
    JSON.stringify(s.words.map((w) => [w.text, w.ok]))
  );
  check('what Azure heard is echoed back', /The cat sat on the mat/.test(s.heard || ''), `heard=${s.heard}`);

  const sentCfg = await ev('window.__azureCalls[0]');
  check('miscue is on for a sentence, so skipped words are caught', sentCfg?.EnableMiscue === true, JSON.stringify(sentCfg));

  // a word a learner got right: tap it to see the sounds inside
  check('no word detail is open before tapping', s.detail === '', `detail=${s.detail}`);
  await ev(CLICK_WORD(TERM, 'cat'));
  s = await until(TERM, (x) => x.detail !== '', 3000, 'word detail');
  check('tapping a word opens its own sounds', /cat/.test(s.detail), `detail=${s.detail}`);
  check(
    'the detail shows that word target IPA and what was said',
    s.detailIpa.length === 2 && s.detailIpa[0][1] === '/kæt/',
    JSON.stringify(s.detailIpa)
  );
  check('the word carries its own score', /100%/.test(s.detail), `detail=${s.detail}`);

  // a skipped word explains itself instead of showing empty IPA
  await ev(CLICK_WORD(TERM, 'down'));
  s = await until(TERM, (x) => /skipped|not said/.test(x.detail), 3000, 'skipped-word detail');
  check('a skipped word says it was skipped', /not said/.test(s.detail), `detail=${s.detail}`);
  check('a skipped word shows no invented IPA', s.detailIpa.length === 0, JSON.stringify(s.detailIpa));

  await ev(`document.querySelector('.tabs button[data-tab="word"]').click()`);
  await sleep(300);

  // ===== the IPA on a freshly saved word =====
  await scenario('goodWord');
  const saved = await ev(`(async () => {
    const r = await LIB.addItem('revamp');
    if (r.status !== 'added') return { status: r.status };
    await LIB.enrichItem(r.id);
    const it = (await LIB.getItems()).find(i => i.id === r.id);
    return { stored: it.phonetic, shown: LIB.readableIpa(it.phonetic), audio: it.audio };
  })()`);
  check(
    'a saved word gets its IPA without being asked',
    !!saved.stored,
    `nothing stored: ${JSON.stringify(saved)}`
  );
  check(
    'the IPA is the American one, matching the audio we play and the accent Azure scores',
    saved.stored === '/\u0279i\u02c8v\u00e6mp/',
    `stored=${saved.stored} - the British /\u0279i\u02d0\u02c8vamp/ would contradict the -us.mp3 audio`
  );
  check(
    'the audio is the American clip, from the same entry as the text',
    /revamp-us\.mp3$/.test(saved.audio || ''),
    `audio=${saved.audio}`
  );
  check(
    'strict IPA symbols are shown as the ones learner dictionaries print',
    saved.shown === '/ri\u02c8v\u00e6mp/',
    `shown=${saved.shown} - \u0279 reads as a broken character to a learner`
  );

  // ===== a pause mid-sentence must not end the attempt =====
  // The reported bug: reading a sentence aloud, a breath between phrases was
  // read as the end and the learner was cut off halfway.
  const timeAttempt = async (term, tab) => {
    await scenario('goodWord', 'window.__gap = true');
    if (tab) {
      await ev(`document.querySelector('.tabs button[data-tab="${tab}"]').click()`);
      await sleep(400);
    }
    const started = Date.now();
    await ev(CLICK(term, 'Start speaking'));
    await until(term, (x) => x.score !== null || x.error !== null, 30000, `${term} verdict`);
    return Date.now() - started;
  };

  const wordMs = await timeAttempt('definition', 'word');
  const sentenceMs = await timeAttempt(TERM, 'sentence');
  check(
    'a two-second pause ends a single-word attempt',
    wordMs < 7000,
    `${wordMs}ms - one word should not wait around`
  );
  check(
    'the same pause does not end a sentence attempt',
    sentenceMs > wordMs + 1500,
    `word ${wordMs}ms vs sentence ${sentenceMs}ms - a breath between phrases must not cut the learner off`
  );
  await ev(`document.querySelector('.tabs button[data-tab="word"]').click()`);
  await sleep(300);

  // ===== live states =====
  await scenario('goodWord');
  await ev(CLICK('definition', 'Start speaking'));
  p = await until('definition', (x) => x.bars === 7, 4000, 'level meter');
  check('level meter and Stop appear while listening', p.bars === 7 && p.buttons.includes('Stop'), JSON.stringify(p.buttons));
  p = await until('definition', (x) => /Listening/i.test(x.status || ''), 5000, '"listening" status');
  check('status becomes "Listening - speak now" once the mic is live', /Listening/i.test(p.status), `status=${p.status}`);
  p = await until('definition', (x) => /hear you/i.test(x.status || ''), 6000, '"I can hear you" status');
  check('status reacts when speech starts, from microphone energy alone', /hear you/i.test(p.status), `status=${p.status}`);
  await until('definition', (x) => x.score !== null, 20000, 'result');

  // ===== user stops early =====
  await scenario('goodWord');
  await ev(CLICK('definition', 'Start speaking'));
  await until('definition', (x) => /hear you/i.test(x.status || ''), 8000, 'speech detected');
  await ev(CLICK('definition', 'Stop'));
  p = await until('definition', (x) => x.score !== null || x.error !== null, 10000, 'result after Stop');
  check('pressing Stop ends the attempt and still scores it', p.score !== null, `error=${p.error}`);

  // ===== nothing said =====
  await scenario('silence', 'window.__staySilent = true');
  await ev(CLICK('definition', 'Start speaking'));
  await sleep(4000);
  p = await ev(PANEL('definition'));
  check('silence does not fail early - still waiting at 4s', p.error === null && p.score === null, `error=${p.error}`);
  check('a countdown reassures the user while nothing happens', /\ds/.test(p.countdown || ''), `countdown=${p.countdown}`);
  p = await until('definition', (x) => x.error !== null, 14000, 'no-speech message');
  check('silence eventually explains itself clearly', /did not hear/i.test(p.error), `error=${p.error}`);
  check('Try again is offered after silence', p.buttons.some((b) => b.includes('Try again')), p.buttons.join('|'));

  // ===== permission denied =====
  await scenario('goodWord', 'window.__denyMic = true');
  await ev(CLICK('definition', 'Start speaking'));
  p = await until('definition', (x) => x.error !== null, 6000, 'denied message');
  check('a blocked microphone says how to fix it', /Microphone blocked/i.test(p.error), `error=${p.error}`);

  // ===== Azure refuses the request =====
  await scenario('goodWord', 'window.__azureStatus = 401');
  await ev(CLICK('definition', 'Start speaking'));
  p = await until('definition', (x) => x.error !== null, 20000, 'request-failed message');
  check(
    'a rejected key is reported, never papered over with a made-up score',
    /Azure key and region/i.test(p.error) && p.score === null,
    `error=${p.error} score=${p.score}`
  );

  // ===== no Azure key at all =====
  await ev(`(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    delete settings.azureKey;
    await chrome.storage.local.set({ settings });
  })()`);
  await scenario('goodWord');
  await ev(CLICK('definition', 'Start speaking'));
  p = await until('definition', (x) => x.error !== null, 20000, 'no-key message');
  check(
    'without a key it asks for one instead of scoring',
    /Azure Speech key/i.test(p.error),
    `error=${p.error}`
  );
} catch (e) {
  check('suite ran without throwing', false, e.stack || e.message);
} finally {
  try {
    await cdp?.send('Browser.close');
  } catch {}
  chrome?.kill('SIGKILL');
  await sleep(400);
  rmSync(profile, { recursive: true, force: true });
}

console.log(`\n${passes}/${passes + failures} checks passed`);
process.exit(failures ? 1 : 0);
