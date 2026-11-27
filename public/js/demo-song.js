"use strict";
/* The sample song: the first 30 seconds of "Faker" by aleksiah (Stellar Music), the Apple Music preview, with the
   official lyrics timed word by word (the site's own lyric timing, fixed by hand where it was unsure). The audio (media/demo/faker.m4a, about 1 MB) is only fetched the first time someone opens
   the editor or presses play without a song of their own; see ensureDemo() in studio.js.
   words: "word|start|length|line", start and length in seconds from the start of the clip. */
window.SLS_DEMO = (() => {
  const W = `I|0.00|0.44|0 can't|0.46|0.41|0 get|0.89|0.11|0 off,|1.02|0.36|0 what's|1.42|0.27|0 a|1.71|0.11|0 girl|1.84|0.20|0 gotta|2.06|0.32|0 do?|2.40|0.64|0 'Cause|3.86|0.69|1 I'm|4.57|0.37|1 a|4.96|0.13|1 heartbreaker,|5.11|1.35|1 a|6.46|0.50|1 'can't-take-er'|7.02|1.55|1 But|8.64|0.41|2 when|9.07|0.37|2 it|9.46|0.13|2 comes|9.61|0.23|2 to|9.86|0.22|2 lovin',|10.10|0.44|2 I'm|10.56|0.39|2 a|10.97|0.16|2 big|11.34|0.38|2 faker|11.74|0.79|2 A|12.55|0.52|3 time-waster,|13.10|1.58|3 ah,|15.00|0.16|3 maybe|15.50|0.28|3 later|15.80|0.74|3 Oh,|16.56|0.59|4 baby,|17.22|0.36|4 I|17.67|0.25|4 can't|17.94|0.33|4 help|18.29|0.23|4 it,|18.54|0.24|4 I'm|18.80|0.23|4 a|19.05|0.14|4 big|19.21|0.63|4 faker|19.86|0.74|4 I'm|20.62|0.38|5 in|21.02|0.16|5 my|21.20|0.14|5 head|21.36|0.30|5 all|21.68|0.12|5 the|21.82|0.14|5 time,|21.98|0.40|5 I|22.45|0.29|5 can't|22.76|0.26|5 get|23.04|0.35|5 past|23.41|0.41|5 the|23.84|0.21|5 line|24.07|0.31|5 Move|24.40|0.37|6 your|24.79|0.22|6 thumb|25.03|0.27|6 to|25.32|0.39|6 the|25.73|0.23|6 right,|25.98|0.39|6 oh,|26.55|0.29|6 wait,|26.84|0.24|6 never|27.10|0.30|6 mind|27.42|0.45|6 'Cause,|27.89|0.35|7 baby,|28.30|0.42|7 I'm|28.82|0.36|7 a|29.20|0.10|7 headshaker,|29.32|0.62|7`;
  const words = W.split(" ").map(s => { const [w, t, d, l] = s.split("|"); return { w, t: +t, d: +d, l: +l }; });
  const lines = []; words.forEach(x => (lines[x.l] = lines[x.l] || []).push(x.w));
  return {
    title: "Faker", artist: "aleksiah", label: "Faker · aleksiah (sample)",
    url: "media/demo/faker.m4a", duration: 30, bpm: 119, offset: 0.135,
    section: { a: 3.5, b: 20.8 },   // the first four lines of the chorus
    words, lyrics: lines.map(l => l.join(" ")).join("\n")
  };
})();
