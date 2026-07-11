"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ipa } from "./ipa";
import { units, type VocabItem } from "./data";

type ContentMode = "words" | "phrases" | "sentences";
type PageMode = "learn" | "practice";
type Accent = "en-GB" | "en-US";

const totalWords = units.reduce((sum, unit) => sum + unit.vocab.length, 0);

function speak(text: string, accent: Accent, rate = 0.88) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replaceAll("…", " "));
  utterance.lang = accent;
  utterance.rate = rate;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const exactVoice = voices.find((voice) => voice.lang === accent);
  const languageVoice = voices.find((voice) => voice.lang.startsWith(accent.slice(0, 2)));
  utterance.voice = exactVoice ?? languageVoice ?? null;
  window.speechSynthesis.speak(utterance);
}

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function SpellingModule({
  word,
  accent,
  completed,
  onCorrect,
}: {
  word: VocabItem;
  accent: Accent;
  completed: boolean;
  onCorrect: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<"idle" | "correct" | "incorrect">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const target = word.term.toLowerCase().replace(/[^a-z]/g, "");

  useEffect(() => {
    setAnswer("");
    setStatus("idle");
  }, [word.term]);

  function updateAnswer(value: string) {
    setAnswer(value.toLowerCase().replace(/[^a-z]/g, "").slice(0, target.length));
    setStatus("idle");
  }

  function checkAnswer() {
    if (!answer) {
      inputRef.current?.focus();
      return;
    }
    if (answer === target) {
      setStatus("correct");
      onCorrect();
    } else {
      setStatus("incorrect");
    }
  }

  function revealNextLetter() {
    let next = 0;
    while (next < answer.length && answer[next] === target[next]) next += 1;
    const prefix = target.slice(0, next + 1);
    setAnswer(prefix);
    setStatus("idle");
    inputRef.current?.focus();
  }

  let letterIndex = 0;

  return (
    <div className="spelling-module">
      <div className="spelling-heading">
        <div><h4>听音默写</h4><p>听发音，根据“{word.meaning}”填写完整单词。</p></div>
        {completed && <span className="spelling-complete">✓ 已默写正确</span>}
      </div>
      <button className="spelling-sound" onClick={() => speak(word.term, accent, 0.78)}>🔊 播放单词</button>
      <div className={`letter-boxes ${status}`} onClick={() => inputRef.current?.focus()} role="presentation">
        {word.term.toLowerCase().split("").map((character, index) => {
          if (!/[a-z]/.test(character)) {
            return <span className="spelling-separator" key={`${character}-${index}`}>{character === " " ? "·" : character}</span>;
          }
          const currentIndex = letterIndex;
          letterIndex += 1;
          const value = answer[currentIndex] ?? "";
          const isWrong = status === "incorrect" && value && value !== target[currentIndex];
          return <span className={`letter-box ${isWrong ? "wrong-letter" : ""}`} key={`${character}-${index}`}>{value || "_"}</span>;
        })}
      </div>
      <label className="spelling-input-label">
        <span>连续输入字母</span>
        <input
          ref={inputRef}
          className="spelling-input"
          value={answer}
          onChange={(event) => updateAnswer(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") checkAnswer(); }}
          placeholder={`共 ${target.length} 个字母`}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label={`默写 ${word.meaning} 对应的英文单词`}
        />
      </label>
      <div className="spelling-actions">
        <button onClick={revealNextLetter}>提示一个字母</button>
        <button onClick={() => { setAnswer(""); setStatus("idle"); inputRef.current?.focus(); }}>重新填写</button>
        <button className="check-spelling" onClick={checkAnswer}>检查答案</button>
      </div>
      {status === "correct" && <div className="spelling-feedback correct">拼写正确！读一遍，再记一遍。</div>}
      {status === "incorrect" && <div className="spelling-feedback incorrect">还有字母不正确，红色格子需要修改。</div>}
    </div>
  );
}

export default function Home() {
  const [unitId, setUnitId] = useState(1);
  const [contentMode, setContentMode] = useState<ContentMode>("words");
  const [pageMode, setPageMode] = useState<PageMode>("learn");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [accent, setAccent] = useState<Accent>("en-GB");
  const [mastered, setMastered] = useState<string[]>([]);
  const [spelled, setSpelled] = useState<string[]>([]);
  const [quiz, setQuiz] = useState<{ word: VocabItem; choices: string[] } | null>(null);
  const [quizAnswer, setQuizAnswer] = useState<string | null>(null);
  const [quizScore, setQuizScore] = useState({ correct: 0, total: 0 });
  const [showChinese, setShowChinese] = useState<Record<number, boolean>>({});

  const unit = units[unitId - 1];
  const filteredWords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return unit.vocab;
    return unit.vocab.filter(
      (item) => item.term.toLowerCase().includes(keyword) || item.meaning.includes(query.trim()),
    );
  }, [query, unit]);

  const selectedWord = filteredWords[selectedIndex] ?? filteredWords[0] ?? unit.vocab[0];
  const selectedPhrase = unit.phrases[selectedIndex] ?? unit.phrases[0];

  useEffect(() => {
    const stored = window.localStorage.getItem("u1-u8-mastered");
    if (stored) setMastered(JSON.parse(stored));
    const storedSpelling = window.localStorage.getItem("u1-u8-spelling");
    if (storedSpelling) setSpelled(JSON.parse(storedSpelling));
  }, []);

  function changeUnit(id: number) {
    setUnitId(id);
    setSelectedIndex(0);
    setQuery("");
    setQuiz(null);
    setQuizAnswer(null);
  }

  function toggleMastered() {
    const key = `${unit.id}:${selectedWord.term}`;
    const next = mastered.includes(key)
      ? mastered.filter((item) => item !== key)
      : [...mastered, key];
    setMastered(next);
    window.localStorage.setItem("u1-u8-mastered", JSON.stringify(next));
  }

  function markSpellingCorrect() {
    const key = `${unit.id}:${selectedWord.term}`;
    if (spelled.includes(key)) return;
    const next = [...spelled, key];
    setSpelled(next);
    window.localStorage.setItem("u1-u8-spelling", JSON.stringify(next));
  }

  function nextWord(direction = 1) {
    const length = contentMode === "words" ? filteredWords.length : unit.phrases.length;
    if (!length) return;
    setSelectedIndex((current) => (current + direction + length) % length);
  }

  function nextQuiz() {
    const candidates = unit.vocab;
    const word = candidates[Math.floor(Math.random() * candidates.length)];
    const distractors = shuffle(candidates.filter((item) => item.term !== word.term))
      .slice(0, 3)
      .map((item) => item.meaning);
    setQuiz({ word, choices: shuffle([word.meaning, ...distractors]) });
    setQuizAnswer(null);
  }

  function answerQuiz(choice: string) {
    if (!quiz || quizAnswer) return;
    setQuizAnswer(choice);
    setQuizScore((score) => ({
      correct: score.correct + (choice === quiz.word.meaning ? 1 : 0),
      total: score.total + 1,
    }));
  }

  const masteredHere = unit.vocab.filter((item) => mastered.includes(`${unit.id}:${item.term}`)).length;
  const isMastered = mastered.includes(`${unit.id}:${selectedWord.term}`);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="返回顶部">
          <span className="brand-mark">A+</span>
          <span>八上英语学习舱</span>
        </a>
        <nav className="topnav" aria-label="主导航">
          <button className={pageMode === "learn" ? "active" : ""} onClick={() => setPageMode("learn")}>学习</button>
          <button className={pageMode === "practice" ? "active" : ""} onClick={() => setPageMode("practice")}>练习</button>
        </nav>
        <div className="accent-switch" aria-label="发音口音">
          <button className={accent === "en-GB" ? "active" : ""} onClick={() => setAccent("en-GB")}>英音</button>
          <button className={accent === "en-US" ? "active" : ""} onClick={() => setAccent("en-US")}>美音</button>
        </div>
      </header>

      <section className="hero" id="top" style={{ "--unit-color": unit.color } as React.CSSProperties}>
        <div className="hero-copy">
          <div className="eyebrow"><span>沪教牛津版</span> 八年级上册</div>
          <h1><span>Unit {unit.id}</span>{unit.title}</h1>
          <p>重点词汇、词组和句型一站式学习。中文释义逐条对照 PDF，支持英音 / 美音点读与慢速跟读。</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => { setPageMode("learn"); document.getElementById("study")?.scrollIntoView({ behavior: "smooth" }); }}>开始学习</button>
            <button className="secondary" onClick={() => { setPageMode("practice"); nextQuiz(); document.getElementById("study")?.scrollIntoView({ behavior: "smooth" }); }}>单词自测</button>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="book-card back-card"><span>phrase</span><b>重点词组</b></div>
          <div className="book-card front-card"><span>WORD OF THE DAY</span><b>{unit.vocab[0].term}</b><small>{unit.vocab[0].meaning}</small></div>
          <div className="spark spark-one">✦</div>
          <div className="spark spark-two">✦</div>
        </div>
      </section>

      <section className="stats-strip" aria-label="学习数据">
        <div><strong>8</strong><span>个单元</span></div>
        <div><strong>{totalWords}</strong><span>个重点词汇</span></div>
        <div><strong>{mastered.length}</strong><span>已掌握</span></div>
        <div><strong>{unit.sentences.length}</strong><span>本单元重点句</span></div>
      </section>

      <section className="units-section">
        <div className="section-heading">
          <div><span className="section-kicker">CONTENTS</span><h2>学习目录</h2></div>
          <p>选择单元，按自己的节奏逐个攻克</p>
        </div>
        <div className="unit-grid">
          {units.map((item) => (
            <button key={item.id} className={`unit-tile ${unitId === item.id ? "selected" : ""}`} onClick={() => changeUnit(item.id)} style={{ "--tile-color": item.color } as React.CSSProperties}>
              <span className="unit-number">{String(item.id).padStart(2, "0")}</span>
              <span><b>Unit {item.id}</b><small>{item.title}</small></span>
              <i>→</i>
            </button>
          ))}
        </div>
      </section>

      <section className="study-section" id="study">
        <div className="study-toolbar">
          <div>
            <span className="section-kicker">UNIT {unit.id}</span>
            <h2>{pageMode === "learn" ? "沉浸式学习" : "即时自测"}</h2>
          </div>
          {pageMode === "learn" && (
            <div className="content-tabs" role="tablist" aria-label="内容类型">
              <button className={contentMode === "words" ? "active" : ""} onClick={() => { setContentMode("words"); setSelectedIndex(0); }}>重点单词 <span>{unit.vocab.length}</span></button>
              <button className={contentMode === "phrases" ? "active" : ""} onClick={() => { setContentMode("phrases"); setSelectedIndex(0); }}>重点词组 <span>{unit.phrases.length}</span></button>
              <button className={contentMode === "sentences" ? "active" : ""} onClick={() => { setContentMode("sentences"); setSelectedIndex(0); }}>重点句型 <span>{unit.sentences.length}</span></button>
            </div>
          )}
        </div>

        {pageMode === "practice" ? (
          <div className="quiz-panel">
            <div className="quiz-head">
              <div><span>本轮成绩</span><strong>{quizScore.correct} / {quizScore.total}</strong></div>
              <button onClick={() => { setQuizScore({ correct: 0, total: 0 }); nextQuiz(); }}>重新开始</button>
            </div>
            {quiz ? (
              <div className="quiz-card">
                <span className="quiz-label">选出正确的中文释义</span>
                <div className="quiz-word-row">
                  <h3>{quiz.word.term}</h3>
                  <button className="round-sound" onClick={() => speak(quiz.word.term, accent)} aria-label={`朗读 ${quiz.word.term}`}>🔊</button>
                </div>
                <p className="phonetic">/{ipa[quiz.word.term] ?? "点击喇叭听发音"}/</p>
                <div className="quiz-options">
                  {quiz.choices.map((choice, index) => {
                    const correct = quizAnswer && choice === quiz.word.meaning;
                    const wrong = quizAnswer === choice && choice !== quiz.word.meaning;
                    return <button key={choice} className={`${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`} onClick={() => answerQuiz(choice)}><span>{String.fromCharCode(65 + index)}</span>{choice}</button>;
                  })}
                </div>
                {quizAnswer && <div className={`quiz-feedback ${quizAnswer === quiz.word.meaning ? "good" : "try"}`}>{quizAnswer === quiz.word.meaning ? "回答正确，很棒！" : `正确答案：${quiz.word.meaning}`}<button onClick={nextQuiz}>下一题 →</button></div>}
              </div>
            ) : (
              <div className="quiz-empty"><div>?</div><h3>准备好检验学习成果了吗？</h3><p>每题从当前单元随机抽取一个单词。</p><button className="primary" onClick={nextQuiz}>开始答题</button></div>
            )}
          </div>
        ) : contentMode === "sentences" ? (
          <div className="sentences-list">
            {unit.sentences.map((sentence, index) => (
              <article className="sentence-card" key={sentence.en}>
                <span className="sentence-index">{String(index + 1).padStart(2, "0")}</span>
                <div><p>{sentence.en}</p>{showChinese[index] && <blockquote>{sentence.zh}</blockquote>}</div>
                <div className="sentence-actions">
                  <button onClick={() => speak(sentence.en, accent)}>🔊 朗读</button>
                  <button onClick={() => setShowChinese((state) => ({ ...state, [index]: !state[index] }))}>{showChinese[index] ? "隐藏释义" : "查看释义"}</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="learning-layout">
            <aside className="word-directory">
              <div className="directory-head"><h3>{contentMode === "words" ? "单词目录" : "词组目录"}</h3><span>{contentMode === "words" ? filteredWords.length : unit.phrases.length} 项</span></div>
              {contentMode === "words" && <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }} placeholder="搜索英文或中文" /></label>}
              <div className="word-list">
                {(contentMode === "words" ? filteredWords : unit.phrases).map((item, index) => (
                  <button key={item.term} className={selectedIndex === index ? "active" : ""} onClick={() => setSelectedIndex(index)}>
                    <span className="list-index">{String(index + 1).padStart(2, "0")}</span>
                    <span><b>{item.term}</b><small>{item.meaning}</small></span>
                    <i>›</i>
                  </button>
                ))}
                {contentMode === "words" && filteredWords.length === 0 && <p className="no-result">没有找到匹配词汇</p>}
              </div>
            </aside>

            <article className="detail-panel" style={{ "--unit-color": unit.color } as React.CSSProperties}>
              {contentMode === "words" ? (
                <>
                  <div className="detail-main">
                    <div className="letter-art"><span>{selectedWord.term.slice(0, 1).toUpperCase()}</span><small>UNIT {unit.id}</small></div>
                    <div className="word-core">
                      <span className="detail-label">WORD DETAIL</span>
                      <h3>{selectedWord.term}</h3>
                      <div className="pronunciation-row">
                        <span>/{ipa[selectedWord.term] ?? "—"}/</span>
                        <button onClick={() => speak(selectedWord.term, accent, 0.88)}>🔊 标准</button>
                        <button onClick={() => speak(selectedWord.term, accent, 0.62)}>慢速</button>
                      </div>
                      <div className="meaning-line"><em>{selectedWord.pos}</em><strong>{selectedWord.meaning}</strong></div>
                    </div>
                    <button className={`master-button ${isMastered ? "done" : ""}`} onClick={toggleMastered}>{isMastered ? "✓ 已掌握" : "○ 标记掌握"}</button>
                  </div>
                  <div className="detail-grid">
                    <section>
                      <span className="card-icon">译</span><div><h4>教材释义</h4><p>{selectedWord.meaning}</p><small>与 PDF 原文保持一致</small></div>
                    </section>
                    <section>
                      <span className="card-icon">音</span><div><h4>跟读练习</h4><p>先听标准速度，再用慢速分辨音节和重音。</p><button className="text-button" onClick={() => speak(selectedWord.term, accent, 0.62)}>播放慢速发音 →</button></div>
                    </section>
                    <section className="wide-card">
                      <span className="card-icon">变</span><div><h4>词形变化</h4>{selectedWord.family?.length ? <ul>{selectedWord.family.map((item) => <li key={item}>{item}</li>)}</ul> : <p>PDF 本单元未列出该词的词形变化。</p>}</div>
                    </section>
                    <section className="wide-card spelling-card">
                      <span className="card-icon">默</span>
                      <SpellingModule
                        word={selectedWord}
                        accent={accent}
                        completed={spelled.includes(`${unit.id}:${selectedWord.term}`)}
                        onCorrect={markSpellingCorrect}
                      />
                    </section>
                    <section className="wide-card sentence-preview">
                      <span className="card-icon">句</span><div><h4>本单元重点句型</h4><p>{unit.sentences[0].en}</p><small>{unit.sentences[0].zh}</small><button className="text-button" onClick={() => speak(unit.sentences[0].en, accent)}>🔊 朗读整句</button></div>
                    </section>
                  </div>
                </>
              ) : (
                <>
                  <div className="detail-main phrase-main">
                    <div className="letter-art phrase-art"><span>PH</span><small>UNIT {unit.id}</small></div>
                    <div className="word-core">
                      <span className="detail-label">KEY PHRASE</span>
                      <h3>{selectedPhrase.term}</h3>
                      <div className="pronunciation-row"><button onClick={() => speak(selectedPhrase.term, accent, 0.88)}>🔊 标准</button><button onClick={() => speak(selectedPhrase.term, accent, 0.62)}>慢速</button></div>
                      <div className="meaning-line"><em>phrase</em><strong>{selectedPhrase.meaning}</strong></div>
                    </div>
                  </div>
                  <div className="detail-grid phrase-grid">
                    <section><span className="card-icon">义</span><div><h4>词组释义</h4><p>{selectedPhrase.meaning}</p><small>与 PDF 原文保持一致</small></div></section>
                    <section><span className="card-icon">法</span><div><h4>学习建议</h4><p>把词组作为一个整体记忆，并跟读三遍。</p><button className="text-button" onClick={() => speak(selectedPhrase.term, accent, 0.72)}>开始跟读 →</button></div></section>
                  </div>
                </>
              )}
              <div className="detail-footer"><button onClick={() => nextWord(-1)}>← 上一个</button><span>Unit {unit.id} · {contentMode === "words" ? `${masteredHere}/${unit.vocab.length} 已掌握` : `${selectedIndex + 1}/${unit.phrases.length}`}</span><button onClick={() => nextWord(1)}>下一个 →</button></div>
            </article>
          </div>
        )}
      </section>

      <footer><div className="brand"><span className="brand-mark">A+</span><span>八上英语学习舱</span></div><p>内容依据《新八上 U1–U8 重点词组、重点句型》整理 · 发音由设备英语语音引擎提供</p></footer>
    </main>
  );
}
