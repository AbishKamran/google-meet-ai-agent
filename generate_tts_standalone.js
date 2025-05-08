/**
 * Standalone script to generate TTS files with predefined scripts
 * Run with: node improved-generate-tts-standalone.js
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

// Wait for a specified time
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generate a unique filename to avoid file access conflicts
 * @returns {string} Unique filename
 */
function generateUniqueFilename(ext = 'wav') {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(4).toString('hex');
  return `bot-tts-${timestamp}-${randomString}.${ext}`;
}

/**
 * Platform-specific TTS implementation as last resort
 * @param {string} text - The text to convert to speech
 * @param {string} outputPath - Path where the audio file will be saved
 * @param {boolean} silentPlay - Whether to play the audio silently (no media player)
 * @param {string} finalOutputPath - Final destination path for the file
 * @returns {Promise<boolean>} - Success status
 */
async function platformSpecificTTS(text, outputPath, silentPlay = true, finalOutputPath) {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        // Windows: Use PowerShell's built-in speech synthesis
        const escapedText = text.replace(/"/g, '\\"');
        const uniquePs1Path = path.join(os.tmpdir(), `tts-script-${Date.now()}.ps1`);
        
        fs.writeFileSync(uniquePs1Path, `
          Add-Type -AssemblyName System.Speech
          $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
          $synth.SetOutputToWaveFile("${outputPath.replace(/\\/g, '\\\\')}")
          $synth.Speak("${escapedText}")
          $synth.Dispose()
          # Explicitly release file handle
          [System.GC]::Collect()
          [System.GC]::WaitForPendingFinalizers()
        `);
        
        exec(`powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "${uniquePs1Path}"`, (err) => {
          // Try to delete the PS1 file regardless of success
          fs.removeSync(uniquePs1Path);
          
          if (err) {
            console.error('PowerShell TTS failed:', err);
            
            // Try Windows Media Speech as last resort
            exec(`mshta vbscript:Execute("CreateObject(""SAPI.SpVoice"").Speak""${escapedText}"":close")`, (err2) => {
              if (err2) {
                console.error('Windows Media Speech failed too:', err2);
              } else {
                console.log('Used Windows Media Speech (no file output)');
              }
              resolve(false);
            });
          } else {
            console.log(`🔊 PowerShell TTS saved to ${outputPath}`);
            
            // Copy to the specified output path if needed
            if (finalOutputPath && finalOutputPath !== outputPath) {
              fs.copy(outputPath, finalOutputPath).catch(copyErr => {
                console.error('Error copying WAV to final output path:', copyErr);
              });
            }
            
            playSound(outputPath, !silentPlay);
            resolve(true);
          }
        });
      } else if (process.platform === 'darwin') {
        // macOS: Use built-in say command
        const escapedText = text.replace(/"/g, '\\"');
        exec(`say -o "${outputPath}" "${escapedText}"`, (err) => {
          if (err) {
            console.error('macOS say command failed:', err);
            resolve(false);
          } else {
            console.log(`🔊 macOS TTS saved to ${outputPath}`);
            
            // Copy to final path if needed
            if (finalOutputPath && finalOutputPath !== outputPath) {
              fs.copy(outputPath, finalOutputPath).catch(err => {
                console.error('Error copying WAV to final path:', err);
              });
            }
            
            playSound(outputPath, !silentPlay);
            resolve(true);
          }
        });
      } else {
        // Linux: Try espeak if available
        const escapedText = text.replace(/"/g, '\\"');
        exec(`espeak "${escapedText}" -w "${outputPath}"`, (err) => {
          if (err) {
            console.error('Linux espeak command failed:', err);
            resolve(false);
          } else {
            console.log(`🔊 Linux TTS saved to ${outputPath}`);
            
            // Copy to final path if needed
            if (finalOutputPath && finalOutputPath !== outputPath) {
              fs.copy(outputPath, finalOutputPath).catch(err => {
                console.error('Error copying WAV to final path:', err);
              });
            }
            
            playSound(outputPath, !silentPlay);
            resolve(true);
          }
        });
      }
    } catch (err) {
      console.error('Platform-specific TTS failed:', err);
      resolve(false);
    }
  });
}

/**
 * Play a sound file using platform-specific methods
 * Silent option available to prevent media players from opening
 * @param {string} audioPath - Path to the audio file
 * @param {boolean} silent - If true, don't actually play the sound (just log it)
 */
function playSound(audioPath, silent = false) {
  // If silent mode is enabled, just log instead of playing
  if (silent) {
    console.log(`🔇 Silent mode: Would have played ${audioPath}`);
    return;
  }
  
  // Generate a unique play ID to track this specific playback
  const playId = Date.now().toString(36);
  console.log(`▶️ [${playId}] Playing audio: ${audioPath}`);
  
  try {
    if (process.platform === 'win32') {
      // Try multiple playback methods on Windows
      
      // Method 1: PowerShell System.Media.SoundPlayer (silent playback)
      const ps1Path = path.join(os.tmpdir(), `play-sound-${playId}.ps1`);
      fs.writeFileSync(ps1Path, `
        Add-Type -AssemblyName System.Media
        $player = New-Object System.Media.SoundPlayer
        $player.SoundLocation = "${audioPath.replace(/\\/g, '\\\\')}"
        $player.PlaySync()
        $player.Dispose()
      `);
      
      exec(`powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps1Path}"`, (err) => {
        // Clean up the script file
        fs.removeSync(ps1Path);
        
        if (err) {
          console.error(`[${playId}] Error playing sound with PowerShell:`, err);
          
          // Method 2: Try the command-line tool mplayer if installed
          exec(`mplayer -really-quiet "${audioPath}"`, (err2) => {
            if (err2) {
              console.error(`[${playId}] Mplayer failed too:`, err2);
              
              // Method 3: Fall back to standard Windows Media Player (might show UI)
              exec(`start /min wmplayer "${audioPath}" /play /close`, (err3) => {
                if (err3) console.error(`[${playId}] All playback methods failed:`, err3);
              });
            }
          });
        }
      });
    } else if (process.platform === 'darwin') {
      // macOS afplay doesn't open a UI
      exec(`afplay "${audioPath}"`, (err) => {
        if (err) console.error(`[${playId}] Error playing sound:`, err);
      });
    } else {
      // For Linux systems, try multiple players that don't open UIs
      exec(`mpg123 -q "${audioPath}" || aplay -q "${audioPath}" || play -q "${audioPath}"`, (err) => {
        if (err) console.error(`[${playId}] Error playing sound:`, err);
      });
    }
  } catch (err) {
    console.error(`[${playId}] Error attempting to play sound:`, err);
  }
}

/**
 * Generate TTS using multiple approaches with fallback mechanism
 * @param {string} text - The text to convert to speech
 * @param {string} outputPath - Path where the audio file will be saved
 * @param {boolean} silentPlay - Whether to play the audio silently (no media player)
 * @returns {Promise<boolean>} - Success status
 */
async function generateTTS(text, outputPath, silentPlay = true) {
  console.log(`🎙️ Generating TTS for: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  
  // Generate unique filenames to avoid conflicts
  const uniqueWavPath = path.join(os.tmpdir(), generateUniqueFilename('wav'));
  const uniqueMp3Path = path.join(os.tmpdir(), generateUniqueFilename('mp3'));
  
  // If specific output path provided, we'll copy to it later
  const finalOutputPath = outputPath || uniqueWavPath;
  
  // Check if we have OpenAI configuration
  let useOpenAI = false;
  try {
    // Only attempt to use OpenAI if the module is installed and API key is set
    const { OpenAI } = require('openai');
    useOpenAI = !!process.env.OPENAI_API_KEY;
    
    if (useOpenAI) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      try {
        const resp = await openai.audio.speech.create({
          model: 'tts-1',
          voice: 'alloy',  // Options: alloy, echo, fable, onyx, nova, shimmer
          input: text,
          format: 'mp3',
        });
        
        const buffer = Buffer.from(await resp.arrayBuffer());
        await fs.writeFile(uniqueMp3Path, buffer);
        console.log(`🔊 OpenAI TTS saved to ${uniqueMp3Path}`);
        
        // Play the sound
        playSound(uniqueMp3Path, silentPlay);
        
        // Copy to the specified output path if needed
        if (outputPath) {
          try {
            await fs.copy(uniqueMp3Path, outputPath.replace(/\.wav$/, '.mp3'));
          } catch (copyErr) {
            console.error('Error copying MP3 to output path:', copyErr);
          }
        }
        
        return true;
      } catch (err) {
        console.error('OpenAI TTS failed, falling back to alternatives:', err.message);
      }
    }
  } catch (err) {
    console.log('OpenAI module not available, falling back to alternatives');
  }
  
  // Try Node-Say as second option
  try {
    const say = require('say');
    return await new Promise((resolve) => {
      say.export(text, null, 1.0, uniqueWavPath, (err) => {
        if (err) {
          console.error('Node-Say TTS failed:', err);
          resolve(platformSpecificTTS(text, uniqueWavPath, silentPlay, finalOutputPath));
        } else {
          console.log(`🔊 Node-Say TTS saved to ${uniqueWavPath}`);
          
          // Copy to the specified output path if needed
          if (outputPath && outputPath !== uniqueWavPath) {
            fs.copy(uniqueWavPath, outputPath).catch(copyErr => {
              console.error('Error copying WAV to output path:', copyErr);
            });
          }
          
          playSound(uniqueWavPath, silentPlay);
          resolve(true);
        }
      });
    });
  } catch (err) {
    console.log('Node-Say module not available, falling back to platform specific TTS');
    return platformSpecificTTS(text, uniqueWavPath, silentPlay, finalOutputPath);
  }
}

// Clear any existing temporary files that might cause conflicts
async function clearOldTempFiles() {
  const tempDir = os.tmpdir();
  try {
    const files = await fs.readdir(tempDir);
    const oldTtsFiles = files.filter(file => file.startsWith('bot-tts'));
    
    for (const file of oldTtsFiles) {
      try {
        await fs.remove(path.join(tempDir, file));
        console.log(`Cleaned up old TTS file: ${file}`);
      } catch (err) {
        // Just ignore errors from files we can't delete
      }
    }
  } catch (err) {
    console.error('Error clearing temp files:', err);
  }
}

// 1️⃣ List out every sentence your bot will speak, in order:
const lines = [
  'Navigating to the meeting link.',
  'Enabling microphone and camera.',
  'Joining the meeting.',
  'Hello everyone, I am the bot. I have joined the meeting.',
  'Now I will share my screen.',
  'Your entire screen selected. Please accept the system prompt.',
  'Now I will open a new tab and visit Google.',
  'I have opened Google dot com.',
  'This is a sample dashboard login page. You should be able to see my screen normally now.',
  'In a real demo, I would now show you how to navigate through the application features.',
  'Thank you for watching this demonstration. I hope it was helpful!'
];

// Generate and test each line individually
async function testIndividualLines() {
  console.log('Testing TTS generation for each line individually...');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    console.log(`\n${i+1}/${lines.length}: Testing line: "${line}"`);
    
    const outPath = path.resolve(__dirname, `test-line-${i+1}.wav`);
    const success = await generateTTS(line, outPath, false); // false = actually play the sound
    
    if (success) {
      console.log(`✅ Line ${i+1} generated successfully`);
    } else {
      console.error(`❌ Line ${i+1} failed to generate`);
    }
    
    // Give some time between each test
    await delay(3000);
  }
}

// Generate TTS for a custom script
async function generateCustomScript(text, outputPath = null) {
  if (!outputPath) {
    outputPath = path.resolve(__dirname, 'custom-tts.wav');
  }
  
  console.log(`\nGenerating TTS for custom script: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  const success = await generateTTS(text, outputPath, false); // false = actually play the sound

  if (success) {
    console.log(`✅ Successfully generated TTS audio at: ${outputPath}`);
    return outputPath;
  } else {
    console.error('❌ Failed to generate TTS audio for the custom script');
    return null;
  }
}

// 2️⃣ Join them into one big paragraph (say will naturally pause at periods):
const fullScript = lines.join(' ');

// 3️⃣ Export to audio file:
const outPath = path.resolve(__dirname, 'bot-tts.wav');

async function generateFullScript() {
  console.log('\nGenerating TTS for the full script...');
  const success = await generateTTS(fullScript, outPath, false); // false = actually play the sound

  if (success) {
    console.log('✅ Successfully generated TTS audio at:', outPath);
  } else {
    console.error('❌ Failed to generate TTS audio for the full script');
  }
}

// Export the TTS functions for potential external use
module.exports = {
  generateTTS,
  playSound,
  generateCustomScript
};

// Execute the TTS generation tests if this script is run directly
if (require.main === module) {
  (async () => {
    try {
      // Clean up any old files first
      await clearOldTempFiles();
      
      // First test individual lines
      await testIndividualLines();
      
      // Then test the full script
      await generateFullScript();
      
      console.log('\n🎉 TTS testing complete!');
    } catch (err) {
      console.error('Error in TTS generation testing:', err);
      process.exit(1);
    }
  })();
}