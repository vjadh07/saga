// Renders the self-contained Saga audit workspace. A deterministic demo may be
// embedded for the explicit Demo view, but Live is the default and accepts only
// persisted results returned by the live audit API.
import type { LiveAuditResult } from "../live/audit.js";
import type { AuditResult } from "../pipeline.js";
import { verdictLabel } from "../render.js";
import type { VerdictKind } from "../types.js";

export type StudioInitialView = "live" | "demo";

export interface StudioPageOptions {
  initialView?: StudioInitialView;
  activeAuditId?: string | null;
}

const VERDICT_CLASS: Record<VerdictKind, string> = {
  supported: "v-ok",
  supported_with_qualifications: "v-warn",
  contradicted: "v-bad",
  disputed: "v-disp",
  outdated: "v-old",
  insufficient_evidence: "v-none",
  not_verifiable: "v-subj",
  failed: "v-fail",
};

const VERDICT_KINDS: VerdictKind[] = [
  "supported",
  "supported_with_qualifications",
  "contradicted",
  "disputed",
  "outdated",
  "insufficient_evidence",
  "not_verifiable",
  "failed",
];

const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  strongly_supported: "Strongly supported",
  mostly_supported: "Mostly supported",
  revision_required: "Revision required",
  insufficiently_supported: "Insufficiently supported",
  materially_contradicted: "Materially contradicted",
};

const AUDIT_STATUS_LABELS: Record<string, string> = {
  created: "Queued",
  mapping_claims: "Mapping claims",
  planning_research: "Planning research",
  researching_support: "Researching support",
  researching_counterevidence: "Researching counterevidence",
  validating_evidence: "Validating evidence",
  analyzing_lineage: "Analyzing source lineage",
  validating_temporal: "Validating dates",
  validating_numeric: "Validating numbers",
  arbitrating: "Arbitrating claims",
  generating_revision: "Generating corrected draft",
  completed: "Completed",
  partially_completed: "Partially completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

type StudioResult = AuditResult | LiveAuditResult;

export function renderStudioPage(result: StudioResult, options: StudioPageOptions = {}): string {
  const embeddedMode = result.mode === "live" ? "live" : "demo";
  const requestedView = options.initialView ?? "live";
  const initialView: StudioInitialView = embeddedMode === "live" ? "live" : requestedView;
  const resultInitiallyVisible = embeddedMode === initialView;
  const labels = Object.fromEntries(VERDICT_KINDS.map((kind) => [kind, verdictLabel(kind)]));
  const bootstrap = JSON.stringify({
    embeddedResult: result,
    initialView,
    activeAuditId: options.activeAuditId ?? null,
  }).replace(/</g, "\\u003c");

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Saga audit workspace</title>
<style>
  :root{--bg:#08090b;--panel:#0f1216;--panel2:#0b0e12;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.05);
    --text:#eef1f5;--dim:#98a2ad;--faint:#7d8792;--accent:#4ade80;--ink:#04170b;
    --ok:#4ade80;--warn:#e3b341;--bad:#f87171;--old:#f0883e;--disp:#bc8cff;--none:#8b949e;--subj:#5aa2f0;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  [hidden]{display:none!important}
  body{background:var(--bg);color:var(--text);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
  code,.mono{font-family:var(--mono)}
  button,input,textarea{font:inherit}
  button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
  .wrap{max-width:1320px;margin:0 auto;padding:0 20px}
  header{border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(8,9,11,.88);backdrop-filter:blur(10px);z-index:5}
  header .wrap{display:flex;align-items:center;gap:14px;min-height:60px}
  .brand{font-family:var(--mono);font-weight:700;letter-spacing:.14em;font-size:14px}.brand b{color:var(--accent)}
  .tagline{color:var(--faint);font-size:13px}
  .view-switch{display:flex;gap:4px;margin-left:auto;padding:3px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)}
  .view-switch button{border:0;border-radius:7px;background:transparent;color:var(--dim);padding:5px 12px;cursor:pointer;font-size:13px}
  .view-switch button[aria-pressed="true"]{background:rgba(74,222,128,.11);color:var(--accent)}
  .modebadge{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;border:1px solid var(--line);border-radius:999px;padding:4px 10px}
  .modebadge.live{color:var(--accent);border-color:rgba(74,222,128,.35)}
  .modebadge.demo{color:var(--warn);border-color:rgba(227,179,65,.4);background:rgba(227,179,65,.07)}
  .status{font-weight:650;font-size:13px;padding:5px 11px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
  .status.bad{color:var(--bad);border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.08)}
  .status.ok{color:var(--ok);border-color:rgba(74,222,128,.4);background:rgba(74,222,128,.08)}
  .status.warn{color:var(--warn);border-color:rgba(227,179,65,.4);background:rgba(227,179,65,.08)}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint);margin:0 0 12px;font-weight:650}
  section{padding:28px 0;border-top:1px solid var(--line2)}section:first-of-type{border-top:none}
  .dim,.note{color:var(--faint)}.note{font-size:12px;margin-top:10px}
  .input-label{display:block;font-weight:650;margin-bottom:8px}
  #intext{width:100%;min-height:150px;resize:vertical;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:14px;font:14px/1.6 var(--sans)}
  #intext::placeholder{color:var(--faint)}#intext:focus{border-color:rgba(74,222,128,.55)}
  .inputctl{display:flex;align-items:end;gap:16px;flex-wrap:wrap;margin-top:12px}
  .modes{display:flex;gap:6px;border:0;min-width:0}.modes legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .modes label{font-size:13px;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:6px}.modes input{accent-color:var(--accent)}
  .btn{border:1px solid var(--line);border-radius:10px;padding:9px 18px;font-weight:650;font-size:14px;cursor:pointer;background:var(--panel);color:var(--text)}
  .btn:hover{border-color:rgba(74,222,128,.42)}.btn:disabled{opacity:.5;cursor:default}
  .btn-run{margin-left:auto;background:var(--accent);color:var(--ink);border-color:transparent;padding:10px 24px}.btn-run:hover{background:#6ce599}
  .btn-danger{color:var(--bad);border-color:rgba(248,113,113,.35)}
  .live-state{margin-top:18px;border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--panel)}
  .live-head{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.live-head p{font-weight:650}
  .live-actions{display:flex;gap:8px;margin-left:auto}
  .live-error{border:1px solid rgba(248,113,113,.4);background:rgba(248,113,113,.06);border-radius:10px;padding:12px;margin-top:12px;color:#f3c8c8;font-size:13px}
  .live-events{margin-top:12px}
  .result-kicker{display:inline-block;font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);border:1px solid rgba(74,222,128,.35);border-radius:999px;padding:4px 12px;margin-bottom:16px}
  .result-kicker.demo{color:var(--warn);border-color:rgba(227,179,65,.4)}
  .stats{display:grid;grid-template-columns:repeat(10,1fr);gap:10px}
  .stat{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--panel)}.stat .num{font-family:var(--mono);font-size:22px;font-weight:650}.stat .lbl{color:var(--faint);font-size:11px;margin-top:4px;text-transform:uppercase;letter-spacing:.04em}
  .stat.v-ok .num{color:var(--ok)}.stat.v-warn .num{color:var(--warn)}.stat.v-bad .num,.stat.v-fail .num{color:var(--bad)}.stat.v-old .num{color:var(--old)}.stat.v-none .num{color:var(--none)}.stat.v-subj .num{color:var(--subj)}
  .work{display:grid;grid-template-columns:1.15fr 1fr 1.15fr;gap:14px;align-items:start}.pane{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:16px;min-height:280px}.pane h3{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);margin-bottom:12px;font-weight:650}
  .doc{white-space:pre-wrap;line-height:1.9;font-size:15px}.claim-mark{display:inline;background:transparent;color:inherit;border:0;border-bottom:2px solid var(--faint);cursor:pointer;padding:1px 0;border-radius:2px;text-align:left}.claim-mark:hover{background:rgba(255,255,255,.05)}.claim-mark.sel{background:rgba(74,222,128,.1)}
  .claim-mark.v-ok{border-color:var(--ok)}.claim-mark.v-warn{border-color:var(--warn)}.claim-mark.v-bad{border-color:var(--bad)}.claim-mark.v-old{border-color:var(--old)}.claim-mark.v-disp{border-color:var(--disp)}.claim-mark.v-none{border-color:var(--none)}.claim-mark.v-subj{border-color:var(--subj)}.claim-mark.v-fail{border-color:var(--bad);border-bottom-style:dashed}
  .verdict-badge{display:inline-block;font-weight:650;font-size:13px;padding:4px 12px;border-radius:999px;border:1px solid var(--line)}.verdict-badge.v-ok{color:var(--ok);border-color:rgba(74,222,128,.4)}.verdict-badge.v-warn{color:var(--warn);border-color:rgba(227,179,65,.4)}.verdict-badge.v-bad{color:var(--bad);border-color:rgba(248,113,113,.4)}.verdict-badge.v-old{color:var(--old);border-color:rgba(240,136,62,.4)}.verdict-badge.v-disp{color:var(--disp);border-color:rgba(188,140,255,.4)}.verdict-badge.v-none{color:var(--none)}.verdict-badge.v-subj{color:var(--subj);border-color:rgba(90,162,240,.4)}.verdict-badge.v-fail{color:var(--bad);border:1px dashed rgba(248,113,113,.6)}
  .kv{color:var(--dim);font-size:13px;margin:10px 0}.kv b{color:var(--text);font-weight:600}.claimtext{font-size:15px;line-height:1.5;margin:6px 0 14px}.conf{font-family:var(--mono);font-size:12px;color:var(--faint)}
  .ev{border:1px solid var(--line);border-radius:10px;padding:11px;margin-bottom:10px;background:var(--panel2)}.ev .src{font-family:var(--mono);font-size:11px;color:var(--accent)}.ev.against .src{color:var(--bad)}.ev .ex{font-size:13px;color:var(--dim);margin-top:5px}.ev .st{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);float:right}.correction{margin-top:12px;padding:10px;border:1px dashed var(--line);border-radius:8px;color:var(--warn);font-size:13px}
  .log{list-style:none;font-family:var(--mono);font-size:12.5px;line-height:1.9;max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--panel2)}.log li .mk{display:inline-block;width:16px;color:var(--faint)}.log li.ok .mk{color:var(--ok)}.log li.warn .mk{color:var(--bad)}.log li.warn{color:#f3c8c8}
  .lgroup{border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--panel);display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;margin-bottom:10px}.lorigin{display:flex;flex-direction:column;gap:6px;align-items:flex-start}.lnode{font-family:var(--mono);font-size:12px;border:1px solid var(--line);border-radius:8px;padding:5px 10px;background:var(--panel2);color:var(--dim)}.lnode.origin{color:var(--accent);border-color:rgba(74,222,128,.45);background:rgba(74,222,128,.07)}.ltag{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint)}.lfan{display:flex;flex-wrap:wrap;gap:8px}.lnote{grid-column:1/-1;color:var(--faint);font-size:12px;border-top:1px solid var(--line2);padding-top:10px}
  .safe{border:1px solid rgba(248,113,113,.35);border-radius:12px;padding:14px;background:rgba(248,113,113,.05);margin-bottom:10px}.stag{font-family:var(--mono);font-size:11px;color:var(--bad);text-transform:uppercase;letter-spacing:.06em}.ssrc{color:var(--faint);font-size:12px;margin:6px 0}.safe code{display:block;font-size:12.5px;color:var(--dim);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:4px}
  .draftgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.change{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--panel)}.chead{display:flex;align-items:center;gap:8px;font-size:12px}.ckind{font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--warn)}.toggle{margin-left:auto;color:var(--dim);font-size:12px;display:flex;align-items:center;gap:5px;cursor:pointer}.cnote{color:var(--dim);font-size:12.5px;margin:8px 0}.cbefore{color:var(--faint);font-size:13px}.cbefore s{color:var(--bad)}.cafter{color:var(--ok);font-size:13px;margin-top:4px}.draftout{white-space:pre-wrap;line-height:1.9;font-size:14px;border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--panel2)}.draftout ins{text-decoration:none;color:var(--ok);background:rgba(74,222,128,.08);border-radius:3px;padding:0 2px}
  .receipt{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.receipt div{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--panel)}.receipt dt{color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.05em}.receipt dd{font-family:var(--mono);font-size:12px;margin-top:5px;overflow-wrap:anywhere}
  .empty-view{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:22px;margin-top:28px}
  @media(max-width:1000px){.stats{grid-template-columns:repeat(5,1fr)}.work,.draftgrid{grid-template-columns:1fr}.receipt{grid-template-columns:1fr}.btn-run{margin-left:0}}
  @media(max-width:640px){.wrap{padding:0 14px}header .wrap{padding-top:9px;padding-bottom:9px;flex-wrap:wrap}.tagline{display:none}.view-switch{margin-left:auto}.modebadge{order:4}.status{order:5;margin-left:auto}.stats{grid-template-columns:repeat(2,1fr)}.modes{display:grid;grid-template-columns:1fr 1fr;width:100%}.modes label:last-child{grid-column:1/-1}.inputctl{align-items:stretch}.btn-run{width:100%}.live-actions{width:100%;margin-left:0}.live-actions .btn{flex:1}.lgroup{grid-template-columns:1fr}.lnote{grid-column:1}.lfan{display:grid;grid-template-columns:1fr 1fr}.lnode{overflow-wrap:anywhere}}
</style>

<header><div class="wrap">
  <span class="brand">SAGA<b>.</b></span>
  <span class="tagline">Trust, with receipts</span>
  <div class="view-switch" role="group" aria-label="Audit view">
    <button type="button" id="view-live" aria-pressed="${initialView === "live"}">Live</button>
    <button type="button" id="view-demo" aria-pressed="${initialView === "demo"}">Demo</button>
  </div>
  <span id="modebadge" class="modebadge ${initialView}">${initialView === "demo" ? "Demo mode" : "Live mode"}</span>
  <span id="status" class="status">${initialView === "demo" ? "Deterministic demo audit" : embeddedMode === "live" ? "Live result loaded" : "Live mode ready"}</span>
</div></header>

<main class="wrap">
  <section id="live-view"${initialView === "live" ? "" : " hidden"}>
    <h2>Live audit</h2>
    <label class="input-label" for="intext">Text to verify</label>
    <textarea id="intext" placeholder="Paste an AI-written report, article, or draft, then Verify."></textarea>
    <div class="inputctl">
      <fieldset class="modes"><legend>Audit depth</legend>
        <label><input type="radio" name="mode" value="quick"> Quick</label>
        <label><input type="radio" name="mode" value="deep" checked> Deep</label>
        <label><input type="radio" name="mode" value="high_stakes"> High-Stakes</label>
      </fieldset>
      <button type="button" id="run" class="btn btn-run">Verify</button>
    </div>
    <div class="live-state">
      <div class="live-head">
        <p id="live-status" role="status" aria-live="polite" aria-atomic="true">Ready for a live audit.</p>
        <div class="live-actions">
          <button type="button" id="cancel" class="btn btn-danger" hidden>Cancel</button>
          <button type="button" id="retry" class="btn" hidden>Retry</button>
        </div>
      </div>
      <div id="live-error" class="live-error" role="alert" aria-live="assertive" hidden></div>
      <div id="live-events-wrap" class="live-events" hidden>
        <h2>Persisted events</h2>
        <ol id="live-events" class="log" aria-label="Persisted live audit events"></ol>
      </div>
    </div>
    <p class="note">Live mode uses provider-backed research only. A failed live audit remains failed and is never replaced by the demo.</p>
  </section>

  <section id="demo-empty" class="empty-view" hidden>
    <h2>Demo unavailable</h2>
    <p>This page contains a live audit result, not a deterministic demo. Return to the guest demo entry point to load the demo fixture.</p>
  </section>

  <div id="result-view"${resultInitiallyVisible ? "" : " hidden"}>
    <section>
      <span id="result-kicker" class="result-kicker${embeddedMode === "demo" ? " demo" : ""}">${embeddedMode === "demo" ? "Deterministic demo audit" : "Live audit result"}</span>
      <h2 id="result-title" tabindex="-1">Trust Passport</h2>
      <div id="stats" class="stats"></div>
      <div id="passport-note" class="note"></div>
    </section>
    <section>
      <h2>Audit workspace</h2>
      <div class="work">
        <div class="pane"><h3>Submitted document</h3><div id="doc" class="doc"></div></div>
        <div class="pane"><h3>Selected claim</h3><div id="claim"></div></div>
        <div class="pane"><h3>Evidence</h3><div id="evidence"></div></div>
      </div>
    </section>
    <section><h2>Agent Flight Recorder</h2><ol id="flight" class="log"></ol></section>
    <section><h2>Source lineage</h2><div id="lineage"></div></section>
    <section><h2>Safety Sentinel</h2><div id="safety"></div></section>
    <section>
      <h2>Corrected draft (proposed, you approve)</h2>
      <div class="draftgrid">
        <div id="changes"></div>
        <div><div id="draftout" class="draftout"></div><div class="note">The original is never overwritten. Uncheck a change to keep the original wording.</div></div>
      </div>
    </section>
    <section id="receipt-section" hidden><h2>Tamper-evident audit receipt</h2><dl id="receipt" class="receipt"></dl></section>
  </div>
</main>

<script id="studio-bootstrap" type="application/json">${bootstrap}</script>
<script>
const BOOT=JSON.parse(document.getElementById("studio-bootstrap").textContent);
const VCLASS=${JSON.stringify(VERDICT_CLASS)};
const LABEL=${JSON.stringify(labels)};
const DOCUMENT_STATUS=${JSON.stringify(DOCUMENT_STATUS_LABELS)};
const AUDIT_STATUS=${JSON.stringify(AUDIT_STATUS_LABELS)};
const TERMINAL=new Set(["completed","partially_completed","failed","cancelled"]);
const WARNING_EVENTS=new Set(["INJECTION_QUARANTINED","SOURCE_REJECTED","CONTRADICTION_FOUND","TEMPORAL_FLAGGED"]);
const POSITIVE_EVENTS=new Set(["PRIMARY_SOURCE_FOUND","VERDICT_REACHED","AUDIT_COMPLETED"]);

const liveView=document.getElementById("live-view");
const resultView=document.getElementById("result-view");
const demoEmpty=document.getElementById("demo-empty");
const liveButton=document.getElementById("view-live");
const demoButton=document.getElementById("view-demo");
const modeBadge=document.getElementById("modebadge");
const headerStatus=document.getElementById("status");
const liveStatus=document.getElementById("live-status");
const liveError=document.getElementById("live-error");
const runButton=document.getElementById("run");
const cancelButton=document.getElementById("cancel");
const retryButton=document.getElementById("retry");

let currentView=BOOT.initialView;
let currentResult=null;
let currentStored=null;
let activeAuditId=BOOT.activeAuditId;
let pollGeneration=0;
const embeddedDemo=BOOT.embeddedResult && BOOT.embeddedResult.mode==="demo" ? BOOT.embeddedResult : null;
const embeddedLive=BOOT.embeddedResult && BOOT.embeddedResult.mode==="live" ? BOOT.embeddedResult : null;
if(embeddedLive) currentResult=embeddedLive;

function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function statusLabel(status){return DOCUMENT_STATUS[status]||String(status||"").replace(/_/g," ")}
function auditStatusLabel(status){return AUDIT_STATUS[status]||String(status||"").replace(/_/g," ")}
function setHeader(text,kind){headerStatus.textContent=text;headerStatus.className="status"+(kind?" "+kind:"")}
function resultKind(result){
  const status=result && result.passport ? result.passport.documentStatus : "";
  return status==="strongly_supported"||status==="mostly_supported" ? "ok" : status ? "bad" : "";
}
function updateModeControls(){
  liveButton.setAttribute("aria-pressed",String(currentView==="live"));
  demoButton.setAttribute("aria-pressed",String(currentView==="demo"));
  modeBadge.textContent=currentView==="live"?"Live mode":"Demo mode";
  modeBadge.className="modebadge "+currentView;
}
function setView(view){
  currentView=view;
  updateModeControls();
  liveView.hidden=view!=="live";
  demoEmpty.hidden=true;
  if(view==="demo"){
    if(embeddedDemo){
      renderAuditResult(embeddedDemo,"demo");
      resultView.hidden=false;
      setHeader(statusLabel(embeddedDemo.passport.documentStatus),resultKind(embeddedDemo));
    }else{
      window.location.assign("/demo");
    }
    return;
  }
  if(currentResult && currentResult.mode==="live"){
    renderAuditResult(currentResult,"live");
    resultView.hidden=false;
  }else{
    resultView.hidden=true;
  }
  if(currentStored) updateLiveHeader(currentStored.record);
  else if(currentResult) setHeader(statusLabel(currentResult.passport.documentStatus),resultKind(currentResult));
  else setHeader("Live mode ready","");
}
liveButton.addEventListener("click",()=>setView("live"));
demoButton.addEventListener("click",()=>setView("demo"));

function stat(label,value,cls){return '<div class="stat '+(cls||"")+'"><div class="num">'+escapeHtml(value)+'</div><div class="lbl">'+escapeHtml(label)+'</div></div>'}
function renderPassport(result){
  const p=result.passport;
  document.getElementById("stats").innerHTML=[
    stat("claims",p.totalClaims),stat("supported",p.supported,"v-ok"),stat("qualified",p.qualified,"v-warn"),
    stat("contradicted",p.contradicted,"v-bad"),stat("outdated",p.outdated,"v-old"),stat("insufficient",p.insufficient,"v-none"),
    stat("subjective",p.notVerifiable,"v-subj"),stat("primary sources",p.primarySourceCount),
    stat("independent origins",p.independentOrigins),stat("need revision",p.claimsRequiringRevision,"v-bad")
  ].join("");
  document.getElementById("passport-note").textContent="Last verified "+p.lastVerifiedAt+". "+result.lineage.sourceCount+" sources cited, "+result.lineage.independentOrigins+" independent evidence origins.";
}
function renderDocument(result){
  const audits=[...(result.claimAudits||[])].sort((a,b)=>a.claim.location.start-b.claim.location.start);
  const doc=String(result.document||"");
  let html="",cursor=0;
  for(const audit of audits){
    const start=audit.claim.location.start,end=audit.claim.location.end;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<cursor||end<start||end>doc.length) continue;
    html+=escapeHtml(doc.slice(cursor,start));
    const cls=VCLASS[audit.verdict.verdict]||"v-none";
    html+='<button type="button" class="claim-mark '+cls+'" data-id="'+escapeHtml(audit.claim.id)+'" aria-pressed="false" aria-controls="claim evidence">'+escapeHtml(doc.slice(start,end))+'</button>';
    cursor=end;
  }
  html+=escapeHtml(doc.slice(cursor));
  document.getElementById("doc").innerHTML=html;
  document.querySelectorAll(".claim-mark").forEach(button=>button.addEventListener("click",()=>selectClaim(result,button.dataset.id)));
  if(audits.length) selectClaim(result,audits[0].claim.id);
  else{
    document.getElementById("claim").innerHTML='<div class="dim">No claims were returned.</div>';
    document.getElementById("evidence").innerHTML='<div class="dim">No evidence was returned.</div>';
  }
}
function selectClaim(result,id){
  const audit=(result.claimAudits||[]).find(item=>item.claim.id===id);if(!audit)return;
  document.querySelectorAll(".claim-mark").forEach(button=>{
    const selected=button.dataset.id===id;button.classList.toggle("sel",selected);button.setAttribute("aria-pressed",String(selected));
  });
  const verdict=audit.verdict,cls=VCLASS[verdict.verdict]||"v-none";
  let claim='<span class="verdict-badge '+cls+'">'+escapeHtml(LABEL[verdict.verdict]||verdict.verdict)+'</span> <span class="conf">'+escapeHtml(verdict.confidence)+' confidence</span>';
  claim+='<div class="claimtext">"'+escapeHtml(audit.claim.originalText)+'"</div>';
  claim+='<div class="kv">type <b>'+escapeHtml(audit.claim.claimType)+'</b> | risk <b>'+escapeHtml(audit.claim.risk)+'</b>'+(audit.claim.timeSensitive?' | <b>time-sensitive</b>':'')+'</div>';
  claim+='<div class="kv">'+escapeHtml(verdict.rationale)+'</div><div class="kv">independent origins behind support: <b>'+escapeHtml(verdict.independentOrigins)+'</b></div>';
  if(verdict.temporal&&verdict.temporal.superseded)claim+='<div class="kv">temporal: <b>'+escapeHtml(verdict.temporal.note)+'</b></div>';
  if(verdict.requiredCorrection)claim+='<div class="correction">Required correction: '+escapeHtml(verdict.requiredCorrection)+'</div>';
  document.getElementById("claim").innerHTML=claim;
  const supporting=(audit.evidence||[]).filter(e=>e.stance==="supports");
  const against=(audit.evidence||[]).filter(e=>e.stance==="contradicts"||e.stance==="qualifies");
  let evidence="";
  for(const item of supporting)evidence+='<div class="ev"><span class="st">supports</span><span class="src">'+escapeHtml(item.sourceId)+'</span><div class="ex">"'+escapeHtml(item.excerpt)+'"</div></div>';
  for(const item of against)evidence+='<div class="ev against"><span class="st">'+escapeHtml(item.stance)+'</span><span class="src">'+escapeHtml(item.sourceId)+'</span><div class="ex">"'+escapeHtml(item.excerpt)+'"</div></div>';
  document.getElementById("evidence").innerHTML=evidence||'<div class="dim">No validated evidence retrieved for this claim.</div>';
}
function eventText(event){
  let text=String(event.type||"recorded event").replace(/_/g," ").toLowerCase();
  if(event.claimId)text+=" | "+event.claimId;
  const detail=event.detail||{};
  if(detail.verdict)text+=" | "+detail.verdict;
  else if(detail.sourceId)text+=" | "+detail.sourceId;
  return text;
}
function renderEventList(element,events,empty){
  if(!events||!events.length){element.innerHTML='<li class="dim">'+escapeHtml(empty)+'</li>';return;}
  element.innerHTML=events.map(event=>{
    const cls=WARNING_EVENTS.has(event.type)?"warn":POSITIVE_EVENTS.has(event.type)?"ok":"dim";
    const marker=cls==="warn"?"!":cls==="ok"?"+":".";
    return '<li class="'+cls+'"><span class="mk">'+marker+'</span>'+escapeHtml(eventText(event))+'</li>';
  }).join("");
}
function renderLineage(result){
  const groups=(result.lineage&&result.lineage.groups)||[];
  document.getElementById("lineage").innerHTML=groups.map(group=>{
    const copies=group.sourceIds.filter(id=>id!==group.representativeSourceId).map(id=>'<span class="lnode">'+escapeHtml(id)+'</span>').join("");
    return '<div class="lgroup"><div class="lorigin"><span class="lnode origin">'+escapeHtml(group.representativeSourceId)+'</span><span class="ltag">origin</span></div><div class="lfan">'+copies+'</div><div class="lnote">'+escapeHtml(group.sourceIds.length)+' sources, 1 independent origin ('+escapeHtml(group.originLabel)+')<br>signals: '+escapeHtml(group.signals.join(", "))+'</div></div>';
  }).join("")||'<div class="dim">No shared-origin clusters detected.</div>';
}
function renderSafety(result){
  const events=result.safetyEvents||[];
  document.getElementById("safety").innerHTML=events.map(event=>'<div class="safe"><span class="stag">'+escapeHtml(event.kind)+' '+escapeHtml(event.action)+'</span><div class="ssrc">source: '+escapeHtml(event.sourceId)+'</div><code>'+escapeHtml(event.excerpt)+'</code></div>').join("")||'<div class="dim">No unsafe content detected.</div>';
}
function renderChanges(result){
  const changes=result.correctedDraft.changes||[];
  document.getElementById("changes").innerHTML=changes.map((change,index)=>'<div class="change" data-i="'+index+'"><div class="chead"><span class="ckind">'+escapeHtml(change.kind)+'</span> <span class="dim">'+escapeHtml(change.claimId)+'</span><label class="toggle"><input type="checkbox" class="approve" data-i="'+index+'" checked> apply</label></div><div class="cnote">'+escapeHtml(change.note)+'</div><div class="cbefore"><s>'+escapeHtml(change.original)+'</s></div><div class="cafter">'+escapeHtml(change.replacement)+'</div></div>').join("")||'<div class="dim">No changes proposed.</div>';
  document.querySelectorAll(".approve").forEach(box=>box.addEventListener("change",()=>renderDraft(result)));
  renderDraft(result);
}
function renderDraft(result){
  const selected=new Set([...document.querySelectorAll(".approve:checked")].map(box=>Number(box.dataset.i)));
  const locations=new Map((result.claimAudits||[]).map(a=>[a.claim.id,a.claim.location]));
  const changes=(result.correctedDraft.changes||[]).map((change,index)=>({change,index,location:locations.get(change.claimId)})).filter(item=>selected.has(item.index)&&item.location).sort((a,b)=>a.location.start-b.location.start);
  const original=String(result.correctedDraft.original||"");
  let html="",cursor=0;
  for(const item of changes){
    if(item.location.start<cursor||item.location.end>original.length)continue;
    html+=escapeHtml(original.slice(cursor,item.location.start))+'<ins>'+escapeHtml(item.change.replacement)+'</ins>';
    cursor=item.location.end;
  }
  html+=escapeHtml(original.slice(cursor));
  document.getElementById("draftout").innerHTML=html;
}
function renderReceipt(result){
  const section=document.getElementById("receipt-section"),receipt=result.receipt;
  if(result.mode!=="live"||!receipt){section.hidden=true;return;}
  section.hidden=false;
  const fields=[["Final audit hash",receipt.finalAuditHash],["Document hash",receipt.documentHash],["Final draft hash",receipt.finalDraftHash],["Workflow",receipt.workflowVersion],["Model",receipt.modelId],["Search",receipt.searchProvider]];
  document.getElementById("receipt").innerHTML=fields.map(field=>'<div><dt>'+escapeHtml(field[0])+'</dt><dd>'+escapeHtml(field[1])+'</dd></div>').join("");
}
function renderAuditResult(result,mode){
  if(!result||result.mode!==mode)return;
  const kicker=document.getElementById("result-kicker");
  kicker.textContent=mode==="demo"?"Deterministic demo audit":"Live audit result";kicker.className="result-kicker"+(mode==="demo"?" demo":"");
  renderPassport(result);renderDocument(result);renderEventList(document.getElementById("flight"),result.flight||[],"No flight events were recorded.");renderLineage(result);renderSafety(result);renderChanges(result);renderReceipt(result);
}

function updateLiveHeader(record){
  const kind=record.status==="completed"?"ok":record.status==="partially_completed"?"warn":record.status==="failed"||record.status==="cancelled"?"bad":"";
  setHeader(auditStatusLabel(record.status),kind);
}
function showLiveFailure(message){
  liveError.textContent=(message?message+" ":"")+"Live audit failed. Demo mode was not substituted.";
  liveError.hidden=false;runButton.disabled=false;cancelButton.hidden=true;retryButton.hidden=false;
  if(currentView==="live")setHeader("Live audit failed","bad");
}
function showInputError(message){
  liveError.textContent=message;liveError.hidden=false;runButton.disabled=false;cancelButton.hidden=true;retryButton.hidden=true;
  setHeader("Input required","warn");
}
function renderStored(stored,suppressStaleFailure){
  if(!stored||!stored.record||stored.record.mode!=="live")throw new Error("The live endpoint returned a non-live audit record.");
  currentStored=stored;
  liveStatus.textContent="Status: "+auditStatusLabel(stored.record.status);
  if(currentView==="live")updateLiveHeader(stored.record);
  const events=Array.isArray(stored.events)?stored.events:[];
  document.getElementById("live-events-wrap").hidden=false;
  renderEventList(document.getElementById("live-events"),events,"No persisted events yet.");
  const terminal=TERMINAL.has(stored.record.status);
  runButton.disabled=!terminal;cancelButton.hidden=terminal;retryButton.hidden=stored.record.status!=="failed"&&stored.record.status!=="cancelled";
  liveError.hidden=true;
  if(stored.result&&!suppressStaleFailure){
    if(typeof stored.result!=="object"||stored.result.mode!=="live"||stored.result.auditId!==stored.record.id)throw new Error("The stored result is not a valid live audit result.");
    currentResult=stored.result;
    if(currentView==="live"){
      renderAuditResult(currentResult,"live");resultView.hidden=false;
      if(terminal)document.getElementById("result-title").focus();
    }
  }
  if(stored.record.status==="failed"&&!suppressStaleFailure)showLiveFailure(stored.record.error||"The persisted audit status is failed.");
  return terminal;
}
async function apiRequest(path,options){
  const response=await fetch(path,options);
  let body=null;try{body=await response.json()}catch{}
  if(!response.ok){const message=body&&typeof body.error==="string"?body.error:"Request failed with status "+response.status;throw new Error(message)}
  return body;
}
function setAuditUrl(id){
  const url=new URL(window.location.href);if(id)url.searchParams.set("audit",id);else url.searchParams.delete("audit");
  window.history.replaceState({},"",url.pathname+url.search+url.hash);
}
function beginPolling(auditId,retryBudget){
  activeAuditId=auditId;const generation=++pollGeneration;
  void pollAudit(auditId,generation,retryBudget||0);
}
async function pollAudit(auditId,generation,retryBudget){
  if(generation!==pollGeneration)return;
  try{
    const stored=await apiRequest("/api/audits/"+encodeURIComponent(auditId));
    if(generation!==pollGeneration)return;
    const staleRetryState=retryBudget>0&&(stored.record.status==="failed"||stored.record.status==="cancelled");
    const terminal=renderStored(stored,staleRetryState);
    const waitingForRetry=terminal&&staleRetryState;
    if(!terminal||waitingForRetry)setTimeout(()=>void pollAudit(auditId,generation,waitingForRetry?retryBudget-1:retryBudget),750);
  }catch(error){
    if(generation!==pollGeneration)return;
    showLiveFailure(error instanceof Error?error.message:String(error));
  }
}

runButton.addEventListener("click",async()=>{
  setView("live");
  const documentText=document.getElementById("intext").value;
  if(!documentText.trim()){showInputError("Paste some text first.");return;}
  const selected=document.querySelector('input[name="mode"]:checked');
  const mode=selected?selected.value:"deep";
  pollGeneration++;currentResult=null;currentStored=null;resultView.hidden=true;liveError.hidden=true;runButton.disabled=true;cancelButton.hidden=false;retryButton.hidden=true;
  liveStatus.textContent="Submitting live audit.";setHeader("Submitting live audit","");
  try{
    const created=await apiRequest("/api/audits",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({document:documentText,mode})});
    if(!created||!created.audit||created.audit.mode!=="live"||typeof created.audit.id!=="string")throw new Error("The live endpoint returned an invalid audit record.");
    activeAuditId=created.audit.id;setAuditUrl(activeAuditId);
    renderStored({record:created.audit,claims:[],evidence:[],events:[],result:null});
    beginPolling(activeAuditId,0);
  }catch(error){showLiveFailure(error instanceof Error?error.message:String(error))}
});
cancelButton.addEventListener("click",async()=>{
  if(!activeAuditId)return;cancelButton.disabled=true;
  try{
    pollGeneration++;
    const stored=await apiRequest("/api/audits/"+encodeURIComponent(activeAuditId)+"/cancel",{method:"POST"});
    renderStored(stored);
  }catch(error){showLiveFailure(error instanceof Error?error.message:String(error))}finally{cancelButton.disabled=false}
});
retryButton.addEventListener("click",async()=>{
  if(!activeAuditId)return;retryButton.disabled=true;liveError.hidden=true;
  try{
    await apiRequest("/api/audits/"+encodeURIComponent(activeAuditId)+"/retry",{method:"POST"});
    currentResult=null;currentStored=null;resultView.hidden=true;
    liveStatus.textContent="Retry accepted. Waiting for persisted state.";setHeader("Retry accepted","");
    beginPolling(activeAuditId,12);
  }catch(error){showLiveFailure(error instanceof Error?error.message:String(error))}finally{retryButton.disabled=false}
});

updateModeControls();
const queryAuditId=new URLSearchParams(window.location.search).get("audit");
if(queryAuditId){activeAuditId=queryAuditId;currentView="live";setView("live");beginPolling(queryAuditId,0)}
else if(activeAuditId){currentView="live";setAuditUrl(activeAuditId);setView("live");beginPolling(activeAuditId,0)}
else if(embeddedLive){setView("live")}
else setView(currentView);
</script>`;
}
