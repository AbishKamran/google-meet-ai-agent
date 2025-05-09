# 🤖 GOOGLE MEET AGENT

Google Meet Agent is a smart automation tool that uses Playwright and OpenAI's Text-to-Speech (TTS) to intelligently join Google Meet calls, speak messages aloud, and even present your screen — all without human intervention.

<br> 

## ✨ FEATURES

### 🎤 TEXT-TO-SPEECH AUDIO

Uses OpenAI TTS to convert text into natural-sounding speech and plays it in the meeting.

### 📅 AUTO JOIN GOOGLE MEET

Automatically opens a meeting link, detects the join button, and clicks it—no user input needed.

### 🖥️ SCREEN SHARING

Automates the “Present now” flow to share your entire screen.

### ⏱️ DYNAMIC TIMED ACTIONS

Adds smart delays based on speech length and interface load times.

### 🔄 KEEP-ALIVE MECHANISM

Prevents disconnection by interacting with the page periodically.

### 🛠️ PERSISTENT GOOGLE LOGIN

Reuses your session across runs using a saved browser profile.

<br>

## 🚀 SETUP

### CLONE THE REPOSITORY

```bash
git clone https://github.com/yourusername/google-meet-agent.git
cd google-meet-agent
```

### Install Dependencies
npm install
npx playwright install

### Set up Environment Variables
Create a .env file in the root directory with your OpenAI API key:
OPENAI_API_KEY=your_openai_api_key_here

### Run the Agent
node bot.js

The bot will:

- Speak a TTS message (e.g., “Joining Google Meet now”)
- Automatically join the specified Google Meet room
- Share your screen
- Optionally open a demo website

<br>

## 🧠 HOW IT WORKS
- Uses playwright.chromium.launchPersistentContext() to reuse your Google login.
- Leverages OpenAI’s TTS to generate .wav audio.
- Automates browser behavior (clicking buttons, navigating) just like a human would.
- Works best on systems where screen and microphone sharing permissions have been granted beforehand.

<br>

🧑‍💻 Author
Made with ❤️ by Abish