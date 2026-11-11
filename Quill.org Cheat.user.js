// ==UserScript==
// @name         Quill.org Cheat
// @namespace    https://github.com/yofriendfromschool1/quill-cheat
// @version      2.0.0
// @description  Answers, auto-pilot and always-active focus spoofing for every Quill.org tool: Connect, Grammar, Proofreader, Diagnostic, Reading for Evidence, Lessons and more.
// @author       Potassium_
// @match        https://quill.org/*
// @match        https://www.quill.org/*
// @match        https://*.quill.org/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=quill.org
// @grant        none
// @run-at       document-start
// @noframes
// @updateURL    https://github.com/yofriendfromschool1/quill-cheat/raw/main/Quill.org%20Cheat.user.js
// @downloadURL  https://github.com/yofriendfromschool1/quill-cheat/raw/main/Quill.org%20Cheat.user.js
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "2.0.0";
  const SETTINGS_KEY = "quill-cheat-settings-v2";
  const LEGACY_SETTINGS_KEY = "quill-cheat-settings";
  const ANSWER_CACHE_TTL = 6 * 60 * 60 * 1000;
  const API_TIMEOUT = 12000;

  const DEFAULT_SETTINGS = {
    answerDelayMin: 0,
    answerDelayMax: 0,
    alwaysActive: false,
    theme: "auto",
    collapsed: false,
    hidden: false,
    panelPos: null,
  };

  const TOOL_META = {
    connect: { label: "Connect", color: "#0f766e" },
    grammar: { label: "Grammar", color: "#15803d" },
    proofreader: { label: "Proofreader", color: "#b45309" },
    diagnostic: { label: "Diagnostic", color: "#7c3aed" },
    evidence: { label: "Evidence", color: "#0e7490" },
    lessons: { label: "Lessons", color: "#475569" },
    generic: { label: "Activity", color: "#334155" },
  };

  const NEVER_CLICK = /save\s*(and|&)?\s*exit|sign\s*(in|out|up)|log\s*(in|out)|skip to main|skip to passage|teacher|dashboard|menu|account|report|settings|delete|remove|back to|go back/i;
  const ADVANCE_RE = /^(next|continue|begin|start|start activity|start lesson|got it|i got it|move on|review|see results|view results|finish|complete|done|try again|skip)(\b.*)?$/i;
  const SUBMIT_RE = /get feedback|submit|check answer|check my answer|check work|grade|turn in|save answer|save and exit|finish activity/i;

  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      /* localStorage can be unavailable in private mode */
    }
  }

  function loadSettings() {
    let parsed = {};
    try {
      parsed = JSON.parse(safeStorageGet(SETTINGS_KEY) || "{}") || {};
    } catch (_) {
      parsed = {};
    }
    if (!Object.keys(parsed).length) {
      try {
        parsed = JSON.parse(safeStorageGet(LEGACY_SETTINGS_KEY) || "{}") || {};
      } catch (_) {
        parsed = {};
      }
    }
    return Object.assign({}, DEFAULT_SETTINGS, parsed);
  }

  let settings = loadSettings();

  function saveSettings() {
    safeStorageSet(SETTINGS_KEY, JSON.stringify(settings));
  }

  function clampSeconds(value) {
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(3600, Math.floor(n));
  }

  function sampleDelayMs() {
    const min = Math.max(0, Number(settings.answerDelayMin) || 0);
    const max = Math.max(min, Number(settings.answerDelayMax) || 0);
    if (max <= 0) return 0;
    return Math.floor((min + Math.random() * (max - min)) * 1000);
  }

  function $(selector, root) {
    try {
      return (root || document).querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  function $$(selector, root) {
    try {
      return Array.from((root || document).querySelectorAll(selector));
    } catch (_) {
      return [];
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    const cls = typeof el.className === "string" ? el.className : "";
    return /\bdisabled\b/i.test(cls);
  }

  function cleanText(value) {
    return String(value == null ? "" : value)
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripHtml(html) {
    if (!html) return "";
    const template = document.createElement("template");
    template.innerHTML = String(html);
    return cleanText(template.content.textContent || "");
  }

  function cleanAnswerText(value) {
    return cleanText(
      String(value == null ? "" : value)
        .replace(/<\/?[^>]+>/g, " ")
        .replace(/[{}]/g, "")
        .replace(/\s+([,.;:!?])/g, "$1")
    );
  }

  function normalized(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[^a-z0-9'%]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function words(value) {
    return cleanText(value).match(/[^\s]+/g) || [];
  }

  function wordKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^a-z0-9']/g, "");
  }

  function splitWords(value) {
    const raw = words(value);
    return {
      raw,
      keys: raw.map(wordKey),
    };
  }

  function truncate(value, length) {
    const text = cleanText(value);
    const max = length || 120;
    return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
      ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
      : m + ":" + String(s).padStart(2, "0");
  }

  function hostIsQuill() {
    const host = location.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "quill.org" && !host.endsWith(".quill.org")) return false;
    if (/^(cms|assets|blog|support|community|intercom|status)\./i.test(host)) return false;
    return true;
  }

  function readRoute() {
    const pathname = location.pathname || "/";
    const hash = location.hash || "";
    const rawHash = hash.replace(/^#\/?/, "");
    const queryIndex = rawHash.indexOf("?");
    const hashPath = queryIndex >= 0 ? rawHash.slice(0, queryIndex) : rawHash;
    const hashQuery = queryIndex >= 0 ? rawHash.slice(queryIndex + 1) : "";
    const hashParams = new URLSearchParams(hashQuery);
    const searchParams = new URLSearchParams(location.search || "");
    const segments = hashPath.split("/").filter(Boolean);
    const toolPath = (pathname.split("/").filter(Boolean)[0] || "").toLowerCase();

    function param() {
      for (let i = 0; i < arguments.length; i += 1) {
        const key = arguments[i];
        const fromHash = hashParams.get(key);
        if (fromHash) return fromHash;
        const fromSearch = searchParams.get(key);
        if (fromSearch) return fromSearch;
      }
      return null;
    }

    const uid = param("uid", "lesson_uid", "activity_uid");
    const activityId = param("activity_id", "activityId");
    const sessionId = param("session", "session_id", "activity_session_id");
    const lowerPath = (pathname + "/" + hashPath).toLowerCase();

    // Stay out of dashboards, libraries and marketing pages. Only activity
    // play routes (plus the Lessons customizer) get a panel.
    const isPlayRoute = /(^|\/)play($|\/)/.test(lowerPath);
    const isLessonCustomize = segments[0] === "customize" && toolPath === "lessons";
    if (!isPlayRoute && !isLessonCustomize && !/\/activity_sessions\//.test(lowerPath)) {
      return null;
    }

    let tool = null;
    let lessonId = null;

    if (/activity_sessions\/anonymous/.test(lowerPath)) {
      tool = "generic";
    } else if (segments[0] === "play") {
      const sub = segments[1];
      if (sub === "lesson") {
        tool = "connect";
        lessonId = segments[2] || uid;
      } else if (sub === "diagnostic") {
        tool = "diagnostic";
        lessonId = segments[2] || uid;
      } else if (sub === "pf" || sub === "proofreader") {
        tool = "proofreader";
        lessonId = uid || segments[2] || null;
      } else if (sub === "sw" || sub === "grammar") {
        tool = "grammar";
        lessonId = uid || segments[2] || null;
      } else if (sub === "class-lessons" || sub === "lessons") {
        tool = "lessons";
        lessonId = segments[2] || uid;
      } else if (toolPath === "evidence") {
        tool = "evidence";
        lessonId = uid || segments[2] || null;
      } else if (toolPath === "connect") {
        tool = "connect";
        lessonId = uid;
      } else if (toolPath === "diagnostic") {
        tool = "diagnostic";
        lessonId = uid;
      } else if (toolPath === "proofreader") {
        tool = "proofreader";
        lessonId = uid;
      } else if (toolPath === "grammar") {
        tool = "grammar";
        lessonId = uid;
      } else if (toolPath === "lessons") {
        tool = "lessons";
        lessonId = uid;
      }
    } else if (segments[0] === "customize" && toolPath === "lessons") {
      tool = "lessons";
      lessonId = segments[1] || uid;
    } else if (toolPath === "evidence" && (uid || segments.length)) {
      tool = "evidence";
      lessonId = uid || segments[segments.length - 1] || null;
    } else if (toolPath === "proofreader") {
      tool = "proofreader";
      lessonId = uid;
    } else if (toolPath === "grammar") {
      tool = "grammar";
      lessonId = uid;
    } else if (toolPath === "diagnostic") {
      tool = "diagnostic";
      lessonId = uid;
    } else if (toolPath === "connect") {
      tool = "connect";
      lessonId = uid;
    } else if (toolPath === "lessons") {
      tool = "lessons";
      lessonId = uid;
    }

    if (!tool && activityId) tool = "generic";
    if (!tool) return null;

    const results = /\/results\b|\/complete\b|\/finished\b/i.test(lowerPath) ||
      /your results are being saved|you(?:'|’)?ve completed|activity complete/i.test(document.body ? document.body.innerText : "");

    const signature = [tool, lessonId || "", uid || "", activityId || "", sessionId || "", hashPath, results ? "results" : ""].join("|");

    return {
      tool,
      lessonId,
      uid,
      activityId,
      sessionId,
      results,
      hashPath,
      signature,
      title: null,
    };
  }

  const jsonCache = new Map();
  const answerCache = new Map();

  function cacheGet(cache, key, ttl) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (ttl && Date.now() - entry.at > ttl) {
      cache.delete(key);
      return null;
    }
    return entry;
  }

  async function fetchJSON(url, options) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), (options && options.timeout) || API_TIMEOUT) : null;
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function cachedJSON(url, ttl) {
    const key = String(url);
    const cached = cacheGet(jsonCache, key, ttl || ANSWER_CACHE_TTL);
    if (cached) return cached.promise;
    const promise = fetchJSON(url).catch((error) => {
      jsonCache.delete(key);
      throw error;
    });
    jsonCache.set(key, { at: Date.now(), promise });
    return promise;
  }

  function apiPath(path) {
    return "/api/v1/" + String(path).replace(/^\/+/, "");
  }

  function getLesson(id) {
    return cachedJSON(apiPath("lessons/" + encodeURIComponent(id) + ".json"));
  }

  function getEvidenceActivity(id) {
    return cachedJSON(apiPath("evidence/activities/" + encodeURIComponent(id)));
  }

  function getGenericActivity(id) {
    return cachedJSON(apiPath("activities/" + encodeURIComponent(id) + ".json"));
  }

  function getQuestion(key) {
    return cachedJSON(apiPath("questions/" + encodeURIComponent(key) + ".json"));
  }

  function getCMSResponses(key) {
    return cachedJSON("https://cms.quill.org/questions/" + encodeURIComponent(key) + "/responses").catch(() => []);
  }

  function getCMSOptions(key) {
    return cachedJSON("https://cms.quill.org/questions/" + encodeURIComponent(key) + "/multiple_choice_options").catch(() => []);
  }

  function firstString() {
    for (let i = 0; i < arguments.length; i += 1) {
      const value = arguments[i];
      if (typeof value === "string" && value.trim()) return value;
    }
    return "";
  }

  function answerObjects(list, source) {
    if (!Array.isArray(list)) return [];
    const mapped = [];
    list.forEach((item) => {
      if (typeof item === "string") {
        const text = cleanAnswerText(item);
        if (text) mapped.push({ text, optimal: false, count: 0, source });
        return;
      }
      if (!item || typeof item !== "object") return;
      const text = cleanAnswerText(firstString(item.text, item.answer, item.value, item.label));
      if (!text) return;
      mapped.push({
        text,
        optimal: Boolean(item.optimal || item.correct || item.isCorrect),
        count: Number(item.count || item.usage_count || 0) || 0,
        source,
      });
    });
    return mapped;
  }

  function sortAnswers(list) {
    const seen = new Set();
    return list
      .filter((answer) => answer && answer.text)
      .sort((a, b) => {
        if (a.optimal !== b.optimal) return a.optimal ? -1 : 1;
        return (b.count || 0) - (a.count || 0);
      })
      .filter((answer) => {
        const key = normalized(answer.text);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  }

  function deriveAnswers(question, apiQuestion, responses, options) {
    let answers = [];
    answers = answers.concat(answerObjects(responses, "responses"));
    answers = answers.concat(answerObjects(options, "options"));
    if (apiQuestion) {
      answers = answers.concat(answerObjects(apiQuestion.answers, "api"));
      if (apiQuestion.correctText) {
        answers.push({
          text: cleanAnswerText(apiQuestion.correctText),
          optimal: true,
          count: 0,
          source: "api",
        });
      }
    }
    if (question && question.answers) answers = answers.concat(answerObjects(question.answers, "embedded"));
    return sortAnswers(answers);
  }

  function mapQuestionType(value, fallback) {
    const type = String(value || "").toLowerCase();
    if (type === "titlecards" || type === "title_cards") return "titleCard";
    if (type.indexOf("proofreader") >= 0) return "proofreader";
    if (type.indexOf("fill") >= 0) return "fillInBlank";
    if (type.indexOf("diagnostic") >= 0) return "sentence";
    if (type.indexOf("connect") >= 0 || type.indexOf("sentence") >= 0) return "sentence";
    if (type.indexOf("evidence") >= 0) return "evidence";
    return fallback || "sentence";
  }

  function pageCounter() {
    const expression = /(\d+)\s+of\s+(\d+)\s+questions?/i;
    const elements = $$("p, span, div, h1, h2, h3, h4");
    const limit = Math.min(elements.length, 1600);
    for (let i = 0; i < limit; i += 1) {
      const el = elements[i];
      if (!isVisible(el)) continue;
      const text = (el.textContent || "").trim();
      if (!text || text.length > 120) continue;
      const match = text.match(expression);
      if (match) {
        return { current: Number(match[1]), total: Number(match[2]) };
      }
    }
    return null;
  }

  function pageTitleFallback() {
    const parts = String(document.title || "").split("|");
    return cleanText(parts.length > 1 ? parts.slice(1).join("|") : parts[0]) || "Quill activity";
  }

  function normalizeLessonActivity(data, tool) {
    const title = cleanText(firstString(data && data.title, data && data.name)) || pageTitleFallback();
    const rawQuestions = Array.isArray(data && data.questions) ? data.questions : [];
    const questions = rawQuestions
      .filter((question) => question && question.key && mapQuestionType(question.questionType) !== "titleCard")
      .map((question, index) => ({
        index,
        key: question.key,
        type: mapQuestionType(question.questionType, tool === "grammar" ? "sentence" : "sentence"),
        prompt: cleanText(question.prompt || question.text || ""),
        answers: [],
        raw: question,
        loaded: false,
      }));

    const activity = {
      tool,
      title,
      questions,
      proofreader: null,
      evidence: null,
      teacherLed: false,
      raw: data,
    };

    if (tool === "proofreader") {
      const corrections = parseProofreaderPassage(data && data.passage);
      if (questions.length) {
        questions.forEach((question) => {
          question.type = "proofreader";
          question.corrections = corrections;
        });
      }
      activity.proofreader = {
        corrections,
        passage: data && data.passage ? data.passage : "",
        questions: rawQuestions,
      };
      activity.questions = [{
        index: 0,
        key: null,
        type: "proofreader",
        prompt: activity.title,
        corrections,
        answers: [],
        raw: data,
        loaded: true,
      }];
    }

    return activity;
  }

  function parseProofreaderPassage(passage) {
    if (!passage) return [];
    let decoded = String(passage);
    try {
      const template = document.createElement("template");
      template.innerHTML = decoded;
      decoded = template.content.textContent || decoded;
    } catch (_) {
      /* keep the raw passage if the template parser is unavailable */
    }
    const corrections = [];
    const expression = /\{\+([^{}]*)\}/g;
    let match;
    while ((match = expression.exec(decoded))) {
      let inner = cleanText(match[1]);
      if (inner.charAt(0) === "+") inner = inner.slice(1);
      const pipe = inner.indexOf("|");
      if (pipe >= 0) inner = inner.slice(0, pipe);
      const dash = inner.indexOf("-");
      if (dash <= 0) continue;
      const correct = cleanText(inner.slice(0, dash));
      const wrong = cleanText(inner.slice(dash + 1));
      if (correct && wrong) corrections.push({ correct, wrong });
    }
    return corrections;
  }

  async function proofreaderCorrectionsFromAPI(questions) {
    if (!Array.isArray(questions) || !questions.length) return [];
    const results = await Promise.allSettled(
      questions
        .filter((question) => question && question.key)
        .map((question) => getQuestion(question.key))
    );
    const corrections = [];
    results.forEach((result) => {
      if (result.status !== "fulfilled" || !result.value) return;
      const correct = cleanText(result.value.correctText);
      const wrong = cleanText(result.value.originalText);
      if (correct && wrong) corrections.push({ correct, wrong });
    });
    return corrections;
  }

  function normalizeEvidenceActivity(data) {
    const prompts = Array.isArray(data && data.prompts) ? data.prompts.slice() : [];
    prompts.sort((a, b) => Number(a && a.id ? a.id : 0) - Number(b && b.id ? b.id : 0));
    const title = cleanText(firstString(data && data.title, data && data.name)) || pageTitleFallback();
    const questions = prompts.map((prompt, index) => {
      const base = cleanText(firstString(prompt && prompt.plain_text, prompt && prompt.text)) || "Writing prompt";
      const answers = [];
      if (prompt && prompt.first_strong_example) {
        answers.push({
          text: cleanText(prompt.first_strong_example),
          optimal: true,
          count: 0,
          source: "evidence",
          label: "Strong example 1",
        });
      }
      if (prompt && prompt.second_strong_example) {
        answers.push({
          text: cleanText(prompt.second_strong_example),
          optimal: false,
          count: 0,
          source: "evidence",
          label: "Strong example 2",
        });
      }
      return {
        index,
        key: prompt && prompt.id ? String(prompt.id) : null,
        type: "evidence",
        prompt: base,
        base,
        conjunction: prompt && prompt.conjunction ? prompt.conjunction : "",
        answers,
        raw: prompt,
        loaded: true,
        maxAttempts: Number(prompt && prompt.max_attempts) || 5,
      };
    });
    return {
      tool: "evidence",
      title,
      questions,
      proofreader: null,
      evidence: { passages: data && data.passages ? data.passages : [], raw: data },
      teacherLed: false,
      raw: data,
    };
  }

  function normalizeGenericActivity(data, toolHint) {
    const activity = data && data.activity ? data.activity : data;
    const classification = activity && activity.classification ? activity.classification.key : toolHint;
    let tool = "generic";
    if (classification === "sentence") tool = "grammar";
    else if (classification === "connect") tool = "connect";
    else if (classification === "diagnostic") tool = "diagnostic";
    else if (classification === "passage") tool = "proofreader";
    else if (classification === "evidence") tool = "evidence";
    else if (toolHint) tool = toolHint;

    const title = cleanText(firstString(activity && activity.name, activity && activity.title)) || pageTitleFallback();
    const rawData = activity && activity.data ? activity.data : {};
    const rawQuestions = Array.isArray(rawData.questions) ? rawData.questions : [];

    if (tool === "proofreader" && rawData.passage) {
      return normalizeLessonActivity({
        title,
        passage: rawData.passage,
        questions: rawQuestions,
      }, "proofreader");
    }

    const questions = rawQuestions.map((question, index) => ({
      index,
      key: question && question.key ? question.key : null,
      type: mapQuestionType(question && question.questionType, tool === "grammar" ? "sentence" : "sentence"),
      prompt: cleanText(firstString(question && question.prompt, question && question.text, rawData.prompt)),
      answers: answerObjects(question && question.answers, "embedded"),
      raw: question,
      loaded: false,
    })).filter((question) => question.key || question.prompt || question.answers.length);

    return {
      tool,
      title,
      questions,
      proofreader: null,
      evidence: null,
      teacherLed: false,
      raw: data,
    };
  }

  async function loadActivity(context) {
    if (context.tool === "lessons") {
      return {
        tool: "lessons",
        title: pageTitleFallback(),
        questions: [],
        proofreader: null,
        evidence: null,
        teacherLed: true,
        raw: null,
      };
    }

    if (context.tool === "evidence") {
      const data = await getEvidenceActivity(context.uid || context.lessonId);
      return normalizeEvidenceActivity(data);
    }

    if (context.tool === "generic") {
      const id = context.activityId || context.uid;
      if (!id) throw new Error("No activity id in this URL");
      const data = await getGenericActivity(id);
      const activity = normalizeGenericActivity(data, context.tool);
      if (activity.tool === "evidence") {
        try {
          const evidenceData = await getEvidenceActivity(id);
          return normalizeEvidenceActivity(evidenceData);
        } catch (_) {
          /* fall back to the generic activity payload */
        }
      }
      return activity;
    }

    const id = context.lessonId || context.uid;
    if (!id) throw new Error("No lesson uid in this URL");
    const data = await getLesson(id);
    const activity = normalizeLessonActivity(data, context.tool);
    if (context.tool === "proofreader" && activity.proofreader) {
      if (!activity.proofreader.corrections.length && activity.proofreader.questions.length) {
        const corrections = await proofreaderCorrectionsFromAPI(activity.proofreader.questions);
        if (corrections.length) {
          activity.proofreader.corrections = corrections;
          activity.questions[0].corrections = corrections;
        }
      }
    }
    return activity;
  }

  async function loadQuestionData(question) {
    if (!question) return null;
    if (question.type === "proofreader" || question.type === "evidence") return question;
    if (question.loaded) return question;
    const cacheKey = question.key || ("prompt:" + normalized(question.prompt));
    const cached = cacheGet(answerCache, cacheKey, ANSWER_CACHE_TTL);
    if (cached) {
      Object.assign(question, cached.value);
      question.loaded = true;
      return cached.value;
    }

    const key = question.key;
    if (!key) {
      question.loaded = true;
      return question;
    }

    const [apiResult, responsesResult, optionsResult] = await Promise.allSettled([
      getQuestion(key),
      getCMSResponses(key),
      getCMSOptions(key),
    ]);

    const apiQuestion = apiResult.status === "fulfilled" ? apiResult.value : null;
    const responses = responsesResult.status === "fulfilled" ? responsesResult.value : [];
    const options = optionsResult.status === "fulfilled" ? optionsResult.value : [];

    const answers = deriveAnswers(question, apiQuestion, responses, options);
    const type = mapQuestionType(
      apiQuestion && (apiQuestion.question_type || apiQuestion.questionType),
      question.type
    );
    const result = {
      answers,
      prompt: question.prompt || stripHtml(apiQuestion && apiQuestion.prompt),
      type,
      correctText: cleanText(apiQuestion && apiQuestion.correctText),
      originalText: cleanText(apiQuestion && apiQuestion.originalText),
    };
    Object.assign(question, result);
    question.loaded = true;
    answerCache.set(cacheKey, { at: Date.now(), value: result });
    return result;
  }

  function prefetchAnswers(questions) {
    if (!Array.isArray(questions) || !questions.length) return;
    const targets = questions.filter((question) => question.key && !question.loaded).slice(0, 8);
    targets.forEach((question) => {
      loadQuestionData(question).catch(() => {});
    });
  }

  function inputScore(el) {
    if (!el || !isVisible(el) || isDisabled(el)) return -1;
    if (el.readOnly) return -1;
    const tag = el.tagName;
    if (tag !== "TEXTAREA" && tag !== "INPUT" && !el.isContentEditable) return -1;
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["hidden", "checkbox", "radio", "button", "submit", "file", "search", "email", "password", "number"].indexOf(type) >= 0) return -1;
    }
    const cls = typeof el.className === "string" ? el.className : "";
    const placeholder = (el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || "").toLowerCase();
    const identity = (el.id + " " + (el.getAttribute("name") || "") + " " + cls).toLowerCase();
    if (/search|login|email|password|coupon|promo/.test(identity + " " + placeholder)) return -1;

    let score = 0;
    if (/connect-text-area|fill-in-blank-input|student-editor|editor\b/.test(cls)) score += 30;
    if (/write|type|answer|response|sentence|blank/.test(placeholder + " " + identity)) score += 12;
    if (el.isContentEditable) score += 8;
    if (tag === "TEXTAREA") score += 6;
    if (tag === "INPUT") score += 3;
    if (/answer-box|response-box|prompt/.test(identity)) score += 4;
    return score;
  }

  function findBestInput() {
    const selectors = [
      ".connect-text-area",
      ".fill-in-blank-input",
      ".editor[contenteditable='true']",
      "textarea",
      "input[type='text']",
      "input:not([type])",
      "[contenteditable='true']",
    ];
    const all = [];
    const seen = new Set();
    selectors.forEach((selector) => {
      $$(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        all.push(el);
      });
    });
    let best = null;
    let bestScore = -1;
    all.forEach((el) => {
      const score = inputScore(el);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    });
    return bestScore >= 0 ? best : null;
  }

  function readInputValue(el) {
    if (!el) return "";
    if (el.isContentEditable) return cleanText(el.innerText || el.textContent || "");
    return cleanText(el.value || "");
  }

  function setNativeValue(el, value) {
    const tag = el.tagName;
    const prototype = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    if (el._valueTracker) {
      try {
        el._valueTracker.setValue("");
      } catch (_) {
        /* ignore React tracker differences */
      }
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function selectElementContents(el) {
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertIntoEditable(el, text, append) {
    const value = append ? cleanText((el.innerText || el.textContent || "") + " " + text) : text;
    el.focus();
    try {
      if (append) {
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        const inserted = document.execCommand("insertText", false, " " + text);
        if (!inserted) el.textContent = value;
      } else {
        selectElementContents(el);
        const inserted = document.execCommand("insertText", false, value);
        if (!inserted) el.textContent = value;
      }
    } catch (_) {
      el.textContent = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return value;
  }

  function insertIntoField(el, text) {
    if (!el) return false;
    if (el.isContentEditable) {
      insertIntoEditable(el, text, false);
    } else {
      el.focus();
      setNativeValue(el, text);
    }
    return true;
  }

  function findOptionButtons() {
    const selector = "button, [role='button'], [role='radio'], [role='option'], label, .answer-option, .choice";
    const seen = new Set();
    return $$(selector).filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      if (!isVisible(el) || isDisabled(el)) return false;
      if (el.closest("header, nav, [role='navigation']")) return false;
      const text = cleanText(el.textContent);
      if (!text || text.length > 260) return false;
      if (NEVER_CLICK.test(text) || SUBMIT_RE.test(text)) return false;
      if (ADVANCE_RE.test(text)) return false;
      return true;
    });
  }

  function optionScore(optionText, answerText) {
    const option = normalized(optionText);
    const answer = normalized(answerText);
    if (!option || !answer) return 0;
    if (option === answer) return 1;
    if (option.length >= 4 && answer.length >= 4 && (option.indexOf(answer) >= 0 || answer.indexOf(option) >= 0)) return 0.9;
    const optionWords = new Set(option.split(" ").filter(Boolean));
    const answerWords = answer.split(" ").filter(Boolean);
    if (!answerWords.length) return 0;
    let common = 0;
    answerWords.forEach((word) => {
      if (optionWords.has(word)) common += 1;
    });
    return common / Math.max(optionWords.size, answerWords.length);
  }

  function clickOptionMatching(answerText) {
    const options = findOptionButtons();
    let best = null;
    let bestScore = 0;
    options.forEach((option) => {
      const score = optionScore(option.textContent, answerText);
      if (score > bestScore) {
        bestScore = score;
        best = option;
      }
    });
    if (best && bestScore >= 0.6) {
      best.click();
      return true;
    }
    return false;
  }

  function findFitBInputs() {
    const direct = $$(".fill-in-blank-input").filter(isVisible);
    if (direct.length) return direct;
    return $$("input[type='text'], input:not([type])").filter((el) =>
      isVisible(el) && !isDisabled(el) && /blank/i.test((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("placeholder") || ""))
    );
  }

  function fitbPromptContainer(input) {
    return (input && input.closest(".fill-in-blank-prompt-container, .prompt, .student-editor")) ||
      $(".fill-in-blank-prompt-container") ||
      $(".prompt");
  }

  function lcsPairs(a, b) {
    const n = a.length;
    const m = b.length;
    if (!n || !m) return [];
    const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = 1; i <= n; i += 1) {
      for (let j = 1; j <= m; j += 1) {
        table[i][j] = a[i - 1] === b[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
    const pairs = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        pairs.push([i - 1, j - 1]);
        i -= 1;
        j -= 1;
      } else if (table[i - 1][j] >= table[i][j - 1]) {
        i -= 1;
      } else {
        j -= 1;
      }
    }
    return pairs.reverse();
  }

  function deriveBlankValues(container, inputs, answerText) {
    const count = Array.isArray(inputs) ? inputs.length : 0;
    if (!count) return [];
    const sentence = splitWords(answerText);
    if (!sentence.keys.length) return new Array(count).fill("");
    if (!container) {
      if (count === 1) return [cleanText(answerText)];
      return new Array(count).fill("");
    }

    let clone;
    try {
      clone = container.cloneNode(true);
    } catch (_) {
      return new Array(count).fill("");
    }
    clone.querySelectorAll("input, textarea, .fill-in-blank-input").forEach((el) => {
      el.replaceWith(document.createTextNode(" __QC_BLANK__ "));
    });
    const text = cleanText(clone.textContent);
    const parts = text.split(/__QC_BLANK__/);
    if (parts.length !== count + 1) {
      return new Array(count).fill("");
    }
    const segments = parts.map((part) => {
      const parsed = splitWords(part);
      const kept = [];
      parsed.raw.forEach((rawWord, index) => {
        const key = parsed.keys[index];
        // Punctuation-only tokens (like a comma right before a blank) have an
        // empty key. They are not real alignment anchors and must not shift
        // the blank boundaries.
        if (key) kept.push({ raw: rawWord, key });
      });
      return {
        raw: kept.map((item) => item.raw),
        keys: kept.map((item) => item.key),
      };
    });
    const promptKeys = [];
    segments.forEach((segment) => {
      segment.keys.forEach((key) => promptKeys.push(key));
    });
    const pairs = lcsPairs(promptKeys, sentence.keys);
    const mapping = new Map(pairs);
    const values = [];
    let promptIndex = 0;
    for (let i = 0; i < segments.length; i += 1) {
      promptIndex += segments[i].keys.length;
      if (i === segments.length - 1) break;
      const previousPrompt = promptIndex - 1;
      const nextPrompt = promptIndex;
      const previousSentence = previousPrompt >= 0 && mapping.has(previousPrompt) ? mapping.get(previousPrompt) : -1;
      const nextSentence = nextPrompt < promptKeys.length && mapping.has(nextPrompt) ? mapping.get(nextPrompt) : sentence.raw.length;
      const start = previousSentence + 1;
      const end = Math.max(start, nextSentence);
      let value = sentence.raw.slice(start, end).join(" ");
      value = value.replace(/^[,.;:!?]+|[,.;:!?]+$/g, "").trim();
      values.push(value);
    }

    if (count === 1 && !values[0]) {
      const promptSet = new Set(promptKeys);
      const leftovers = sentence.keys
        .map((key, index) => ({ key, index }))
        .filter((item) => item.key && !promptSet.has(item.key));
      if (leftovers.length) {
        values[0] = leftovers.map((item) => sentence.raw[item.index]).join(" ").replace(/[,.;:!?]+$/g, "");
      }
    }
    return values;
  }

  function fillFitB(answerText) {
    const inputs = findFitBInputs();
    if (!inputs.length) return false;
    const container = fitbPromptContainer(inputs[0]);
    const values = deriveBlankValues(container, inputs, answerText);
    inputs.forEach((input, index) => {
      input.focus();
      setNativeValue(input, values[index] || "");
      input.blur();
    });
    return true;
  }

  function isFitBPage() {
    return findFitBInputs().length > 0;
  }

  function visibleButtons() {
    return $$("button, [role='button'], input[type='button'], input[type='submit']").filter((el) => {
      if (!isVisible(el) || isDisabled(el)) return false;
      const text = cleanText(el.value || el.textContent);
      return text.length > 0 && text.length < 200;
    });
  }

  function findSubmitButton() {
    const buttons = visibleButtons();
    const preferred = buttons.filter((el) => {
      const text = cleanText(el.textContent || el.value);
      if (/save\s*(and|&)?\s*exit/i.test(text)) return false;
      return /get feedback|submit|check (my )?answer|check work|turn in|save answer|^done$/i.test(text);
    });
    return preferred[0] || null;
  }

  function findAdvanceButton() {
    const buttons = visibleButtons();
    for (let i = 0; i < buttons.length; i += 1) {
      const el = buttons[i];
      const text = cleanText(el.textContent || el.value);
      if (!text || NEVER_CLICK.test(text)) continue;
      if (ADVANCE_RE.test(text)) return el;
    }
    return null;
  }

  function clickSubmitButton() {
    const button = findSubmitButton();
    if (!button) return false;
    button.click();
    return true;
  }

  function clickAdvanceButton() {
    const button = findAdvanceButton();
    if (!button) return false;
    button.click();
    return true;
  }

  function clickLanguageButton() {
    const buttons = visibleButtons();
    const english = buttons.find((el) =>
      /\blanguage-button\b/i.test(typeof el.className === "string" ? el.className : "") &&
      /^english$/i.test(cleanText(el.textContent))
    );
    if (!english) return false;
    english.click();
    return true;
  }

  function activityComplete() {
    if (state.context && state.context.results) return true;
    const text = document.body ? document.body.innerText : "";
    return /your results are being saved|you(?:'|’)?ve completed|activity complete|lesson complete|nice work! you(?:'|’)?ve finished|your feedback was sent|thanks for sharing your feedback/i.test(text) ||
      /\/results\b|\/complete\b|\/finished\b/i.test(location.hash + location.pathname);
  }

  function surveyTick() {
    const container = $(".activity-survey-container");
    if (!container || !isVisible(container)) return false;
    const emojis = $$(".emoji-button").filter(isVisible);
    if (emojis.length) {
      const selectedEmoji = emojis.find((el) => /(^|\s)selected(\s|$)/i.test(typeof el.className === "string" ? el.className : ""));
      if (!selectedEmoji) {
        // Pick the happiest face; any answer just needs the survey finished.
        emojis[emojis.length - 1].click();
        return true;
      }
    }
    const options = $$(".multiple-choice-option").filter(isVisible);
    if (options.length) {
      const selectedOption = options.find((el) => /(^|\s)selected(\s|$)/i.test(typeof el.className === "string" ? el.className : ""));
      if (!selectedOption) {
        options[0].click();
        return true;
      }
    }
    // Quill's survey Send button keeps a cosmetic "disabled" class even when
    // it is clickable, so only trust the real disabled state here.
    const send = $$("button", container).find((el) =>
      isVisible(el) &&
      /^send$/i.test(cleanText(el.textContent || el.value)) &&
      !el.disabled &&
      el.getAttribute("aria-disabled") !== "true"
    );
    if (send) {
      send.click();
      return true;
    }
    return true;
  }

  function matchCorrection(text, corrections, used) {
    if (!corrections || !corrections.length) return null;
    const key = normalized(text);
    let fallback = null;
    for (let i = 0; i < corrections.length; i += 1) {
      if (!corrections[i] || used.has(i)) continue;
      const wrong = normalized(corrections[i].wrong);
      if (wrong && wrong === key) return { correction: corrections[i], index: i };
      if (!fallback && wrong && (wrong.indexOf(key) >= 0 || key.indexOf(wrong) >= 0)) {
        fallback = { correction: corrections[i], index: i };
      }
    }
    if (fallback) return fallback;
    for (let i = 0; i < corrections.length; i += 1) {
      if (!used.has(i)) return { correction: corrections[i], index: i };
    }
    return null;
  }

  function allProofreaderUnderlined() {
    return $$(".edit-input.underlined, .edit-input").filter((el) => {
      const cls = typeof el.className === "string" ? el.className : "";
      return isVisible(el) && /\bunderlined\b/i.test(cls);
    });
  }

  function proofreaderSpans() {
    return allProofreaderUnderlined().filter((el) => {
      const cls = typeof el.className === "string" ? el.className : "";
      return !/\b(bolded|edited)\b/i.test(cls);
    });
  }

  function correctionForSpan(span, corrections) {
    if (!corrections || !corrections.length) return null;
    const all = allProofreaderUnderlined();
    const index = all.indexOf(span);
    if (index >= 0 && index < corrections.length) {
      return { correction: corrections[index], index };
    }
    return matchCorrection(span.textContent, corrections, new Set());
  }

  function applyProofreaderCorrection(span, correct) {
    if (!span || !correct) return false;
    span.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, correct);
    } catch (_) {
      inserted = false;
    }
    if (!inserted) span.textContent = correct;
    span.dispatchEvent(new Event("input", { bubbles: true }));
    span.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      span.blur();
    } catch (_) {
      /* ignore */
    }
    try {
      span.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    } catch (_) {
      /* FocusEvent may be unavailable in very old engines */
    }
    return true;
  }

  async function applyAllProofreaderCorrections() {
    const question = state.current && state.current.question;
    const corrections = question && question.corrections ? question.corrections : [];
    let applied = 0;
    for (let guard = 0; guard < 40; guard += 1) {
      const span = proofreaderSpans()[0];
      if (!span) break;
      const match = correctionForSpan(span, corrections);
      if (!match) break;
      applyProofreaderCorrection(span, match.correction.correct);
      applied += 1;
      // Wait for React to mark the word as bolded before touching the next one.
      for (let wait = 0; wait < 12; wait += 1) {
        const cls = typeof span.className === "string" ? span.className : "";
        if (!span.isConnected || /\b(bolded|edited)\b/i.test(cls)) break;
        await sleep(35);
      }
    }
    return applied;
  }

  function proofreaderProgress() {
    const match = (document.body ? document.body.innerText : "").match(/(\d+)\s+of\s+(\d+)\s+edits?\s+made/i);
    return match ? { made: Number(match[1]), total: Number(match[2]) } : null;
  }

  function proofreaderReviewButton() {
    const progress = proofreaderProgress();
    if (!progress || progress.total <= 0 || progress.made < progress.total) return null;
    const text = document.body ? document.body.innerText : "";
    if (!/found\s+\d+\s+of\s+\d+\s+errors|let(?:'|’)?s review your edits/i.test(text)) return null;
    return visibleButtons().find((el) => /^review$/i.test(cleanText(el.textContent || el.value))) || null;
  }

  function proofreaderReviewState() {
    const tooltip = $$(".edit-tooltip").filter(isVisible)[0];
    if (!tooltip) return null;
    const buttons = $$("button", tooltip).filter(isVisible);
    const counter = tooltip.innerText.match(/(\d+)\s+of\s+(\d+)/);
    return {
      tooltip,
      done: buttons.find((el) => /^done$/i.test(cleanText(el.textContent))) || null,
      next: buttons.find((el) => /^next$/i.test(cleanText(el.textContent))) || null,
      back: buttons.find((el) => /^back$/i.test(cleanText(el.textContent))) || null,
      index: counter ? Number(counter[1]) : 0,
      total: counter ? Number(counter[2]) : 0,
    };
  }

  function evidencePromptQuestion() {
    if (!state.activity || !state.activity.questions || !state.activity.questions.length) return null;
    const containers = $$("[id^='prompt-editor-']").filter(isVisible);
    for (let i = 0; i < containers.length; i += 1) {
      const container = containers[i];
      const idMatch = String(container.id || "").match(/^prompt-editor-(.+)$/);
      if (!idMatch) continue;
      const editor = container.querySelector(".editor[contenteditable='true'], .editor");
      if (!editor || !isVisible(editor)) continue;
      const key = idMatch[1];
      const question = state.activity.questions.find((item) => String(item.key) === String(key));
      if (question) return { question, editor, container };
    }
    return null;
  }

  function findEvidenceEditor() {
    const matched = evidencePromptQuestion();
    if (matched) return matched.editor;
    const direct = $$(".editor[contenteditable='true'], .editor").filter(isVisible);
    if (direct.length) return direct[0];
    return null;
  }

  function evidenceQuestionForEditor(editor) {
    if (!state.activity || !state.activity.questions || !state.activity.questions.length) return null;
    const matched = evidencePromptQuestion();
    if (matched && (!editor || matched.editor === editor || matched.container.contains(editor))) {
      return matched.question;
    }
    if (!editor) return state.current ? state.current.question : null;
    const editorText = normalized(editor.innerText || editor.textContent || "");
    let best = null;
    let bestLength = 0;
    state.activity.questions.forEach((question) => {
      const prompt = normalized(question.base || question.prompt || "");
      if (!prompt) return;
      let score = 0;
      if (editorText.indexOf(prompt) >= 0) {
        score = prompt.length + 1000;
      } else {
        // The three prompts share a long stem and differ only by their
        // conjunction. Match the distinctive tail instead of the shared prefix.
        const tail = prompt.slice(-48);
        if (tail.length >= 12 && editorText.indexOf(tail) >= 0) score = tail.length;
      }
      if (score > bestLength) {
        best = question;
        bestLength = score;
      }
    });
    if (best) return best;
    if (state.current && state.current.question && state.current.question.type === "evidence") {
      return state.current.question;
    }
    return state.activity.questions[0];
  }

  function evidenceTextFor(question, answer) {
    const base = cleanText((question && (question.base || question.prompt)) || "");
    const suffix = cleanText(answer);
    if (!base) return suffix;
    if (!suffix) return base;
    return base.replace(/[,.;:!?]+$/, "") + " " + suffix;
  }

  function evidenceAnswerUsed(question, editorText) {
    if (!question || !question.answers) return -1;
    const haystack = normalized(editorText);
    for (let i = 0; i < question.answers.length; i += 1) {
      const answer = normalized(question.answers[i].text);
      if (answer && haystack.indexOf(answer) >= 0) return i;
    }
    return -1;
  }

  function writeEvidenceAnswer(question, answerIndex, editorOverride) {
    if (!question || !question.answers || !question.answers.length) return false;
    const promptMatch = evidencePromptQuestion();
    if (promptMatch && String(promptMatch.question.key) !== String(question.key)) return false;
    const editor = editorOverride || (promptMatch ? promptMatch.editor : findEvidenceEditor());
    if (!editor || !isVisible(editor)) return false;
    const index = Math.min(Math.max(0, answerIndex || 0), question.answers.length - 1);
    const text = evidenceTextFor(question, question.answers[index].text);
    insertIntoEditable(editor, text, false);
    state.evidenceAnswerIndex = index;
    state.evidenceLastEditorText = "";
    return true;
  }

  function evidenceActiveContainer() {
    const matched = evidencePromptQuestion();
    if (matched) return matched.container.closest(".active-content-container") || matched.container;
    return $(".active-content-container");
  }

  function evidenceAttempts() {
    const container = evidenceActiveContainer();
    const el = container && container.querySelector(".number-of-attempts");
    if (!el) return null;
    const value = parseInt(cleanText(el.textContent), 10);
    return Number.isFinite(value) ? value : null;
  }

  function evidenceSubmitButton() {
    const container = evidenceActiveContainer();
    if (!container) return null;
    const buttons = $$("button, [role='button'], input[type='submit']", container).filter((el) => isVisible(el) && !isDisabled(el));
    return buttons.find((el) => /^get feedback$/i.test(cleanText(el.textContent || el.value))) || null;
  }

  function evidenceNextButton() {
    const container = evidenceActiveContainer();
    if (!container) return null;
    const buttons = $$("button, [role='button']", container).filter((el) => isVisible(el) && !isDisabled(el));
    return buttons.find((el) => /^(next|done|continue|finish)$/i.test(cleanText(el.textContent))) || null;
  }

  function evidenceHighlights() {
    return $$("mark.highlightable, mark[role='button'], .highlightable").filter(isVisible);
  }

  function requiredHighlightCount() {
    const text = document.body ? document.body.innerText : "";
    const match = text.match(/highlight\s+(\d+|one|two|three|four|five|six)\s+(?:sentences?|phrases?|details?|pieces?|examples?)/i);
    if (match) {
      const numbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
      const value = match[1].toLowerCase();
      return numbers[value] || Number(value) || 0;
    }
    return 0;
  }

  function selectedHighlightCount() {
    return evidenceHighlights().filter((mark) => mark.getAttribute("aria-pressed") === "true" || /selected/i.test(mark.className)).length;
  }

  function scrollEvidenceToEnd() {
    const end = $("#end-of-passage, .end-of-passage, #end-of-activity");
    if (end) {
      end.scrollIntoView({ block: "end", behavior: "auto" });
    } else {
      window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
    }
    document.dispatchEvent(new Event("scroll", { bubbles: true }));
    window.dispatchEvent(new Event("scroll"));
  }

  function doneButtonEnabled() {
    const button = visibleButtons().find((el) => /^done$/i.test(cleanText(el.textContent || el.value)));
    return Boolean(button && !isDisabled(button));
  }

  let panelHost = null;
  let shadowRoot = null;
  let panel = null;
  let panelBody = null;
  let panelSettings = null;
  let toastEl = null;
  let toastTimer = null;
  let dragState = null;

  const state = {
    context: null,
    activity: null,
    activityError: "",
    loadingActivity: false,
    loadingQuestion: false,
    current: null,
    questionToken: "",
    questionIndex: 0,
    evidenceIndex: 0,
    evidenceAnswerIndex: 0,
    attempts: 0,
    questionStartedAt: Date.now(),
    quizStartedAt: Date.now(),
    finishedAt: 0,
    delayMs: 0,
    statusText: "Ready",
    statusTone: "idle",
    syncBusy: false,
    autoPilot: false,
    autoPilotTimer: null,
    routeTimer: null,
    tickTimer: null,
    observer: null,
    observerTimer: null,
    lastRenderKey: "",
    lastRouteCheck: 0,
    evidenceScrolled: false,
    evidenceSubmittedFor: -1,
    evidencePromptKey: "",
    evidenceReadyAt: 0,
    evidenceLastEditorText: "",
    evidenceSubmittedText: "",
    evidenceSubmittedExample: -1,
    evidenceAttemptsSeen: null,
    evidenceFeedbackPending: false,
    evidenceSubmittedAt: 0,
    evidenceWaitTicks: 0,
  };

  const PANEL_CSS = `
    :host {
      all: initial;
      --qc-bg: #ffffff;
      --qc-bg-soft: #f6f8f7;
      --qc-bg-raised: #ffffff;
      --qc-text: #17211e;
      --qc-muted: #64736e;
      --qc-line: #dce5e1;
      --qc-accent: #0f766e;
      --qc-accent-strong: #0b5d56;
      --qc-accent-soft: #e5f4f0;
      --qc-warn: #b45309;
      --qc-danger: #b91c1c;
      --qc-shadow: 0 18px 50px rgba(13, 42, 36, 0.18), 0 2px 8px rgba(13, 42, 36, 0.08);
      --qc-radius: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--qc-text);
      font-size: 13px;
      line-height: 1.4;
      position: fixed;
      left: 0;
      top: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
      pointer-events: none;
    }

    :host([data-theme="dark"]) {
      --qc-bg: #111917;
      --qc-bg-soft: #17221f;
      --qc-bg-raised: #1b2925;
      --qc-text: #e8f2ee;
      --qc-muted: #95aaa2;
      --qc-line: #2b3c36;
      --qc-accent: #2dd4bf;
      --qc-accent-strong: #5eead4;
      --qc-accent-soft: #123a34;
      --qc-warn: #fbbf24;
      --qc-danger: #f87171;
      --qc-shadow: 0 20px 54px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35);
    }

    *, *::before, *::after { box-sizing: border-box; }

    .qc-panel {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 374px;
      max-width: calc(100vw - 24px);
      background: var(--qc-bg);
      color: var(--qc-text);
      border: 1px solid var(--qc-line);
      border-radius: var(--qc-radius);
      box-shadow: var(--qc-shadow);
      overflow: hidden;
      pointer-events: auto;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: box-shadow 160ms ease, width 160ms ease, opacity 160ms ease;
    }

    .qc-panel:hover { box-shadow: 0 22px 58px rgba(13, 42, 36, 0.24), 0 2px 8px rgba(13, 42, 36, 0.1); }
    .qc-panel.dragging { transition: none; user-select: none; }

    .qc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 10px 9px 12px;
      background: linear-gradient(135deg, var(--qc-accent) 0%, var(--qc-accent-strong) 100%);
      color: #ffffff;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    .qc-panel.dragging .qc-header { cursor: grabbing; }
    .qc-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .qc-logo {
      width: 24px; height: 24px; border-radius: 8px;
      display: grid; place-items: center;
      background: rgba(255, 255, 255, 0.17);
      border: 1px solid rgba(255, 255, 255, 0.26);
      font-weight: 900; font-size: 13px; letter-spacing: -0.5px;
      flex: 0 0 auto;
    }
    .qc-brand-text { min-width: 0; }
    .qc-title { font-weight: 800; font-size: 13px; letter-spacing: 0.1px; line-height: 1.15; }
    .qc-sub { font-size: 10.5px; opacity: 0.84; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 182px; line-height: 1.3; margin-top: 1px; }
    .qc-head-actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
    .qc-hbtn {
      appearance: none; border: 1px solid rgba(255, 255, 255, 0.24);
      background: rgba(255, 255, 255, 0.11); color: #fff;
      border-radius: 7px; height: 24px; min-width: 27px; padding: 0 7px;
      font: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      transition: background 120ms ease, transform 120ms ease, border-color 120ms ease;
    }
    .qc-hbtn:hover { background: rgba(255, 255, 255, 0.23); border-color: rgba(255, 255, 255, 0.42); }
    .qc-hbtn:active { transform: scale(0.96); }
    .qc-hbtn.active { background: #ffffff; color: var(--qc-accent-strong); border-color: #ffffff; }
    .qc-hbtn.icon-only { width: 25px; padding: 0; font-size: 14px; }
    .qc-collapse-arrow { display: inline-block; transition: transform 160ms ease; }
    .qc-panel.collapsed .qc-collapse-arrow { transform: rotate(180deg); }

    .qc-body {
      max-height: min(46vh, 380px);
      overflow-y: auto;
      overflow-x: hidden;
      padding: 11px 12px 12px;
      background: var(--qc-bg);
      overscroll-behavior: contain;
    }
    .qc-body::-webkit-scrollbar { width: 6px; }
    .qc-body::-webkit-scrollbar-track { background: transparent; }
    .qc-body::-webkit-scrollbar-thumb { background: var(--qc-line); border-radius: 999px; }

    .qc-panel.collapsed .qc-body,
    .qc-panel.collapsed .qc-footer,
    .qc-panel.collapsed .qc-settings { display: none; }
    .qc-panel.collapsed { width: 286px; }

    .qc-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
    .qc-badge {
      display: inline-flex; align-items: center; gap: 5px;
      border-radius: 999px; padding: 2px 8px; font-size: 10px; font-weight: 800;
      letter-spacing: 0.4px; text-transform: uppercase;
      background: var(--qc-accent-soft); color: var(--qc-accent-strong);
      border: 1px solid var(--qc-line);
      white-space: nowrap;
    }
    .qc-count { font-size: 11px; color: var(--qc-muted); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .qc-activity { font-size: 12px; color: var(--qc-text); font-weight: 700; margin: 0 0 5px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .qc-prompt {
      margin: 0 0 10px; padding: 8px 9px; border-radius: 9px;
      background: var(--qc-bg-soft); border: 1px solid var(--qc-line);
      color: var(--qc-muted); font-size: 11.5px; line-height: 1.45;
      max-height: 86px; overflow-y: auto;
    }
    .qc-prompt strong { color: var(--qc-text); }
    .qc-section-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 6px; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; color: var(--qc-muted); }

    .qc-answer {
      width: 100%; text-align: left; appearance: none;
      border: 1px solid var(--qc-line); background: var(--qc-bg-raised);
      color: var(--qc-text); border-radius: 9px; padding: 8px 10px;
      cursor: pointer; font: inherit; font-size: 12px; line-height: 1.4;
      display: flex; flex-direction: column; gap: 3px; margin: 0 0 6px;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }
    .qc-answer:hover { border-color: var(--qc-accent); background: var(--qc-accent-soft); transform: translateX(2px); }
    .qc-answer:active { transform: translateX(1px) scale(0.997); }
    .qc-answer.optimal { border-left: 3px solid var(--qc-accent); }
    .qc-answer-top { display: flex; align-items: center; gap: 6px; }
    .qc-answer-label { font-size: 9px; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; color: var(--qc-accent-strong); }
    .qc-answer-text { color: var(--qc-text); word-break: break-word; }
    .qc-answer-meta { font-size: 9.5px; color: var(--qc-muted); }

    .qc-correction { cursor: pointer; }
    .qc-correction-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .qc-wrong { color: var(--qc-danger); text-decoration: line-through; text-decoration-thickness: 1px; }
    .qc-arrow { color: var(--qc-muted); }
    .qc-correct { color: var(--qc-accent-strong); font-weight: 800; }

    .qc-message { padding: 12px 10px; border-radius: 9px; background: var(--qc-bg-soft); border: 1px dashed var(--qc-line); color: var(--qc-muted); font-size: 11.5px; line-height: 1.5; text-align: center; }
    .qc-message.warn { color: var(--qc-warn); border-color: color-mix(in srgb, var(--qc-warn) 45%, var(--qc-line)); }
    .qc-message.error { color: var(--qc-danger); }
    .qc-message strong { color: var(--qc-text); }

    .qc-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .qc-action {
      appearance: none; border: 1px solid var(--qc-line); background: var(--qc-bg-soft);
      color: var(--qc-text); border-radius: 7px; padding: 6px 9px;
      font: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
    }
    .qc-action:hover { background: var(--qc-accent-soft); border-color: var(--qc-accent); }
    .qc-action:active { transform: scale(0.98); }
    .qc-action.primary { background: var(--qc-accent); border-color: var(--qc-accent); color: #fff; }
    .qc-action.primary:hover { background: var(--qc-accent-strong); border-color: var(--qc-accent-strong); }
    .qc-action.danger { color: var(--qc-danger); border-color: color-mix(in srgb, var(--qc-danger) 40%, var(--qc-line)); }
    .qc-action:disabled { opacity: 0.5; cursor: default; transform: none; }

    .qc-skeleton { display: grid; gap: 6px; padding: 2px 0 4px; }
    .qc-skeleton-line { height: 11px; border-radius: 4px; background: linear-gradient(90deg, var(--qc-bg-soft) 0%, var(--qc-line) 48%, var(--qc-bg-soft) 100%); background-size: 220% 100%; animation: qc-shimmer 1.15s ease-in-out infinite; }
    .qc-skeleton-line.short { width: 64%; }
    @keyframes qc-shimmer { 0% { background-position: 180% 0; } 100% { background-position: -60% 0; } }

    .qc-settings {
      display: none; padding: 10px 12px 11px;
      border-top: 1px solid var(--qc-line); background: var(--qc-bg-soft);
      font-size: 11px;
    }
    .qc-settings.open { display: block; }
    .qc-settings-title { font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; color: var(--qc-muted); margin-bottom: 7px; }
    .qc-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 7px 0; color: var(--qc-text); }
    .qc-row label { flex: 1; font-weight: 600; }
    .qc-row input[type="number"], .qc-row select {
      width: 82px; border: 1px solid var(--qc-line); background: var(--qc-bg);
      color: var(--qc-text); border-radius: 6px; padding: 4px 7px; font: inherit; font-size: 11px;
    }
    .qc-row input[type="checkbox"] { width: 15px; height: 15px; accent-color: var(--qc-accent); cursor: pointer; }
    .qc-row.check { cursor: pointer; user-select: none; }
    .qc-note { color: var(--qc-muted); font-size: 10px; line-height: 1.45; margin: 7px 0 0; }
    .qc-note kbd { font: inherit; font-size: 9.5px; border: 1px solid var(--qc-line); border-radius: 4px; padding: 0 3px; background: var(--qc-bg); }
    .qc-settings-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

    .qc-footer {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 6px 12px; border-top: 1px solid var(--qc-line);
      background: var(--qc-bg-soft); color: var(--qc-muted);
      font-size: 10px; font-weight: 600; line-height: 1.3;
    }
    .qc-status-wrap { display: flex; align-items: center; gap: 5px; min-width: 0; }
    .qc-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--qc-muted); flex: 0 0 auto; }
    .qc-dot.ready { background: var(--qc-accent); }
    .qc-dot.busy { background: var(--qc-warn); animation: qc-pulse 1s ease-in-out infinite; }
    .qc-dot.error { background: var(--qc-danger); }
    .qc-status { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px; }
    .qc-timers { display: flex; gap: 8px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    @keyframes qc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

    .qc-toast {
      position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%) translateY(8px);
      background: #102a25; color: #f5fffc; border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 9px; padding: 8px 13px; font-size: 11.5px; font-weight: 700;
      box-shadow: 0 12px 35px rgba(0, 0, 0, 0.28); opacity: 0; pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease; max-width: min(88vw, 420px);
      text-align: center; z-index: 2;
    }
    .qc-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .qc-toast.error { background: #3b1111; color: #ffe9e9; }
    .qc-toast.success { background: #0c352c; color: #eafff8; }
    .qc-toast.warn { background: #3b2a0b; color: #fff6de; }

    .qc-badge.tool { background: var(--qc-accent-soft); }

    @media (max-width: 520px) {
      .qc-panel { right: 10px !important; bottom: 10px !important; left: auto !important; top: auto !important; width: calc(100vw - 20px); }
      .qc-panel.collapsed { width: min(286px, calc(100vw - 20px)); }
      .qc-sub { max-width: 140px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .qc-panel, .qc-answer, .qc-hbtn, .qc-action, .qc-toast, .qc-collapse-arrow { transition: none !important; }
      .qc-skeleton-line, .qc-dot.busy { animation: none !important; }
    }
  `;

  function createElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function resolveTheme() {
    if (settings.theme === "light") return "light";
    if (settings.theme === "dark") return "dark";
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (_) {
      return "light";
    }
  }

  function applyTheme() {
    if (panelHost) panelHost.setAttribute("data-theme", resolveTheme());
  }

  function ensurePanel() {
    if (panelHost) return panelHost;
    if (!document.documentElement) return null;

    panelHost = document.createElement("div");
    panelHost.id = "quill-cheat-root";
    document.documentElement.appendChild(panelHost);
    shadowRoot = panelHost.attachShadow ? panelHost.attachShadow({ mode: "open" }) : null;

    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    const mount = shadowRoot || panelHost;
    mount.appendChild(style);

    panel = createElement("div", "qc-panel");
    panel.innerHTML = `
      <div class="qc-header">
        <div class="qc-brand">
          <span class="qc-logo">Q</span>
          <div class="qc-brand-text">
            <div class="qc-title">Quill Cheat</div>
            <div class="qc-sub">Detecting activity\u2026</div>
          </div>
        </div>
        <div class="qc-head-actions">
          <button type="button" class="qc-hbtn" data-action="auto" title="Answer this question (Alt+Shift+A)">\u26a1 Auto</button>
          <button type="button" class="qc-hbtn" data-action="loop" title="Auto-pilot through the whole activity (Alt+Shift+L)">\ud83e\udd16 Loop</button>
          <button type="button" class="qc-hbtn icon-only" data-action="settings" title="Settings" aria-label="Settings">\u2699</button>
          <button type="button" class="qc-hbtn icon-only" data-action="collapse" title="Collapse or expand (Alt+Shift+H)" aria-label="Collapse">\u25be</button>
        </div>
      </div>
      <div class="qc-body"></div>
      <div class="qc-settings">
        <div class="qc-settings-title">Loop settings</div>
        <div class="qc-row"><label for="qc-delay-min">Time on question min (s)</label><input id="qc-delay-min" type="number" min="0" max="3600" step="1"></div>
        <div class="qc-row"><label for="qc-delay-max">Time on question max (s)</label><input id="qc-delay-max" type="number" min="0" max="3600" step="1"></div>
        <label class="qc-row check"><span>Always-active tab</span><input id="qc-always" type="checkbox"></label>
        <div class="qc-row"><label for="qc-theme">Theme</label><select id="qc-theme"><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
        <p class="qc-note">Always-active overrides visibility, focus and user-activation APIs, blocks blur/visibility signals and sends a background heartbeat every 2 seconds. Time on question adds a random delay per question so the loop looks human.</p>
        <p class="qc-note"><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> answer \u00b7 <kbd>L</kbd> loop \u00b7 <kbd>H</kbd> collapse \u00b7 <kbd>Q</kbd> show/hide panel</p>
        <div class="qc-settings-actions">
          <button type="button" class="qc-action" data-action="reset">Reset defaults</button>
          <button type="button" class="qc-action" data-action="reset-pos">Reset position</button>
        </div>
      </div>
      <div class="qc-footer">
        <div class="qc-status-wrap"><span class="qc-dot"></span><span class="qc-status">Ready</span></div>
        <div class="qc-timers"><span>Quiz <span class="qc-quiz-time">0:00</span></span><span>Q <span class="qc-q-time">0:00</span></span></div>
      </div>
      <div class="qc-toast"></div>
    `;
    mount.appendChild(panel);

    panelBody = panel.querySelector(".qc-body");
    panelSettings = panel.querySelector(".qc-settings");
    toastEl = panel.querySelector(".qc-toast");

    if (settings.hidden) panel.style.display = "none";
    panel.classList.toggle("collapsed", Boolean(settings.collapsed));
    syncPanelSettings();
    applyTheme();
    applyPanelPosition();
    bindPanelEvents();
    updateLoopButton();
    updateTimerDisplay();

    try {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      if (media && media.addEventListener) {
        media.addEventListener("change", () => {
          if (settings.theme === "auto") applyTheme();
        });
      }
    } catch (_) {
      /* old browser without matchMedia events */
    }

    window.addEventListener("resize", () => {
      if (!settings.panelPos) applyPanelPosition();
      else clampPanelPosition();
    });

    return panelHost;
  }

  function bindPanelEvents() {
    if (!panel || panel.__qcBound) return;
    panel.__qcBound = true;

    panel.querySelector(".qc-header").addEventListener("click", (event) => {
      if (dragState && dragState.moved) return;
      if (event.target.closest("button")) return;
      toggleCollapsed();
    });

    panel.addEventListener("click", (event) => {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      const action = actionEl.getAttribute("data-action");
      if (action === "auto") {
        event.stopPropagation();
        autoAnswerNow();
      } else if (action === "loop") {
        event.stopPropagation();
        toggleAutoPilot();
      } else if (action === "settings") {
        event.stopPropagation();
        panelSettings.classList.toggle("open");
      } else if (action === "collapse") {
        event.stopPropagation();
        toggleCollapsed();
      } else if (action === "reset") {
        event.stopPropagation();
        resetSettings();
      } else if (action === "reset-pos") {
        event.stopPropagation();
        settings.panelPos = null;
        saveSettings();
        applyPanelPosition();
        showToast("Panel position reset");
      } else if (action === "fix-all") {
        event.stopPropagation();
        applyAllProofreaderCorrections().then((applied) => {
          showToast(applied ? "Fixed " + applied + " correction" + (applied === 1 ? "" : "s") : "No underlined words found");
          if (applied) setTimeout(() => clickSubmitButton(), 250);
        });
      } else if (action === "fill-blanks") {
        event.stopPropagation();
        const question = state.current && state.current.question;
        const answer = question && question.answers && question.answers[0];
        if (answer && fillFitB(answer.text)) {
          showToast("Blanks filled");
          setTimeout(() => clickSubmitButton(), 160);
        } else {
          showToast("No answers for this question", "warn");
        }
      } else if (action === "answer-now") {
        event.stopPropagation();
        autoAnswerNow();
      } else if (action === "retry") {
        event.stopPropagation();
        loadCurrentActivity(true);
      }
    });

    const delayMin = panel.querySelector("#qc-delay-min");
    const delayMax = panel.querySelector("#qc-delay-max");
    const always = panel.querySelector("#qc-always");
    const theme = panel.querySelector("#qc-theme");

    delayMin.addEventListener("input", () => {
      settings.answerDelayMin = clampSeconds(delayMin.value);
      saveSettings();
      state.delayMs = sampleDelayMs();
    });
    delayMax.addEventListener("input", () => {
      settings.answerDelayMax = clampSeconds(delayMax.value);
      saveSettings();
      state.delayMs = sampleDelayMs();
    });
    always.addEventListener("change", () => {
      settings.alwaysActive = always.checked;
      saveSettings();
      syncAlwaysActive();
      showToast(settings.alwaysActive ? "Always-active mode on" : "Always-active mode off");
    });
    theme.addEventListener("change", () => {
      settings.theme = theme.value;
      saveSettings();
      applyTheme();
    });

    bindPanelDrag();
  }

  function syncPanelSettings() {
    if (!panel) return;
    const delayMin = panel.querySelector("#qc-delay-min");
    const delayMax = panel.querySelector("#qc-delay-max");
    const always = panel.querySelector("#qc-always");
    const theme = panel.querySelector("#qc-theme");
    if (delayMin) delayMin.value = settings.answerDelayMin;
    if (delayMax) delayMax.value = settings.answerDelayMax;
    if (always) always.checked = Boolean(settings.alwaysActive);
    if (theme) theme.value = settings.theme;
  }

  function resetSettings() {
    const position = settings.panelPos;
    settings = Object.assign({}, DEFAULT_SETTINGS, { panelPos: position });
    saveSettings();
    if (panel) {
      panel.style.display = "none";
      panel.classList.toggle("collapsed", Boolean(settings.collapsed));
    }
    syncPanelSettings();
    applyTheme();
    syncAlwaysActive();
    showToast("Settings reset to defaults");
    setTimeout(() => {
      if (panel) panel.style.display = "";
    }, 500);
  }

  function applyPanelPosition() {
    if (!panel) return;
    if (settings.panelPos && Number.isFinite(settings.panelPos.left) && Number.isFinite(settings.panelPos.top)) {
      panel.style.left = Math.max(4, settings.panelPos.left) + "px";
      panel.style.top = Math.max(4, settings.panelPos.top) + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    } else {
      panel.style.left = "";
      panel.style.top = "";
      panel.style.right = "16px";
      panel.style.bottom = "16px";
    }
  }

  function clampPanelPosition() {
    if (!panel || !settings.panelPos) return;
    const maxLeft = Math.max(4, window.innerWidth - 80);
    const maxTop = Math.max(4, window.innerHeight - 48);
    settings.panelPos.left = Math.max(4, Math.min(maxLeft, settings.panelPos.left));
    settings.panelPos.top = Math.max(4, Math.min(maxTop, settings.panelPos.top));
    applyPanelPosition();
  }

  function bindPanelDrag() {
    const header = panel && panel.querySelector(".qc-header");
    if (!header || header.__qcDragBound) return;
    header.__qcDragBound = true;

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("button, input, select, label, a")) return;
      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false,
      };
      panel.classList.add("dragging");
      event.preventDefault();
    });

    header.addEventListener("pointermove", (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const left = Math.max(4, Math.min(window.innerWidth - 72, event.clientX - dragState.offsetX));
      const top = Math.max(4, Math.min(window.innerHeight - 40, event.clientY - dragState.offsetY));
      settings.panelPos = { left: Math.round(left), top: Math.round(top) };
      dragState.moved = true;
      panel.style.left = left + "px";
      panel.style.top = top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });

    const endDrag = (event) => {
      if (!dragState || (event.pointerId != null && event.pointerId !== dragState.pointerId)) return;
      const moved = dragState.moved;
      dragState = null;
      panel.classList.remove("dragging");
      if (moved) {
        settings.panelPos = settings.panelPos || null;
        saveSettings();
      }
      setTimeout(() => {
        if (!dragState) panel.classList.remove("dragging");
      }, 0);
    };
    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);
  }

  function toggleCollapsed() {
    if (!panel) return;
    settings.collapsed = !settings.collapsed;
    saveSettings();
    panel.classList.toggle("collapsed", settings.collapsed);
  }

  function togglePanelVisibility(force) {
    ensurePanel();
    if (!panel) return;
    const hidden = typeof force === "boolean" ? !force : panel.style.display !== "none";
    panel.style.display = hidden ? "none" : "";
    settings.hidden = hidden;
    saveSettings();
    if (!hidden) {
      applyPanelPosition();
      syncPanelSettings();
    }
  }

  function showToast(message, tone) {
    ensurePanel();
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = "qc-toast" + (tone ? " " + tone : " success");
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2400);
  }

  function setStatus(text, tone) {
    state.statusText = text;
    state.statusTone = tone || "idle";
    if (!panel) return;
    const status = panel.querySelector(".qc-status");
    const dot = panel.querySelector(".qc-dot");
    if (status) status.textContent = text;
    if (dot) dot.className = "qc-dot " + state.statusTone;
  }

  function updateLoopButton() {
    if (!panel) return;
    const button = panel.querySelector("[data-action='loop']");
    if (button) {
      button.classList.toggle("active", state.autoPilot);
      button.title = state.autoPilot ? "Stop auto-pilot (Alt+Shift+L)" : "Auto-pilot through the whole activity (Alt+Shift+L)";
    }
  }

  function updateTimerDisplay() {
    if (!panel) return;
    const quiz = panel.querySelector(".qc-quiz-time");
    const question = panel.querySelector(".qc-q-time");
    const end = state.finishedAt || Date.now();
    if (quiz) quiz.textContent = formatDuration(end - state.quizStartedAt);
    if (question) question.textContent = formatDuration(end - state.questionStartedAt);
  }

  function renderSkeleton() {
    if (!panelBody) return;
    panelBody.innerHTML = "";
    const wrap = createElement("div", "qc-skeleton");
    wrap.appendChild(createElement("div", "qc-skeleton-line short"));
    wrap.appendChild(createElement("div", "qc-skeleton-line"));
    wrap.appendChild(createElement("div", "qc-skeleton-line"));
    wrap.appendChild(createElement("div", "qc-skeleton-line short"));
    panelBody.appendChild(wrap);
  }

  function renderMessage(text, tone, actionLabel, actionName) {
    if (!panelBody) return;
    panelBody.innerHTML = "";
    const message = createElement("div", "qc-message" + (tone ? " " + tone : ""), text);
    panelBody.appendChild(message);
    if (actionLabel && actionName) {
      const actions = createElement("div", "qc-actions");
      const button = createElement("button", "qc-action primary", actionLabel);
      button.type = "button";
      button.setAttribute("data-action", actionName);
      actions.appendChild(button);
      panelBody.appendChild(actions);
    }
  }

  function currentTool() {
    return state.context ? state.context.tool : "generic";
  }

  function questionLabel(question) {
    if (!question) return "";
    if (question.type === "proofreader") return "Proofreader";
    if (question.type === "evidence") return question.conjunction ? "Evidence \u00b7 " + question.conjunction : "Evidence";
    if (question.type === "fillInBlank") return "Fill in the blanks";
    if (question.type === "sentence") return "Rewrite";
    return "Question";
  }

  function totalQuestions() {
    return state.activity && state.activity.questions ? state.activity.questions.length : 0;
  }

  function answerCard(answer, index, question) {
    const card = createElement("button", "qc-answer" + (answer.optimal ? " optimal" : ""));
    card.type = "button";
    const top = createElement("div", "qc-answer-top");
    const label = createElement("span", "qc-answer-label", answer.label || (answer.optimal ? "Best answer" : "Answer " + (index + 1)));
    top.appendChild(label);
    if (answer.count) {
      top.appendChild(createElement("span", "qc-answer-meta", answer.count.toLocaleString() + " uses"));
    }
    card.appendChild(top);
    card.appendChild(createElement("div", "qc-answer-text", answer.text));
    card.addEventListener("click", () => {
      if (question.type === "evidence") {
        if (writeEvidenceAnswer(question, index)) {
          state.evidenceAnswerIndex = index;
          showToast("Example written \u2014 submit when ready");
        } else {
          showToast("Could not find the writing editor", "warn");
        }
        return;
      }
      if (question.type === "fillInBlank" && fillFitB(answer.text)) {
        showToast("Blanks filled \u2014 press Get feedback");
        return;
      }
      const inserted = insertAnswerIntoPage(answer.text);
      showToast(inserted ? "Answer inserted" : "Could not find an answer field", inserted ? "success" : "warn");
    });
    return card;
  }

  function renderPanel(force) {
    ensurePanel();
    if (!panel || !panelBody) return;
    const context = state.context;
    const tool = currentTool();
    const meta = TOOL_META[tool] || TOOL_META.generic;

    const sub = panel.querySelector(".qc-sub");
    if (sub) {
      const title = state.activity && state.activity.title ? state.activity.title : (context ? meta.label : "Waiting for a Quill activity");
      sub.textContent = state.activity ? meta.label + " \u00b7 " + truncate(title, 42) : meta.label + " \u00b7 " + truncate(title, 38);
      sub.title = title;
    }

    const titleEl = panel.querySelector(".qc-title");
    if (titleEl) titleEl.textContent = "Quill Cheat";

    updateLoopButton();
    if (!force && !state.loadingActivity && state.lastRenderKey === state.questionToken + "|" + state.loadingQuestion + "|" + state.activityError) {
      updateTimerDisplay();
      return;
    }
    state.lastRenderKey = state.questionToken + "|" + state.loadingQuestion + "|" + state.activityError;

    panelBody.innerHTML = "";

    if (!context) {
      renderMessage("Open any Quill activity to see answers.", "", "", "");
      return;
    }

    if (state.loadingActivity && !state.activity) {
      renderSkeleton();
      return;
    }

    if (state.activityError) {
      renderMessage(state.activityError, "error", "Retry", "retry");
      return;
    }

    if (state.activity && state.activity.teacherLed) {
      const wrap = document.createDocumentFragment();
      const metaRow = createElement("div", "qc-meta");
      const badge = createElement("span", "qc-badge", "Lessons");
      badge.style.setProperty("--qc-accent", meta.color);
      metaRow.appendChild(badge);
      wrap.appendChild(metaRow);
      wrap.appendChild(createElement("div", "qc-activity", state.activity.title || pageTitleFallback()));
      wrap.appendChild(createElement("div", "qc-message warn", "This is a teacher-led Class Lesson. Quill does not publish an answer key for it, so there is nothing to auto-fill here."));
      panelBody.appendChild(wrap);
      return;
    }

    if (context.results) {
      const wrap = document.createDocumentFragment();
      const metaRow = createElement("div", "qc-meta");
      metaRow.appendChild(createElement("span", "qc-badge", "Complete"));
      wrap.appendChild(metaRow);
      wrap.appendChild(createElement("div", "qc-activity", state.activity ? state.activity.title : "Activity complete"));
      wrap.appendChild(createElement("div", "qc-message", "Activity complete. Nice work!"));
      panelBody.appendChild(wrap);
      return;
    }

    const question = state.current && state.current.question;
    if (!question) {
      const wrap = document.createDocumentFragment();
      const metaRow = createElement("div", "qc-meta");
      const badge = createElement("span", "qc-badge", meta.label);
      metaRow.appendChild(badge);
      wrap.appendChild(metaRow);
      wrap.appendChild(createElement("div", "qc-message", "Waiting for the first question\u2026"));
      panelBody.appendChild(wrap);
      return;
    }

    const wrap = document.createDocumentFragment();
    const metaRow = createElement("div", "qc-meta");
    const badge = createElement("span", "qc-badge", meta.label);
    badge.style.setProperty("--qc-accent", meta.color);
    metaRow.appendChild(badge);

    let counterText = "";
    if (question.type === "proofreader") {
      const progress = proofreaderProgress();
      counterText = progress ? progress.made + " / " + progress.total + " edits" : (question.corrections ? question.corrections.length + " edits" : "");
    } else if (totalQuestions()) {
      counterText = (state.questionIndex + 1) + " / " + totalQuestions();
    }
    if (counterText) metaRow.appendChild(createElement("span", "qc-count", counterText));
    wrap.appendChild(metaRow);

    wrap.appendChild(createElement("div", "qc-activity", truncate(state.activity && state.activity.title ? state.activity.title : pageTitleFallback(), 110)));

    if (question.prompt) {
      const prompt = createElement("div", "qc-prompt");
      prompt.textContent = truncate(question.prompt, 320);
      prompt.title = question.prompt;
      wrap.appendChild(prompt);
    }

    if (state.loadingQuestion) {
      const loading = createElement("div", "qc-message", "Loading answers\u2026");
      wrap.appendChild(loading);
    } else if (question.type === "proofreader") {
      const label = createElement("div", "qc-section-label");
      label.appendChild(createElement("span", "", "Corrections"));
      if (question.corrections && question.corrections.length) {
        label.appendChild(createElement("span", "", question.corrections.length + " total"));
      }
      wrap.appendChild(label);
      if (!question.corrections || !question.corrections.length) {
        wrap.appendChild(createElement("div", "qc-message warn", "No corrections were found in this passage. Try Loop to use the page's own feedback."));
      } else {
        const list = createElement("div", "qc-corrections");
        question.corrections.forEach((correction) => {
          const item = createElement("button", "qc-answer qc-correction");
          item.type = "button";
          const row = createElement("div", "qc-correction-row");
          row.appendChild(createElement("span", "qc-wrong", correction.wrong));
          row.appendChild(createElement("span", "qc-arrow", "\u2192"));
          row.appendChild(createElement("span", "qc-correct", correction.correct));
          item.appendChild(row);
          item.addEventListener("click", () => {
            const spans = proofreaderSpans();
            const target = spans.find((span) => normalized(span.textContent) === normalized(correction.wrong)) || spans[0];
            if (target && applyProofreaderCorrection(target, correction.correct)) {
              showToast("Corrected \u201c" + correction.wrong + "\u201d");
            } else {
              showToast("That word is not on screen yet", "warn");
            }
          });
          list.appendChild(item);
        });
        wrap.appendChild(list);
        const actions = createElement("div", "qc-actions");
        const fixAll = createElement("button", "qc-action primary", "Fix all corrections");
        fixAll.type = "button";
        fixAll.setAttribute("data-action", "fix-all");
        actions.appendChild(fixAll);
        wrap.appendChild(actions);
      }
    } else if (question.type === "evidence") {
      const label = createElement("div", "qc-section-label");
      label.appendChild(createElement("span", "", "Strong examples"));
      wrap.appendChild(label);
      if (question.answers && question.answers.length) {
        question.answers.forEach((answer, index) => {
          wrap.appendChild(answerCard(answer, index, question));
        });
      } else {
        wrap.appendChild(createElement("div", "qc-message warn", "No example response was returned for this prompt."));
      }
      const actions = createElement("div", "qc-actions");
      const write = createElement("button", "qc-action primary", "Write best example");
      write.type = "button";
      write.setAttribute("data-action", "answer-now");
      actions.appendChild(write);
      wrap.appendChild(actions);
    } else {
      const answers = question.answers || [];
      const label = createElement("div", "qc-section-label");
      label.appendChild(createElement("span", "", answers.length ? "Answers" : "No answers yet"));
      if (answers.length) label.appendChild(createElement("span", "", answers.length + " options"));
      wrap.appendChild(label);

      if (answers.length) {
        answers.forEach((answer, index) => {
          wrap.appendChild(answerCard(answer, index, question));
        });
      } else {
        wrap.appendChild(createElement("div", "qc-message", "No public answer was found for this question. Try Auto to use the page's own choices."));
      }

      const actions = createElement("div", "qc-actions");
      if (question.type === "fillInBlank" || isFitBPage()) {
        const fill = createElement("button", "qc-action primary", "Fill blanks");
        fill.type = "button";
        fill.setAttribute("data-action", "fill-blanks");
        actions.appendChild(fill);
      }
      const auto = createElement("button", "qc-action" + (question.type === "fillInBlank" ? "" : " primary"), "Auto answer");
      auto.type = "button";
      auto.setAttribute("data-action", "answer-now");
      actions.appendChild(auto);
      wrap.appendChild(actions);
    }

    panelBody.appendChild(wrap);
    updateTimerDisplay();
  }

  let autoAnswerBusy = false;

  function insertAnswerIntoPage(text) {
    const value = cleanText(text);
    if (!value) return false;
    if (isFitBPage()) return fillFitB(value);
    const input = findBestInput();
    if (input) {
      insertIntoField(input, value);
      return true;
    }
    if (clickOptionMatching(value)) return true;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(() => showToast("Answer copied to clipboard")).catch(() => {});
      }
    } catch (_) {
      /* clipboard is a best-effort fallback */
    }
    return false;
  }

  function evidenceStepIndex() {
    const active = $(".step-overview-step.active");
    if (!active) return null;
    const text = normalized(active.textContent);
    let conjunction = null;
    if (/cause|reason/.test(text)) conjunction = "because";
    else if (/contrast|oppos/.test(text)) conjunction = "but";
    else if (/consequence|result/.test(text)) conjunction = "so";
    if (!conjunction || !state.activity) return null;
    const index = state.activity.questions.findIndex((question) => question.conjunction === conjunction);
    return index >= 0 ? index : null;
  }

  function findCurrentQuestion() {
    const activity = state.activity;
    if (!activity || !activity.questions || !activity.questions.length) return null;
    if (activity.teacherLed) return null;

    if (activity.tool === "proofreader" || activity.questions[0].type === "proofreader") {
      return {
        index: 0,
        question: activity.questions[0],
        token: "proofreader:" + activity.questions[0].type,
      };
    }

    if (activity.tool === "evidence") {
      const editor = findEvidenceEditor();
      let index = state.evidenceIndex || 0;
      const matched = evidencePromptQuestion();
      if (matched) {
        index = matched.question.index;
      } else if (editor) {
        const found = evidenceQuestionForEditor(editor);
        if (found && Number.isInteger(found.index)) index = found.index;
      } else {
        state.evidencePromptKey = "";
        const stepIndex = evidenceStepIndex();
        if (stepIndex != null) index = stepIndex;
      }
      if (index < 0 || index >= activity.questions.length) index = 0;
      state.evidenceIndex = index;
      return {
        index,
        question: activity.questions[index],
        token: "evidence:" + (activity.questions[index].key || index),
      };
    }

    const counter = pageCounter();
    let index = null;
    if (counter && counter.current > 0) {
      index = counter.current - 1;
    } else if (counter && counter.current === 0) {
      return null;
    } else {
      // Without a question counter, only trust a real answer field. Intro
      // screens, language pickers and menus also contain clickable options.
      if (!findBestInput()) return null;
      index = state.current ? state.questionIndex : 0;
    }
    if (index == null || index < 0) return null;
    if (index >= activity.questions.length) index = activity.questions.length - 1;
    return {
      index,
      question: activity.questions[index],
      token: (activity.questions[index].key || "q") + ":" + index,
    };
  }

  async function syncNow(force) {
    if (!state.context) return;
    if (state.syncBusy) return;
    if (state.loadingActivity) return;
    state.syncBusy = true;
    try {
      if (!state.activity) {
        if (!state.activityError || force) await loadCurrentActivity(force);
        return;
      }
      if (state.activity.teacherLed) {
        state.current = null;
        renderPanel();
        return;
      }
      const found = findCurrentQuestion();
      if (!found) {
        if (state.current) {
          state.current = null;
          state.questionToken = "";
          state.lastRenderKey = "";
          renderPanel(true);
        }
        const text = state.context.results ? "Activity complete" : "Waiting for a question";
        setStatus(text, state.context.results ? "ready" : "idle");
        return;
      }

      if (found.token !== state.questionToken || force) {
        state.questionToken = found.token;
        state.current = { index: found.index, question: found.question, token: found.token };
        state.questionIndex = found.index;
        state.attempts = 0;
        state.questionStartedAt = Date.now();
        state.delayMs = sampleDelayMs();
        state.evidenceScrolled = false;
        state.evidenceAnswerIndex = 0;
        state.evidenceReadyAt = 0;
        state.evidenceSubmittedText = "";
        state.evidenceSubmittedExample = -1;
        state.evidenceAttemptsSeen = null;
        state.evidenceFeedbackPending = false;
        state.evidenceSubmittedAt = 0;
        state.evidenceWaitTicks = 0;
        state.lastRenderKey = "";
        if (found.question.type !== "proofreader" && found.question.type !== "evidence") {
          state.loadingQuestion = !found.question.loaded;
          renderPanel(true);
          if (state.loadingQuestion) setStatus("Loading answers\u2026", "busy");
          try {
            await loadQuestionData(found.question);
          } catch (_) {
            /* an unanswered question is still usable */
          }
          state.loadingQuestion = false;
        }
        renderPanel(true);
        const total = totalQuestions();
        setStatus(
          found.question.type === "proofreader"
            ? "Ready to proofread"
            : total ? "Question " + (found.index + 1) + " of " + total : "Ready",
          "ready"
        );
      } else {
        state.current = { index: found.index, question: found.question, token: found.token };
        renderPanel();
      }
    } finally {
      state.syncBusy = false;
    }
  }

  async function loadCurrentActivity(force) {
    if (!state.context) return;
    if (state.loadingActivity) return;
    if (!force && state.activity) return;
    const signature = state.context.signature;
    state.loadingActivity = true;
    state.activityError = "";
    state.activity = null;
    state.current = null;
    state.questionToken = "";
    state.lastRenderKey = "";
    ensurePanel();
    if (panel && !settings.hidden) panel.style.display = "";
    renderPanel(true);
    setStatus("Loading activity\u2026", "busy");

    try {
      if (state.context.results) {
        state.loadingActivity = false;
        state.finishedAt = state.finishedAt || Date.now();
        state.activity = { tool: state.context.tool, title: pageTitleFallback(), questions: [], teacherLed: false };
        renderPanel(true);
        setStatus("Activity complete", "ready");
        return;
      }
      const activity = await loadActivity(state.context);
      if (!state.context || state.context.signature !== signature) return;
      state.activity = activity;
      if (activity.title) state.context.title = activity.title;
      state.quizStartedAt = state.quizStartedAt || Date.now();
      state.loadingActivity = false;
      renderPanel(true);
      if (activity.teacherLed) {
        setStatus("Teacher-led lesson", "warn");
      } else {
        setStatus("Ready", "ready");
        prefetchAnswers(activity.questions);
      }
      await syncNow(true);
    } catch (error) {
      if (!state.context || state.context.signature !== signature) return;
      state.loadingActivity = false;
      state.activityError = "Could not load this activity: " + (error && error.message ? error.message : "unknown error");
      setStatus("Load failed", "error");
      renderPanel(true);
    }
  }

  function handleRoute(context, force) {
    if (!context) {
      if (panel) panel.style.display = "none";
      if (state.autoPilot) stopAutoPilot("left the activity", true);
      state.context = null;
      state.activity = null;
      state.current = null;
      state.activityError = "";
      state.lastRenderKey = "";
      return;
    }
    const changed = !state.context || state.context.signature !== context.signature;
    if (!changed && !force) return;
    if (changed && state.autoPilot) stopAutoPilot("activity changed", true);
    if (changed) {
      // The completion screen changes the route signature too; keep the real
      // quiz/question start times so the panel freezes at the actual elapsed
      // time instead of resetting to 0:00.
      if (!context.results) {
        state.quizStartedAt = Date.now();
        state.questionStartedAt = Date.now();
        state.finishedAt = 0;
      } else {
        state.finishedAt = state.finishedAt || Date.now();
      }
      state.attempts = 0;
      state.evidenceIndex = 0;
      state.evidenceAnswerIndex = 0;
      state.evidenceScrolled = false;
      state.evidencePromptKey = "";
      state.evidenceReadyAt = 0;
      state.evidenceLastEditorText = "";
      state.evidenceSubmittedText = "";
      state.evidenceSubmittedExample = -1;
      state.evidenceAttemptsSeen = null;
      state.evidenceFeedbackPending = false;
      state.evidenceSubmittedAt = 0;
      state.evidenceWaitTicks = 0;
    }
    state.context = context;
    ensurePanel();
    if (panel) panel.style.display = settings.hidden ? "none" : "";
    applyTheme();
    renderPanel(true);
    loadCurrentActivity(force || changed).catch(() => {});
  }

  function routeCheck(force) {
    if (!hostIsQuill()) return;
    const context = readRoute();
    if (!context) {
      handleRoute(null);
      return;
    }
    if (!force && state.context && context.signature === state.context.signature && state.activity) return;
    handleRoute(context, force);
  }

  async function autoAnswerNow() {
    if (autoAnswerBusy) return;
    autoAnswerBusy = true;
    setStatus("Answering\u2026", "busy");
    try {
      await syncNow(true);
      if (activityComplete()) {
        state.finishedAt = state.finishedAt || Date.now();
        updateTimerDisplay();
        setStatus("Activity complete", "ready");
        showToast("This activity is already complete", "success");
        return;
      }
      if (surveyTick()) {
        showToast("Survey completed");
        return;
      }
      const current = state.current;
      const question = current && current.question;
      if (!question) {
        if (clickLanguageButton()) {
          showToast("Language set to English");
        } else if (clickAdvanceButton()) {
          showToast("Advanced");
        } else {
          showToast("No question is visible yet", "warn");
        }
        return;
      }

      if (question.type === "proofreader") {
        const applied = await applyAllProofreaderCorrections();
        await sleep(250);
        const submitted = clickSubmitButton();
        showToast(applied ? "Fixed " + applied + " correction" + (applied === 1 ? "" : "s") : "No underlined words found", applied ? "success" : "warn");
        if (!submitted && applied) setTimeout(() => clickSubmitButton(), 250);
        return;
      }

      if (question.type === "evidence") {
        const promptMatch = evidencePromptQuestion();
        if (!promptMatch) {
          await evidenceAutoTick();
          return;
        }
        if (Date.now() < state.evidenceReadyAt) {
          showToast("Waiting for the prompt editor\u2026", "warn");
          return;
        }
        const target = promptMatch.question;
        let index = evidenceAnswerUsed(target, promptMatch.editor.innerText || promptMatch.editor.textContent || "");
        if (index < 0) index = 0;
        if (writeEvidenceAnswer(target, index, promptMatch.editor)) {
          await sleep(180);
          const submit = evidenceSubmitButton();
          if (submit) submit.click();
          showToast(submit ? "Example submitted" : "Example written \u2014 press Get feedback", submit ? "success" : "warn");
        } else {
          showToast("Could not find the evidence editor", "warn");
        }
        return;
      }

      if (question.type === "fillInBlank" || isFitBPage()) {
        const answer = question.answers && question.answers[0];
        if (answer && fillFitB(answer.text)) {
          await sleep(100);
          clickSubmitButton();
          showToast("Blanks filled", "success");
        } else {
          showToast("No fill-in-the-blank answer found", "warn");
        }
        return;
      }

      const answer = question.answers && question.answers[0];
      if (answer) {
        const inserted = insertAnswerIntoPage(answer.text);
        await sleep(180);
        const submitted = clickSubmitButton();
        showToast(
          submitted ? "Answer submitted" : inserted ? "Answer inserted \u2014 submit when ready" : "Could not find an answer field",
          submitted || inserted ? "success" : "warn"
        );
        if (!submitted && !inserted) clickAdvanceButton();
      } else if (clickAdvanceButton()) {
        showToast("Advanced");
      } else {
        showToast("No answer found for this question", "warn");
      }
    } finally {
      autoAnswerBusy = false;
      updateTimerDisplay();
    }
  }

  function startAutoPilot() {
    if (state.autoPilot) return;
    if (!state.context) {
      showToast("Open a Quill activity first", "warn");
      return;
    }
    state.autoPilot = true;
    state.attempts = 0;
    updateLoopButton();
    setStatus("Auto-pilot on", "busy");
    showToast("Auto-pilot on \u2014 answering and advancing", "success");
    state.autoPilotTimer = setInterval(autoPilotTick, 700);
    autoPilotTick();
  }

  function stopAutoPilot(reason, silent) {
    if (state.autoPilotTimer) clearInterval(state.autoPilotTimer);
    state.autoPilotTimer = null;
    state.autoPilot = false;
    updateLoopButton();
    if (reason) setStatus(reason, "idle");
    if (!silent) showToast(reason ? "Auto-pilot off \u2014 " + reason : "Auto-pilot off", "warn");
  }

  function toggleAutoPilot() {
    if (state.autoPilot) stopAutoPilot();
    else startAutoPilot();
  }

  async function proofreaderAutoTick() {
    if (!state.current || !state.current.question) return;
    const review = proofreaderReviewState();
    if (review) {
      if (review.done) {
        if (!isDisabled(review.done)) {
          review.done.click();
          await sleep(250);
          return;
        }
        // Anonymous proofreader plays disable the final Done button on purpose.
        if (!review.total || review.index >= review.total) {
          state.finishedAt = state.finishedAt || Date.now();
          updateTimerDisplay();
          stopAutoPilot("Proofreader review complete \ud83c\udf89", true);
          showToast("All edits reviewed \u2014 anonymous proofreader activities end here", "success");
        }
        return;
      }
      if (review.next) {
        review.next.click();
        await sleep(220);
        return;
      }
      return;
    }
    const spans = proofreaderSpans();
    if (spans.length) {
      const corrections = state.current.question.corrections || [];
      const span = spans[0];
      const match = correctionForSpan(span, corrections);
      if (match && applyProofreaderCorrection(span, match.correction.correct)) {
        await sleep(180);
        return;
      }
    }
    const reviewButton = proofreaderReviewButton();
    if (reviewButton) {
      reviewButton.click();
      await sleep(220);
      return;
    }
    if (clickSubmitButton()) {
      await sleep(200);
      return;
    }
    if (clickAdvanceButton()) {
      await sleep(200);
      return;
    }
  }

  async function evidenceAutoTick() {
    const promptMatch = evidencePromptQuestion();
    const editor = promptMatch ? promptMatch.editor : findEvidenceEditor();
    if (editor) {
      const question = promptMatch ? promptMatch.question : (evidenceQuestionForEditor(editor) || (state.current && state.current.question));
      if (!question || !question.answers || !question.answers.length) {
        if (clickSubmitButton()) return;
        if (clickAdvanceButton()) return;
        return;
      }

      // Quill swaps the prompt editor before React settles. Never type into
      // the stale editor from the previous prompt: wait for the new prompt id
      // and one stable frame before touching the field.
      const promptKey = String(question.key || question.index);
      if (state.evidencePromptKey !== promptKey) {
        state.evidencePromptKey = promptKey;
        state.evidenceReadyAt = Date.now() + 900;
        state.evidenceLastEditorText = "";
        state.evidenceSubmittedText = "";
        state.evidenceSubmittedExample = -1;
        state.evidenceAttemptsSeen = evidenceAttempts();
        state.evidenceFeedbackPending = false;
        state.evidenceSubmittedAt = 0;
        state.evidenceWaitTicks = 0;
        state.evidenceAnswerIndex = 0;
        return;
      }
      if (Date.now() < state.evidenceReadyAt) return;

      const editorText = editor.innerText || editor.textContent || "";
      if (state.evidenceLastEditorText !== editorText) {
        state.evidenceLastEditorText = editorText;
        await sleep(80);
        return;
      }

      const nextButton = evidenceNextButton();
      if (nextButton) {
        nextButton.click();
        state.evidenceFeedbackPending = false;
        await sleep(220);
        return;
      }

      const used = evidenceAnswerUsed(question, editorText);
      const normalizedEditorText = normalized(editorText);
      const attempts = evidenceAttempts();

      if (state.evidenceFeedbackPending) {
        const feedbackArrived = attempts != null && state.evidenceAttemptsSeen != null
          ? attempts > state.evidenceAttemptsSeen
          : Date.now() - state.evidenceSubmittedAt > 10000;
        if (!feedbackArrived) {
          if (Date.now() - state.evidenceSubmittedAt > 14000) {
            state.evidenceFeedbackPending = false;
          } else {
            return;
          }
        }
        state.evidenceFeedbackPending = false;
        state.evidenceAttemptsSeen = attempts != null ? attempts : state.evidenceAttemptsSeen;

        if (used >= 0 && used === state.evidenceSubmittedExample && used < question.answers.length - 1) {
          if (writeEvidenceAnswer(question, used + 1, editor)) {
            state.evidenceReadyAt = Date.now() + 300;
            await sleep(120);
            return;
          }
        }
        if (used >= 0 && used === question.answers.length - 1) {
          // Both published examples have been tried. Quill's AI can still
          // reject them; stop rather than filling the editor with garbage.
          stopAutoPilot("Evidence needs manual revision", true);
          showToast("Both strong examples were rejected \\u2014 revise the last one manually", "warn");
          return;
        }
      }

      if (used < 0) {
        if (writeEvidenceAnswer(question, Math.min(state.evidenceAnswerIndex || 0, question.answers.length - 1), editor)) {
          state.evidenceReadyAt = Date.now() + 300;
          await sleep(120);
          return;
        }
      }

      const submit = evidenceSubmitButton();
      if (submit) {
        if (state.evidenceSubmittedText !== normalizedEditorText) {
          state.evidenceSubmittedText = normalizedEditorText;
          state.evidenceSubmittedExample = used;
          state.evidenceSubmittedAt = Date.now();
          state.evidenceAttemptsSeen = attempts;
          state.evidenceFeedbackPending = true;
          submit.click();
          await sleep(200);
          return;
        }
      }

      // The button is disabled because this exact response was already
      // submitted (or feedback is still loading). Try the other example.
      if (used >= 0 && used < question.answers.length - 1 && normalizedEditorText === state.evidenceSubmittedText) {
        if (writeEvidenceAnswer(question, used + 1, editor)) {
          state.evidenceReadyAt = Date.now() + 300;
          await sleep(120);
          return;
        }
      }

      state.evidenceWaitTicks += 1;
      if (state.evidenceWaitTicks > 20) {
        state.evidenceWaitTicks = 0;
        stopAutoPilot("Evidence stalled", true);
        showToast("Evidence feedback is not advancing \\u2014 finish this prompt manually", "warn");
      }
      return;
    }

    const marks = evidenceHighlights();
    if (marks.length) {
      const required = requiredHighlightCount();
      const selected = selectedHighlightCount();
      const target = required > 0 ? required : marks.length;
      if (selected < target) {
        const next = marks.find((mark) => mark.getAttribute("aria-pressed") !== "true" && !/selected/i.test(mark.className));
        if (next) {
          next.click();
          await sleep(160);
          return;
        }
      }
      if (!state.evidenceScrolled) {
        scrollEvidenceToEnd();
        state.evidenceScrolled = true;
        await sleep(350);
        return;
      }
      if (doneButtonEnabled()) {
        if (!clickSubmitButton()) clickAdvanceButton();
        await sleep(160);
        return;
      }
      scrollEvidenceToEnd();
      if (clickSubmitButton()) {
        await sleep(160);
        return;
      }
      if (clickAdvanceButton()) return;
      return;
    }

    if (clickAdvanceButton()) {
      await sleep(160);
      return;
    }
    if (clickSubmitButton()) {
      await sleep(160);
    }
  }

  async function autoPilotTick() {
    if (!state.autoPilot || autoAnswerBusy) return;
    autoAnswerBusy = true;
    try {
      if (activityComplete()) {
        state.finishedAt = state.finishedAt || Date.now();
        updateTimerDisplay();
        stopAutoPilot("activity complete \ud83c\udf89");
        return;
      }
      if (surveyTick()) {
        await sleep(350);
        return;
      }
      await syncNow();
      if (!state.context) {
        stopAutoPilot("left the activity");
        return;
      }
      if (state.activity && state.activity.teacherLed) {
        stopAutoPilot("teacher-led lesson");
        return;
      }
      const current = state.current;
      const question = current && current.question;

      if (!question) {
        state.attempts += 1;
        if (state.attempts > 60) {
          stopAutoPilot("no question found");
          return;
        }
        if (clickLanguageButton()) {
          await sleep(160);
        } else if (clickAdvanceButton()) {
          await sleep(160);
        } else if (clickSubmitButton()) {
          await sleep(160);
        }
        return;
      }

      if (Date.now() - state.questionStartedAt < state.delayMs) {
        const wait = Math.ceil((state.delayMs - (Date.now() - state.questionStartedAt)) / 1000);
        setStatus("Waiting " + wait + "s before answering", "busy");
        return;
      }

      state.attempts += 1;
      if (state.attempts > 120) {
        stopAutoPilot("stuck on this question");
        return;
      }

      if (question.type === "proofreader") {
        await proofreaderAutoTick();
        return;
      }
      if (question.type === "evidence") {
        await evidenceAutoTick();
        return;
      }

      const input = findBestInput();
      const options = findOptionButtons();
      const answer = question.answers && question.answers[0];

      if (question.type === "fillInBlank" || isFitBPage()) {
        if (answer) {
          const inputs = findFitBInputs();
          if (inputs.length) {
            const currentValues = inputs.map((el) => readInputValue(el));
            if (currentValues.some((value) => value)) {
              if (clickSubmitButton()) {
                await sleep(160);
                return;
              }
              if (!findSubmitButton() && clickAdvanceButton()) {
                await sleep(160);
                return;
              }
            }
            fillFitB(answer.text);
            await sleep(140);
            if (clickSubmitButton()) return;
            if (!findSubmitButton() && clickAdvanceButton()) return;
            return;
          }
        }
        if (clickAdvanceButton()) return;
        return;
      }

      if (input) {
        if (answer) {
          const value = readInputValue(input);
          if (normalized(value).indexOf(normalized(answer.text)) < 0) {
            insertIntoField(input, answer.text);
            await sleep(180);
            return;
          }
          if (clickSubmitButton()) {
            await sleep(160);
            return;
          }
        }
        if (clickAdvanceButton()) {
          await sleep(160);
          return;
        }
        if (clickSubmitButton()) {
          await sleep(160);
          return;
        }
        return;
      }

      if (answer && clickOptionMatching(answer.text)) {
        await sleep(180);
        if (clickSubmitButton()) return;
        return;
      }

      if (clickAdvanceButton()) {
        await sleep(160);
        return;
      }
      if (clickSubmitButton()) {
        await sleep(160);
        return;
      }
      if (!options.length && !answer) {
        setStatus("No answer or control found", "warn");
      }
    } finally {
      autoAnswerBusy = false;
      updateTimerDisplay();
    }
  }

  function scheduleSync() {
    if (state.observerTimer) return;
    state.observerTimer = setTimeout(() => {
      state.observerTimer = null;
      if (!state.context) return;
      syncNow().catch(() => {});
    }, 250);
  }

  function installObserver() {
    if (state.observer || !document.documentElement) return;
    try {
      state.observer = new MutationObserver(() => {
        if (!state.context) return;
        scheduleSync();
      });
      state.observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {
      state.observer = null;
    }
  }

  const forgery = {
    active: false,
    saved: [],
    listeners: [],
    worker: null,
    timer: null,
    position: { x: 0, y: 0 },
  };

  function rememberAndDefine(target, prop, getter) {
    let own = null;
    try {
      own = Object.getOwnPropertyDescriptor(target, prop);
    } catch (_) {
      own = null;
    }
    if (own && own.configurable === false) return false;
    try {
      Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: own ? own.enumerable : true,
        get: getter,
      });
      forgery.saved.push({ target, prop, own });
      return true;
    } catch (_) {
      return false;
    }
  }

  function heartbeat() {
    try {
      const x = Math.round(Math.max(1, Math.min(window.innerWidth - 2, forgery.position.x + (Math.random() - 0.5) * 120)));
      const y = Math.round(Math.max(1, Math.min(window.innerHeight - 2, forgery.position.y + (Math.random() - 0.5) * 120)));
      forgery.position = { x, y };
      const options = {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        view: window,
      };
      document.dispatchEvent(new MouseEvent("mousemove", options));
      document.dispatchEvent(new MouseEvent("mouseover", options));
      document.dispatchEvent(new MouseEvent("pointermove", options));
    } catch (_) {
      /* event synthesis is best-effort */
    }
  }

  function installFocusForgeries() {
    if (forgery.active) return;
    forgery.active = true;

    rememberAndDefine(document, "hidden", () => false);
    rememberAndDefine(document, "visibilityState", () => "visible");
    rememberAndDefine(document, "webkitHidden", () => false);
    rememberAndDefine(document, "webkitVisibilityState", () => "visible");

    try {
      const original = document.hasFocus;
      document.hasFocus = function () {
        return true;
      };
      forgery.saved.push({ target: document, prop: "hasFocus", own: Object.prototype.hasOwnProperty.call(document, "hasFocus") ? original : null });
    } catch (_) {
      /* ignore */
    }

    try {
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "userActivation");
      if (!descriptor || descriptor.configurable !== false) {
        Object.defineProperty(navigator, "userActivation", {
          configurable: true,
          get: () => ({ hasBeenActive: true, isActive: true }),
        });
        forgery.saved.push({ target: navigator, prop: "userActivation", own: null });
      }
    } catch (_) {
      /* ignore */
    }

    const swallow = (event) => {
      event.stopImmediatePropagation();
    };
    const swallowWindowBlur = (event) => {
      if (event.target === window || event.target === document) event.stopImmediatePropagation();
    };

    ["visibilitychange", "webkitvisibilitychange"].forEach((type) => {
      [window, document].forEach((target) => {
        target.addEventListener(type, swallow, true);
        forgery.listeners.push([target, type, swallow]);
      });
    });
    window.addEventListener("blur", swallowWindowBlur, true);
    forgery.listeners.push([window, "blur", swallowWindowBlur]);
    document.addEventListener("blur", swallowWindowBlur, true);
    forgery.listeners.push([document, "blur", swallowWindowBlur]);

    forgery.position = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    try {
      const source = "let t=null;onmessage=function(e){if(e.data==='start'){t=setInterval(function(){postMessage('tick')},2000)}else if(e.data==='stop'){clearInterval(t)}};";
      const blob = new Blob([source], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      forgery.worker = new Worker(url);
      URL.revokeObjectURL(url);
      forgery.worker.onmessage = () => heartbeat();
      forgery.worker.postMessage("start");
    } catch (_) {
      forgery.worker = null;
    }
    if (!forgery.worker) {
      forgery.timer = setInterval(heartbeat, 2200);
    }
    heartbeat();
  }

  function removeFocusForgeries() {
    if (!forgery.active) return;
    forgery.active = false;
    forgery.listeners.forEach(([target, type, listener]) => {
      try {
        target.removeEventListener(type, listener, true);
      } catch (_) {
        /* ignore */
      }
    });
    forgery.listeners = [];
    if (forgery.timer) clearInterval(forgery.timer);
    forgery.timer = null;
    if (forgery.worker) {
      try {
        forgery.worker.postMessage("stop");
        forgery.worker.terminate();
      } catch (_) {
        /* ignore */
      }
      forgery.worker = null;
    }
    forgery.saved.forEach(({ target, prop, own }) => {
      try {
        if (own) Object.defineProperty(target, prop, own);
        else delete target[prop];
      } catch (_) {
        /* ignore */
      }
    });
    forgery.saved = [];
  }

  function syncAlwaysActive() {
    if (settings.alwaysActive) installFocusForgeries();
    else removeFocusForgeries();
  }

  function onHotkey(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    const key = String(event.key || "").toLowerCase();
    if (["a", "l", "h", "q", "s"].indexOf(key) < 0) return;
    event.preventDefault();
    if (key === "a") autoAnswerNow();
    else if (key === "l") toggleAutoPilot();
    else if (key === "h") {
      ensurePanel();
      toggleCollapsed();
    } else if (key === "q") {
      togglePanelVisibility();
    } else if (key === "s") {
      ensurePanel();
      if (panel) {
        if (panel.style.display === "none") togglePanelVisibility(true);
        panelSettings.classList.toggle("open");
      }
    }
  }

  function init() {
    try {
      if (window.top !== window.self) return;
    } catch (_) {
      return;
    }
    if (!hostIsQuill()) return;
    syncAlwaysActive();
    document.addEventListener("keydown", onHotkey, true);
    window.addEventListener("hashchange", () => routeCheck(true));
    window.addEventListener("popstate", () => routeCheck(true));
    installObserver();

    routeCheck(true);
    state.routeTimer = setInterval(() => routeCheck(false), 850);
    state.tickTimer = setInterval(() => {
      if (state.context && !state.loadingActivity) {
        syncNow().catch(() => {});
      }
    }, 750);
    setInterval(updateTimerDisplay, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
