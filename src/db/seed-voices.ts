import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { voices } from './schema/index.js';
import { env } from '../config/env.js';
import { buildDbUrl } from './index.js';

interface VoiceSpec { id: string; name: string; }
interface Snippet { data: Buffer; mimeType: string; }
type Db = PostgresJsDatabase<Record<string, never>>;

const SNIPPET_TEXT = 'Hello! How can I help you today?';

interface TtsConfig { url: string; model: string; apiKey: string | undefined; keyName: string; label: string; }

async function fetchTtsSnippet(voiceId: string, config: TtsConfig): Promise<Snippet> {
  if (!config.apiKey) throw new Error(`${config.keyName} is not set`);
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, input: SNIPPET_TEXT, voice: voiceId }),
  });
  if (!response.ok) throw new Error(`${config.label} TTS error: ${response.status} ${response.statusText}`);
  return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') ?? 'audio/mpeg' };
}

// --- Google provider ---

const GOOGLE_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const GOOGLE_PROVIDER = 'google';

const GOOGLE_VOICES: VoiceSpec[] = [
  { id: 'Achernar', name: 'Achernar' }, { id: 'Achird', name: 'Achird' },
  { id: 'Algenib', name: 'Algenib' }, { id: 'Algieba', name: 'Algieba' },
  { id: 'Alnilam', name: 'Alnilam' }, { id: 'Aoede', name: 'Aoede' },
  { id: 'Autonoe', name: 'Autonoe' }, { id: 'Callirrhoe', name: 'Callirrhoe' },
  { id: 'Charon', name: 'Charon' }, { id: 'Despina', name: 'Despina' },
  { id: 'Enceladus', name: 'Enceladus' }, { id: 'Erinome', name: 'Erinome' },
  { id: 'Fenrir', name: 'Fenrir' }, { id: 'Gacrux', name: 'Gacrux' },
  { id: 'Iapetus', name: 'Iapetus' }, { id: 'Kore', name: 'Kore' },
  { id: 'Laomedeia', name: 'Laomedeia' }, { id: 'Leda', name: 'Leda' },
  { id: 'Orus', name: 'Orus' }, { id: 'Pulcherrima', name: 'Pulcherrima' },
  { id: 'Puck', name: 'Puck' }, { id: 'Rasalgethi', name: 'Rasalgethi' },
  { id: 'Sadachbia', name: 'Sadachbia' }, { id: 'Sadaltager', name: 'Sadaltager' },
  { id: 'Schedar', name: 'Schedar' }, { id: 'Sulafat', name: 'Sulafat' },
  { id: 'Umbriel', name: 'Umbriel' }, { id: 'Vindemiatrix', name: 'Vindemiatrix' },
  { id: 'Zephyr', name: 'Zephyr' }, { id: 'Zubenelgenubi', name: 'Zubenelgenubi' },
];

interface GeminiTtsResponse {
  candidates: [{ content: { parts: [{ inlineData: { mimeType: string; data: string } }] } }];
}

function buildGeminiTtsBody(voiceId: string): object {
  return {
    contents: [{ parts: [{ text: SNIPPET_TEXT }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } } },
  };
}

function buildGeminiTtsUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_TTS_MODEL}:generateContent?key=${apiKey}`;
}

/**
 * Generates an audio snippet for the given Google Gemini voice.
 *
 * @param voiceId - The Gemini voice identifier (e.g. `"Puck"`).
 * @returns Buffer containing the audio data and its MIME type.
 * @throws If `GOOGLE_API_KEY` is not set or the API returns an error status.
 */
export async function generateGeminiSnippet(voiceId: string): Promise<Snippet> {
  if (!env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');
  const url = buildGeminiTtsUrl(env.GOOGLE_API_KEY);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildGeminiTtsBody(voiceId)) });
  if (!response.ok) throw new Error(`Google TTS error: ${response.status} ${response.statusText}`);
  const json = (await response.json()) as GeminiTtsResponse;
  const { mimeType, data } = json.candidates[0].content.parts[0].inlineData;
  return { data: Buffer.from(data, 'base64'), mimeType };
}

// --- xAI provider ---

const XAI_PROVIDER = 'xai';

const XAI_VOICES: VoiceSpec[] = [
  { id: 'Eve', name: 'Eve' },
  { id: 'Ara', name: 'Ara' },
  { id: 'Leo', name: 'Leo' },
  { id: 'Rex', name: 'Rex' },
  { id: 'Sal', name: 'Sal' },
];

/**
 * Generates an audio snippet for the given xAI voice.
 *
 * @param voiceId - The xAI voice identifier (e.g. `"Ara"`). Case-sensitive.
 * @returns Buffer containing the audio data and its MIME type.
 * @throws If `XAI_API_KEY` is not set or the API returns an error status.
 */
export async function generateXaiSnippet(voiceId: string): Promise<Snippet> {
  if (!env.XAI_API_KEY) throw new Error('XAI_API_KEY is not set');
  const response = await fetch('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: SNIPPET_TEXT, voice_id: voiceId, language: 'en' }),
  });
  if (!response.ok) throw new Error(`xAI TTS error: ${response.status} ${response.statusText}`);
  return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') ?? 'audio/mpeg' };
}

// --- OpenAI provider ---

const OPENAI_PROVIDER = 'openai';

const OPENAI_VOICES: VoiceSpec[] = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'ash', name: 'Ash' },
  { id: 'ballad', name: 'Ballad' },
  { id: 'coral', name: 'Coral' },
  { id: 'echo', name: 'Echo' },
  { id: 'sage', name: 'Sage' },
  { id: 'shimmer', name: 'Shimmer' },
  { id: 'verse', name: 'Verse' },
];

/**
 * Generates an audio snippet for the given OpenAI TTS voice.
 *
 * @param voiceId - The OpenAI voice identifier (e.g. `"alloy"`).
 * @returns Buffer containing the audio data and its MIME type.
 * @throws If `OPENAI_API_KEY` is not set or the API returns an error status.
 */
export async function generateSnippet(voiceId: string): Promise<Snippet> {
  return fetchTtsSnippet(voiceId, { url: 'https://api.openai.com/v1/audio/speech', model: 'gpt-4o-mini-tts', apiKey: env.OPENAI_API_KEY, keyName: 'OPENAI_API_KEY', label: 'OpenAI' });
}

// --- Phonic provider ---

const PHONIC_API_URL = 'https://api.phonic.co/v1/voices';
const PHONIC_MODEL = 'merritt';
const PHONIC_PROVIDER = 'phonic';

interface PhonicVoice extends VoiceSpec { description: string | null; audio_url: string; }

async function fetchPhonicVoices(): Promise<PhonicVoice[]> {
  const { PHONIC_API_KEY } = env;
  if (!PHONIC_API_KEY) throw new Error('PHONIC_API_KEY is not set');
  const response = await fetch(`${PHONIC_API_URL}?model=${PHONIC_MODEL}`, {
    headers: { Authorization: `Bearer ${PHONIC_API_KEY}` },
  });
  if (!response.ok) throw new Error(`Phonic API error: ${response.status} ${response.statusText}`);
  return ((await response.json()) as { voices: PhonicVoice[] }).voices;
}

async function downloadSnippet(audioUrl: string): Promise<Snippet> {
  const response = await fetch(audioUrl);
  if (!response.ok) throw new Error(`Failed to download audio from ${audioUrl}: ${response.status}`);
  return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') ?? 'audio/wav' };
}

// --- Shared upsert ---

async function insertVoices<T extends VoiceSpec>(db: Db, provider: string, specs: T[], getSnippet: (v: T) => Promise<Snippet>) {
  const results = await Promise.allSettled(specs.map(getSnippet));
  const inserted: string[] = [];
  await Promise.all(specs.map(async (voice, i) => {
    const result = results[i];
    if (result.status === 'rejected') { console.error(`Failed snippet for ${voice.name}: ${result.reason}`); return; }
    await db.insert(voices).values({ name: voice.name, externalId: voice.id, provider, snippet: result.value.data, snippetMimeType: result.value.mimeType });
    inserted.push(voice.name);
  }));
  if (inserted.length > 0) console.log(`Inserted ${inserted.length} ${provider} voice(s): ${inserted.join(', ')}`);
}

async function updateVoices<T extends VoiceSpec>(db: Db, provider: string, specs: T[], idMap: Map<string, number>, getSnippet: (v: T) => Promise<Snippet>) {
  const results = await Promise.allSettled(specs.map(getSnippet));
  const updated: string[] = [];
  await Promise.all(specs.map(async (voice, i) => {
    const result = results[i];
    if (result.status === 'rejected') { console.error(`Failed snippet for ${voice.name}: ${result.reason}`); return; }
    await db.update(voices).set({ name: voice.name, snippet: result.value.data, snippetMimeType: result.value.mimeType }).where(eq(voices.id, idMap.get(voice.id)!));
    updated.push(voice.name);
  }));
  if (updated.length > 0) console.log(`Updated ${updated.length} ${provider} voice(s): ${updated.join(', ')}`);
}

async function upsertProviderVoices<T extends VoiceSpec>(db: Db, provider: string, defs: T[], getSnippet: (v: T) => Promise<Snippet>) {
  const existing = await db.select({ id: voices.id, externalId: voices.externalId }).from(voices).where(eq(voices.provider, provider));
  const idMap = new Map(existing.map(v => [v.externalId, v.id]));
  const toInsert = defs.filter(v => !idMap.has(v.id));
  const toUpdate = defs.filter(v => idMap.has(v.id));
  if (toInsert.length === 0 && toUpdate.length === 0) { console.log(`${provider} voices are up to date.`); return; }
  await insertVoices(db, provider, toInsert, getSnippet);
  await updateVoices(db, provider, toUpdate, idMap, getSnippet);
}

async function seedVoices() {
  const client = postgres(buildDbUrl(), { max: 1 });
  const db = drizzle(client);
  const phonicVoices = await fetchPhonicVoices();
  await upsertProviderVoices(db, PHONIC_PROVIDER, phonicVoices, v => downloadSnippet(v.audio_url));
  await upsertProviderVoices(db, OPENAI_PROVIDER, OPENAI_VOICES, v => generateSnippet(v.id));
  await upsertProviderVoices(db, XAI_PROVIDER, XAI_VOICES, v => generateXaiSnippet(v.id));
  await upsertProviderVoices(db, GOOGLE_PROVIDER, GOOGLE_VOICES, v => generateGeminiSnippet(v.id));
  await client.end();
}

const isMain = process.argv[1]?.endsWith('seed-voices.ts') || process.argv[1]?.endsWith('seed-voices.js');
if (isMain) seedVoices().catch(console.error);
