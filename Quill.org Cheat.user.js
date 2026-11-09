// ==UserScript==
// @name         Quill.org Cheat
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Get answers for Quill.org, with quiz timer and auto-answer
// @author       Potassium_
// @match        https://www.quill.org/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=quill.org
// @grant        none
// @updateURL    https://github.com/yofriendfromschool1/quill-cheat/raw/main/Quill.org%20Cheat.user.js
// @downloadURL  https://github.com/yofriendfromschool1/quill-cheat/raw/main/Quill.org%20Cheat.user.js
// ==/UserScript==

(function () {
    "use strict";

    const SETTINGS_KEY = "quill-cheat-settings";
    const DEFAULT_SETTINGS = { answerDelayMin: 0, answerDelayMax: 0, alwaysActive: false };

    function loadSettings() {
      try {
        return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
      } catch (error) {
        return Object.assign({}, DEFAULT_SETTINGS);
      }
    }

    function saveSettings() {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (error) {
        // localStorage may be unavailable — settings just won't persist
      }
    }

    function clampSeconds(value) {
      const n = parseFloat(value);
      if (isNaN(n) || n < 0) return 0;
      return Math.min(3600, Math.floor(n));
    }

    function sampleDelayMs() {
      const min = Math.max(0, Number(settings.answerDelayMin) || 0);
      const max = Math.max(min, Number(settings.answerDelayMax) || 0);
      if (max <= 0) return 0;
      return Math.floor((min + Math.random() * (max - min)) * 1000);
    }

    let settings = loadSettings();

    let answersPanel = null;
    let currentQuestionKey = null;
    let lessonQuestions = [];
    let currentResponses = [];
    let quizStartTime = Date.now();
    let questionStartTime = Date.now();
    let currentQuestionDelayMs = 0;
    let autoPilotInterval = null;
    let autoPilotEnabled = false;
    let autoPilotAttempts = 0;
    let lastAutoPilotQuestionIndex = null;
    let alwaysActiveInterval = null;
    let forgeryListeners = [];
    let alwaysActivePosition = { x: 0, y: 0 };

    function injectStyles() {
      const styles = document.createElement("style");
      styles.textContent = `
        .quill-cheat-panel {
          position: fixed;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          width: 420px;
          max-width: calc(100vw - 32px);
          background: #ffffff;
          color: #000000;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          border: 2px solid #06806b;
          border-radius: 12px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
          transition: transform 0.3s ease, opacity 0.3s ease;
        }
        .quill-cheat-panel.collapsed {
          transform: translateX(-50%) translateY(calc(100% - 42px));
        }
        .quill-cheat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          cursor: pointer;
          user-select: none;
          background: #f8f8f8;
          border-bottom: 1px solid #06806b;
          border-radius: 10px 10px 0 0;
        }
        .quill-cheat-panel.collapsed .quill-cheat-header {
          border-radius: 10px;
          border-bottom: none;
        }
        .quill-cheat-header:hover {
          background: #f0f0f0;
        }
        .quill-cheat-title {
          font-weight: 700;
          font-size: 14px;
          color: #06806b;
        }
        .quill-cheat-toggle {
          font-size: 16px;
          color: #057360;
          transition: transform 0.3s ease;
        }
        .quill-cheat-panel.collapsed .quill-cheat-toggle {
          transform: rotate(180deg);
        }
        .quill-cheat-body {
          max-height: 220px;
          overflow-y: auto;
          padding: 10px 12px;
        }
        .quill-cheat-body::-webkit-scrollbar {
          width: 6px;
        }
        .quill-cheat-body::-webkit-scrollbar-track {
          background: #f8f8f8;
          border-radius: 3px;
        }
        .quill-cheat-body::-webkit-scrollbar-thumb {
          background: #06806b;
          border-radius: 3px;
        }
        .quill-cheat-card {
          background: #f8f8f8;
          border: 1px solid #06806b;
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .quill-cheat-card:last-child {
          margin-bottom: 0;
        }
        .quill-cheat-card:hover {
          background: #06806b;
          border-color: #057360;
          transform: translateX(4px);
        }
        .quill-cheat-card:hover .quill-cheat-card-text {
          color: #ffffff;
        }
        .quill-cheat-card-text {
          flex: 1;
          font-size: 14px;
          line-height: 1.4;
          color: #000000;
        }
        .quill-cheat-no-answers {
          color: #888;
          font-style: italic;
          text-align: center;
          padding: 16px;
        }
        .quill-cheat-loading {
          color: #06806b;
          text-align: center;
          padding: 16px;
          font-weight: 600;
        }
        .quill-cheat-header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .quill-cheat-autobutton {
          background: #06806b;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .quill-cheat-autobutton:hover {
          background: #057360;
        }
        .quill-cheat-autopilot {
          background: #f0f0f0;
          color: #057360;
          border: 1px solid #06806b;
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .quill-cheat-autopilot:hover {
          background: #e4f5f2;
        }
        .quill-cheat-autopilot.active {
          background: #06806b;
          color: #ffffff;
          border-color: #057360;
          box-shadow: 0 0 0 2px rgba(6, 128, 107, 0.3);
        }
        .quill-cheat-gear {
          background: #f0f0f0;
          color: #057360;
          border: 1px solid #06806b;
          border-radius: 6px;
          padding: 4px 9px;
          font-size: 13px;
          line-height: 1;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .quill-cheat-gear:hover {
          background: #e4f5f2;
        }
        .quill-cheat-settings {
          display: none;
          padding: 12px 16px;
          background: #ffffff;
          border-top: 1px solid #06806b;
          border-radius: 0 0 10px 10px;
          font-size: 12px;
          font-weight: 600;
          color: #057360;
        }
        .quill-cheat-settings-title {
          font-size: 12px;
          font-weight: 800;
          color: #06806b;
          margin-bottom: 8px;
        }
        .quill-cheat-setting-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin: 7px 0;
        }
        .quill-cheat-setting-row.checkbox-row {
          cursor: pointer;
          user-select: none;
        }
        .quill-cheat-setting-input {
          width: 68px;
          padding: 4px 8px;
          border: 1px solid #06806b;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #000000;
          text-align: right;
        }
        .quill-cheat-settings-note {
          font-size: 11px;
          font-weight: 400;
          color: #888;
          margin-top: 6px;
          line-height: 1.35;
        }
        .quill-cheat-settings-reset {
          background: none;
          border: 1px solid #06806b;
          color: #057360;
          padding: 4px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          margin-top: 8px;
        }
        .quill-cheat-settings-reset:hover {
          background: #e4f5f2;
        }
        .quill-cheat-timer-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 16px;
          background: #f8f8f8;
          border-top: 1px solid #06806b;
          border-radius: 0 0 10px 10px;
          font-size: 12px;
          font-weight: 600;
          color: #057360;
        }
        .quill-cheat-timer-bar .timer-value {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }
      `;
      document.head.appendChild(styles);
    }

    function createPanel() {
      if (answersPanel) return answersPanel;

      answersPanel = document.createElement("div");
      answersPanel.className = "quill-cheat-panel collapsed";
      answersPanel.id = "quill-cheat-answers";

      answersPanel.innerHTML = `
        <div class="quill-cheat-header">
          <span class="quill-cheat-title">Quill Answers</span>
          <div class="quill-cheat-header-actions">
            <button type="button" class="quill-cheat-autobutton" title="Insert the best answer and submit it once">&#9889; Auto</button>
            <button type="button" class="quill-cheat-autopilot" id="quill-cheat-autopilot" title="Auto-pilot — answers every question and clicks Next until the end of the lesson">&#129302; Loop</button>
            <button type="button" class="quill-cheat-gear" id="quill-cheat-gear" title="Loop settings">&#9881;</button>
            <span class="quill-cheat-toggle">&#9650;</span>
          </div>
        </div>
        <div class="quill-cheat-body">
          <div class="quill-cheat-loading">Loading answers...</div>
        </div>
        <div class="quill-cheat-timer-bar">
          <span>Quiz time: <span class="timer-value quiz-elapsed">0:00</span></span>
          <span>Question time: <span class="timer-value question-elapsed">0:00</span></span>
        </div>
        <div class="quill-cheat-settings" id="quill-cheat-settings">
          <div class="quill-cheat-settings-title">Loop settings</div>
          <label class="quill-cheat-setting-row">
            <span>Time on question min (s)</span>
            <input type="number" min="0" max="3600" step="1" class="quill-cheat-setting-input" id="quill-cheat-delay-min" title="Minimum seconds the loop waits on each question before answering">
          </label>
          <label class="quill-cheat-setting-row">
            <span>Time on question max (s)</span>
            <input type="number" min="0" max="3600" step="1" class="quill-cheat-setting-input" id="quill-cheat-delay-max" title="Maximum seconds the loop waits on each question before answering (a random time between min and max is picked per question)">
          </label>
          <label class="quill-cheat-setting-row checkbox-row">
            <span>Always-active window</span>
            <input type="checkbox" id="quill-cheat-always-active">
          </label>
          <div class="quill-cheat-settings-note">Makes Quill's JavaScript believe the tab is always visible, focused and engaged: overrides the visibility/focus/userActivation APIs, swallows blur &amp; visibilitychange signals, and dispatches natural mouse-movement (mousemove/mouseover/pointermove) every 2.5s. Pair with Time on Question so wall-clock time looks like real effort.</div>
          <button type="button" class="quill-cheat-settings-reset" id="quill-cheat-settings-reset">Reset defaults</button>
        </div>
      `;

      answersPanel.querySelector(".quill-cheat-header").addEventListener("click", () => {
        answersPanel.classList.toggle("collapsed");
      });

      answersPanel.querySelector(".quill-cheat-autobutton").addEventListener("click", (event) => {
        event.stopPropagation();
        autoAnswer();
      });

      answersPanel.querySelector(".quill-cheat-autopilot").addEventListener("click", (event) => {
        event.stopPropagation();
        toggleAutoPilot();
      });

      const settingsPanel = answersPanel.querySelector("#quill-cheat-settings");
      const delayMinInput = answersPanel.querySelector("#quill-cheat-delay-min");
      const delayMaxInput = answersPanel.querySelector("#quill-cheat-delay-max");
      const alwaysActiveInput = answersPanel.querySelector("#quill-cheat-always-active");

      answersPanel.querySelector("#quill-cheat-gear").addEventListener("click", (event) => {
        event.stopPropagation();
        settingsPanel.style.display = settingsPanel.style.display === "block" ? "none" : "block";
      });

      delayMinInput.value = settings.answerDelayMin;
      delayMaxInput.value = settings.answerDelayMax;
      alwaysActiveInput.checked = settings.alwaysActive;

      delayMinInput.addEventListener("input", () => {
        settings.answerDelayMin = clampSeconds(delayMinInput.value);
        saveSettings();
      });
      delayMaxInput.addEventListener("input", () => {
        settings.answerDelayMax = clampSeconds(delayMaxInput.value);
        saveSettings();
      });
      alwaysActiveInput.addEventListener("change", () => {
        settings.alwaysActive = alwaysActiveInput.checked;
        saveSettings();
        syncAlwaysActive();
      });

      answersPanel.querySelector("#quill-cheat-settings-reset").addEventListener("click", (event) => {
        event.stopPropagation();
        settings = Object.assign({}, DEFAULT_SETTINGS);
        saveSettings();
        delayMinInput.value = settings.answerDelayMin;
        delayMaxInput.value = settings.answerDelayMax;
        alwaysActiveInput.checked = settings.alwaysActive;
        syncAlwaysActive();
        showToast("Settings reset to defaults");
      });

      document.body.appendChild(answersPanel);
      return answersPanel;
    }

    function getLessonId() {
      const hash = window.location.hash;
      if (hash) {
        const match = hash.match(/\/lesson\/([^?#/]+)/);
        if (match) return match[1];
      }
      const pathMatch = window.location.pathname.match(/\/lesson\/([^?#/]+)/);
      if (pathMatch) return pathMatch[1];
      return null;
    }

    function getQuestionNumberFromPage() {
      const paragraphs = Array.from(document.querySelectorAll("p"));
      for (const p of paragraphs) {
        const text = p.textContent.trim();
        const match = text.match(/(\d+)\s+of\s+\d+/);
        if (match) return parseInt(match[1], 10) - 1;
      }
      return null;
    }

    function isLessonComplete() {
      const url = window.location.href;
      if (url.includes("activity_sessions")) return true;
      const hash = window.location.hash;
      if (hash.includes("/results") || hash.includes("/complete")) return true;
      const allText = document.body.innerText || "";
      if (allText.includes("You've completed the lesson")) return true;
      if (allText.includes("Your results are being saved")) return true;
      if (allText.includes("Activity Complete")) return true;
      return false;
    }

    async function fetchResponsesForQuestion(questionKey) {
      try {
        const url = `https://cms.quill.org/questions/${questionKey}/responses`;
        const response = await fetch(url);
        let data = await response.json();

        if (!Array.isArray(data)) data = [];
        let withText = data.filter((r) => r.text && r.text.trim());

        // Fall back to multiple choice options when there are no text responses
        if (withText.length === 0) {
          try {
            const mcResponse = await fetch(`https://cms.quill.org/questions/${questionKey}/multiple_choice_options`);
            const mcData = await mcResponse.json();
            if (Array.isArray(mcData)) {
              withText = mcData.filter((r) => r.text && r.text.trim());
            }
          } catch (mcError) {
            console.error("Quill Cheat: Error fetching MC options:", mcError);
          }
        }

        if (withText.length === 0) return [];

        const sorted = withText.sort((a, b) => {
          if (a.optimal && !b.optimal) return -1;
          if (!a.optimal && b.optimal) return 1;
          return (b.count || 0) - (a.count || 0);
        });

        return sorted.slice(0, 5).map((r) => ({
          text: r.text,
          optimal: r.optimal,
          count: r.count,
        }));
      } catch (error) {
        console.error("Quill Cheat: Error fetching responses:", error);
        return [];
      }
    }

    function updatePanel(responses) {
      if (!answersPanel) return;

      const body = answersPanel.querySelector(".quill-cheat-body");
      currentResponses = responses;
      const optimal = responses.filter((r) => r.optimal);

      if (optimal.length === 0) {
        body.innerHTML = '<div class="quill-cheat-no-answers">No answers found for this question</div>';
        answersPanel.classList.remove("collapsed");
        return;
      }

      body.innerHTML = "";

      optimal.forEach((response) => {
        const card = document.createElement("div");
        card.className = "quill-cheat-card";

        const textEl = document.createElement("span");
        textEl.className = "quill-cheat-card-text";
        textEl.textContent = response.text;

        card.appendChild(textEl);

        card.addEventListener("click", () => insertAnswer(response.text));

        body.appendChild(card);
      });

      answersPanel.classList.remove("collapsed");
    }

    function findInputField() {
      const selectors = [
        'textarea',
        'input[type="text"]:not([readonly]):not([disabled])',
        '[contenteditable="true"]'
      ];
      const elements = Array.from(document.querySelectorAll(selectors.join(", ")));
      const visible = elements.filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (visible.length === 0) return null;

      const placeholderMatch = visible.find((el) => {
        const ph = (el.placeholder || el.getAttribute("aria-placeholder") || "").toLowerCase();
        return ph.includes("type your answer") || ph.includes("write your");
      });
      if (placeholderMatch) return placeholderMatch;

      return visible[visible.length - 1];
    }

    function findMultipleChoiceButtons() {
      const buttons = Array.from(document.querySelectorAll(
        'button, [role="button"], label, .answer-option, .choice'
      ));
      return buttons.filter((el) => {
        const rect = el.getBoundingClientRect();
        const text = el.textContent.trim();
        return rect.width > 0 && rect.height > 0 && text.length > 0 && text.length < 200;
      });
    }

    function insertAnswer(text) {
      const input = findInputField();

      if (input) {
        input.focus();

        if (input.tagName === "TEXTAREA" || (input.tagName === "INPUT" && input.type === "text")) {
          const nativeSet = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, "value"
          )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          )?.set;

          if (nativeSet) {
            nativeSet.call(input, text);
          } else {
            input.value = text;
          }

          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));

          const tracker = input._valueTracker;
          if (tracker) tracker.setValue("");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (input.isContentEditable) {
          // Quill's answer box is a contenteditable that React reads via the
          // native `beforeinput`/`input` events produced by a real insertion.
          // Replacing textContent directly leaves React's state empty and the
          // submit button stays disabled — use execCommand instead.
          input.focus();
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(input);
            selection.removeAllRanges();
            selection.addRange(range);
          }
          const inserted = document.execCommand("insertText", false, text);
          if (!inserted) {
            input.textContent = text;
          }
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        return;
      }

      const mcButtons = findMultipleChoiceButtons();
      const match = mcButtons.find((btn) => {
        const btnText = btn.textContent.trim().toLowerCase();
        return btnText === text.trim().toLowerCase();
      });
      if (match) {
        match.click();
        return;
      }

      navigator.clipboard.writeText(text).then(() => {
        showCopiedToast();
      }).catch(() => {});
    }

    function showToast(message) {
      const toast = document.createElement("div");
      toast.textContent = message;
      toast.style.cssText = `
        position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
        background: #06806b; color: white; padding: 8px 20px; border-radius: 6px;
        font-size: 13px; font-weight: 600; z-index: 9999999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    }

    function showCopiedToast() {
      showToast("Answer copied to clipboard");
    }

    function formatDuration(ms) {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const formattedMinutes = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
      const formattedSeconds = String(seconds).padStart(2, "0");
      return hours > 0 ? `${hours}:${formattedMinutes}:${formattedSeconds}` : `${formattedMinutes}:${formattedSeconds}`;
    }

    function updateTimerDisplay() {
      const quizElapsedEl = answersPanel?.querySelector(".quiz-elapsed");
      const questionElapsedEl = answersPanel?.querySelector(".question-elapsed");
      if (quizElapsedEl) quizElapsedEl.textContent = formatDuration(Date.now() - quizStartTime);
      if (questionElapsedEl) questionElapsedEl.textContent = formatDuration(Date.now() - questionStartTime);
    }

    function findSubmitButton() {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
      const visible = candidates.filter((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || "").trim();
        const className = (el.className || "").toString();
        const type = (el.getAttribute("type") || "").toLowerCase();

        if (rect.width <= 0 || rect.height <= 0 || !text || text.length >= 200) return false;
        if (el.disabled) return false;
        // Quill disables buttons via a "disabled" class rather than the attribute
        if (/\bdisabled\b/i.test(className)) return false;

        return type === "submit" || /submit|check|grade|save|feedback|continue|next/i.test(text);
      });

      // Prefer real submit actions over "Next"/"Continue" navigation
      const preferred = visible.find((el) =>
        /get feedback|feedback|submit|check|grade|save/i.test((el.textContent || "").trim())
      );
      return preferred || visible[0] || null;
    }

    function submitAnswer() {
      const submitBtn = findSubmitButton();
      if (submitBtn) {
        submitBtn.click();
        return true;
      }

      const input = findInputField();
      if (input) {
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
        return true;
      }

      return false;
    }

    function autoAnswer() {
      const responses = currentResponses;
      const body = answersPanel?.querySelector(".quill-cheat-body");

      if (!responses || responses.length === 0) {
        if (body) body.innerHTML = '<div class="quill-cheat-no-answers">No answers found for this question</div>';
        return;
      }

      const best = responses[0];
      insertAnswer(best.text);

      // Give React a tick to enable the submit/feedback button after our input events
      setTimeout(() => {
        const submitted = submitAnswer();
        if (submitted) {
          showToast("⚡ Auto-answer submitted!");
        } else {
          showToast("⚡ Answer inserted — press Get feedback");
        }
      }, 150);
    }

    function installFocusForgeries() {
      // Pages can only detect focus/visibility/idle through JS APIs — override them
      // so the page always believes the tab is visible, focused and engaged.
      try {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        document.hasFocus = () => true;
        Object.defineProperty(window.navigator, "userActivation", {
          configurable: true,
          get: () => ({ hasBeenActive: true, isActive: true })
        });
      } catch (error) {
        console.error("Quill Cheat: Could not override page focus/visibility:", error);
      }
    }

    function enableAlwaysActive() {
      installFocusForgeries();
      if (alwaysActiveInterval) return;

      // Block blur/visibility signals in the capture phase so page handlers never see them
      const swallow = (event) => event.stopImmediatePropagation();
      ["visibilitychange", "webkitvisibilitychange", "blur", "focusout", "pagehide"].forEach((type) => {
        [window, document].forEach((target) => {
          target.addEventListener(type, swallow, true);
          forgeryListeners.push([target, type, swallow]);
        });
      });

      // Constant jitter — small natural-looking mouse drift every 2.5s so idle
      // timers and input-staleness heuristics (time since last event, etc.) never trip
      alwaysActivePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      alwaysActiveInterval = setInterval(() => {
        const step = () => (Math.random() - 0.5) * 160;
        alwaysActivePosition = {
          x: Math.round(Math.min(Math.max(0, alwaysActivePosition.x + step()), Math.max(1, window.innerWidth - 1))),
          y: Math.round(Math.min(Math.max(0, alwaysActivePosition.y + step()), Math.max(1, window.innerHeight - 1))),
        };
        const shared = {
          clientX: alwaysActivePosition.x,
          clientY: alwaysActivePosition.y,
          bubbles: true,
          cancelable: true,
          view: window,
        };
        document.dispatchEvent(new MouseEvent("mousemove", shared));
        document.dispatchEvent(new MouseEvent("mouseover", shared));
        document.dispatchEvent(new MouseEvent("pointermove", shared));
      }, 2500);
    }

    function disableAlwaysActive() {
      forgeryListeners.forEach(([target, type, listener]) => {
        target.removeEventListener(type, listener, true);
      });
      forgeryListeners = [];
      if (alwaysActiveInterval) clearInterval(alwaysActiveInterval);
      alwaysActiveInterval = null;
    }

    function syncAlwaysActive() {
      if (settings.alwaysActive) {
        enableAlwaysActive();
      } else {
        disableAlwaysActive();
      }
    }

    const AUTO_PILOT_NEVER_CLICK = /save|exit|skip to main|menu|sign ?(in|out)|log ?(in|out)|teacher/i;
    const AUTO_PILOT_ADVANCE = /^(next|continue|begin|start activity|start lesson|got it|move on|see results|view results|finish|complete)(\b.*)?$/i;

    function findAdvanceButton() {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const el of buttons) {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || "").trim();
        const className = (el.className || "").toString();
        const type = (el.getAttribute("type") || "").toLowerCase();

        if (rect.width <= 0 || rect.height <= 0 || !text || text.length >= 200) continue;
        if (el.disabled) continue;
        if (/\bdisabled\b/i.test(className)) continue;
        if (AUTO_PILOT_NEVER_CLICK.test(text)) continue;
        if (type === "submit" || AUTO_PILOT_ADVANCE.test(text)) return el;
      }
      return null;
    }

    function updateAutoPilotButtonUI() {
      const btn = answersPanel?.querySelector(".quill-cheat-autopilot");
      if (btn) btn.classList.toggle("active", autoPilotEnabled);
    }

    function startAutoPilot() {
      if (autoPilotInterval) return;
      autoPilotEnabled = true;
      autoPilotAttempts = 0;
      lastAutoPilotQuestionIndex = null;
      updateAutoPilotButtonUI();
      showToast("🤖 Auto-pilot ON — answering questions and advancing");
      autoPilotInterval = setInterval(autoPilotTick, 900);
      autoPilotTick();
    }

    function stopAutoPilot(reason) {
      if (autoPilotInterval) clearInterval(autoPilotInterval);
      autoPilotInterval = null;
      autoPilotEnabled = false;
      updateAutoPilotButtonUI();
      showToast(reason ? `🤖 Auto-pilot off — ${reason}` : "🤖 Auto-pilot OFF");
    }

    function toggleAutoPilot() {
      if (autoPilotEnabled) {
        stopAutoPilot();
      } else {
        startAutoPilot();
      }
    }

    function autoPilotTick() {
      if (isLessonComplete()) {
        stopAutoPilot("lesson complete 🎉");
        return;
      }

      const questionIndex = getQuestionNumberFromPage();
      if (questionIndex !== lastAutoPilotQuestionIndex) {
        lastAutoPilotQuestionIndex = questionIndex;
        autoPilotAttempts = 0;
        currentQuestionDelayMs = sampleDelayMs();
      }

      const input = findInputField();

      if (input) {
        // Wait the configured "time on question" before answering (min–max, randomized per question)
        if (Date.now() - questionStartTime < currentQuestionDelayMs) return;

        autoPilotAttempts += 1;
        if (autoPilotAttempts > 30) {
          stopAutoPilot("stuck on this question");
          return;
        }

        const best = currentResponses && currentResponses[0] ? currentResponses[0] : null;
        if (!best) {
          stopAutoPilot("no answers available for this question");
          return;
        }

        const bestText = best.text.trim().toLowerCase();
        const currentText = (
          input.tagName === "TEXTAREA" || input.tagName === "INPUT"
            ? input.value
            : (input.textContent || "")
        ).trim().toLowerCase();

        if (currentText === bestText) {
          submitAnswer();
          return;
        }

        insertAnswer(best.text);
        setTimeout(() => {
          if (autoPilotEnabled) submitAnswer();
        }, 150);
        return;
      }

      // No text box — could be a multiple choice question
      const best = currentResponses && currentResponses[0] ? currentResponses[0] : null;
      if (best) {
        // Same "time on question" delay applies to multiple choice questions
        if (Date.now() - questionStartTime < currentQuestionDelayMs) return;

        const bestLower = best.text.trim().toLowerCase();
        const mcButtons = findMultipleChoiceButtons();
        const match = mcButtons.find((btn) => {
          const btnLower = btn.textContent.trim().toLowerCase();
          if (btnLower === bestLower) return true;
          if (bestLower.length >= 20 && btnLower.includes(bestLower)) return true;
          if (btnLower.length >= 20 && bestLower.includes(btnLower)) return true;
          return false;
        });
        if (match) {
          autoPilotAttempts += 1;
          if (autoPilotAttempts > 30) {
            stopAutoPilot("stuck on this question");
            return;
          }
          match.click();
          setTimeout(() => {
            if (autoPilotEnabled) submitAnswer();
          }, 150);
          return;
        }
      }

      const advance = findAdvanceButton();
      if (advance) {
        autoPilotAttempts += 1;
        if (autoPilotAttempts > 40) {
          stopAutoPilot("stuck advancing");
          return;
        }
        advance.click();
        return;
      }

      // Nothing to act on this tick — count it anyway so we can't idle forever
      autoPilotAttempts += 1;
      if (autoPilotAttempts > 45) {
        stopAutoPilot("no action possible");
      }
    }

    async function loadLesson() {
      const lessonId = getLessonId();
      if (!lessonId) return;

      try {
        const url = `https://www.quill.org/api/v1/lessons/${lessonId}.json`;
        const response = await fetch(url);
        const data = await response.json();
        lessonQuestions = data.questions || [];
      } catch (error) {
        console.error("Quill Cheat: Error loading lesson:", error);
      }
    }

    async function onQuestionChange() {
      if (isLessonComplete()) return;

      const questionIndex = getQuestionNumberFromPage();
      if (questionIndex === null) return;

      if (lessonQuestions.length === 0) {
        await loadLesson();
      }

      if (questionIndex >= lessonQuestions.length) return;

      const questionKey = lessonQuestions[questionIndex].key;
      if (questionKey === currentQuestionKey) return;
      currentQuestionKey = questionKey;
      currentResponses = [];
      questionStartTime = Date.now();
      currentQuestionDelayMs = sampleDelayMs();

      const body = answersPanel?.querySelector(".quill-cheat-body");
      if (body) body.innerHTML = '<div class="quill-cheat-loading">Loading answers...</div>';

      const responses = await fetchResponsesForQuestion(questionKey);
      updatePanel(responses);
    }

    function watchForInput() {
      const observer = new MutationObserver(() => {
        if (isLessonComplete()) return;
        const input = findInputField();
        if (input) {
          onQuestionChange();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function watchUrlChange() {
      let lastLessonId = null;
      let lastQuestionNumber = null;

      setInterval(() => {
        if (isLessonComplete()) {
          if (answersPanel) answersPanel.style.display = "none";
          return;
        }
        if (answersPanel) answersPanel.style.display = "";

        const lessonId = getLessonId();
        if (lessonId !== lastLessonId) {
          lastLessonId = lessonId;
          quizStartTime = Date.now();
          questionStartTime = Date.now();
          currentQuestionKey = null;
          currentResponses = [];
        }

        const currentNumber = getQuestionNumberFromPage();
        if (currentNumber !== null && currentNumber !== lastQuestionNumber) {
          lastQuestionNumber = currentNumber;
          currentQuestionKey = null;
          onQuestionChange();
        }
      }, 500);
    }

    function init() {
      injectStyles();
      syncAlwaysActive();
      createPanel();
      loadLesson();
      watchUrlChange();
      watchForInput();

      setTimeout(onQuestionChange, 1500);
      setInterval(updateTimerDisplay, 1000);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();
