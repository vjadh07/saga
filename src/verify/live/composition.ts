// Production composition for the complete Live path. The service owns persistence and
// lifecycle, while this module wires the validated Claim Mapper and provider-backed audit
// orchestrator without importing Demo fixtures.
import { mapClaimsWithModel } from "../agent/mapper.js";
import type { ModelProvider } from "../providers/model.js";
import type { PageFetcher } from "../providers/fetch.js";
import type { SearchProvider } from "../providers/search.js";
import type { AuditStore } from "../providers/store.js";
import type { Claim } from "../types.js";
import { runLiveAudit } from "./audit.js";
import { AuditService, type AuditServiceOptions } from "./service.js";
import type { AuditResourceOptions } from "./resources.js";

export interface LiveAuditCompositionOptions {
  store: AuditStore;
  model: ModelProvider;
  search: SearchProvider;
  fetcher: PageFetcher;
  now?: () => string;
  mapper?: (document: string, model: ModelProvider) => Promise<Claim[]>;
  mappingModelCalls?: number;
  resourceOptions?: Omit<AuditResourceOptions, "signal">;
  serviceOptions?: AuditServiceOptions;
}

export function createLiveAuditService(options: LiveAuditCompositionOptions): AuditService {
  const now = options.now ?? (() => new Date().toISOString());
  const mapper = options.mapper ?? mapClaimsWithModel;
  const mappingModelCalls = options.mappingModelCalls ?? 1;
  return new AuditService(options.store, {
    async mapClaims(document, { signal }) {
      signal.throwIfAborted();
      const claims = await mapper(document, options.model);
      signal.throwIfAborted();
      return claims;
    },
    runAudit(input) {
      const initialUsage = {
        ...options.resourceOptions?.initialUsage,
        modelCalls: (options.resourceOptions?.initialUsage?.modelCalls ?? 0) + mappingModelCalls,
      };
      return runLiveAudit({
        auditId: input.auditId,
        document: input.document,
        claims: input.claims,
        mode: input.auditMode,
        model: options.model,
        search: options.search,
        fetcher: options.fetcher,
        now: now(),
        signal: input.signal,
        onStage: input.onStage,
        onEvent: input.onEvent,
        resourceOptions: { ...options.resourceOptions, initialUsage },
      });
    },
  }, options.serviceOptions);
}
