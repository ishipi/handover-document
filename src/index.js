const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const page = (notes) => `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>my-tool</title>
  <style>
    body { font-family: sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
    textarea { width: 100%; box-sizing: border-box; }
    li { margin-bottom: .75rem; white-space: pre-wrap; }
    small { color: #666; display: block; }
  </style>
</head>
<body>
  <h1>my-tool</h1>
  <form method="post" action="/notes">
    <textarea name="content" rows="3" maxlength="1000" required placeholder="メモを入力"></textarea>
    <button type="submit">保存</button>
  </form>
  <h2>メモ一覧</h2>
  ${notes.length ? `<ul>${notes.map((n) => `<li>${escapeHtml(n.content)}<small>${escapeHtml(n.created_at)} (UTC)</small></li>`).join("")}</ul>` : "<p>まだメモがありません。</p>"}
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/notes" && request.method === "POST") {
      const form = await request.formData();
      const content = String(form.get("content") ?? "").trim().slice(0, 1000);
      if (content) {
        await env.DB.prepare("INSERT INTO notes (content) VALUES (?)").bind(content).run();
      }
      return Response.redirect(new URL("/", request.url).toString(), 303);
    }

    if (url.pathname === "/" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, content, created_at FROM notes ORDER BY id DESC LIMIT 100"
      ).all();
      return new Response(page(results), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
