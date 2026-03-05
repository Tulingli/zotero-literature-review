import { getPref } from "../utils/prefs";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Call the LLM API (OpenAI-compatible endpoint).
 * Supports configurable timeout (default 120s).
 */
export async function callLLM(
  messages: LLMMessage[],
  onProgress?: (partial: string) => void,
): Promise<LLMResponse> {
  const apiUrl = getPref("llmApiUrl") as string;
  const apiKey = getPref("llmApiKey") as string;
  const model = getPref("llmModel") as string;
  const temperature = ((getPref("llmTemperature") as number) || 700) / 1000;
  const maxTokens = (getPref("llmMaxTokens") as number) || 4096;
  const timeoutMs = ((getPref("llmTimeout") as number) || 120) * 1000;

  if (!apiUrl || !apiKey || !model) {
    throw new Error(
      "LLM configuration is incomplete. Please set API URL, API Key and Model in the plugin preferences.",
    );
  }

  // Normalize URL: ensure it ends with /chat/completions
  let endpoint = apiUrl.replace(/\/+$/, "");
  if (!endpoint.endsWith("/chat/completions")) {
    if (!endpoint.endsWith("/v1")) {
      endpoint += "/v1";
    }
    endpoint += "/chat/completions";
  }

  const requestBody: any = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };

  ztoolkit.log("LLM Request:", endpoint, "model:", model, "timeout:", timeoutMs);

  const response = await Zotero.HTTP.request("POST", endpoint, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    responseType: "json",
    timeout: timeoutMs,
  });

  const data = response.response as any;

  if (!data || !data.choices || data.choices.length === 0) {
    ztoolkit.log("LLM Error Response:", JSON.stringify(data));
    throw new Error("LLM API returned no valid response.");
  }

  const result: LLMResponse = {
    content: data.choices[0].message.content,
    usage: data.usage,
  };

  ztoolkit.log("LLM Response received, tokens:", JSON.stringify(result.usage));
  return result;
}

// ============ Text Chunking (MapReduce) Strategy ============

/** Rough estimate: 1 token ≈ 1.5 Chinese chars or ≈ 4 English chars */
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * Split long text into overlapping chunks.
 * Each chunk ≈ maxChunkChars characters with ~200 char overlap.
 */
function splitTextIntoChunks(
  text: string,
  maxChunkChars: number = 6000,
  overlapChars: number = 200,
): string[] {
  if (text.length <= maxChunkChars) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxChunkChars;
    if (end >= text.length) {
      chunks.push(text.substring(start));
      break;
    }
    // Try to break at a paragraph or sentence boundary
    const breakZone = text.substring(end - 200, end + 200);
    const breakMatch = breakZone.match(/[。.\n\r!！?？]/);
    if (breakMatch && breakMatch.index !== undefined) {
      end = end - 200 + breakMatch.index + 1;
    }
    chunks.push(text.substring(start, end));
    start = end - overlapChars;
  }
  return chunks;
}

/**
 * MapReduce summarization for long texts:
 * 1. Map: Summarize each chunk independently
 * 2. Reduce: Combine chunk summaries into a final summary
 */
async function mapReduceSummarize(
  title: string,
  authors: string,
  year: string,
  journal: string,
  fullText: string,
  extraInfo: string,
): Promise<string> {
  const maxContextTokens = (getPref("llmMaxTokens") as number) || 4096;
  // Reserve tokens for system prompt + output; use ~60% of context for input
  const maxInputChars = Math.min(maxContextTokens * 2, 12000);

  const chunks = splitTextIntoChunks(fullText, maxInputChars);
  ztoolkit.log(`MapReduce: text length=${fullText.length}, chunks=${chunks.length}`);

  if (chunks.length === 1) {
    // Short enough, just summarize directly
    return await directSummarize(title, authors, year, journal, chunks[0], extraInfo);
  }

  // MAP phase: summarize each chunk
  const chunkSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkPrompt: LLMMessage[] = [
      {
        role: "system",
        content: `你是一个专业的学术文献分析助手。请对以下文献片段（第${i + 1}/${chunks.length}段）进行要点提取。
文献标题：${title}
作者：${authors}（${year}）
请提取该片段的核心论点、关键数据和重要结论，控制在200字以内。`,
      },
      {
        role: "user",
        content: chunks[i],
      },
    ];
    try {
      const resp = await callLLM(chunkPrompt);
      chunkSummaries.push(`[片段${i + 1}] ${resp.content}`);
    } catch (e: any) {
      ztoolkit.log(`MapReduce chunk ${i + 1} failed:`, e);
      chunkSummaries.push(`[片段${i + 1}] (总结失败)`);
    }
  }

  // REDUCE phase: combine chunk summaries into final summary
  const customPrompt =
    (getPref("promptSummary") as string) || getDefaultSummaryPrompt();

  const reduceMessages: LLMMessage[] = [
    {
      role: "system",
      content: customPrompt,
    },
    {
      role: "user",
      content: `以下是文献《${title}》（${authors}，${year}，${journal}）的分段摘要：
${extraInfo ? `补充信息：${extraInfo}\n` : ""}
${chunkSummaries.join("\n\n")}

请基于以上分段摘要，生成该文献的完整结构化总结，包括：研究目的、研究方法、主要发现和结论。`,
    },
  ];

  const finalResp = await callLLM(reduceMessages);
  return finalResp.content;
}

/**
 * Direct (single-pass) summarization for short texts.
 */
async function directSummarize(
  title: string,
  authors: string,
  year: string,
  journal: string,
  text: string,
  extraInfo: string,
): Promise<string> {
  const customPrompt =
    (getPref("promptSummary") as string) || getDefaultSummaryPrompt();

  const systemMessage: LLMMessage = {
    role: "system",
    content: customPrompt,
  };

  const userContent = `请总结以下文献：

标题：${title}
作者：${authors}
年份：${year}
期刊/来源：${journal}
内容：${text}
${extraInfo ? `补充信息：${extraInfo}` : ""}

请提供该文献的结构化总结，包括：研究目的、研究方法、主要发现和结论。`;

  const userMessage: LLMMessage = {
    role: "user",
    content: userContent,
  };

  const response = await callLLM([systemMessage, userMessage]);
  return response.content;
}

/**
 * Summarize a single literature item using LLM.
 * Automatically uses MapReduce for long texts.
 */
export async function summarizeSingleItem(
  title: string,
  authors: string,
  year: string,
  abstract: string,
  journal: string,
  extraInfo: string,
): Promise<string> {
  return await mapReduceSummarize(title, authors, year, journal, abstract, extraInfo);
}

/**
 * Generate a literature review from individual summaries.
 */
export async function generateReview(
  summaries: Array<{
    title: string;
    authors: string;
    year: string;
    summary: string;
  }>,
  topic?: string,
): Promise<string> {
  const customPrompt =
    (getPref("promptReview") as string) ||
    getDefaultReviewPrompt();

  const systemMessage: LLMMessage = {
    role: "system",
    content: customPrompt,
  };

  let summaryText = "";
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    summaryText += `\n### 文献 ${i + 1}：${s.title}\n`;
    summaryText += `作者：${s.authors}，年份：${s.year}\n`;
    summaryText += `摘要总结：\n${s.summary}\n`;
    summaryText += "---\n";
  }

  const userContent = `基于以下 ${summaries.length} 篇文献的总结，请生成一篇完整的文献综述：
${topic ? `\n综述主题：${topic}\n` : ""}
${summaryText}

请生成一篇结构完整、逻辑清晰的文献综述，包括：
1. 引言 - 概述该领域的研究背景
2. 主题分析 - 将文献按主题归类讨论，分析研究趋势
3. 比较与对比 - 比较不同研究的方法、发现和观点
4. 研究空白与未来方向 - 指出现有研究的不足和未来研究方向
5. 总结 - 综合所有文献的主要发现

请使用学术论文的写作风格，在适当的位置引用文献（使用作者+年份的格式）。`;

  const userMessage: LLMMessage = {
    role: "user",
    content: userContent,
  };

  const response = await callLLM([systemMessage, userMessage]);
  return response.content;
}

function getDefaultSummaryPrompt(): string {
  return `你是一个专业的学术文献分析助手。你的任务是对给定的学术文献进行简洁而全面的总结。
请使用中文回答，保持学术写作风格。
总结应包含以下要素：
- 研究目的和背景
- 主要研究方法
- 关键发现和结论
- 该研究的贡献和局限性
总结长度控制在200-400字。`;
}

function getDefaultReviewPrompt(): string {
  return `你是一个专业的学术写作助手，擅长撰写高质量的文献综述。
你的任务是基于多篇文献的总结，生成一篇结构完整、逻辑清晰的文献综述。
请使用中文撰写，保持学术论文的写作风格。
文献综述应该：
- 不是简单罗列每篇文献，而是按主题进行组织
- 分析研究趋势和发展脉络
- 比较不同研究的异同
- 在适当位置引用文献
- 指出研究空白和未来方向`;
}
