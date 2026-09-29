// Forwards the browser's API calls to the private inspection service.
//
// The service runs in a private Hugging Face Space, so every call needs a token
// that must never reach the browser. This route adds it on the server, passes
// the visitor's address for rate limiting (signed with a shared secret), and
// streams the response straight through, Server-Sent Events included.

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UPSTREAM = (process.env.API_UPSTREAM ?? "http://localhost:8000").replace(/\/$/, "");
const ALLOWED = new Set(["runs", "limits", "health", "evidence", "findings", "fixtures", "demo"]);

async function forward(request: Request, path: string[]): Promise<Response> {
  if (!path.length || !ALLOWED.has(path[0]) || path.some((part) => part === ".." || part === "")) {
    return Response.json({ detail: "Not found." }, { status: 404 });
  }
  const url = new URL(request.url);
  const target = `${UPSTREAM}/${path.map(encodeURIComponent).join("/")}${url.search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (process.env.HF_TOKEN) headers.set("authorization", `Bearer ${process.env.HF_TOKEN}`);
  if (process.env.PROXY_SECRET) {
    const visitor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "";
    headers.set("x-proxy-secret", process.env.PROXY_SECRET);
    headers.set("x-client-ip", visitor);
  }
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
      // Required by Node when streaming a request body.
      ...(request.method === "GET" ? {} : { duplex: "half" }),
      signal: request.signal,
    } as RequestInit);
    const out = new Headers();
    for (const name of ["content-type", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    if (out.get("content-type")?.startsWith("text/event-stream")) out.set("cache-control", "no-cache, no-transform");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch {
    return Response.json({ detail: "The inspection service did not answer." }, { status: 502 });
  }
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return forward(request, (await params).path);
}

export async function POST(request: Request, { params }: Context) {
  return forward(request, (await params).path);
}
