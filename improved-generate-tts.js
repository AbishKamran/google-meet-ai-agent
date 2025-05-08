/**
 * Text-to-Speech generation module using various approaches
 * Supports multiple TTS engines and falls back gracefully
 */

const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const os = require('os');

// Optional dependencies - will try to load but continue if not available
let say;
let openai;

try {
  say = require('say');
} catch (err) {
  console.log('Node-Say package not available, will use alternative TTS methods');
}

try {
  const { OpenAI } = require('openai');
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (err) {
  console.log('OpenAI package not available, will use alternative TTS methods');
}

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
  
  // Try OpenAI TTS first if available
  if (openai && process.env.OPENAI_API_KEY) {
    try {
      const resp = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: text,
        format: 'mp3',
      });
      
      const buffer = Buffer.from(await resp.arrayBuffer());
      await fs.writeFile(uniqueMp3Path, buffer);
      console.log(`🔊 OpenAI TTS saved to ${uniqueMp3Path}`);
      
      // Play the sound silently (no media player)
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
  
  // Try Node-Say as second option
  if (say) {
    try {
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
      console.error('Node-Say export failed:', err);
      return platformSpecificTTS(text, uniqueWavPath, silentPlay, finalOutputPath);
    }
  } else {
    // If say is not available, go directly to platform specific TTS
    return platformSpecificTTS(text, uniqueWavPath, silentPlay, finalOutputPath);
  }
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
            
            playSound(outputPath, silentPlay);
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
            
            playSound(outputPath, silentPlay);
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
            
            playSound(outputPath, silentPlay);
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
  // Ensure the sound is played without opening a media player
  console.log(`▶️ Playing audio: ${audioPath}`);
  
  try {
    if (process.platform === 'win32') {
      // Use PowerShell System.Media.SoundPlayer for playback
      const ps1Path = path.join(os.tmpdir(), `play-sound-${Date.now().toString(36)}.ps1`);
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
          console.error(`Error playing sound with PowerShell:`, err);
        }
      });
    } else if (process.platform === 'darwin') {
      exec(`afplay "${audioPath}"`, (err) => {
        if (err) console.error(`Error playing sound:`, err);
      });
    } else {
      exec(`mpg123 -q "${audioPath}" || aplay -q "${audioPath}" || play -q "${audioPath}"`, (err) => {
        if (err) console.error(`Error playing sound:`, err);
      });
    }
  } catch (err) {
    console.error(`Error attempting to play sound:`, err);
  }
}

module.exports = {
  generateTTS,
  playSound
};