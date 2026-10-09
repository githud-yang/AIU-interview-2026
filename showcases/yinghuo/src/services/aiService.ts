// 前端 AI 门面：提交/订阅任务，并将结果写入已有本地词汇缓存。
import type { GoldenSentence, VocabItem, AgentProfile, Note } from '../types';
import { runAiTask } from './aiTransport';
import { enrichGoldenSentencesVocabulary, enrichVocabularyFromItems, lookupVocabItem, putCachedVocabItem } from './vocabKnowledge';
interface AnalysisResult { translation: string; goldenSentences: GoldenSentence[] }
export async function analyzeNote(noteId: string, content: string): Promise<AnalysisResult> {
  const result = await runAiTask<AnalysisResult>('analyzeNote', { noteId, content });
  return { ...result, goldenSentences: await enrichGoldenSentencesVocabulary(result.goldenSentences) };
}
export async function analyzeSelectedText(noteId: string, text: string): Promise<GoldenSentence> {
  const result = await runAiTask<GoldenSentence>('analyzeSelectedText', { noteId, text });
  return { ...result, vocabulary: await enrichVocabularyFromItems(result.vocabulary) };
}
export async function analyzeWord(word: string): Promise<VocabItem> {
  const cached = await lookupVocabItem(word);
  if (cached) return cached;
  const result = await runAiTask<VocabItem>('analyzeWord', { word });
  await putCachedVocabItem(result);
  return result;
}
export async function generateAgentProfile(notes: Note[], existingName?: string): Promise<{ name: string; personality: string; profile: AgentProfile }> {
  return runAiTask('generateAgentProfile', { notes: notes.map(note => ({ content: note.content, goldenSentences: note.goldenSentences?.map(gs => ({ original: gs.original })) })), existingName });
}
export async function getAgentReply(userMessage: string, agentName: string, agentProfile: AgentProfile | undefined, level: number, recentNoteExcerpts: string[], recentMessages?: { role: 'user' | 'agent'; content: string }[]): Promise<string> {
  return runAiTask('getAgentReply', { userMessage, agentName, agentProfile, level, recentNoteExcerpts, recentMessages });
}
