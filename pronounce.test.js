// Checks for the Azure assessment parsing. Run: node pronounce.test.js
//
// The fixtures below are trimmed from real responses captured from the live
// Azure endpoint (region-agnostic), so the field names and the nesting are the
// ones the service actually sends, not a guess at them.
const assert = require('assert');
const PRON = require('./pronounce.js');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

// ---------- fixtures ----------
const ph = (phoneme, score, ...nbest) => ({
  Phoneme: phoneme,
  AccuracyScore: score,
  NBestPhonemes: nbest.map(([p, s]) => ({ Phoneme: p, Score: s })),
});
const syl = (grapheme, sound, score) => ({ Grapheme: grapheme, Syllable: sound, AccuracyScore: score });

// "definition" said correctly. Only the final /n/ was weak.
const GOOD_WORD = {
  RecognitionStatus: 'Success',
  NBest: [
    {
      Display: 'Definition.',
      Confidence: 0.994,
      AccuracyScore: 98,
      FluencyScore: 100,
      ProsodyScore: 90.4,
      CompletenessScore: 100,
      PronScore: 95.8,
      Words: [
        {
          Word: 'definition',
          AccuracyScore: 98,
          ErrorType: 'None',
          Syllables: [syl('def', 'dɛf', 100), syl('i', 'ə', 100), syl('ni', 'nɪ', 100), syl('tion', 'ʃən', 93)],
          Phonemes: [
            ph('d', 100, ['d', 100], ['t', 16]),
            ph('ɛ', 100, ['ɛ', 100], ['d', 23]),
            ph('f', 100, ['f', 100], ['ə', 3]),
            ph('ə', 100, ['ə', 100], ['ɪ', 1]),
            ph('n', 100, ['n', 100], ['ə', 77]),
            ph('ɪ', 100, ['ɪ', 100], ['ʃ', 0]),
            ph('ʃ', 100, ['ʃ', 100], ['ɪ', 47]),
            ph('ə', 100, ['ə', 100], ['n', 16]),
            ph('n', 66, ['n', 100], ['ə', 1]),
          ],
        },
      ],
    },
  ],
};

// "banana" said at a card asking for "definition". Every sound is wrong, and
// the top alternatives spell out what was really said.
const WRONG_WORD = {
  RecognitionStatus: 'Success',
  NBest: [
    {
      Display: 'Definition.',
      AccuracyScore: 20,
      FluencyScore: 0,
      ProsodyScore: 56.8,
      CompletenessScore: 0,
      PronScore: 15.4,
      Words: [
        {
          Word: 'definition',
          AccuracyScore: 20,
          ErrorType: 'Mispronunciation',
          Syllables: [syl('def', 'dɛf', 0), syl('i', 'ə', 72), syl('ni', 'nɪ', 26), syl('tion', 'ʃən', 0)],
          Phonemes: [
            ph('d', 0, ['b', 100], ['s', 90]),
            ph('ɛ', 0, ['b', 100], ['p', 44]),
            ph('f', 0, ['ə', 100], ['b', 100]),
            ph('ə', 72, ['ə', 100], ['b', 15]),
            ph('n', 35, ['n', 100], ['æ', 100]),
            ph('ɪ', 0, ['æ', 100], ['n', 1]),
            ph('ʃ', 0, ['æ', 100], ['n', 99]),
            ph('ə', 0, ['n', 100], ['æ', 15]),
            ph('n', 0, ['n', 100], ['ə', 0]),
          ],
        },
      ],
    },
  ],
};

// "the cat sat on the mat" read against "the cat sat down on the warm mat":
// two words skipped, so miscue detection reports them as omissions.
const word = (text, score, errorType, sound) => ({
  Word: text,
  AccuracyScore: score,
  ErrorType: errorType,
  Syllables: sound ? [syl(text, sound, score)] : [],
  Phonemes: sound ? [...sound].map((p) => ph(p, score, [p, 100])) : [],
});
const SENTENCE = {
  RecognitionStatus: 'Success',
  NBest: [
    {
      Display: 'The cat sat on the mat.',
      AccuracyScore: 71,
      FluencyScore: 100,
      ProsodyScore: 90.9,
      CompletenessScore: 75,
      PronScore: 81.6,
      Words: [
        word('the', 80, 'None', 'ðə'),
        word('cat', 100, 'None', 'kæt'),
        word('sat', 100, 'None', 'sæt'),
        word('down', 0, 'Omission'),
        word('on', 97, 'None', 'ɑn'),
        word('the', 91, 'None', 'ðʌ'),
        word('warm', 0, 'Omission'),
        word('mat', 100, 'None', 'mæt'),
      ],
    },
  ],
};

// ---------- one sound at a time ----------
check('a sound that scored well is reported as the sound it should be', () => {
  const slot = PRON.phonemeSlot(ph('d', 100, ['d', 100], ['t', 16]));
  assert.deepStrictEqual(slot, { expected: 'd', score: 100, ok: true, spoken: 'd' });
});

check('a failed sound is reported as the sound that was actually made', () => {
  // The whole point of NBestPhonemeCount: "you said /b/ where /d/ belongs".
  const slot = PRON.phonemeSlot(ph('d', 0, ['b', 100], ['s', 90]));
  assert.strictEqual(slot.spoken, 'b');
  assert.strictEqual(slot.expected, 'd');
  assert.strictEqual(slot.ok, false);
});

check('a failed sound with no alternatives offered still renders', () => {
  const slot = PRON.phonemeSlot({ Phoneme: 'd', AccuracyScore: 10 });
  assert.strictEqual(slot.spoken, '?');
  assert.strictEqual(slot.ok, false);
});

check('the SDK shape with nested scores is accepted too', () => {
  const slot = PRON.phonemeSlot({ Phoneme: 'd', PronunciationAssessment: { AccuracyScore: 95 } });
  assert.strictEqual(slot.score, 95);
  assert.strictEqual(slot.ok, true);
});

check('a sound right on the pass mark counts as correct', () => {
  assert.strictEqual(PRON.phonemeSlot(ph('d', PRON.OK_SCORE, ['d', 100])).ok, true);
  assert.strictEqual(PRON.phonemeSlot(ph('d', PRON.OK_SCORE - 1, ['b', 100])).ok, false);
});

// ---------- merging repeated sounds ----------
check('one drawn-out sound spread over several slots is merged', () => {
  // Without this, "banana" against "definition" reads as /bbəənæænn/.
  const slots = [...'bbəənæænn'].map((p, i) => ({ spoken: p, expected: 'x', score: 10 * i, ok: false }));
  assert.strictEqual(PRON.ipaOf(PRON.collapseSlots(slots), 'spoken'), 'bənæn');
});

check('merging keeps the harsher verdict, never the kinder one', () => {
  const merged = PRON.collapseSlots([
    { spoken: 'n', expected: 'n', score: 100, ok: true },
    { spoken: 'n', expected: 'ə', score: 20, ok: false },
  ]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].ok, false, 'a repeat must not launder a failed sound green');
  assert.strictEqual(merged[0].score, 20);
});

check('different sounds in a row are left alone', () => {
  const slots = [...'dɛf'].map((p) => ({ spoken: p, expected: p, score: 100, ok: true }));
  assert.strictEqual(PRON.collapseSlots(slots).length, 3);
});

// ---------- a single word ----------
check('a good word gives the target IPA, the spoken IPA, and the scores', () => {
  const r = PRON.parseAssessment(GOOD_WORD, 'word');
  assert.strictEqual(r.targetIpa, 'dɛf.ə.nɪ.ʃən', 'syllable dots make it read like a dictionary entry');
  assert.strictEqual(PRON.ipaOf(r.spokenIpa, 'spoken'), 'dɛfənɪʃən');
  assert.strictEqual(r.score, 96);
  assert.strictEqual(r.accuracy, 98);
  assert.strictEqual(r.prosody, 90.4);
  assert.strictEqual(r.heard, 'Definition.');
});

check('only the sound that actually failed is marked red', () => {
  const r = PRON.parseAssessment(GOOD_WORD, 'word');
  const red = r.spokenIpa.filter((s) => !s.ok);
  assert.strictEqual(red.length, 1, JSON.stringify(r.spokenIpa.map((s) => [s.spoken, s.ok])));
  assert.strictEqual(red[0].expected, 'n');
});

check('syllables are labelled by letters but carry their sound', () => {
  const r = PRON.parseAssessment(GOOD_WORD, 'word');
  assert.deepStrictEqual(
    r.syllables.map((s) => s.text),
    ['def', 'i', 'ni', 'tion'],
    'the learner sees letters in the word, not "ʃən"'
  );
  assert.deepStrictEqual(
    r.syllables.map((s) => s.sound),
    ['dɛf', 'ə', 'nɪ', 'ʃən']
  );
  assert.strictEqual(r.syllables.map((s) => s.text).join(''), 'definition');
});

check('the wrong word scores low and every sound is red', () => {
  const r = PRON.parseAssessment(WRONG_WORD, 'word');
  assert.strictEqual(r.score, 15);
  assert.ok(
    r.spokenIpa.every((s) => !s.ok),
    'saying "banana" at "definition" must not leave green sounds behind'
  );
  assert.strictEqual(PRON.scoreLabel(r.score), 'Keep practising');
});

check('the spoken IPA spells out what was really said', () => {
  // This is the feature: the learner sees /bənæn/, not just a low number.
  const r = PRON.parseAssessment(WRONG_WORD, 'word');
  assert.strictEqual(PRON.ipaOf(r.spokenIpa, 'spoken'), 'bənæn');
  assert.notStrictEqual(PRON.ipaOf(r.spokenIpa, 'spoken'), r.targetIpa);
});

check('a mispronounced word is never marked ok, whatever its score', () => {
  const r = PRON.parseAssessment(WRONG_WORD, 'word');
  assert.strictEqual(r.words[0].ok, false);
  assert.strictEqual(r.words[0].errorType, 'Mispronunciation');
});

// ---------- a sentence ----------
check('a sentence is scored on every PTE dimension', () => {
  const r = PRON.parseAssessment(SENTENCE, 'sentence');
  assert.strictEqual(r.completeness, 75, 'content: how much of it was said');
  assert.strictEqual(r.accuracy, 71, 'pronunciation');
  assert.strictEqual(r.fluency, 100);
  assert.strictEqual(r.prosody, 90.9);
  assert.strictEqual(r.score, 82);
});

check('every word of the sentence is judged on its own', () => {
  const r = PRON.parseAssessment(SENTENCE, 'sentence');
  assert.strictEqual(r.words.length, 8);
  assert.deepStrictEqual(
    r.words.map((w) => w.ok),
    [true, true, true, false, true, true, false, true]
  );
  assert.deepStrictEqual(
    r.words.map((w) => w.text),
    ['the', 'cat', 'sat', 'down', 'on', 'the', 'warm', 'mat']
  );
});

check('a skipped word is named as skipped, not just scored zero', () => {
  const r = PRON.parseAssessment(SENTENCE, 'sentence');
  const skipped = r.words.filter((w) => w.errorType === 'Omission').map((w) => w.text);
  assert.deepStrictEqual(skipped, ['down', 'warm']);
});

check('each sentence word carries its own IPA for the detail view', () => {
  const r = PRON.parseAssessment(SENTENCE, 'sentence');
  assert.strictEqual(r.words[1].ipa, 'kæt');
  assert.strictEqual(r.words[3].ipa, '', 'a word that was never said has no sounds to show');
});

check('sentence mode does not pretend one word is the whole answer', () => {
  const r = PRON.parseAssessment(SENTENCE, 'sentence');
  assert.strictEqual(r.targetIpa, undefined);
  assert.strictEqual(r.spokenIpa, undefined);
});

// ---------- what the coach is allowed to reason from ----------
check('the coach is told which sound failed, not just the syllable it sits in', () => {
  // The bug this guards: a sound can score 66 and still be the sound Azure
  // expected, so both IPA strings match and every syllable stays in the
  // nineties. Briefed that way the model saw no fault and named one at
  // random - telling a learner to fix a sound they had got right.
  const facts = PRON.coachFacts('definition', 'word', PRON.parseAssessment(GOOD_WORD, 'word'));
  assert.ok(/n at 66\/100/.test(facts), facts);
  assert.ok(/ONLY sounds that failed/.test(facts), facts);
});

check('a sound that passed is never offered as the fault', () => {
  const facts = PRON.coachFacts('definition', 'word', PRON.parseAssessment(GOOD_WORD, 'word'));
  const failedPart = facts.slice(facts.indexOf('The ONLY sounds that failed'));
  for (const sound of ['d at', 'ɛ at', 'f at', 'ʃ at']) {
    assert.ok(!failedPart.includes(sound), `${sound} passed but was listed as failed:\n${facts}`);
  }
});

check('a swapped sound says what was said instead', () => {
  const facts = PRON.coachFacts('definition', 'word', PRON.parseAssessment(WRONG_WORD, 'word'));
  assert.ok(/d at 0\/100 \(they made b instead\)/.test(facts), facts);
});

check('a clean attempt tells the coach there is nothing to fix', () => {
  const clean = PRON.parseAssessment(GOOD_WORD, 'word');
  clean.spokenIpa = clean.spokenIpa.map((s) => ({ ...s, ok: true, score: 100 }));
  const facts = PRON.coachFacts('definition', 'word', clean);
  assert.ok(/Do not invent a fault/.test(facts), facts);
});

check('a sentence is still briefed per word, which is what its colours show', () => {
  const facts = PRON.coachFacts('the cat sat down on the warm mat', 'sentence', PRON.parseAssessment(SENTENCE, 'sentence'));
  assert.ok(/down 0\/100 \(Omission\)/.test(facts), facts);
  assert.ok(/Content 75\/100/.test(facts), facts);
});

// ---------- nothing usable ----------
check('silence is reported as no speech, not as a zero score', () => {
  assert.deepStrictEqual(PRON.parseAssessment({ RecognitionStatus: 'InitialSilenceTimeout' }, 'word'), {
    error: 'no-speech',
    status: 'InitialSilenceTimeout',
  });
  assert.strictEqual(PRON.parseAssessment({ RecognitionStatus: 'Success', NBest: [] }, 'word').error, 'no-speech');
  assert.strictEqual(PRON.parseAssessment({}, 'word').error, 'no-speech');
});

// ---------- the request we send ----------
check('the request asks for IPA, not Azure default alphabet', () => {
  // SAPI spells "tion" as "shaxn", which means nothing to a learner.
  assert.strictEqual(PRON.assessConfig('definition').PhonemeAlphabet, 'IPA');
});

check('the request asks what was said, not only whether it was right', () => {
  assert.ok(PRON.assessConfig('definition').NBestPhonemeCount >= 1);
  assert.strictEqual(PRON.assessConfig('definition').EnableProsodyAssessment, true);
  assert.strictEqual(PRON.assessConfig('definition').Granularity, 'Phoneme');
});

check('miscue detection is on for a sentence and off for one word', () => {
  // On a single word it punishes a learner who simply says it twice.
  assert.strictEqual(PRON.assessConfig('definition').EnableMiscue, false);
  assert.strictEqual(PRON.assessConfig('  definition  ').EnableMiscue, false);
  assert.strictEqual(PRON.assessConfig('the cat sat down').EnableMiscue, true);
});

// ---------- labels and timings ----------
check('score labels cover the whole range', () => {
  assert.strictEqual(PRON.scoreLabel(100), 'Excellent');
  assert.strictEqual(PRON.scoreLabel(90), 'Excellent');
  assert.strictEqual(PRON.scoreLabel(80), 'Good');
  assert.strictEqual(PRON.scoreLabel(60), 'Almost');
  assert.strictEqual(PRON.scoreLabel(10), 'Keep practising');
});

check('timings leave room to actually speak', () => {
  assert.ok(PRON.WAIT_FOR_SPEECH_MS >= 8000, 'need a generous window before the first word');
  assert.ok(PRON.END_SILENCE_MS >= 1200, 'need to tolerate a pause between syllables');
  assert.ok(PRON.MAX_MS > PRON.END_SILENCE_MS);
});

console.log(`${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}`);
