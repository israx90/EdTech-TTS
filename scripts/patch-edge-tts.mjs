import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetFile = path.resolve(__dirname, '../node_modules/edge-tts-universal/dist/index.js');

try {
  if (fs.existsSync(targetFile)) {
    let content = fs.readFileSync(targetFile, 'utf8');
    
    // We want edge-tts to escape all standard text (like '&', '<', etc.) so Azure doesn't crash on normal text.
    // However, since we send <lang> tags from the frontend, they get escaped to &lt;lang...
    // We will patch the final XML string generator (mkssml) to un-escape ONLY our tags right before they go to Azure.
    
    content = content.replace(
      /return `<speak(.*?)>\${text}<\/prosody><\/voice><\/speak>`;/g,
      "let __restored = text.replace(/&lt;voice name=(?:&quot;|')en-US-AriaNeural(?:&quot;|')&gt;/g, '<voice name=\"en-US-AriaNeural\">').replace(/&lt;\\/voice&gt;/g, '</voice>');\n  return `<speak$1>${__restored}</prosody></voice></speak>`;"
    );
    
    // If we previously removed the escape, restore it just in case this script runs multiple times:
    content = content.replace(/splitTextByByteLength\(\s*removeIncompatibleCharacters\(text\)/g, 'splitTextByByteLength(escape(removeIncompatibleCharacters(text))');
    
    fs.writeFileSync(targetFile, content);
    console.log('✅ patched edge-tts-universal successfully to allow raw SSML voice tags safely.');
  } else {
    console.warn('⚠️ edge-tts-universal dist file not found. Skipping patch.');
  }
} catch (err) {
  console.error('❌ Error patching edge-tts-universal:', err);
}
