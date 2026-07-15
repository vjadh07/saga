// Startup-only provider selection for Studio. Configuration chooses one concrete provider;
// request failures never trigger a fallback to another provider or to Demo mode.
import { AgentSdkModelProvider } from "../providers/model-agent.js";
import { GeminiModelProvider } from "../providers/model-gemini.js";
import type { ModelProvider } from "../providers/model.js";
import { BraveSearchProvider } from "../providers/search-brave.js";
import { GeminiSearchProvider } from "../providers/search-gemini.js";
import { TavilySearchProvider } from "../providers/search-tavily.js";
import type { SearchProvider, SearchRequest, SearchResult } from "../providers/search.js";

export interface LiveProviderEnvironment {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_SEARCH_GROUNDING?: string;
  BRAVE_SEARCH_API_KEY?: string;
  TAVILY_API_KEY?: string;
}

export interface LiveProviders {
  model: ModelProvider;
  search: SearchProvider;
}

export class UnconfiguredLiveSearch implements SearchProvider {
  readonly id = "unconfigured-live-search";

  async search(_request: SearchRequest): Promise<SearchResult[]> {
    throw new Error("Live search credentials are not configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY.");
  }
}

export function createLiveProviders(env: LiveProviderEnvironment = process.env): LiveProviders {
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const geminiModel = env.GEMINI_MODEL?.trim();
  const braveKey = env.BRAVE_SEARCH_API_KEY?.trim();
  const tavilyKey = env.TAVILY_API_KEY?.trim();
  const useGeminiGrounding = env.GEMINI_SEARCH_GROUNDING?.trim().toLowerCase() === "true";

  const model = geminiKey
    ? new GeminiModelProvider({ apiKey: geminiKey, ...(geminiModel ? { model: geminiModel } : {}) })
    : new AgentSdkModelProvider();
  const search = braveKey
    ? new BraveSearchProvider({ apiKey: braveKey })
    : tavilyKey
      ? new TavilySearchProvider({ apiKey: tavilyKey })
      : geminiKey && useGeminiGrounding
      ? new GeminiSearchProvider({ apiKey: geminiKey, ...(geminiModel ? { model: geminiModel } : {}) })
      : new UnconfiguredLiveSearch();

  return { model, search };
}
