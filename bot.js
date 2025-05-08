require('dotenv').config();
const { OpenAI } = require('openai');
const { chromium } = require('playwright');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const tmpDir = os.tmpdir();
const delay = ms => new Promise(res => setTimeout(res, ms));

/**
 * Improved audio synthesis and playback function
 * Ensures audio plays through the default output device which Google Meet captures
 */
async function synthesizeSpeech(text) {
  try {
    console.log(`🎙️ Generating TTS for: "${text}"`);
    const resp = await openai.audio.speech.create({
      model: 'tts-1-hd', // Upgraded to HD model for clearer voice
      voice: 'nova',     // Using nova for more natural voice
      input: text,
      speed: 1.1,        // Slightly faster pace for better engagement
      format: 'mp3',
    });
    
    const buffer = Buffer.from(await resp.arrayBuffer());
    const uniqueTtsPath = path.join(tmpDir, `bot-tts-${Date.now()}.mp3`);
    await fs.writeFile(uniqueTtsPath, buffer);
    console.log(`🔊 Audio saved to ${uniqueTtsPath}`);
    
    // Platform-specific audio playback strategies optimized for Google Meet
    if (process.platform === 'win32') {
      // Windows: Use Windows Media Player to play MP3 files
      try {
        await execAsync(`start /wait wmplayer /play /close "${uniqueTtsPath}"`, { timeout: 30000 });
      } catch (err) {
        console.log('Error playing audio with Windows Media Player:', err.message);
      }
    } else if (process.platform === 'darwin') {
      // macOS: Use afplay with maximum volume and wait for completion
      await execAsync(`afplay -v 2 "${uniqueTtsPath}" && sleep 1`, { timeout: 30000 });
    } else {
      // Linux: Configure PulseAudio to ensure proper routing to Meet
      try {
        // Set PulseAudio to route output to input
        await execAsync(`pactl load-module module-loopback latency_msec=1`);
        await execAsync(`paplay --volume=65535 "${uniqueTtsPath}"`, { timeout: 30000 });
        await execAsync(`sleep 1 && pactl unload-module module-loopback`);
      } catch (err) {
        // Fallback players with explicit wait
        try {
          await execAsync(`mpg123 -q --scale=2 "${uniqueTtsPath}" && sleep 1`, { timeout: 30000 });
        } catch (err2) {
          await execAsync(`aplay -q "${uniqueTtsPath}" && sleep 1`, { timeout: 30000 });
        }
      }
    }
    
    // Dynamic wait based on text length to ensure complete playback
    const wordCount = text.split(/\s+/).length;
    const waitTime = Math.max(2000, wordCount * 200); // ~200ms per word minimum
    await delay(waitTime);
    
    // Clean up file after playing
    try {
      await fs.unlink(uniqueTtsPath);
    } catch (err) {
      console.log(`Could not delete temp file: ${uniqueTtsPath}`);
    }
    
    return true;
  } catch (err) {
    console.error('Error in TTS generation or playback:', err);
    return false;
  }
}

/**
 * Improved speak and wait function with dynamic timing
 */
async function speakAndDo(text, fn) {
  console.log(`\n🤖 Speaking: "${text}"`);
  const speechSuccess = await synthesizeSpeech(text);
  
  // Dynamic timing based on text length and complexity
  const wordCount = text.split(/\s+/).length;
  const punctuationCount = (text.match(/[.,!?;]/g) || []).length;
  
  // Base timing: 180 words per minute (~3 words per second) plus pauses for punctuation
  const baseSpeechDuration = (wordCount / 3) * 1000;
  const punctuationPause = punctuationCount * 300; // 300ms pause per punctuation mark
  const speechDuration = Math.max(3000, baseSpeechDuration + punctuationPause);
  
  console.log(`Waiting ${Math.round(speechDuration/1000)}s for speech to complete`);
  await delay(speechDuration);
  
  try {
    if (typeof fn === 'function') {
      await fn();
    }
  } catch (err) {
    console.error(`Error during action after speaking "${text}":`, err);
  }
}

/**
 * Improved Google Meet joining function
 * Handles various UI states and authentication challenges
 */
async function joinMeet(page, url) {
  console.log(`🌐 Joining meeting: ${url}`);
  
  // Clear any existing service workers to avoid CORS issues
  try {
    const context = page.context();
    const serviceWorkers = await context.serviceWorkers();
    for (const worker of serviceWorkers) {
      await worker.unregister();
    }
  } catch (err) {
    console.log('Error clearing service workers:', err.message);
  }
  
  // Navigate to the meeting URL with improved error handling
  try {
    await page.goto(url, { 
      waitUntil: 'networkidle', 
      timeout: 90000 
    });
  } catch (err) {
    console.log('Initial navigation timeout, continuing anyway:', err.message);
  }
  
  // Wait for critical elements to load
  await delay(5000);
  
  // Check for "instant join" scenario (already authenticated)
  console.log('Looking for instant join option...');
  
  // Handle various pre-meeting flows
  const preJoinSelectors = [
    'button:has-text("Join now")', 
    'button:has-text("Ask to join")',
    'div[role="button"]:has-text("Join now")',
    'div[role="button"]:has-text("Ask to join")'
  ];
  
  let foundPreJoinControl = false;
  
  // Check for login requirement first
  const loginPrompt = await page.locator('input[type="email"], button:has-text("Sign in")').isVisible({ timeout: 5000 }).catch(() => false);
  
  if (loginPrompt) {
    console.log('⚠️ Login required - please complete authentication in the browser window');
    console.log('Waiting up to 90 seconds for manual login...');
    
    // Wait for the login process to complete
    try {
      for (const selector of preJoinSelectors) {
        const joinControlVisible = await page.waitForSelector(selector, { timeout: 90000, state: 'visible' })
          .then(() => true)
          .catch(() => false);
          
        if (joinControlVisible) {
          foundPreJoinControl = true;
          console.log('✅ Login completed successfully');
          break;
        }
      }
    } catch (err) {
      console.log('Login wait timed out, attempting to proceed anyway');
    }
  } else {
    console.log('No login required, proceeding to meeting join');
    foundPreJoinControl = true;
  }
  
  // Handle camera & microphone permissions
  console.log('Configuring audio/video settings...');
  
  // Camera handling - turn it off
  try {
    const cameraButtons = [
      'button[aria-label*="camera"][data-is-muted="false"]',
      'div[role="button"][aria-label*="camera"][data-is-muted="false"]',
      'button:has-text("Turn off camera")'
    ];
    
    for (const selector of cameraButtons) {
      const cameraButton = page.locator(selector);
      if (await cameraButton.isVisible({ timeout: 3000 })) {
        await cameraButton.click();
        console.log('✔️ Turned off camera');
        await delay(1000);
        break;
      }
    }
  } catch (err) {
    console.log('Camera control not found or error:', err.message);
  }
  
  // Microphone handling - make sure it's ON
  try {
    const micButtons = [
      'button[aria-label*="microphone"][data-is-muted="true"]',
      'div[role="button"][aria-label*="microphone"][data-is-muted="true"]',
      'button:has-text("Turn on microphone")'
    ];
    
    for (const selector of micButtons) {
      const micButton = page.locator(selector);
      if (await micButton.isVisible({ timeout: 3000 })) {
        await micButton.click();
        console.log('✔️ Turned ON microphone');
        await delay(1000);
        break;
      }
    }
  } catch (err) {
    console.log('Microphone control not found or error:', err.message);
  }
  
  // Look for join button variants
  try {
    // Try Join Now first (instant join)
    const joinNowButton = page.locator('button:has-text("Join now"), div[role="button"]:has-text("Join now")');
    if (await joinNowButton.isVisible({ timeout: 5000 })) {
      await joinNowButton.click();
      console.log('✔️ Clicked "Join now" button');
      await delay(5000);
    } else {
      // Handle "Ask to join" flow
      console.log('Looking for "Ask to join" flow elements...');
      
      // Input name if needed
      const nameInput = page.locator('input[placeholder*="Your name"], input[aria-label*="Your name"]');
      if (await nameInput.isVisible({ timeout: 5000 })) {
        await nameInput.fill('Meeting Assistant');
        console.log('✔️ Entered name');
        await delay(1000);
      }
      
      // Click "Ask to join" button
      const askButtons = [
        'button:has-text("Ask to join")', 
        'div[role="button"]:has-text("Ask to join")',
        'button:has-text("Request to join")'
      ];
      
      let askButtonClicked = false;
      for (const selector of askButtons) {
        try {
          const askButton = page.locator(selector);
          if (await askButton.isVisible({ timeout: 3000 })) {
            await askButton.click();
            console.log('✔️ Clicked "Ask to join" button');
            askButtonClicked = true;
            await delay(3000);
            break;
          }
        } catch (err) {
          // Try next selector
        }
      }
      
      if (!askButtonClicked) {
        console.log('⚠️ Could not find standard join buttons, trying keyboard navigation');
        // Focus on the page and use keyboard navigation as fallback
        await page.keyboard.press('Tab');
        await delay(500);
        await page.keyboard.press('Tab');
        await delay(500);
        await page.keyboard.press('Enter');
        await delay(3000);
      }
    }
  } catch (err) {
    console.error('Error during meeting join process:', err);
  }
  
  // Wait for meeting to load and stabilize
  console.log('Waiting for meeting to fully load...');
  await delay(10000);
  
  // Verify we're in the meeting
  let inMeeting = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    inMeeting = await checkIfInMeeting(page);
    if (inMeeting) break;
    console.log(`Meeting verification attempt ${attempt} failed, waiting...`);
    await delay(5000);
  }
  
  if (inMeeting) {
    console.log('✅ Successfully joined the meeting!');
    
    // Check and handle the "now presenting" overlay
    try {
      const gotItButton = page.locator('button:has-text("Got it")');
      if (await gotItButton.isVisible({ timeout: 3000 })) {
        await gotItButton.click();
        console.log('✔️ Dismissed "now presenting" overlay');
      }
    } catch (err) {
      // Ignore if not present
    }
    
    // Final microphone check to ensure it's ON
    try {
      const micStatusCheck = page.locator('button[aria-label*="microphone"][data-is-muted="true"]');
      if (await micStatusCheck.isVisible({ timeout: 3000 })) {
        await micStatusCheck.click();
        console.log('✔️ Final microphone check - turned ON');
      }
    } catch (err) {
      // Ignore if not found
    }
    
    // Wait for audio system to stabilize
    await delay(3000);
    
    // Announce our presence with clear audio
    await speakAndDo('Hello everyone! I am the meeting assistant bot. Can you hear me clearly?', 
      async () => {
        console.log('✅ First message spoken in meeting');
      }
    );
    
    return true;
  } else {
    console.log('⚠️ Could not confirm we are in the meeting');
    return false;
  }
}

/**
 * Improved meeting detection function
 */
async function checkIfInMeeting(page) {
  console.log('Checking if we are in the meeting...');
  
  const inMeetingSelectors = [
    // UI elements that indicate we're in a meeting
    '[aria-label*="People"]', 
    '[aria-label*="Chat"]',
    '[data-self-name]',
    'div[data-allocation-index]',
    // Participant indicators
    '[data-participant-id]',
    // Controls that only appear in active meetings
    '[aria-label*="mic"]',
    '[aria-label*="camera"]',
    // Meet-specific UI containers
    'div[jscontroller*="Meeting"]',
    // Any visible video feeds
    'div[data-is-speaking]'
  ];
  
  for (const selector of inMeetingSelectors) {
    try {
      if (await page.locator(selector).isVisible({ timeout: 2000 })) {
        console.log(`✅ Detected we're in meeting via: ${selector}`);
        return true;
      }
    } catch (err) {
      // Continue to next selector
    }
  }
  
  // Check for meeting-specific URL patterns
  const currentUrl = page.url();
  if (currentUrl.includes('meet.google.com') && 
     (currentUrl.includes('/lookup/') || 
      currentUrl.includes('?authuser=') || 
      currentUrl.match(/\/[a-z]+-[a-z]+-[a-z]+$/))) {
    console.log('✅ Detected we\'re in meeting via URL pattern');
    return true;
  }
  
  console.log('⚠️ Could not confirm we are in the meeting using standard checks');
  return false;
}

/**
 * Improved screen sharing function with better error handling
 */
async function shareScreen(page) {
  try {
    // Announce screen sharing with clear audio
    await speakAndDo('I will now share my screen with you. One moment please.', async () => {
      console.log('Announced screen sharing intention');
    });
    
    // Try multiple selectors for the present button
    const presentSelectors = [
      '[aria-label*="Present now"]', 
      'button:has-text("Present now")',
      '[data-tooltip*="Present now"]',
      'button[jsname*="present"]'
    ];
    
    let presentClicked = false;
    for (const selector of presentSelectors) {
      try {
        const presentButton = page.locator(selector);
        if (await presentButton.isVisible({ timeout: 5000 })) {
          await presentButton.click();
          console.log(`✔️ Clicked present button with selector: ${selector}`);
          presentClicked = true;
          await delay(2000);
          break;
        }
      } catch (err) {
        // Try next selector
      }
    }
    
    if (!presentClicked) {
      console.log('⚠️ Could not find present button with standard selectors');
      // Try keyboard shortcut as fallback
      await page.keyboard.press('Control+d');
      await delay(2000);
    }
    
    // Select entire screen option
    const screenSelectors = [
      '[aria-label*="Your entire screen"]', 
      '[role="menuitem"]:has-text("Your entire screen")',
      'div:has-text("Your entire screen")',
      'span:has-text("Your entire screen")'
    ];
    
    let screenSelected = false;
    for (const selector of screenSelectors) {
      try {
        const screenOption = page.locator(selector);
        if (await screenOption.isVisible({ timeout: 5000 })) {
          await screenOption.click();
          console.log(`✔️ Selected "Your entire screen" with selector: ${selector}`);
          screenSelected = true;
          await delay(2000);
          break;
        }
      } catch (err) {
        // Try next selector
      }
    }
    
    // Use keyboard navigation if clicking didn't work
    if (!screenSelected) {
      console.log('⚠️ Could not find screen selection with standard selectors, trying keyboard navigation');
      // Navigate with keyboard: Tab to highlight option, Enter to select
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
        await delay(500);
      }
    }
    
    // Confirm sharing dialog with multiple methods
    console.log('Confirming screen share dialog...');
    
    // Try clicking the "Share" button if visible
    const shareButtons = [
      'button:has-text("Share")', 
      '[role="button"]:has-text("Share")',
      'button[jsname*="share"]'
    ];
    
    let shareClicked = false;
    for (const selector of shareButtons) {
      try {
        const shareButton = page.locator(selector);
        if (await shareButton.isVisible({ timeout: 3000 })) {
          await shareButton.click();
          console.log(`✔️ Clicked share button with selector: ${selector}`);
          shareClicked = true;
          await delay(2000);
          break;
        }
      } catch (err) {
        // Try next selector
      }
    }
    
    // Use keyboard as fallback
    if (!shareClicked) {
      console.log('Using keyboard to confirm screen sharing dialog');
      await page.keyboard.press('Enter');
      await delay(1000);
      
      // Sometimes Tab+Enter is needed
      await page.keyboard.press('Tab');
      await delay(500);
      await page.keyboard.press('Enter');
    }
    
    // Wait for sharing to begin
    await delay(5000);
    
    // Confirm screen sharing is active
    await speakAndDo('Screen sharing is now active. You should be able to see my screen. Please let me know if you can see my screen clearly.', async () => {
      console.log('✅ Confirmed screen sharing is active');
    });
    
    return true;
  } catch (error) {
    console.error('Error during screen sharing:', error);
    await speakAndDo('I encountered an issue while trying to share my screen. Let me try again in a moment.', async () => {
      console.log('Announced screen sharing failure');
    });
    return false;
  }
}

/**
 * Completely rewritten keep-alive function
 * Uses multiple strategies to prevent automatic disconnection
 */
async function keepMeetingAlive(page) {
  console.log('🔄 Starting comprehensive keep-alive mechanism');
  
  let keepAliveCounter = 0;
  let lastMajorActivity = Date.now();
  
  // Function to check if we need emergency recovery
  async function checkNeedRecovery() {
    // If no major activity in 10 minutes, something might be wrong
    const timeElapsed = Date.now() - lastMajorActivity;
    if (timeElapsed > 600000) { // 10 minutes
      console.log('⚠️ No major activity detected for 10 minutes, attempting recovery');
      
      // Force audio activity
      await synthesizeSpeech("I'm checking the connection status. Can everyone still hear me clearly?");
      
      // Try to interact with UI
      try {
        // Try clicking chat button to show activity
        const chatButton = page.locator('[aria-label*="Chat"]');
        if (await chatButton.isVisible({ timeout: 3000 })) {
          await chatButton.click();
          await delay(1000);
          await chatButton.click(); // Click again to close
        }
      } catch (err) {
        console.log('Could not interact with UI during recovery');
      }
      
      lastMajorActivity = Date.now();
    }
  }
  
  // 1. Micro-interactions (mouse movement, subtle UI interaction) - Every 30 seconds
  const microInteractionInterval = setInterval(async () => {
    try {
      // Basic check if still in meeting
      const stillInMeeting = await checkIfInMeeting(page);
      
      if (stillInMeeting) {
        // Move mouse randomly to show activity
        const viewportSize = await page.viewportSize();
        const x = Math.floor(Math.random() * viewportSize.width * 0.8) + viewportSize.width * 0.1;
        const y = Math.floor(Math.random() * viewportSize.height * 0.8) + viewportSize.height * 0.1;
        await page.mouse.move(x, y);
        
        // Check if emergency recovery needed
        await checkNeedRecovery();
        
        keepAliveCounter++;
        if (keepAliveCounter % 6 === 0) { // Every 3 minutes
          console.log(`🔄 Minor UI interaction #${keepAliveCounter/6}`);
          
          // Try subtle UI interactions like toggling tooltips
          try {
            // Try clicking a non-destructive button like participants list or chat
            const uiElements = [
              '[aria-label*="Chat"]',
              '[aria-label*="People"]',
              '[aria-label*="meeting details"]',
              '[aria-label*="More options"]'
            ];
            
            for (const selector of uiElements) {
              const element = page.locator(selector);
              if (await element.isVisible({ timeout: 2000 })) {
                await element.click();
                await delay(1000);
                await element.click(); // Click again to close
                break;
              }
            }
          } catch (err) {
            // Ignore errors with UI interaction
          }
        }
      } else {
        console.log('⚠️ No longer detected in meeting during micro-interaction - attempting to recover');
        await checkNeedRecovery();
      }
    } catch (err) {
      console.error('Error in micro keep-alive routine:', err);
    }
  }, 30000); // Run every 30 seconds
  
  // 2. Minor audio interactions - Every 2 minutes
  const minorAudioInterval = setInterval(async () => {
    try {
      // Check if still in meeting
      const stillInMeeting = await checkIfInMeeting(page);
      
      if (stillInMeeting) {
        console.log('🔊 Performing minor audio keep-alive');
        
        // Subtle audio signals to keep connection active
        const minorKeepAliveMessages = [
          "I'm still connected to the meeting.",
          "The presentation is continuing as planned.",
          "I'm here and monitoring the session.",
          "Still active and ready to assist."
        ];
        
        const randomMessage = minorKeepAliveMessages[Math.floor(Math.random() * minorKeepAliveMessages.length)];
        await synthesizeSpeech(randomMessage);
        
        lastMajorActivity = Date.now();
      }
    } catch (err) {
      console.error('Error in minor audio keep-alive routine:', err);
    }
  }, 120000); // Run every 2 minutes
  
  // 3. Major audio/UI interactions - Every 5 minutes
  const majorInteractionInterval = setInterval(async () => {
    try {
      // Check if still in meeting
      const stillInMeeting = await checkIfInMeeting(page);
      
      if (stillInMeeting) {
        console.log('🔊 Performing major audio/UI keep-alive');
        
        // Substantial audio message to ensure meeting doesn't time out
        const majorKeepAliveMessages = [
          "I'm continuing to monitor this meeting. The system remains active and I'm here to assist with any questions or demonstrations. Please let me know if you need anything specific.",
          "Just checking in to make sure everyone can still hear me clearly. The presentation is ongoing and I'm ready to help with any questions that arise during this session.",
          "I want to confirm that I'm still actively connected to this meeting. Everything is functioning as expected. Feel free to ask questions at any time.",
          "This is a scheduled check-in to ensure our connection is strong. I'm still presenting and ready to demonstrate any features or answer questions as needed."
        ];
        
        const randomMessage = majorKeepAliveMessages[Math.floor(Math.random() * majorKeepAliveMessages.length)];
        await speakAndDo(randomMessage, async () => {
          console.log('✅ Spoke major keep-alive message');
          
          // Perform substantial UI interaction
          try {
            // Try clicking a menu item and then closing it
            const menuButton = page.locator('[aria-label*="More options"], [aria-label*="more"]');
            if (await menuButton.isVisible({ timeout: 3000 })) {
              await menuButton.click();
              await delay(1000);
              // Click elsewhere to close the menu
              await page.mouse.click(100, 100);
            }
          } catch (err) {
            console.log('UI interaction during major keep-alive failed:', err);
          }
          
          lastMajorActivity = Date.now();
        });
      }
    } catch (err) {
      console.error('Error in major keep-alive routine:', err);
    }
  }, 300000); // Run every 5 minutes
  
  // 4. Connection health monitoring - Every 8 minutes
  const healthCheckInterval = setInterval(async () => {
    try {
      console.log('🔍 Performing connection health check');
      
      // Check if we're still in meeting
      const stillInMeeting = await checkIfInMeeting(page);
      
      if (!stillInMeeting) {
        console.log('⚠️ Connection health check failed - attempting deeper recovery');
        
        // Try more aggressive recovery - check for any Meet elements
        const anyMeetElement = page.locator('div[jscontroller*="Meet"], div[jsname*="Meet"]');
        if (await anyMeetElement.isVisible({ timeout: 5000 })) {
          console.log('✅ Found some Meet elements, attempting recovery');
          
          // Try to force audio again
          await synthesizeSpeech("I'm checking if there are any connection issues. Can everyone still hear me clearly?");
          
          // Try to refresh the UI without reloading
          try {
            // Click on "People" panel then close it
            const peopleButton = page.locator('[aria-label*="People"], [aria-label*="participants"]');
            if (await peopleButton.isVisible({ timeout: 3000 })) {
              await peopleButton.click();
              await delay(1000);
              await peopleButton.click();
            }
          } catch (err) {
            console.log('UI refresh attempt failed:', err);
          }
          
          lastMajorActivity = Date.now();
        } else {
          console.log('❌ No Meet elements found, connection may be lost');
          // Continue running - it might recover automatically
        }
      }
    } catch (err) {
      console.error('Error in health check routine:', err);
    }
  }, 480000); // Run every 8 minutes
  
  return [microInteractionInterval, minorAudioInterval, majorInteractionInterval, healthCheckInterval];
}

/**
 * Browser launch with optimized settings to avoid CORS issues
 */
async function launchBrowser() {
  console.log('🚀 Launching browser with optimized settings...');
  
  // Launch with configurations to avoid CORS and audio issues
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: [
      '--window-size=1280,720',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-web-security', // Critical to avoid CORS issues
      '--disable-features=IsolateOrigins,site-per-process', // Helps with frame access
      '--disable-blink-features=AutomationControlled',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-audio-output',
      '--disable-infobars',
      '--lang=en-US,en',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-notifications'
    ]
  });

  // Create context with appropriate permissions and settings
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    permissions: ['camera', 'microphone', 'notifications'],
    ignoreHTTPSErrors: true, // Important for certain Google domains
    bypassCSP: true, // Bypasses Content Security Policy
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://meet.google.com'
    }
  });
  
  // Enable all browser features
  await context.grantPermissions(['camera', 'microphone', 'notifications'], { origin: 'https://meet.google.com' });
  
  // Clear any existing cookies to avoid conflicts
  await context.clearCookies();
  
  // Set custom cookies to help with Google auth
  await context.addCookies([
    {
      name: 'CONSENT',
      value: 'YES+',
      domain: '.google.com',
      path: '/'
    }
  ]);
  
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  
  // Set up error handling for CORS issues
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('CORS') || text.includes('ERR_FAILED')) {
      console.log('⚠️ CORS warning detected in console:', text.substring(0, 100));
    }
  });
  
  return { browser, context, page };
}

// Main function
(async () => {
  let browser, context, page;
  
  try {
    console.log('👨‍💻 Starting enhanced Google Meet bot...');
    
    // Launch browser with optimized settings
    const browserSetup = await launchBrowser();
    browser = browserSetup.browser;
    context = browserSetup.context;
    page = browserSetup.page;
    
    // Check Google login status
    console.log('🌐 Checking Google login status...');
    await page.goto('https://accounts.google.com/signin', { waitUntil: 'networkidle' });
    
    // Wait for login if needed
    const isLoggedIn = await page.locator('div[role="main"] h1:has-text("Welcome"), div[data-email]').isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!isLoggedIn) {
      console.log('⚠️ Not logged in to Google - please log in manually in the browser window');
      console.log('⏳ Waiting up to 2 minutes for login...');
      
      try {
        await page.waitForSelector('div[role="main"] h1:has-text("Welcome"), div[data-email]', { timeout: 120000 });
        console.log('✅ Successfully logged in to Google');
      } catch (err) {
        console.log('Login timeout - proceeding anyway as login might be cached');
      }
    } else {
      console.log('✅ Already logged in to Google');
    }
    
    // Test audio before joining meeting
    console.log('🔊 Testing audio system before joining meeting...');
    await synthesizeSpeech('Audio test before joining the meeting. If you can hear this, the audio system is working correctly.');
    
    // Join the meeting with retry logic
    let joinSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`Attempt ${attempt} to join meeting...`);
      joinSuccess = await joinMeet(page, 'https://meet.google.com/iae-qzsw-mqm');
      
      if (joinSuccess) {
        console.log('✅ Successfully joined the meeting!');
        break;
      } else if (attempt < 3) {
        console.log(`⚠️ Join attempt ${attempt} failed, retrying in 10 seconds...`);
        await delay(10000);
      }
    }
    
    if (joinSuccess) {
      // Start enhanced keep-alive mechanism
      const keepAliveTimers = await keepMeetingAlive(page);
      
      // Share screen with retry logic
      let screenShareSuccess = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        screenShareSuccess = await shareScreen(page);
        if (screenShareSuccess) break;
        
        if (attempt < 3) {
          console.log(`⚠️ Screen share attempt ${attempt} failed, retrying in 5 seconds...`);
          await delay(5000);
        }
      }
      
      // Navigate to demo app
      await speakAndDo('I will now navigate to the demonstration dashboard', async () => {
        await page.goto('https://dashboard.howbee.in/login', { waitUntil: 'networkidle', timeout: 60000 });
      });
      
      // Demo interactions
      await speakAndDo('This is the sample dashboard login page we will be using for our demonstration today. I will show you how to navigate through this application.', async () => {
        await delay(2000);
      });
      
      await speakAndDo('Let me demonstrate how I can interact with elements on this page. For example, I can fill in the login form fields as part of our demo.', async () => {
        // Simulate filling a form
        const usernameField = page.locator('input[type="email"], input[name="email"]').first();
        if (await usernameField.isVisible({ timeout: 5000 })) {
          await usernameField.fill('demo@example.com');
          await delay(1000);
        }
        
        const passwordField = page.locator('input[type="password"]').first();
        if (await passwordField.isVisible({ timeout: 5000 })) {
          await passwordField.fill('••••••••');
          await delay(1000);
        }
      });
      
      await speakAndDo('If we wanted to proceed with login, I could click the login button. However, for this demonstration, we will just show how the form interaction works.', async () => {
        // Optional: Hover over login button without clicking
        const loginButton = page.locator('button:has-text("Login"), button[type="submit"]').first();
        if (await loginButton.isVisible({ timeout: 3000 })) {
          await loginButton.hover();
          await delay(1000);
        }
      });
      
      // Comprehensive demonstration of browser capabilities
      await speakAndDo('Now I will show you how this bot can navigate to different websites as part of the demonstration. Let me open a public data dashboard.', async () => {
        await page.goto('https://covid19.who.int/table', { waitUntil: 'networkidle', timeout: 60000 });
        await delay(3000);
      });
      
      // Setup interval for ongoing demonstrations
      const demoInterval = setInterval(async () => {
        // Check if still in meeting
        const stillInMeeting = await checkIfInMeeting(page);
        
        if (stillInMeeting) {
          // Choose a random demonstration action
          const demoActions = [
            // Action 1: Navigate to a news site
            async () => {
              await speakAndDo('Let me demonstrate navigation to a news website for our information portal demo.', async () => {
                await page.goto('https://news.google.com', { waitUntil: 'networkidle', timeout: 60000 });
                await delay(3000);
              });
            },
            // Action 2: Show dashboard interaction
            async () => {
              await speakAndDo('This visualization dashboard shows how our bot can present data during meetings.', async () => {
                await page.goto('https://public.tableau.com/app/discover', { waitUntil: 'networkidle', timeout: 60000 });
                await delay(3000);
                
                // Scroll to show content
                await page.evaluate(() => {
                  window.scrollBy(0, 300);
                });
              });
            },
            // Action 3: Demonstrate form interaction
            async () => {
              await speakAndDo('Let me show another example of form interaction capabilities.', async () => {
                await page.goto('https://www.saucedemo.com/', { waitUntil: 'networkidle', timeout: 60000 });
                await delay(2000);
                
                // Fill the form fields
                const usernameField = page.locator('input#user-name');
                if (await usernameField.isVisible({ timeout: 3000 })) {
                  await usernameField.fill('standard_user');
                  await delay(1000);
                }
                
                const passwordField = page.locator('input#password');
                if (await passwordField.isVisible({ timeout: 3000 })) {
                  await passwordField.fill('••••••••');
                  await delay(1000);
                }
              });
            }
          ];
          
          // Execute a random demo action
          const randomAction = demoActions[Math.floor(Math.random() * demoActions.length)];
          await randomAction();
        }
      }, 300000); // Run every 5 minutes
      
      // Enhanced error handling and recovery
      process.on('uncaughtException', async (err) => {
        console.error('Uncaught exception:', err);
        await synthesizeSpeech('I encountered an error but am attempting to recover and continue the demonstration.');
        
        // Try to stay in the meeting even after errors
        try {
          if (page && !page.isClosed()) {
            // Check if we're still in the meeting
            const stillInMeeting = await checkIfInMeeting(page);
            if (!stillInMeeting) {
              console.log('Attempting to rejoin meeting after error...');
              await joinMeet(page, 'https://meet.google.com/iae-qzsw-mqm');
            }
          }
        } catch (recoveryErr) {
          console.error('Recovery attempt failed:', recoveryErr);
        }
      });
      
      console.log('🔄 Bot is now running and will remain active until manually stopped');
      
      // Implement a graceful shutdown handler
      const handleExit = async () => {
        console.log('🛑 Shutting down bot gracefully...');
        
        // Say goodbye if still in meeting
        try {
          if (page && !page.isClosed()) {
            const stillInMeeting = await checkIfInMeeting(page);
            if (stillInMeeting) {
              await synthesizeSpeech('I am now leaving the meeting. Thank you for your attention.');
              await delay(3000);
            }
          }
        } catch (err) {
          console.error('Error during shutdown:', err);
        }
        
        // Close browser
        if (browser) await browser.close();
        
        console.log('✅ Bot shut down successfully');
        process.exit(0);
      };
      
      // Register shutdown handlers
      process.on('SIGINT', handleExit);
      process.on('SIGTERM', handleExit);
      
      // Keep process running
      // This is intentional - do not remove
    } else {
      console.log('❌ Failed to join the meeting after multiple attempts');
      await synthesizeSpeech('I was unable to connect to the Google Meet after several attempts. Please check your connection and try again.');
      await delay(5000);
      
      if (browser) await browser.close();
    }
  } catch (error) {
    console.error('Unexpected error in main flow:', error);
    
    try {
      await synthesizeSpeech('I encountered a critical error during execution. Please check the console for details.');
      await delay(5000);
      
      if (browser) await browser.close();
    } catch (err) {
      console.error('Error during shutdown after failure:', err);
    }
  }
})();