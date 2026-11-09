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

# Installation
1. Google Chrome or Firefox (only tested on these two)
2. Install and enable userscripts for [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
3. Then **[Click here to install the userscript](https://github.com/ImPotassium/quill-cheat/raw/main/Quill.org%20Cheat.user.js)**

> **Recommended:** Install [Quill.org QoL Auto-focus & Enter to Next](https://greasyfork.org/en/scripts/578804-quill-org-qol-auto-focus-enter-to-next). This script allows you to press enter to easily go to the next question.

# Structure / Documentation
## How it works
1. The script reads the lesson ID from the URL and fetches question data from the Quill API
2. It detects which question you're on by reading the "X of Y" counter on the page
3. It fetches the correct answer(s) from the CMS API and displays them in a panel at the bottom of the screen
4. Click an answer to insert it into the response box
5. Hit ⚡ Auto to insert the best answer and submit it automatically

## FAQ
### Does the timer reset?
Yes — the quiz timer resets when you start a new lesson and the question timer resets every time you move to a new question.

### What does Auto Answer do?
Clicks the ⚡ Auto button in the answers panel. It grabs the top (optimal) answer for the current question, inserts it into the response box, and submits it — all automatically.

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

