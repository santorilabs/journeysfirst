// The foundation of the review page: every color, type size, space, corner
// size and control height, each set once as a variable, and how plain
// elements look. primitives.js and the page's parts read these and never
// write a value of their own.

/** The two typefaces. Without a network the page falls back to system fonts. */
export const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Onest:wght@400;500&display=swap">';

/** The maker's mark, at the left of the header bar. */
export const MARK = '<svg viewBox="0 0 127 127" role="img" aria-label="Santori Labs"><rect width="127" height="127" rx="20" fill="#141516"/><circle cx="63.5" cy="64" r="38" fill="#fff"/></svg>';

/** The variables, then plain elements. */
export const TOKENS_CSS = `:root{
--black:#141516;--white:#fff;--chalk:#f7f9f4;--gray-300:#e6e6e3;--gray-500:#a5a7a4;--gray-700:#6b6d69;--gray-800:#505352;
--red-50:#fff4f4;--red-600:#a32057;--yellow-300:#ffc83a;
--text:var(--black);--text-2:#3a3c3a;--text-3:var(--gray-700);--line:var(--gray-300);--error:var(--red-600);
--body:"Onest",system-ui,Helvetica,Arial,sans-serif;--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
--fs-xs:12px;--fs-sm:14px;--fs-md:16px;--fs-lg:18px;--fs-xl:20px;--fs-2xl:24px;--fs-3xl:30px;
--s-xs:4px;--s-sm:8px;--s-md:16px;--s-lg:24px;--s-xl:32px;--s-2xl:48px;
--r-xs:4px;--r-sm:8px;--r-md:12px;--r-full:9999px;
--control-sm:32px;--control:40px;--touch:44px;--tab:48px;--status:28px;
--tick:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 8.5l3.2 3L13 4.5'/%3E%3C/svg%3E");
--cross:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M4 4l8 8M12 4l-8 8'/%3E%3C/svg%3E");
--label:400 var(--fs-xs)/1.5 var(--mono);--label-strong:500 var(--fs-xs)/1 var(--mono)}
*{box-sizing:border-box}
body{margin:0;font:400 var(--fs-md)/1.5 var(--body);color:var(--text);background:var(--white);-webkit-font-smoothing:antialiased}
a{color:inherit}button{font:inherit;color:inherit;border:0;cursor:pointer}
h1{margin:0 0 var(--s-md);font:500 var(--fs-3xl)/1.3 var(--mono);letter-spacing:-.01em;max-width:26em;text-wrap:balance}
img{width:100%;border:1px solid var(--line);border-radius:var(--r-sm);display:block;margin-top:var(--s-sm)}
details{margin-top:var(--s-sm);font-size:var(--fs-sm)}summary{cursor:pointer;color:var(--text-3)}
pre{background:var(--chalk);border:1px solid var(--line);border-radius:var(--r-sm);padding:var(--s-sm) var(--s-md);font:var(--label);overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:var(--s-sm) 0}`;
