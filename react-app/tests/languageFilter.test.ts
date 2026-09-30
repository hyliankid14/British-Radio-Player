import test from "node:test";
import assert from "node:assert/strict";

import {
  isEnglishLanguageTag,
  isForeignLanguageService,
  readFeedLanguage,
  readProgrammeService,
  isEnglishPodcast,
  looksNonEnglishByText
} from "../src/podcasts/languageRules.ts";
import type { Podcast } from "../src/api/podcasts.ts";

function podcast(overrides: Partial<Podcast> = {}): Podcast {
  return {
    id: "p0000001",
    title: "A Podcast",
    description: "",
    rssUrl: "https://podcasts.files.bbci.co.uk/p0000001.rss",
    htmlUrl: "",
    imageUrl: "",
    genres: ["Entertainment", "Podcasts"],
    typicalDurationMins: 30,
    ...overrides
  };
}

test("isEnglishLanguageTag accepts every English variant", () => {
  for (const tag of ["en", "en-GB", "en-gb", "en-001", "EN_us", "en"]) {
    assert.equal(isEnglishLanguageTag(tag), true, tag);
  }
});

test("isEnglishLanguageTag rejects other languages and lookalikes", () => {
  for (const tag of ["cy", "gd", "hi", "ar", "rw", "enigma", "fr", "pt", "es", "id", "ta", ""]) {
    assert.equal(isEnglishLanguageTag(tag), false, tag);
  }
});

test("foreign services are recognised, English services are not", () => {
  for (const key of ["radiocymru", "bbc_cymru", "radionangaidheal", "bbcalba", "hindiradio", "brasil"]) {
    assert.equal(isForeignLanguageService(key), true, key);
  }
  for (const key of ["radio4", "radio1", "worldserviceradio", "5live", "radiowales", "podcasts"]) {
    assert.equal(isForeignLanguageService(key), false, key);
  }
});

test("readFeedLanguage reads the channel language tag", () => {
  // Trimmed from the real feed for "Y Fangre Hon gyda Trystan ac Emma".
  const welsh = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Y Fangre Hon gyda Trystan ac Emma</title><itunes:author>BBC Radio Cymru</itunes:author><language>cy</language><ppg:network id="radiocymru" name="BBC Radio Cymru"/><item><title>Yr Orsedd</title></item></channel></rss>`;
  assert.equal(readFeedLanguage(welsh), "cy");

  assert.equal(readFeedLanguage("<channel><language>en-GB</language></channel>"), "en-gb");
  assert.equal(readFeedLanguage("<channel><title>No tag here</title></channel>"), null);
  assert.equal(readFeedLanguage("<channel><language></language></channel>"), null);
});

test("readProgrammeService reads the owning BBC service key", () => {
  // Trimmed from the real programme JSON for p0nrm70f.
  const cymru = `{"programme":{"pid":"p0nrm70f","title":"Y Fangre Hon gyda Trystan ac Emma","ownership":{"service":{"type":"radio","id":"bbc_radio_cymru","key":"radiocymru","title":"BBC Radio Cymru"}}}}`;
  assert.equal(readProgrammeService(cymru), "radiocymru");

  assert.equal(readProgrammeService(`{"programme":{"ownership":{}}}`), null);
  assert.equal(readProgrammeService("not json"), null);
  assert.equal(readProgrammeService("{}"), null);
});

test("Welsh and Gaelic podcasts are hidden once their feed language is known", () => {
  // The reported bug: Latin script and ordinary genre tags, so text cannot spot them.
  const welsh = podcast({ id: "p0nrm70f", title: "Y Fangre Hon gyda Trystan ac Emma" });
  assert.equal(looksNonEnglishByText(welsh), false, "text alone genuinely cannot detect this");
  assert.equal(isEnglishPodcast(welsh, "cy", "radiocymru"), false);
  assert.equal(isEnglishPodcast(welsh, "cy"), false);

  const gaelic = podcast({ id: "p0f8vhw9", title: "Litir do Luchd-ionnsachaidh", genres: ["Adults", "Languages"] });
  assert.equal(looksNonEnglishByText(gaelic), false);
  assert.equal(isEnglishPodcast(gaelic, "gd", "radionangaidheal"), false);
});

test("an English service key keeps a podcast without a feed fetch", () => {
  assert.equal(isEnglishPodcast(podcast({ id: "b007rkcg", title: "BBC Radio Cymru" }), undefined, "radiocymru"), true);
  assert.equal(isEnglishPodcast(podcast({ title: "In Our Time" }), undefined, "radio4"), true);
});

test("an English feed language wins over a non-Latin title", () => {
  // These are English World Service shows the text heuristic used to hide.
  const hindiTitle = podcast({ id: "p055260j", title: "बीबीसी संगीत समीक्षा" });
  assert.equal(looksNonEnglishByText(hindiTitle), true, "text alone wrongly flags this");
  assert.equal(isEnglishPodcast(hindiTitle, "en", "hindiradio"), true);
});

test("unresolved podcasts still fall back to the text heuristic", () => {
  assert.equal(isEnglishPodcast(podcast({ title: "In Our Time" })), true);
  assert.equal(
    isEnglishPodcast(podcast({ title: "Something", genres: ["Urdu", "Podcasts"] })),
    false
  );
  assert.equal(
    isEnglishPodcast(podcast({ title: "बात सरहद पार", genres: ["Chat"] })),
    false
  );
  // Latin-script non-English that the index has not resolved yet stays visible
  // rather than being wrongly hidden.
  assert.equal(isEnglishPodcast(podcast({ title: "Y Diflaniad" })), true);
});
