<pre>
  ____        _  _ _       ____ _                    _   
 / __ \      (_)| | |    / ____| |                  | |  
| |  | |_   _ _ | | |   | |    | |__   ___   __ _ __| |_ 
| |  | | | | | || | |   | |    | '_ \ / _ \ / _` |__  __|
| |__| | |_| | || | |   | |____| | | |  __/| (_| |  | | 
 \___\_\\__,_|_||_|_|    \_____|_| |_|\___| \__,__|  \__|
</pre>

A fast, cross-browser userscript for Quill.org. It shows the best known answer for the question you're on, can paste and submit it for you, and can auto-pilot a whole activity from start to finish.

> **Note:** this only works because Quill publishes its lesson and answer data in its own public API. Quill can change that API at any time. This project is for educational/personal use; use it responsibly and follow your school's rules.

# Features

- **Live answers** — best answer(s) for the current question, sorted by Quill's own usage counts.
- **One-click answer** — click a card to insert it, or press **Auto** to insert and submit.
- **Auto-pilot** — start it manually and it will read, highlight, answer, submit, advance and finish the activity, then stop itself.
- **Works across Quill** — Connect, Grammar (including fill-in-the-blank), Proofreader, Diagnostic, Reading for Evidence, and generic activity routes.
- **Smart detection** — handles hash routing, question transitions, feedback screens, intro/title cards, language pickers and end-of-activity surveys.
- **Polished panel** — draggable, collapsible, light/dark/auto theme, live quiz/question timers, status and toasts.
- **Always-active mode** — the page sees the tab as visible and focused even when it isn't.
- **Human-like pacing** — optional random min/max delay per question.
- **No external permissions** — `@grant none`, standard DOM APIs, works in Tampermonkey, Violentmonkey, Userscripts and other managers.

# Installation

1. Install a userscript manager for your browser:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox, Safari, Opera)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Edge, Firefox)
   - [Userscripts](https://github.com/quoid/userscripts) (Safari)
2. Open the userscript and install it:
   - **[Install Quill.org Cheat](https://github.com/yofriendfromschool1/quill-cheat/raw/main/Quill.org%20Cheat.user.js)**
3. Open any Quill activity. The panel appears in the bottom-right corner.
> **Recommended:** Install [Quill.org QoL Auto-focus & Enter to Next](https://greasyfork.org/en/scripts/578804-quill-org-qol-auto-focus-enter-to-next). This script allows you to press enter to easily go to the next question.

# Usage

- Click **Auto** (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>) to answer the current question.
- Click **Loop** (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>) to start or stop auto-pilot.
- Click an answer card to insert that answer without submitting.
- Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> to collapse/expand, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Q</kbd> to hide/show the panel, and <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> to open settings.
- Drag the header to move the panel; the position is remembered.
- Open **⚙ Settings** to change the theme, per-question delay, always-active mode, or reset the panel.

## Auto-pilot behavior

Auto-pilot is deliberately **manual-start**. It:

1. Answers each question with the best available answer and submits it.
2. Reads the feedback and retries with the next strong answer if Quill rejects the first one.
3. Clicks Next/Continue/Done through feedback, reflection and title screens.
4. Handles Proofreader corrections and review cards.
5. Handles Reading for Evidence highlights, prompts, revisions and the final survey.
6. Stops on activity completion, when you change activities, or if it gets stuck instead of clicking randomly.

## Supported tools

| Tool | Support |
| --- | --- |
| Connect | Full auto-pilot |
| Grammar | Full auto-pilot (multiple choice, written responses, fill-in-the-blank) |
| Proofreader | Full auto-fix and review. Note: Quill disables the final **Done** button for anonymous proofreader plays, so auto-pilot stops after the last review card. |
| Diagnostic | Full auto-pilot through the placement activity |
| Reading for Evidence | Full auto-pilot: highlights, 3 prompts, revisions, survey |
| Lessons | Panel detects teacher-led lessons and explains that Quill publishes no answer key for them |
| Other `/play/...` activities | Generic fallback using Quill's activity API |

# How it works

1. The script reads the lesson/activity id from the URL and determines which Quill tool you're in.
2. It fetches the lesson structure from Quill's public API and resolves the current question from the page.
3. Answers come from the CMS response data embedded in the lesson and/or `https://cms.quill.org/questions/{key}/responses` and `.../multiple_choice_options`.
4. Proofreader corrections are parsed from passage markers such as `{+correct-wrong|concept}` and matched against the underlined words in the DOM.
5. Fill-in-the-blank answers are aligned word-by-word against the prompt so each blank gets the right words.
6. Reading for Evidence prompts are mapped by their `#prompt-editor-{promptId}` container, so a new prompt can never be filled with the previous prompt's answer.
7. The panel is rendered in a Shadow DOM so Quill's CSS can't break it.

## FAQ

### Does the timer reset?
The quiz timer resets when you start a new activity; the question timer resets on each new question, and both freeze when the activity is complete.

### Does auto-pilot start by itself?
No. You have to press **Loop** on each activity. This avoids accidentally running through something you opened to read.

### What does Auto do?
It inserts the best answer for the current question and submits it. If there is no question yet, it advances past intro/title screens.

### What is always-active mode?
It overrides the page's view of `document.hidden`, `document.visibilityState`, `document.hasFocus()`, focus/blur and visibility events, and sends a lightweight heartbeat. It does **not** change your operating system's focus; it only affects what Quill's JavaScript can detect. Quill still records real wall-clock time, so use the time-on-question setting if you care about pacing.

### Why did auto-pilot stop?
It stops on purpose when:
- the activity is complete,
- you changed activities,
- it detects a teacher-led lesson (no public answer key),
- both published Evidence examples were rejected,
- or it has been stuck for too long.

The status line in the panel tells you why.

### Are answers always correct?
No. Quill's accepted answers change over time, and some prompts are graded by AI. The script uses the highest-usage optimal answers and falls back to the next strong answer, but occasional manual review may still be needed.

# API reference

You can reproduce the core behavior without the script.

## Lesson data

```
https://www.quill.org/api/v1/lessons/{lessonId}.json
```

Returns the lesson name and a `questions` array. Each entry has a `key` used below.

```json
{
  "name": "That & Which 2",
  "questions": [
    { "key": "-Kvhp3xrJYkJ4FPM5Orj", "questionType": "questions" }
  ]
}
```

## Answers

Written responses:

```
https://cms.quill.org/questions/{questionKey}/responses
```

Multiple-choice options:

```
https://cms.quill.org/questions/{questionKey}/multiple_choice_options
```

Both return arrays of answers:

```json
[
  {
    "id": 2673861,
    "text": "I prefer the shirt that has blue stripes.",
    "optimal": true,
    "count": 294193,
    "feedback": "<p>That's a strong sentence!</p>"
  }
]
```

- `text` — the answer text
- `optimal` — `true` for an accepted answer
- `count` — how many times the answer has been submitted

## Reading for Evidence

```
https://www.quill.org/api/v1/evidence/activities/{uid}
```

The response contains `prompts`, each with a `conjunction`, `text`, `first_strong_example` and `second_strong_example`. Auto-pilot fills the sentence stem plus one strong example.

## Proofreader

```
https://www.quill.org/api/v1/lessons/{uid}.json
```

Proofreader passages contain markers in the form `{+correct-wrong|concept}`; the script parses and applies those corrections.
