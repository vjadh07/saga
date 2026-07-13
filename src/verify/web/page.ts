// Renders the Saga audit workspace as a single self-contained HTML page. The audit
// result is serialized into the page, so it works offline and is fully deterministic:
// no fetch, no external resource. The client script only handles selection and the
// approve/reject toggles. Kept in one function so it is easy to test that the page
// carries the real audit data.
import type { AuditResult } from "../pipeline.js";
import { flightLine, flightMarker, statusLabel, verdictLabel } from "../render.js";

const VERDICT_CLASS: Record<string, string> = {
  supported: "v-ok",
  supported_with_qualifications: "v-warn",
  contradicted: "v-bad",
  disputed: "v-disp",
  outdated: "v-old",
  insufficient_evidence: "v-none",
  not_verifiable: "v-subj",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderStudioPage(result: AuditResult): string {
  // Embed JSON in a <script> without HTML-escaping (browsers do not decode entities
  // inside <script>); only neutralize "<" so a "</script>" in the data cannot break out.
  const data = JSON.stringify(result).replace(/</g, "\\u003c");
  const p = result.passport;

  const stat = (label: string, value: number | string, cls = "") =>
    `<div class="stat ${cls}"><div class="num">${value}</div><div class="lbl">${label}</div></div>`;

  const passportStats = [
    stat("claims", p.totalClaims),
    stat("supported", p.supported, "v-ok"),
    stat("qualified", p.qualified, "v-warn"),
    stat("contradicted", p.contradicted, "v-bad"),
    stat("outdated", p.outdated, "v-old"),
    stat("insufficient", p.insufficient, "v-none"),
    stat("subjective", p.notVerifiable, "v-subj"),
    stat("primary sources", p.primarySourceCount),
    stat("independent origins", p.independentOrigins),
    stat("need revision", p.claimsRequiringRevision, "v-bad"),
  ].join("");

  const flight = result.flight
    .map((e) => {
      const m = flightMarker(e.type);
      const cls = m === "!" ? "warn" : m === "+" ? "ok" : "dim";
      return `<li class="${cls}"><span class="mk">${m}</span>${esc(flightLine(e))}</li>`;
    })
    .join("");

  const lineage = result.lineage.groups
    .map((g) => {
      const copies = g.sourceIds.filter((s) => s !== g.representativeSourceId);
      const nodes = copies.map((s) => `<span class="lnode">${esc(s)}</span>`).join("");
      return `<div class="lgroup">
        <div class="lorigin"><span class="lnode origin">${esc(g.representativeSourceId)}</span><span class="ltag">origin</span></div>
        <div class="lfan">${nodes}</div>
        <div class="lnote">${g.sourceIds.length} sources, 1 independent origin (${esc(g.originLabel)})<br>signals: ${g.signals.map(esc).join(", ")}</div>
      </div>`;
    })
    .join("");

  const safety = result.safetyEvents.length
    ? result.safetyEvents
        .map(
          (s) =>
            `<div class="safe"><span class="stag">${esc(s.kind)} ${esc(s.action)}</span><div class="ssrc">source: ${esc(s.sourceId)}</div><code>${esc(s.excerpt)}</code></div>`,
        )
        .join("")
    : `<div class="dim">No unsafe content detected.</div>`;

  const changes = result.correctedDraft.changes
    .map(
      (c, i) => `<div class="change" data-i="${i}">
        <div class="chead"><span class="ckind">${esc(c.kind)}</span> <span class="dim">${esc(c.claimId)}</span>
          <label class="toggle"><input type="checkbox" class="approve" checked> apply</label></div>
        <div class="cnote">${esc(c.note)}</div>
        <div class="cbefore"><s>${esc(c.original)}</s></div>
        <div class="cafter">${esc(c.replacement)}</div>
      </div>`,
    )
    .join("");

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Saga audit workspace</title>
<style>
  :root{--bg:#08090b;--panel:#0f1216;--panel2:#0b0e12;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.05);
    --text:#eef1f5;--dim:#98a2ad;--faint:#5f6771;--accent:#4ade80;--ink:#04170b;
    --ok:#4ade80;--warn:#e3b341;--bad:#f87171;--old:#f0883e;--disp:#bc8cff;--none:#8b949e;--subj:#5aa2f0;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
  code,.mono{font-family:var(--mono)}
  a{color:var(--accent)}
  .wrap{max-width:1320px;margin:0 auto;padding:0 20px}
  header{border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(8,9,11,.85);backdrop-filter:blur(10px);z-index:5}
  header .wrap{display:flex;align-items:center;gap:16px;height:60px}
  .brand{font-family:var(--mono);font-weight:700;letter-spacing:.14em;font-size:14px}
  .brand b{color:var(--accent)}
  .tagline{color:var(--faint);font-size:13px}
  .status{margin-left:auto;font-weight:650;font-size:14px;padding:6px 14px;border-radius:999px;border:1px solid var(--line)}
  .status.bad{color:var(--bad);border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.08)}
  .status.ok{color:var(--ok);border-color:rgba(74,222,128,.4);background:rgba(74,222,128,.08)}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint);margin:0 0 12px;font-weight:650}
  section{padding:28px 0;border-top:1px solid var(--line2)}
  section:first-of-type{border-top:none}
  /* passport */
  .stats{display:grid;grid-template-columns:repeat(10,1fr);gap:10px}
  .stat{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--panel)}
  .stat .num{font-family:var(--mono);font-size:22px;font-weight:650}
  .stat .lbl{color:var(--faint);font-size:11px;margin-top:4px;text-transform:uppercase;letter-spacing:.04em}
  .stat.v-ok .num{color:var(--ok)}.stat.v-warn .num{color:var(--warn)}.stat.v-bad .num{color:var(--bad)}
  .stat.v-old .num{color:var(--old)}.stat.v-none .num{color:var(--none)}.stat.v-subj .num{color:var(--subj)}
  /* workspace */
  .work{display:grid;grid-template-columns:1.15fr 1fr 1.15fr;gap:14px;align-items:start}
  .pane{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:16px;min-height:280px}
  .pane h3{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);margin-bottom:12px;font-weight:650}
  .doc{white-space:pre-wrap;line-height:1.9;font-size:15px}
  .doc mark{background:transparent;color:inherit;border-bottom:2px solid var(--faint);cursor:pointer;padding:1px 0;border-radius:2px}
  .doc mark:hover{background:rgba(255,255,255,.05)}
  .doc mark.sel{background:rgba(74,222,128,.1)}
  .doc mark.v-ok{border-color:var(--ok)}.doc mark.v-warn{border-color:var(--warn)}.doc mark.v-bad{border-color:var(--bad)}
  .doc mark.v-old{border-color:var(--old)}.doc mark.v-disp{border-color:var(--disp)}.doc mark.v-none{border-color:var(--none)}.doc mark.v-subj{border-color:var(--subj)}
  .verdict-badge{display:inline-block;font-weight:650;font-size:13px;padding:4px 12px;border-radius:999px;border:1px solid var(--line)}
  .verdict-badge.v-ok{color:var(--ok);border-color:rgba(74,222,128,.4)}
  .verdict-badge.v-warn{color:var(--warn);border-color:rgba(227,179,65,.4)}
  .verdict-badge.v-bad{color:var(--bad);border-color:rgba(248,113,113,.4)}
  .verdict-badge.v-old{color:var(--old);border-color:rgba(240,136,62,.4)}
  .verdict-badge.v-disp{color:var(--disp);border-color:rgba(188,140,255,.4)}
  .verdict-badge.v-none{color:var(--none)}.verdict-badge.v-subj{color:var(--subj);border-color:rgba(90,162,240,.4)}
  .kv{color:var(--dim);font-size:13px;margin:10px 0}
  .kv b{color:var(--text);font-weight:600}
  .claimtext{font-size:15px;line-height:1.5;margin:6px 0 14px}
  .conf{font-family:var(--mono);font-size:12px;color:var(--faint)}
  .ev{border:1px solid var(--line);border-radius:10px;padding:11px;margin-bottom:10px;background:var(--panel2)}
  .ev .src{font-family:var(--mono);font-size:11px;color:var(--accent)}
  .ev.against .src{color:var(--bad)}
  .ev .ex{font-size:13px;color:var(--dim);margin-top:5px}
  .ev .st{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);float:right}
  .correction{margin-top:12px;padding:10px;border:1px dashed var(--line);border-radius:8px;color:var(--warn);font-size:13px}
  /* flight log */
  .log{list-style:none;font-family:var(--mono);font-size:12.5px;line-height:1.9;max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--panel2)}
  .log li .mk{display:inline-block;width:16px;color:var(--faint)}
  .log li.ok .mk{color:var(--ok)}.log li.warn .mk{color:var(--bad)}.log li.warn{color:#f3c8c8}
  /* lineage */
  .lgroup{border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--panel);display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center}
  .lorigin{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
  .lnode{font-family:var(--mono);font-size:12px;border:1px solid var(--line);border-radius:8px;padding:5px 10px;background:var(--panel2);color:var(--dim)}
  .lnode.origin{color:var(--accent);border-color:rgba(74,222,128,.45);background:rgba(74,222,128,.07)}
  .ltag{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint)}
  .lfan{display:flex;flex-wrap:wrap;gap:8px}
  .lnote{grid-column:1/-1;color:var(--faint);font-size:12px;border-top:1px solid var(--line2);padding-top:10px}
  /* safety */
  .safe{border:1px solid rgba(248,113,113,.35);border-radius:12px;padding:14px;background:rgba(248,113,113,.05)}
  .stag{font-family:var(--mono);font-size:11px;color:var(--bad);text-transform:uppercase;letter-spacing:.06em}
  .ssrc{color:var(--faint);font-size:12px;margin:6px 0}
  .safe code{display:block;font-size:12.5px;color:var(--dim);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:4px}
  /* corrected draft */
  .draftgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
  .change{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--panel)}
  .chead{display:flex;align-items:center;gap:8px;font-size:12px}
  .ckind{font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--warn)}
  .toggle{margin-left:auto;color:var(--dim);font-size:12px;display:flex;align-items:center;gap:5px;cursor:pointer}
  .cnote{color:var(--dim);font-size:12.5px;margin:8px 0}
  .cbefore{color:var(--faint);font-size:13px}.cbefore s{color:var(--bad)}
  .cafter{color:var(--ok);font-size:13px;margin-top:4px}
  .draftout{white-space:pre-wrap;line-height:1.9;font-size:14px;border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--panel2)}
  .draftout ins{text-decoration:none;color:var(--ok);background:rgba(74,222,128,.08);border-radius:3px;padding:0 2px}
  .draftout del{color:var(--bad)}
  .note{color:var(--faint);font-size:12px;margin-top:10px}
  @media(max-width:1000px){.stats{grid-template-columns:repeat(5,1fr)}.work{grid-template-columns:1fr}.draftgrid{grid-template-columns:1fr}}
</style>

<header><div class="wrap">
  <span class="brand">SAGA<b>.</b></span>
  <span class="tagline">Trust, with receipts</span>
  <span id="status" class="status"></span>
</div></header>

<main class="wrap">
  <section>
    <h2>Trust Passport</h2>
    <div class="stats">${passportStats}</div>
    <div class="note">Last verified ${esc(p.lastVerifiedAt)}. ${result.lineage.sourceCount} sources cited, ${result.lineage.independentOrigins} independent evidence origins.</div>
  </section>

  <section>
    <h2>Audit workspace</h2>
    <div class="work">
      <div class="pane"><h3>Submitted document</h3><div id="doc" class="doc"></div></div>
      <div class="pane"><h3>Selected claim</h3><div id="claim"></div></div>
      <div class="pane"><h3>Evidence</h3><div id="evidence"></div></div>
    </div>
  </section>

  <section>
    <h2>Agent Flight Recorder</h2>
    <ul class="log">${flight}</ul>
  </section>

  <section>
    <h2>Source lineage</h2>
    ${lineage || '<div class="dim">No shared-origin clusters detected.</div>'}
  </section>

  <section>
    <h2>Safety Sentinel</h2>
    ${safety}
  </section>

  <section>
    <h2>Corrected draft (proposed, you approve)</h2>
    <div class="draftgrid">
      <div><div id="changes">${changes || '<div class="dim">No changes proposed.</div>'}</div></div>
      <div><div id="draftout" class="draftout"></div>
        <div class="note">The original is never overwritten. Uncheck a change to keep the original wording.</div></div>
    </div>
  </section>
</main>

<script id="audit" type="application/json">${data}</script>
<script>
const R = JSON.parse(document.getElementById("audit").textContent);
const VCLASS = ${JSON.stringify(VERDICT_CLASS)};

// status badge
const st = document.getElementById("status");
const good = R.passport.documentStatus === "strongly_supported" || R.passport.documentStatus === "mostly_supported";
st.textContent = ${JSON.stringify(statusLabel(p.documentStatus))};
st.classList.add(good ? "ok" : "bad");

const LABEL = ${JSON.stringify(Object.fromEntries((["supported","supported_with_qualifications","contradicted","disputed","outdated","insufficient_evidence","not_verifiable"]).map((k)=>[k, verdictLabel(k as never)])))};

// build the highlighted document
const audits = [...R.claimAudits].sort((a,b)=>a.claim.location.start-b.claim.location.start);
const doc = R.document; let html=""; let cur=0;
for(const a of audits){
  const {start,end}=a.claim.location;
  html += escapeHtml(doc.slice(cur,start));
  html += '<mark class="'+VCLASS[a.verdict.verdict]+'" data-id="'+a.claim.id+'">'+escapeHtml(doc.slice(start,end))+'</mark>';
  cur = end;
}
html += escapeHtml(doc.slice(cur));
document.getElementById("doc").innerHTML = html;

function escapeHtml(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}

function select(id){
  const a = R.claimAudits.find(x=>x.claim.id===id); if(!a) return;
  document.querySelectorAll(".doc mark").forEach(m=>m.classList.toggle("sel", m.dataset.id===id));
  const v=a.verdict;
  const cls=VCLASS[v.verdict];
  let c = '<span class="verdict-badge '+cls+'">'+LABEL[v.verdict]+'</span> <span class="conf">'+v.confidence+' confidence</span>';
  c += '<div class="claimtext">"'+escapeHtml(a.claim.originalText)+'"</div>';
  c += '<div class="kv">type <b>'+a.claim.claimType+'</b> · risk <b>'+a.claim.risk+'</b>'+(a.claim.timeSensitive?' · <b>time-sensitive</b>':'')+'</div>';
  c += '<div class="kv">'+escapeHtml(v.rationale)+'</div>';
  c += '<div class="kv">independent origins behind support: <b>'+v.independentOrigins+'</b></div>';
  if(v.temporal && v.temporal.superseded) c += '<div class="kv">temporal: <b>'+escapeHtml(v.temporal.note)+'</b></div>';
  if(v.requiredCorrection) c += '<div class="correction">Required correction: '+escapeHtml(v.requiredCorrection)+'</div>';
  document.getElementById("claim").innerHTML = c;

  const sup=a.evidence.filter(e=>e.stance==="supports");
  const against=a.evidence.filter(e=>e.stance==="contradicts"||e.stance==="qualifies");
  let ev="";
  if(!sup.length && !against.length) ev='<div class="dim">No evidence retrieved for this claim.</div>';
  for(const e of sup) ev+='<div class="ev"><span class="st">supports</span><span class="src">'+escapeHtml(e.sourceId)+'</span><div class="ex">"'+escapeHtml(e.excerpt)+'"</div></div>';
  for(const e of against) ev+='<div class="ev against"><span class="st">'+e.stance+'</span><span class="src">'+escapeHtml(e.sourceId)+'</span><div class="ex">"'+escapeHtml(e.excerpt)+'"</div></div>';
  document.getElementById("evidence").innerHTML = ev;
}
document.querySelectorAll(".doc mark").forEach(m=>m.addEventListener("click",()=>select(m.dataset.id)));
if(audits.length) select(audits[0].claim.id);

// corrected draft: rebuild from checked changes, applied at offsets
function renderDraft(){
  const active = new Map();
  document.querySelectorAll(".change").forEach(el=>{
    const i=+el.dataset.i; const on=el.querySelector(".approve").checked;
    if(on) active.set(i,R.correctedDraft.changes[i]);
  });
  // map change -> claim location
  const byClaim = new Map(R.claimAudits.map(a=>[a.claim.id,a.claim.location]));
  const applied=[...active.values()].map(c=>({c,loc:byClaim.get(c.claimId)})).filter(x=>x.loc).sort((a,b)=>b.loc.start-a.loc.start);
  let out=R.correctedDraft.original;
  const marks=[];
  for(const {c,loc} of applied){
    out = out.slice(0,loc.start)+"\\u0001"+c.replacement+"\\u0002"+out.slice(loc.end);
  }
  document.getElementById("draftout").innerHTML = escapeHtml(out).replace(/\\u0001/g,'<ins>').replace(/\\u0002/g,'</ins>');
}
document.querySelectorAll(".approve").forEach(cb=>cb.addEventListener("change",renderDraft));
renderDraft();
</script>`;
}
