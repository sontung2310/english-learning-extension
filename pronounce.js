// Pronunciation practice: microphone capture, then Azure Pronunciation
// Assessment on the recording. The parsing half is pure so it can be unit
// tested outside the browser against real captured Azure responses.
//
// There is no speech-to-text grader here on purpose. A transcript cannot prove
// the sounds were right: its language model quietly corrects a mispronounced
// word back to the real one. Azure scores the phonemes against the target
// word, so it can tell "defonition" from "definition".
const PRON = (() => {
  // ---------- tuning ----------
  // Every timer is anchored on the microphone actually going live, never on
  // the click, so a slow mic does not eat the user's speaking time.
  const WAIT_FOR_SPEECH_MS = 10000; // silence allowed before the first word
  // Read through the exported object, never the constant directly. It is the
  // one seam the end-to-end suite uses to shorten its "said nothing" scenario,
  // which would otherwise sit through the full ten seconds for real. Nothing
  // in the extension ever writes to it, so the shipped behaviour is the
  // constant above.
  const waitForSpeech = () => PRON.WAIT_FOR_SPEECH_MS;
  const END_SILENCE_MS = 1600; // pause after one word that ends the attempt
  const MAX_MS = 15000; // hard cap on one word
  // A learner reading a sentence aloud is slow and pauses between phrases.
  // Both clocks have to grow with the sentence: the hard cap, or they are cut
  // off before the last word, and the end-of-speech pause, or a breath in the
  // middle is mistaken for the end.
  const SENTENCE_END_SILENCE_MS = 2500; // a phrase break is not the end
  const PER_WORD_MS = 1500; // unhurried learner pace, with room to spare
  const SENTENCE_LEAD_MS = 6000; // getting started, and a breath at the end
  const MAX_SENTENCE_MS = 60000; // nothing holds the microphone longer
  const VAD_RMS = 0.015; // mic energy that counts as speech
  // How long sound must hold before it counts as speech. Wall clock, not a
  // frame count: frames are 50ms apart only while the tab is in front, and
  // Chrome throttles them to one a second in the background, where "three
  // frames" quietly becomes "three seconds of talking" and short words are
  // never noticed at all.
  const VAD_SPEECH_MS = 150;
  // However noisy the room, a threshold past this would sit above ordinary
  // speech, and the microphone would appear to be dead.
  const VAD_CEILING = 0.07;
  const TARGET_RATE = 16000; // Azure's documented rate for assessment
  const OK_SCORE = 70; // Azure accuracy at or above this reads as correct
  const NBEST_PHONEMES = 3; // alternatives per sound, to show what was said

  // How long this particular target is allowed to take. One word keeps the
  // short clocks; anything longer is scaled by its word count.
  function limitsFor(targetText) {
    const words = (targetText || '').trim().split(/\s+/).filter(Boolean).length;
    if (words <= 1) return { maxMs: MAX_MS, endSilenceMs: END_SILENCE_MS };
    return {
      maxMs: Math.min(MAX_SENTENCE_MS, Math.max(MAX_MS, words * PER_WORD_MS + SENTENCE_LEAD_MS)),
      endSilenceMs: SENTENCE_END_SILENCE_MS,
    };
  }

  // The room's noise floor, taken as the QUIETEST frame rather than the
  // average of them.
  //
  // The average is wrong whenever sound arrives during calibration, and it
  // does: a learner who presses start and speaks straight away, or a tab in
  // the background, where Chrome throttles timers to one frame a second and
  // "the first few frames" stretches over six seconds of talking. Averaging
  // then puts the floor - and the threshold above it - higher than the voice
  // it is supposed to notice, and the attempt fails with "I did not hear
  // anything" no matter how loudly the user speaks. The quietest frame
  // survives all of that; it is only wrong if every frame was loud.
  const noiseFloor = (frames) => (frames.length ? Math.min(...frames) : 0);

  const vadThreshold = (floor) => Math.min(VAD_CEILING, Math.max(VAD_RMS, floor * 2.5 + 0.01));

  function scoreLabel(score) {
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Good';
    if (score >= 50) return 'Almost';
    return 'Keep practising';
  }

  // ---------- parsing Azure's reply (pure) ----------
  const num = (v) => (typeof v === 'number' ? v : null);
  // The REST API puts scores straight on the object; the SDK nests them under
  // PronunciationAssessment. Accept either shape.
  const accOf = (o) => num(o && o.AccuracyScore) ?? num(o && o.PronunciationAssessment && o.PronunciationAssessment.AccuracyScore);
  const fieldOf = (o, name) => num(o && o[name]) ?? num(o && o.PronunciationAssessment && o.PronunciationAssessment[name]);
  const errorOf = (o) => (o && o.ErrorType) || (o && o.PronunciationAssessment && o.PronunciationAssessment.ErrorType) || null;

  // One expected sound, and the sound the learner actually made in its place.
  //
  // A slot scored well means the expected sound landed, so that is what we
  // show. Only a failed slot is worth replacing with Azure's best guess at
  // what was said instead - on a good attempt the top guess is the expected
  // phoneme anyway, and showing the guess regardless would make a correct
  // attempt flicker between equally-scored symbols.
  function phonemeSlot(p) {
    const expected = (p && p.Phoneme) || '';
    const score = accOf(p);
    const ok = score === null || score >= OK_SCORE;
    const guess = ((p && p.NBestPhonemes) || [])[0];
    return { expected, score, ok, spoken: ok ? expected : (guess && guess.Phoneme) || '?' };
  }

  // Each slot is judged on its own, so one drawn-out sound can win several
  // slots in a row ("banana" against "definition" comes back as
  // b b ə ə n æ æ n n). Merging the repeats is what turns that back into
  // /bənæn/, something a learner can actually read.
  function collapseSlots(slots) {
    const out = [];
    for (const slot of slots) {
      const prev = out[out.length - 1];
      if (prev && prev.spoken === slot.spoken) {
        // Keep the harsher verdict of the merged slots, so a repeat can never
        // launder a failed sound into a green one.
        prev.ok = prev.ok && slot.ok;
        if (slot.score !== null && (prev.score === null || slot.score < prev.score)) prev.score = slot.score;
        continue;
      }
      out.push({ ...slot });
    }
    return out;
  }

  const ipaOf = (slots, key) => slots.map((s) => s[key]).join('');

  function parseWord(w) {
    const slots = ((w && w.Phonemes) || []).map(phonemeSlot);
    const syllables = ((w && w.Syllables) || []).map((s) => {
      const score = accOf(s);
      return {
        // Azure names a syllable by its sound ("ʃən") but also gives the
        // letters it came from ("tion"). Letters are what the learner sees in
        // the word, so they label the segment and the sound rides along.
        text: s.Grapheme || s.Syllable,
        sound: s.Syllable,
        score,
        ok: score === null || score >= OK_SCORE,
      };
    });
    const score = accOf(w);
    const errorType = errorOf(w);
    return {
      text: (w && w.Word) || '',
      score,
      ok: errorType && errorType !== 'None' ? false : score === null || score >= OK_SCORE,
      errorType: errorType === 'None' ? null : errorType,
      syllables,
      slots: collapseSlots(slots),
      // Dotted syllables read closest to a dictionary entry (dɛf.ə.nɪ.ʃən).
      // An omitted word has no syllables, so fall back to the raw sounds.
      ipa: syllables.length ? syllables.map((s) => s.sound).join('.') : ipaOf(slots, 'expected'),
    };
  }

  // Turn one Azure assessment into everything the UI shows. `type` only
  // decides which extras are worth computing, never the scores themselves.
  function parseAssessment(json, type) {
    if (json && json.RecognitionStatus && json.RecognitionStatus !== 'Success') {
      return { error: 'no-speech', status: json.RecognitionStatus };
    }
    const best = ((json && json.NBest) || [])[0];
    if (!best) return { error: 'no-speech' };

    const words = (best.Words || []).map(parseWord);
    const spoken = words.filter((w) => w.errorType !== 'Omission');
    const result = {
      heard: best.Display || best.Lexical || '',
      score: Math.round(fieldOf(best, 'PronScore') ?? accOf(best) ?? 0),
      accuracy: accOf(best),
      fluency: fieldOf(best, 'FluencyScore'),
      prosody: fieldOf(best, 'ProsodyScore'),
      completeness: fieldOf(best, 'CompletenessScore'),
      confidence: num(best.Confidence),
      words,
    };

    if (type === 'word') {
      const w = spoken[0] || words[0];
      if (w) {
        result.syllables = w.syllables;
        result.targetIpa = w.ipa;
        result.spokenIpa = w.slots;
      }
    }
    return result;
  }

  // ---------- audio encoding (browser) ----------
  // Azure takes 16 kHz mono PCM wav; MediaRecorder gives webm/opus.
  async function blobToWavBytes(blob) {
    const buffer = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(buffer);
    } finally {
      ctx.close();
    }

    const source = decoded.getChannelData(0);
    const ratio = decoded.sampleRate / TARGET_RATE;
    const frames = Math.floor(source.length / ratio);
    const pcm = new Int16Array(frames);
    for (let i = 0; i < frames; i++) {
      // Average the window instead of picking one sample, to avoid aliasing.
      const start = Math.floor(i * ratio);
      const end = Math.min(source.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let k = start; k < end; k++) sum += source[k];
      const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
      pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
    }

    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const text = (offset, str) => {
      for (let i = 0; i < str.length; i++) out.setUint8(offset + i, str.charCodeAt(i));
    };
    text(0, 'RIFF');
    out.setUint32(4, 36 + pcm.length * 2, true);
    text(8, 'WAVEfmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); // PCM
    out.setUint16(22, 1, true); // mono
    out.setUint32(24, TARGET_RATE, true);
    out.setUint32(28, TARGET_RATE * 2, true);
    out.setUint16(32, 2, true);
    out.setUint16(34, 16, true);
    text(36, 'data');
    out.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, pcm[i], true);

    return new Uint8Array(out.buffer);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  // ---------- Azure pronunciation assessment (browser) ----------
  function assessConfig(targetText) {
    return {
      ReferenceText: targetText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Comprehensive',
      // IPA, not Azure's default SAPI alphabet: the learner already sees IPA
      // on the card and in every dictionary, "shaxn" means nothing to them.
      PhonemeAlphabet: 'IPA',
      // What turns "you got this sound wrong" into "you said /b/ here".
      NBestPhonemeCount: NBEST_PHONEMES,
      // Rhythm, stress and intonation - the other half of PTE fluency.
      EnableProsodyAssessment: true,
      // Miscue detection catches skipped and inserted words, which is what a
      // sentence needs. On a single word it punishes a learner who simply
      // says it twice, scoring a good attempt near zero.
      EnableMiscue: /\s/.test(targetText.trim()),
    };
  }

  async function azureAssess(targetText, type, audioBlob) {
    const { azureKey, azureRegion } = await LIB.getSettings();
    if (!azureKey || !azureRegion) return { error: 'no-key' };
    if (!audioBlob) return { error: 'no-audio' };

    let wav;
    try {
      wav = await blobToWavBytes(audioBlob);
    } catch (e) {
      return { error: 'encode-failed', message: e.message };
    }

    const url =
      `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=en-US&format=detailed`;

    let res;
    const startedAt = Date.now();
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          'Pronunciation-Assessment': bytesToBase64(
            new TextEncoder().encode(JSON.stringify(assessConfig(targetText)))
          ),
          Accept: 'application/json',
        },
        body: wav,
      });
    } catch (e) {
      return { error: 'network', message: e.message };
    }
    const ms = Date.now() - startedAt;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: 'request-failed', message: `HTTP ${res.status} ${body.slice(0, 200)}`, ms };
    }

    const parsed = parseAssessment(await res.json(), type);
    return { ...parsed, ms };
  }

  // ---------- coach feedback (browser) ----------
  // Azure gives numbers; a learner needs a sentence. Only the numbers go up,
  // never the audio: Azure already judged the sounds, so the model is just
  // putting its verdict into words.
  // The facts the coach is allowed to reason from. Pure, so the prompt can be
  // checked without spending an API call.
  //
  // This must describe the same thing the colours do - per sound, not per
  // syllable. A sound can score 66 and still be the sound Azure expected, in
  // which case the two IPA strings match exactly and a syllable summary stays
  // in the nineties. Briefing the coach that way left the one red sound
  // invisible, and the model filled the silence by naming a sound at random.
  function coachFacts(targetText, type, assessment) {
    if (type !== 'word') {
      return (
        `Target sentence: "${targetText}". They were heard saying: "${assessment.heard}". ` +
        `Accuracy per word: ${(assessment.words || [])
          .map((w) => `${w.text} ${Math.round(w.score)}/100${w.errorType ? ` (${w.errorType})` : ''}`)
          .join(', ')}. ` +
        `Content ${Math.round(assessment.completeness)}/100, pronunciation ${Math.round(
          assessment.accuracy
        )}/100, fluency ${Math.round(assessment.fluency)}/100` +
        (assessment.prosody !== null ? `, prosody ${Math.round(assessment.prosody)}/100` : '') +
        '.'
      );
    }

    const slots = assessment.spokenIpa || [];
    const scored = slots
      .map(
        (s) =>
          `${s.expected}${s.spoken !== s.expected ? `->${s.spoken}` : ''} ${Math.round(s.score)}/100`
      )
      .join(', ');
    const failed = slots.filter((s) => !s.ok);
    const verdict = failed.length
      ? `The ONLY sounds that failed: ${failed
          .map(
            (s) =>
              `${s.expected} at ${Math.round(s.score)}/100 ` +
              (s.spoken !== s.expected
                ? `(they made ${s.spoken} instead)`
                : `(the right sound, but too weak or unclear)`)
          )
          .join('; ')}.`
      : 'Every sound passed. Do not invent a fault.';

    return (
      `Target word: "${targetText}". Expected sounds in IPA: ${assessment.targetIpa}. ` +
      `Score for each sound in order: ${scored}. ` +
      `${verdict} ` +
      `Syllables: ${(assessment.syllables || [])
        .map((s) => `${s.text} (${s.sound})`)
        .join(', ')}.`
    );
  }

  async function coach(targetText, type, assessment) {
    const { apiKey } = await LIB.getSettings();
    if (!apiKey) return { error: 'no-key' };

    const prompt =
      `You are a warm, concise English pronunciation coach` +
      (type === 'sentence' ? ` marking a PTE Speaking read-aloud answer` : '') +
      `. A phoneme-level scorer already judged the recording - trust its numbers, do not re-score. ` +
      `${coachFacts(targetText, type, assessment)} ` +
      (type === 'word'
        ? `Name only a sound the scorer actually failed. Never name a sound that passed. `
        : `Name only a word the scorer actually marked down. `) +
      `Reply with JSON only: {"feedback":"1-2 short sentences in simple English. Name the exact ` +
      `${type === 'word' ? 'sound or syllable' : 'word'} to fix and how to make it. Be encouraging."}`;

    try {
      const reply = await LIB.openaiChat(apiKey, [{ role: 'user', content: prompt }], true);
      const match = reply.match(/\{[\s\S]*\}/);
      const feedback = match && JSON.parse(match[0]).feedback;
      return feedback ? { feedback } : { error: 'bad-reply' };
    } catch (e) {
      return { error: 'request-failed', message: e.message };
    }
  }

  // ---------- capture session (browser) ----------
  // One recording. Reports progress through handlers so the UI can show a live
  // level meter and a countdown; always finishes exactly once, through onDone.
  //
  // Microphone energy alone decides when speech starts and ends. No recogniser
  // is involved, so the attempt starts instantly, never needs the network, and
  // cannot be cut off mid-word by someone else's endpointer.
  function createSession(targetText, handlers = {}) {
    const { maxMs, endSilenceMs } = limitsFor(targetText);
    const emit = (name, ...args) => {
      if (typeof handlers[name] === 'function') handlers[name](...args);
    };

    let finished = false;
    let cancelled = false;
    let speechStarted = false;
    let loudSince = null;
    let deadline = 0;

    let waitTimer = null;
    let silenceTimer = null;
    let capTimer = null;
    let tickTimer = null;
    let stream = null;
    let audioCtx = null;
    let recorder = null;
    let levelTimer = null;
    const chunks = [];

    function cleanup() {
      [waitTimer, silenceTimer, capTimer].forEach(clearTimeout);
      clearInterval(tickTimer);
      clearInterval(levelTimer);
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (e) {
          /* already stopped */
        }
      }
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
    }

    const blobOf = () => (chunks.length ? new Blob(chunks, { type: chunks[0].type }) : null);

    // Wait for the recorder to flush, so Azure gets the whole utterance rather
    // than whatever had been written when we stopped.
    function recordedBlob() {
      if (!recorder || recorder.state === 'inactive') return Promise.resolve(blobOf());
      return new Promise((resolve) => {
        recorder.onstop = () => resolve(blobOf());
        try {
          recorder.stop();
        } catch (e) {
          resolve(blobOf());
        }
        setTimeout(() => resolve(blobOf()), 1500);
      });
    }

    async function finish(reason) {
      if (finished) return;
      finished = true;
      [waitTimer, silenceTimer, capTimer].forEach(clearTimeout);
      clearInterval(tickTimer);

      if (reason === 'cancelled') {
        cleanup();
        emit('onDone', { cancelled: true });
        return;
      }
      if (reason && reason !== 'ok') {
        cleanup();
        emit('onDone', { error: reason });
        return;
      }

      emit('onState', 'scoring');
      const blob = await recordedBlob();
      cleanup();
      if (!blob || !blob.size) {
        emit('onDone', { error: 'no-speech' });
        return;
      }
      emit('onDone', { audio: blob });
    }

    const armEndOfSpeech = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => finish('ok'), endSilenceMs);
    };

    function noteSpeech() {
      if (finished) return;
      if (!speechStarted) {
        speechStarted = true;
        clearTimeout(waitTimer);
        deadline = Date.now() + maxMs;
        emit('onState', 'speaking');
        // Enforce the cap the countdown is promising. Without this, someone
        // talking continuously keeps re-arming the end-of-speech timer and the
        // countdown sits at 0 while the attempt runs on.
        clearTimeout(capTimer);
        capTimer = setTimeout(() => finish('ok'), maxMs);
      }
      armEndOfSpeech();
    }

    // The microphone is open: only now can we fairly time how long the user
    // has been silent.
    function micLive() {
      if (finished || speechStarted || waitTimer) return;
      deadline = Date.now() + waitForSpeech();
      emit('onState', 'listening');
      waitTimer = setTimeout(() => finish('no-speech'), waitForSpeech());
      capTimer = setTimeout(() => finish('ok'), maxMs + waitForSpeech());
      tickTimer = setInterval(() => {
        if (!finished) emit('onTick', Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      }, 250);
    }

    async function openMic() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        finish(e && e.name === 'NotAllowedError' ? 'denied' : 'no-mic');
        return false;
      }
      if (cancelled) return false;

      try {
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        recorder.start();
      } catch (e) {
        // Nothing to assess without a recording, so this is fatal now that
        // Azure is the only grader.
        finish('no-mic');
        return false;
      }

      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // A context created while the tab is hidden starts suspended and would
        // report pure silence.
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);

        // Learn the room's noise floor from the first few frames, so a fixed
        // threshold does not mistake a noisy room for continuous speech (which
        // would stop end-of-speech ever being detected).
        let floor = null;
        const floorFrames = [];

        // A timer, not requestAnimationFrame: rAF is paused entirely in a
        // hidden tab, which would freeze end-of-speech detection the moment
        // the user switched tabs mid-attempt.
        levelTimer = setInterval(() => {
          if (finished) return;
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const s of samples) sum += s * s;
          const rms = Math.sqrt(sum / samples.length);
          emit('onLevel', Math.min(1, rms * 8));

          if (floor === null) {
            floorFrames.push(rms);
            if (floorFrames.length < 6) return; // still calibrating
            floor = noiseFloor(floorFrames);
          }
          const threshold = vadThreshold(floor);

          // Only sound re-arms the end-of-speech timer. Silence must be left
          // alone so the timer can actually run down - re-arming it here would
          // keep the attempt open until the hard cap.
          if (rms > threshold) {
            if (loudSince === null) loudSince = Date.now();
            if (Date.now() - loudSince >= VAD_SPEECH_MS) noteSpeech();
          } else {
            loudSince = null;
          }
        }, 50);
      } catch (e) {
        // ponytail: no meter means no end-of-speech detection either, so the
        // hard cap becomes the only stop. Acceptable because an AudioContext
        // failing at all is a broken browser, not a normal path.
      }
      return true;
    }

    emit('onState', 'starting');
    (async () => {
      if (!(await openMic())) return;
      if (cancelled || finished) return;
      micLive();
    })();

    return {
      stop() {
        if (!finished) finish(speechStarted ? 'ok' : 'no-speech');
      },
      cancel() {
        cancelled = true;
        finish('cancelled');
      },
    };
  }

  const ERRORS = {
    denied: 'Microphone blocked. Allow it in the address bar, then try again.',
    'no-mic': 'No microphone found. Check your input device.',
    'no-speech': 'I did not hear anything. Press start and speak clearly.',
    'no-key': 'Add your Azure Speech key and region in Settings to score pronunciation.',
    'no-audio': 'The recording was empty. Press start and try again.',
    'encode-failed': 'Could not read the recording. Try again.',
    network: 'Scoring needs an internet connection.',
    'request-failed': 'Scoring was refused. Check your Azure key and region in Settings.',
    error: 'Something went wrong. Try again.',
  };

  return {
    scoreLabel,
    limitsFor,
    noiseFloor,
    vadThreshold,
    phonemeSlot,
    collapseSlots,
    ipaOf,
    parseAssessment,
    assessConfig,
    azureAssess,
    coachFacts,
    coach,
    createSession,
    ERRORS,
    OK_SCORE,
    WAIT_FOR_SPEECH_MS,
    END_SILENCE_MS,
    MAX_MS,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PRON;
