// The review page's parts: the page frame with its header bar and footer, the
// run list, a run's strip, and the sections a run can have. PAGE_CSS is every
// style on a page, in order: the foundation, the primitives, then the parts.
import { PRIMITIVES_CSS } from "./primitives.js";
import { RUN_PLAYER_CSS } from "./run-player.js";
import { SESSION_CSS } from "./session.js";
import { TOKENS_CSS } from "./tokens.js";

const PARTS_CSS = `.frame{max-width:80rem;min-height:100vh;margin:0 auto;display:flex;flex-direction:column;border-left:1px solid var(--line);border-right:1px solid var(--line)}
.bar,.foot{position:relative;display:flex}
.bar{align-items:stretch;min-height:var(--tab);border-bottom:1px solid var(--line);font-size:var(--fs-sm)}
.bar>*{display:flex;align-items:center;padding:0 var(--s-md);border-right:1px solid var(--line);color:var(--text-2);text-decoration:none;white-space:nowrap}
.bar a:hover{background:var(--chalk)}.bar [aria-current]{color:var(--text);font-weight:500}
.bar svg{width:var(--s-lg);height:var(--s-lg)}
.bar::before,.bar::after,.foot::before,.foot::after{content:"";position:absolute;width:calc(var(--s-sm) + 1px);height:calc(var(--s-sm) + 1px);background:linear-gradient(var(--gray-500),var(--gray-500)) center/100% 1px no-repeat,linear-gradient(var(--gray-500),var(--gray-500)) center/1px 100% no-repeat}
.bar::before,.bar::after{bottom:calc(var(--s-xs)*-1 - 1px)}.foot::before,.foot::after{top:calc(var(--s-xs)*-1 - 1px)}
.bar::before,.foot::before{left:calc(var(--s-xs)*-1 - 1px)}.bar::after,.foot::after{right:calc(var(--s-xs)*-1 - 1px)}
main{flex:1;min-width:0;padding:var(--s-xl) var(--s-xl) var(--s-2xl)}
.foot{justify-content:space-between;flex-wrap:wrap;gap:var(--s-md);padding:var(--s-md) var(--s-xl);border-top:1px solid var(--line);font:var(--label);letter-spacing:.01em;color:var(--text-3)}
.rows{margin:var(--s-lg) calc(var(--s-xl)*-1) 0;border-bottom:1px solid var(--line)}
.day{padding:var(--s-sm) var(--s-xl);background:var(--chalk);border-top:1px solid var(--line);font:var(--label);letter-spacing:.01em;color:var(--text-3)}
.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s-xs) var(--s-lg);padding:var(--s-md) var(--s-xl);border-top:1px solid var(--line);text-decoration:none}
.row>*{grid-column:1}.row .title{font-weight:500;display:flex;align-items:center;gap:var(--s-sm);flex-wrap:wrap}.row .summary{font-size:var(--fs-sm);color:var(--text-2)}
.row .row-meta{grid-column:2;grid-row:1/span 3;display:flex;flex-direction:column;align-items:flex-end;font:var(--label);letter-spacing:.01em}
a.row:hover{background:var(--chalk)}
.runs{display:flex;flex-wrap:wrap;gap:var(--s-xs) var(--s-md);font-size:var(--fs-sm)}.runs a{text-decoration:none}
.verdict-row{display:flex;gap:var(--s-sm);align-items:center;flex-wrap:wrap;margin:0 0 var(--s-sm)}.summary{font-weight:500}
.facts{font:var(--label);letter-spacing:.01em;color:var(--text-3)}
/* A run fits one screen: the strip, then the player. Only the player's side panel scrolls. */
.fit .frame{height:100vh;min-height:40rem}.fit main{display:flex;flex-direction:column;min-height:0;padding:0}
.strip{flex:none;padding:var(--s-md) var(--s-xl)}.strip h1{margin:0;font-size:var(--fs-2xl);line-height:1.4;max-width:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fit .problems{flex:none;max-height:9rem;overflow-y:auto;margin:0 var(--s-xl) var(--s-md)}.fit .foot{padding-top:var(--s-sm);padding-bottom:var(--s-sm)}
.problems{border:1px solid var(--error);border-radius:var(--r-sm);padding:var(--s-xs) var(--s-md);margin:var(--s-md) 0;font-size:var(--fs-sm)}.problems ul{padding-left:var(--s-lg)}
.transcript pre{max-height:24rem;overflow:auto}
.evidence{list-style:none;padding:0;margin:var(--s-sm) 0}.evidence li{padding:var(--s-sm) 0;border-top:1px solid var(--line)}
.evidence dd dl{margin:0}.evidence ul.evidence-values{margin:0;padding-left:var(--s-md)}.evidence-values li{padding:0;border:0}
.run-details{margin:0}.panel>.start:first-child{border-top:0}
.start{border-top:1px solid var(--line);padding:var(--s-sm) 0}.start ul{margin:var(--s-xs) 0;padding-left:var(--s-lg)}
.start h2{font:500 var(--fs-lg)/1.4 var(--body);margin:var(--s-xs) 0}.found{font-weight:400}
.start .findings{list-style:none;padding:0;margin:var(--s-xs) 0 var(--s-sm)}.findings li{padding:var(--s-sm) 0;border-top:1px solid var(--line)}.findings li:first-child{border-top:0}
.reported{border-top:1px solid var(--line);margin-top:var(--s-md);padding-top:var(--s-xs)}.reported-user{padding:var(--s-xs) 0}.reported-user p{margin:var(--s-xs) 0}.reported code{font:var(--label);word-break:break-all}
.findings p{margin:var(--s-xs) 0}.findings .says{font-weight:500}.findings a{color:var(--text-3)}
/* The compare pages. A screen has the full width. With the switch on, main's and the change's sit in one box, as tall as the taller, and one shows. Both is the 2 columns the clicks use. */
.cmp-strip{padding-left:0;padding-right:0}.cmp-strip.stale{opacity:.55}.cmp-callout{border-color:var(--line)}.cmp-note{margin:var(--s-md) 0}.day a{text-decoration:none}
.cmp-step{border-top:1px solid var(--line);padding:var(--s-lg) 0}.cmp-step h2{font:500 var(--fs-lg)/1.4 var(--body);margin:var(--s-xs) 0 var(--s-md)}
.cmp-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-md)}.cmp-side{min-width:0}
.cmp-actions{margin:var(--s-xs) 0;padding-left:var(--s-lg);font:var(--label);line-height:1.75;overflow-wrap:anywhere}
.cmp-flip{margin-top:var(--s-md)}.cmp-flip:not(.on) .tabs{display:none}.cmp-flip .tabs{padding:0}.cmp-frame figure{margin:0 0 var(--s-md)}
.cmp-flip.on .cmp-frame{display:grid}.cmp-flip.on figure{margin:0}.cmp-flip.on:not(.both) figure{grid-area:1/1;visibility:hidden}.cmp-flip.on:not(.both) figure.shown{visibility:visible}.cmp-flip.on:not(.both) figcaption{display:none}
.cmp-all{display:flex;align-items:center;gap:var(--s-lg);margin-top:var(--s-md)}.cmp-all:not(.on){display:none}.cmp-all .tabs{flex:1;padding:0}
@media(max-width:54em){.cmp-cols{grid-template-columns:minmax(0,1fr)}}
.cmp-step .findings{list-style:none;padding:0;margin:var(--s-md) 0 0}
/* A window no wider than the frame has no room for its side rules or corner marks. */
@media(max-width:81rem){.frame{border-left:0;border-right:0}.bar::before,.bar::after,.foot::before,.foot::after{display:none}}
@media(max-width:54em){
  main{padding:var(--s-lg) var(--s-md) var(--s-xl)}.foot{padding:var(--s-md)}
  .fit .frame{height:auto}.strip{padding:var(--s-md)}.strip h1{-webkit-line-clamp:unset}.fit .problems{margin:0 var(--s-md) var(--s-md)}
  .bar>span:not([aria-current]):not(.logo){display:none}
  .rows{margin-left:calc(var(--s-md)*-1);margin-right:calc(var(--s-md)*-1)}.day,.row{padding-left:var(--s-md);padding-right:var(--s-md)}
  .row{grid-template-columns:minmax(0,1fr)}.row .row-meta{grid-column:1;grid-row:auto;flex-direction:row;flex-wrap:wrap;gap:var(--s-xs) var(--s-md)}
  h1{font-size:var(--fs-2xl)}
  .evidence dl,.run-details dl{grid-template-columns:minmax(0,1fr);gap:var(--s-xs)}
  .evidence dt,.run-details dt{overflow-wrap:anywhere}
  .evidence dd+dt,.run-details dd+dt{margin-top:var(--s-sm)}
  .evidence dd dl{border-left:1px solid var(--line);padding-left:var(--s-sm)}
}`;

/** Every style on a review page. */
export const PAGE_CSS = `${TOKENS_CSS}\n${PRIMITIVES_CSS}\n${PARTS_CSS}\n${RUN_PLAYER_CSS}\n${SESSION_CSS}`;
