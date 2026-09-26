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

## ENHANCE! architecture
- Pixel algorithms live in src/lib/engine (ported from Skyelabz210/Digisl-Image-Processing-App) and run in Web Workers — keeps the UI responsive and processing local to the browser.
- Shared session state (source, outputs, ledger) lives in WorkspaceProvider in src/lib/workspace.tsx, mounted in __root — every page reads the same image.
- AI suggestions go through the suggestSettings server function (src/lib/ai.functions.ts) — keeps the AI key server-side.
