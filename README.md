<pre>
  ____        _  _ _       ____ _                    _   
 / __ \      (_)| | |    / ____| |                  | |  
| |  | |_   _ _ | | |   | |    | |__   ___   __ _ __| |_ 
| |  | | | | | || | |   | |    | '_ \ / _ \ / _` |__  __|
| |__| | |_| | || | |   | |____| | | |  __/| (_| |  | | 
 \___\_\\__,_|_||_|_|    \_____|_| |_|\___| \__,__|  \__|
</pre>

Displays and pastes optimal responces because every responce for every question in every lesson is in Quill's public API.

# Features
- **Live answers** — shows the optimal answer(s) for the question you're currently on.
- **Quiz timer** — a live timer in the panel showing how long you've been on the current quiz, plus how long you've spent on the current question.
- **Auto Answer** — the ⚡ Auto button inserts the best answer and submits it for you in one click.
- **Auto-pilot (🤖 Loop)** — a toggle that auto-answers every question and clicks Next/Continue until the lesson is complete, then stops itself.
- **Loop settings (⚙)** — set a min/max "time on question" so the loop waits a human-like random time per question instead of speeding through, and toggle "Always-active window" so Quill's JavaScript sees the tab as visible/focused at all times (like Canvashack).

# Installation
1. Google Chrome or Firefox (only tested on these two)
2. Install and enable userscripts for [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
3. Then **[Click here to install the userscript](https://github.com/yofriendfromschool1/quill-cheat/raw/main/Quill.org%20Cheat.user.js)**
4. [Always Active Window](https://webextension.org/listing/always-active.html)

> **Recommended:** Install [Quill.org QoL Auto-focus & Enter to Next](https://greasyfork.org/en/scripts/578804-quill-org-qol-auto-focus-enter-to-next). This script allows you to press enter to easily go to the next question.

# Structure / Documentation
## How it works
1. The script reads the lesson ID from the URL and fetches question data from the Quill API
2. It detects which question you're on by reading the "X of Y" counter on the page
3. It fetches the correct answer(s) from the CMS API and displays them in a panel at the bottom of the screen
4. Click an answer to insert it into the response box
5. Hit ⚡ Auto to insert the best answer and submit it automatically
6. Or toggle 🤖 Loop to answer every question and advance through the whole lesson automatically

## FAQ
### Does the timer reset?
Yes — the quiz timer resets when you start a new lesson and the question timer resets every time you move to a new question.

### What does Auto Answer do?
Clicks the ⚡ Auto button in the answers panel. It grabs the top (optimal) answer for the current question, inserts it into the response box, and submits it — all automatically.

### What does 🤖 Loop do?
Toggles auto-pilot. While it's on, every ~900ms the script checks the page: if it's a question it inserts the optimal answer and submits it (multiple choice included), and if it's a feedback or intro screen it clicks the advance button (Next, Continue, Begin, etc.). It never clicks Save and Exit, and it stops itself automatically when the lesson is complete or it gets stuck.

### What are the ⚙ Loop settings?
- **Time on question min/max** — when set, the loop waits a *random* time between min and max seconds per question before answering (both 0 = instant, the default). Use this when you want the activity to take a natural amount of time on Quill rather than being finished in under a minute.
- **Always-active window** — makes the page always report `document.hidden = false` / `visibilityState = 'visible'` / `document.hasFocus() = true`, blocks `blur`/`visibilitychange` events in the capture phase, and dispatches a synthetic mouse movement every 15 seconds so idle detection doesn't flag you. Honest caveat: a userscript can't force OS-level window focus — this only neutralizes what the page's JavaScript can detect. Quill also tracks real wall-clock time, so pair this setting with a time-on-question setting for a natural look. Settings persist in localStorage across reloads.

## API Documentation
> You can also do this yourself without the script, by following the steps here
### Lesson URL Pattern
```
https://www.quill.org/connect/#/play/lesson/{lessonId}?activities={activityIndex}&student={studentId}
```
- `lessonId` — the lesson identifier (e.g. `-L1sW9oOPAuLTPCWNbTI`)

### Step 1 — Get lesson data
```
https://www.quill.org/api/v1/lessons/{lessonId}.json
```
Returns a JSON object with a `questions` array. Each question has a `key` field used in Step 2.

Example response structure:
```json
{
  "name": "That & Which 2",
  "questions": [
    { "key": "-Kvhp3xrJYkJ4FPM5Orj", "questionType": "questions" },
    { "key": "-KvhpAQdZBZFPhjsF49Z", "questionType": "questions" }
  ]
}
```
- `questions[0].key` = first question's key

### Step 2 — Get answers for a question

#### Written Responses
```
https://cms.quill.org/questions/{questionKey}/responses
```
Returns an array of response objects:
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
- `optimal` — `true` if this is a correct/accepted answer
- `count` — how many times this response has been submitted

#### Multiple Choice Responses
```
https://cms.quill.org/questions/{questionKey}/multiple_choice_options
```
Returns the same format as written responses.

