// The review page's look: the page frame, the header bar, the run list and
// the text styles. Colors, type sizes, spaces, corner sizes and control
// heights are each set once, as a variable at the top. Every rule below reads
// them, so a value is never written twice.
import { RUN_PLAYER_CSS } from "./run-player.js";

/** The two typefaces. Without a network the page falls back to system fonts. */
export const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Onest:wght@400;500&display=swap">';

/** The maker's mark, at the left of the header bar. */
export const MARK = '<svg viewBox="0 0 127 127" role="img" aria-label="Santori Labs"><rect width="127" height="127" rx="20" fill="#141516"/><circle cx="63.5" cy="64" r="38" fill="#fff"/></svg>';

/** Every style on a review page. */
export const PAGE_CSS = `:root{
--black:#141516;--white:#fff;--chalk:#f7f9f4;--gray-300:#e6e6e3;--gray-500:#a5a7a4;--gray-700:#6b6d69;--gray-800:#505352;
--red-50:#fff4f4;--red-600:#a32057;--yellow-300:#ffc83a;
--text:var(--black);--text-2:#3a3c3a;--text-3:var(--gray-700);--line:var(--gray-300);--error:var(--red-600);
--body:"Onest",system-ui,Helvetica,Arial,sans-serif;--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
--fs-xs:12px;--fs-sm:14px;--fs-md:16px;--fs-lg:18px;--fs-xl:20px;--fs-2xl:24px;--fs-3xl:30px;
--s-xs:4px;--s-sm:8px;--s-md:16px;--s-lg:24px;--s-xl:32px;--s-2xl:48px;
--r-xs:4px;--r-sm:8px;--r-md:12px;--r-full:9999px;
--control-sm:32px;--control:40px;--touch:44px;--tab:48px;--status:28px}
*{box-sizing:border-box}
body{margin:0;font:400 var(--fs-md)/1.5 var(--body);color:var(--text);background:var(--white);-webkit-font-smoothing:antialiased}
a{color:inherit}button{font:inherit;color:inherit;border:0;cursor:pointer}
.frame{max-width:80rem;min-height:100vh;margin:0 auto;display:flex;flex-direction:column;border-left:1px solid var(--line);border-right:1px solid var(--line)}
.bar,.foot{position:relative;display:flex}
.bar{align-items:stretch;min-height:var(--tab);border-bottom:1px solid var(--line);font-size:var(--fs-sm)}
.bar>*{display:flex;align-items:center;padding:0 var(--s-md);border-right:1px solid var(--line);color:var(--text-2);text-decoration:none;white-space:nowrap}
.bar a:hover{background:var(--chalk)}.bar [aria-current]{color:var(--text);font-weight:500}
.bar svg{width:var(--s-lg);height:var(--s-lg)}
.bar::before,.bar::after,.foot::before,.foot::after{content:"";position:absolute;width:calc(var(--s-sm) + 1px);height:calc(var(--s-sm) + 1px);background:linear-gradient(var(--gray-500),var(--gray-500)) center/100% 1px no-repeat,linear-gradient(var(--gray-500),var(--gray-500)) center/1px 100% no-repeat}
.bar::before,.bar::after{bottom:calc(var(--s-xs)*-1 - 1px)}.foot::before,.foot::after{top:calc(var(--s-xs)*-1 - 1px)}
.bar::before,.foot::before{left:calc(var(--s-xs)*-1 - 1px)}.bar::after,.foot::after{right:calc(var(--s-xs)*-1 - 1px)}
main{flex:1;min-width:0;padding:var(--s-xl) var(--s-xl) var(--s-2xl)}
.foot{justify-content:space-between;flex-wrap:wrap;gap:var(--s-md);padding:var(--s-md) var(--s-xl);border-top:1px solid var(--line);font:400 var(--fs-xs)/1.5 var(--mono);letter-spacing:.01em;color:var(--text-3)}
h1{margin:0 0 var(--s-md);font:500 var(--fs-3xl)/1.3 var(--mono);letter-spacing:-.01em;max-width:26em;text-wrap:balance}
.meta,.how,.empty{color:var(--text-3);font-size:var(--fs-sm)}
.rows{margin:var(--s-lg) calc(var(--s-xl)*-1) 0;border-bottom:1px solid var(--line)}
.day{padding:var(--s-sm) var(--s-xl);background:var(--chalk);border-top:1px solid var(--line);font:400 var(--fs-xs)/1.5 var(--mono);letter-spacing:.01em;color:var(--text-3)}
.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s-xs) var(--s-lg);padding:var(--s-md) var(--s-xl);border-top:1px solid var(--line);text-decoration:none}
.row>*{grid-column:1}.row .title{font-weight:500}.row .summary{font-size:var(--fs-sm);color:var(--text-2)}
.row .row-meta{grid-column:2;grid-row:1/span 3;display:flex;flex-direction:column;align-items:flex-end;font:400 var(--fs-xs)/1.5 var(--mono);letter-spacing:.01em}
a.row:hover{background:var(--chalk)}
.runs{display:flex;flex-wrap:wrap;gap:var(--s-xs) var(--s-md);font-size:var(--fs-sm)}.runs a{text-decoration:none}
.verdict{display:inline-flex;align-items:center;height:var(--s-lg);padding:0 var(--s-sm);border-radius:var(--r-xs);vertical-align:middle;white-space:nowrap;font:500 var(--fs-xs)/1 var(--mono);letter-spacing:.01em;color:var(--text-2);background:var(--chalk)}
.verdict.passed,.verdict.done{color:var(--text);background:none;box-shadow:inset 0 0 0 1px var(--line)}.verdict.failed{color:var(--white);background:var(--error)}
img{width:100%;border:1px solid var(--line);border-radius:var(--r-sm);display:block;margin-top:var(--s-sm)}
${RUN_PLAYER_CSS}
.error{color:var(--error);font-size:var(--fs-sm)}
.verdict-row{display:flex;gap:var(--s-sm);align-items:center;flex-wrap:wrap;margin:0 0 var(--s-md)}.summary{font-weight:500}
.problems{border:1px solid var(--error);border-radius:var(--r-sm);padding:var(--s-xs) var(--s-md);margin:var(--s-md) 0;font-size:var(--fs-sm)}.problems ul{padding-left:var(--s-lg)}
details{margin-top:var(--s-sm);font-size:var(--fs-sm)}summary{cursor:pointer;color:var(--text-3)}
pre{background:var(--chalk);border:1px solid var(--line);border-radius:var(--r-sm);padding:var(--s-sm) var(--s-md);font:400 var(--fs-xs)/1.5 var(--mono);overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:var(--s-sm) 0}
.transcript pre{max-height:24rem;overflow:auto}
.evidence{list-style:none;padding:0;margin:var(--s-sm) 0}.evidence li{padding:var(--s-sm) 0;border-top:1px solid var(--line)}
.evidence dl,.run-details dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--s-xs) var(--s-md);margin:var(--s-sm) 0}
.evidence dt,.run-details dt{color:var(--text-3)}.evidence dd,.run-details dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
.evidence dd dl{margin:0}.evidence ul.evidence-values{margin:0;padding-left:var(--s-md)}.evidence-values li{padding:0;border:0}
.run-details{border-top:1px solid var(--line);margin-top:var(--s-lg);padding-top:var(--s-sm)}.run-details dl{max-width:40rem}
.start{border-top:1px solid var(--line);padding:var(--s-sm) 0}.start ul{margin:var(--s-xs) 0;padding-left:var(--s-lg)}
.start h2{font:500 var(--fs-lg)/1.4 var(--body);margin:var(--s-xs) 0}.found{font-weight:400}
.start .findings{list-style:none;padding:0;margin:var(--s-xs) 0 var(--s-sm)}.findings li{padding:var(--s-sm) 0;border-top:1px solid var(--line)}.findings li:first-child{border-top:0}
.reported{border-top:1px solid var(--line);margin-top:var(--s-md);padding-top:var(--s-xs)}.reported-user{padding:var(--s-xs) 0}.reported-user p{margin:var(--s-xs) 0}.reported code{font:400 var(--fs-xs)/1.5 var(--mono);word-break:break-all}
.findings p{margin:var(--s-xs) 0}.findings .says{font-weight:500}.findings a{color:var(--text-3)}
/* A window no wider than the frame has no room for its side rules or corner marks. */
@media(max-width:81rem){.frame{border-left:0;border-right:0}.bar::before,.bar::after,.foot::before,.foot::after{display:none}}
@media(max-width:54em){
  main{padding:var(--s-lg) var(--s-md) var(--s-xl)}.foot{padding:var(--s-md)}
  .bar>span:not([aria-current]):not(.logo){display:none}
  .rows{margin-left:calc(var(--s-md)*-1);margin-right:calc(var(--s-md)*-1)}.day,.row{padding-left:var(--s-md);padding-right:var(--s-md)}
  .row{grid-template-columns:minmax(0,1fr)}.row .row-meta{grid-column:1;grid-row:auto;flex-direction:row;flex-wrap:wrap;gap:var(--s-xs) var(--s-md)}
  h1{font-size:var(--fs-2xl)}
  .evidence dl,.run-details dl{grid-template-columns:minmax(0,1fr);gap:var(--s-xs)}
  .evidence dt,.run-details dt{overflow-wrap:anywhere}
  .evidence dd+dt,.run-details dd+dt{margin-top:var(--s-sm)}
  .evidence dd dl{border-left:1px solid var(--line);padding-left:var(--s-sm)}
}`;
