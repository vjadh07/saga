import { expect, test } from "vitest";
import {
  UnconfiguredLiveSearch,
  createLiveProviders,
} from "../src/verify/live/provider-selection.js";

test("a Gemini key selects Gemini reasoning and leaves search explicitly unconfigured", () => {
  const providers = createLiveProviders({ GEMINI_API_KEY: "gemini-key" });
  expect(providers.model.id).toBe("google-gemini/gemini-3.1-flash-lite");
  expect(providers.search).toBeInstanceOf(UnconfiguredLiveSearch);
});

test("a Tavily key selects the free direct search adapter", () => {
  const providers = createLiveProviders({ GEMINI_API_KEY: "gemini-key", TAVILY_API_KEY: "tavily-key" });
  expect(providers.model.id).toBe("google-gemini/gemini-3.1-flash-lite");
  expect(providers.search.id).toBe("tavily-search");
});

test("the configured Gemini model is recorded and paid grounding is opt-in", () => {
  const providers = createLiveProviders({
    GEMINI_API_KEY: "gemini-key",
    GEMINI_MODEL: "gemini-3.5-flash",
    GEMINI_SEARCH_GROUNDING: "true",
  });
  expect(providers.model.id).toBe("google-gemini/gemini-3.5-flash");
  expect(providers.search.id).toBe("google-search-grounding/gemini-3.5-flash");
});

test("existing Brave Search remains supported when both provider keys are configured", () => {
  const providers = createLiveProviders({
    GEMINI_API_KEY: "gemini-key",
    BRAVE_SEARCH_API_KEY: "brave-key",
  });
  expect(providers.model.id).toBe("google-gemini/gemini-3.1-flash-lite");
  expect(providers.search.id).toBe("brave-search");
});

test("the existing Claude path remains the default and missing search fails explicitly", async () => {
  const providers = createLiveProviders({});
  expect(providers.model.id).toBe("claude-code-agent-sdk");
  expect(providers.search).toBeInstanceOf(UnconfiguredLiveSearch);
  await expect(providers.search.search({ query: "test" })).rejects.toThrow(/TAVILY_API_KEY|BRAVE_SEARCH_API_KEY/);
});
