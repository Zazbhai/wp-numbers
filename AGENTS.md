<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- WhatsApp Web lifecycle reports come from the external Playwright monitor, not frontend polling, because browser logout must be observed directly.
- Store logout transitions and Telegram alert outcomes in `wa_sessions`; use the existing checker key for authenticated reports and never mistake network failure for logout.
- The included WhatsApp monitor and filesystem linking bridge are preview-only; lasting monitoring requires a persistent external browser host.
