const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>my-tool</title>
</head>
<body>
  <h1>my-tool</h1>
</body>
</html>`;

export default {
  async fetch() {
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
