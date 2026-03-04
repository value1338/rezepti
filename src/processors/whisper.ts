import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Convert audio/video to 16kHz WAV for whisper-cpp.
 */
async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-y",
    outputPath,
  ], { timeout: 120_000 });
}

/**
 * Transcribe audio file using whisper-cpp.
 * Returns the transcribed text.
 */
export async function transcribeAudio(
  audioPath: string,
  tempDir: string
): Promise<string> {
  const wavPath = join(tempDir, "audio.wav");

  // Convert to WAV if not already
  if (!audioPath.endsWith(".wav")) {
    await convertToWav(audioPath, wavPath);
  } else {
    // Already a WAV, just use it directly
    await execFileAsync("cp", [audioPath, wavPath]);
  }

  const modelPath =
    process.env.WHISPER_MODEL_PATH ||
    join(process.env.HOME || "/", ".cache", "whisper-cpp", "models", "ggml-large-v3-turbo.bin");

  if (!existsSync(modelPath)) {
    throw new Error(
      `Whisper-Modell nicht gefunden: ${modelPath}. Setze WHISPER_MODEL_PATH oder lade das Modell.`
    );
  }

  const whisperCli = process.env.WHISPER_CLI_PATH || "whisper-cli";
  const outputBase = join(tempDir, "transcript");

  await execFileAsync(whisperCli, [
    "-m", modelPath,
    "-f", wavPath,
    "-l", "auto",
    "--output-txt",
    "-of", outputBase,
  ], { timeout: 600_000 });

  const txtPath = `${outputBase}.txt`;
  if (!existsSync(txtPath)) {
    throw new Error("Whisper-Transkription fehlgeschlagen: Keine Ausgabedatei");
  }

  return (await readFile(txtPath, "utf-8")).trim();
}
