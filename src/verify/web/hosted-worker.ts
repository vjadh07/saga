import type { AuditResult } from "../pipeline.js";
import { renderStudioPage } from "./page.js";

export function renderHostedDemoWorker(result: AuditResult): string {
  const html = "<!doctype html>\n" + renderStudioPage(result, {
    initialView: "demo",
    hostedDemoOnly: true,
  });

  return `const HTML=${JSON.stringify(html)};
const HTML_HEADERS={
  "cache-control":"public, max-age=300",
  "content-security-policy":"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "content-type":"text/html; charset=utf-8",
  "referrer-policy":"no-referrer",
  "x-content-type-options":"nosniff",
  "x-frame-options":"DENY"
};
export default {
  fetch(request){
    const url=new URL(request.url);
    if(request.method!=="GET"&&request.method!=="HEAD"){
      return new Response("Method not allowed",{status:405,headers:{allow:"GET, HEAD"}});
    }
    if(url.pathname==="/"||url.pathname==="/demo"){
      return new Response(request.method==="HEAD"?null:HTML,{status:200,headers:HTML_HEADERS});
    }
    if(url.pathname==="/health"){
      return new Response(request.method==="HEAD"?null:"ok",{status:200,headers:{"content-type":"text/plain; charset=utf-8"}});
    }
    return new Response("Page not found",{status:404,headers:{"content-type":"text/plain; charset=utf-8"}});
  }
};
`;
}
