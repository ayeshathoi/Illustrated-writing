// Background music for books.
// - If the book has its own music file, that plays (looping).
// - Otherwise a gentle music-box lullaby is composed in the browser. The book's id
//   seeds the composer, so every book gets its own tune, the same each visit.
// Music never starts by itself; readers press the music button.
(function () {
  function seeded(text) {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return () => {
      h += 0x6d2b79f5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SCALES = {
    dreamy: [0, 2, 4, 7, 9],          // major pentatonic
    wistful: [0, 3, 5, 7, 10],        // minor pentatonic
    magical: [0, 2, 4, 6, 7, 9, 11],  // lydian
    gentle: [0, 2, 4, 5, 7, 9, 11],   // major
  };
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function compose(seed) {
    const rnd = seeded(seed);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const moodName = pick(Object.keys(SCALES));
    const scale = SCALES[moodName];
    const root = 60 + pick([0, 2, 3, 5, 7]);          // C, D, Eb, F or G
    const bpm = 66 + Math.floor(rnd() * 22);
    const note = (deg) => root + scale[((deg % scale.length) + scale.length) % scale.length] + 12 * Math.floor(deg / scale.length);

    // Two 4-bar phrases (A and B) built by a soft random walk, in eighth notes.
    const phrase = () => {
      const out = [];
      let deg = Math.floor(rnd() * scale.length);
      for (let bar = 0; bar < 4; bar++) {
        let beat = 0;
        while (beat < 8) {
          const len = rnd() < 0.62 ? 1 : rnd() < 0.7 ? 2 : 3;
          const rest = rnd() < 0.12;
          deg += pick([-2, -1, -1, 0, 1, 1, 2, 3, -3]);
          deg = Math.max(-2, Math.min(scale.length * 2, deg));
          out.push({ at: bar * 8 + beat, len: Math.min(len, 8 - beat), pitch: rest ? null : note(deg) + 12 });
          beat += len;
        }
      }
      // end the phrase on the home note
      const last = out[out.length - 1];
      last.pitch = root + 12;
      return out;
    };
    const A = phrase(), B = phrase();
    const chords = [0, pick([3, 4, 5]), pick([2, 3]), pick([4, 1])].map((d) => [note(d) - 12, note(d + 2) - 12, note(d + 4) - 12]);
    return { mood: moodName, bpm, melody: [A, A, B, A], chords };
  }

  function reverb(ctx) {
    const len = ctx.sampleRate * 2.8;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  function musicBox(seed) {
    const song = compose(seed);
    let ctx, master, timer, nextBar = 0, startAt = 0, playing = false;
    const eighth = 60 / song.bpm / 2;
    const barLen = eighth * 8;

    function pluck(freq, time, gain, dur) {
      [[1, 1], [2, 0.32], [3, 0.12], [4.2, 0.05]].forEach(([mult, amp]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = mult === 1 ? "triangle" : "sine";
        o.frequency.value = freq * mult;
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(gain * amp, time + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, time + dur / Math.sqrt(mult));
        o.connect(g).connect(master);
        o.start(time);
        o.stop(time + dur + 0.1);
      });
    }

    function pad(freqs, time, dur) {
      freqs.forEach((f) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = midi(f);
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(0.035, time + dur * 0.4);
        g.gain.linearRampToValueAtTime(0, time + dur);
        o.connect(g).connect(master);
        o.start(time);
        o.stop(time + dur + 0.05);
      });
    }

    function scheduleBar(i, time) {
      const section = song.melody[Math.floor(i / 4) % song.melody.length];
      const bar = i % 4;
      section.filter((n) => Math.floor(n.at / 8) === bar && n.pitch).forEach((n) => {
        pluck(midi(n.pitch), time + (n.at % 8) * eighth, 0.16, 1.6 + n.len * eighth);
      });
      pad(song.chords[bar], time, barLen * 1.02);
    }

    function tick() {
      while (startAt + nextBar * barLen < ctx.currentTime + 0.6) {
        scheduleBar(nextBar, startAt + nextBar * barLen);
        nextBar++;
      }
    }

    return {
      get playing() { return playing; },
      play() {
        if (!ctx) {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          master = ctx.createGain();
          const dry = ctx.createGain(), wet = ctx.createGain(), verb = reverb(ctx);
          dry.gain.value = 0.7; wet.gain.value = 0.45;
          master.connect(dry).connect(ctx.destination);
          master.connect(verb).connect(wet).connect(ctx.destination);
        }
        ctx.resume();
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(0.0001, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.5);
        startAt = ctx.currentTime + 0.1;
        nextBar = 0;
        tick();
        timer = setInterval(tick, 200);
        playing = true;
      },
      stop() {
        if (!ctx) return;
        clearInterval(timer);
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        setTimeout(() => { if (!playing) ctx.suspend(); }, 700);
        playing = false;
      },
      mood: song.mood,
    };
  }

  function filePlayer(url) {
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.7;
    let playing = false;
    return {
      get playing() { return playing; },
      play() { playing = true; audio.play().catch(() => { playing = false; }); },
      stop() { playing = false; audio.pause(); },
    };
  }

  // Wire a toggle button to a book's music. Returns nothing if the book has music turned off.
  window.setupBookMusic = function (book, button) {
    if (!button || book.musicMode === "off") return;
    const player = book.musicMode === "file" && book.music
      ? filePlayer(`books/${encodeURIComponent(book.id)}/${encodeURIComponent(book.music)}`)
      : musicBox(book.id);
    button.hidden = false;
    const label = () => {
      button.setAttribute("aria-pressed", String(player.playing));
      button.setAttribute("aria-label", player.playing ? "Pause music" : "Play music");
      button.title = player.playing ? "Pause music" : "Play music";
    };
    button.addEventListener("click", () => { player.playing ? player.stop() : player.play(); label(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && player.playing) { player.stop(); label(); } });
    label();
  };
})();
