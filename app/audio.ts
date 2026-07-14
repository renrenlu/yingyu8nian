import audioManifestJson from "./audio-manifest.json";

export type Accent = "en-GB" | "en-US";
export type SpeechLocale = Accent | "zh-CN";

type AudioManifest = {
  version: number;
  voices: Record<SpeechLocale, { name: string; label: string }>;
  entries: Record<SpeechLocale, Record<string, string>>;
};

const audioManifest = audioManifestJson as AudioManifest;
let activeAudio: HTMLAudioElement | null = null;

function fallbackSpeech(text: string, locale: SpeechLocale, rate: number) {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replaceAll("…", " "));
  utterance.lang = locale;
  utterance.rate = rate;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  utterance.voice =
    voices.find((voice) => voice.lang === locale) ??
    voices.find((voice) => voice.lang.startsWith(locale.slice(0, 2))) ??
    null;
  window.speechSynthesis.speak(utterance);
}

export function playSpeech(text: string, locale: SpeechLocale, rate = 1) {
  if (typeof window === "undefined") return;

  activeAudio?.pause();
  window.speechSynthesis?.cancel();

  const filename = audioManifest.entries[locale]?.[text];
  if (!filename) {
    fallbackSpeech(text, locale, rate);
    return;
  }

  const audioUrl = new URL(`audio/${locale}/${filename}`, document.baseURI);
  const audio = new Audio(audioUrl.toString());
  audio.preload = "auto";
  audio.playbackRate = rate;
  audio.preservesPitch = true;
  activeAudio = audio;

  audio.play().catch(() => fallbackSpeech(text, locale, rate));
}

export const voiceLabels = audioManifest.voices;
