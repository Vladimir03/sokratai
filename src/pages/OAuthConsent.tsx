import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

// Consent screen for the app's OAuth 2.1 authorization server (Supabase).
// Routed at /.lovable/oauth/consent — Supabase redirects the user here to
// approve or deny an OAuth client (e.g. an MCP client like ChatGPT/Claude).
//
// See .claude/rules docs and app-mcp-server-authoring knowledge: the
// consent URL (path + query) MUST survive the sign-in round-trip, otherwise
// the connector bounces back to `/` instead of completing the flow.

// Local typed wrapper: supabase.auth.oauth is beta and may be missing from
// the shipped types on some versions of supabase-js. We call the same
// runtime methods; do NOT hit /oauth/authorizations endpoints directly.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};
function getOAuthApi(): OAuthApi | null {
  const api = (supabase.auth as unknown as { oauth?: OAuthApi }).oauth;
  return api ?? null;
}

function safeNext(): string {
  const path = window.location.pathname + window.location.search;
  // same-origin relative path only
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const oauth = getOAuthApi();
      if (!oauth) {
        setError(
          "OAuth server client is not available in this build of supabase-js.",
        );
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Preserve full consent URL so login/signup returns the user here.
        window.location.href =
          "/login?next=" + encodeURIComponent(safeNext());
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(
        authorizationId,
      );
      if (!active) return;
      if (error) {
        setError(error.message ?? String(error));
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    const oauth = getOAuthApi();
    if (!oauth) return;
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message ?? String(error));
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <main className="max-w-md mx-auto pt-20 px-6">
        <h1 className="text-xl font-semibold mb-2">Не удалось загрузить запрос</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </main>
    );
  }
  if (!details) {
    return (
      <main className="max-w-md mx-auto pt-20 px-6">
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </main>
    );
  }

  const clientName = details.client?.name ?? "приложение";

  return (
    <main className="max-w-md mx-auto pt-20 px-6">
      <h1 className="text-2xl font-semibold mb-3">
        Подключить {clientName} к Сократ AI
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {clientName} сможет использовать Сократ AI от вашего имени: читать ваш
        профиль и вызывать доступные инструменты MCP-сервера.
      </p>
      <div className="flex gap-3">
        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
        >
          Разрешить
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="px-4 py-2 rounded-md border disabled:opacity-50"
        >
          Отклонить
        </button>
      </div>
    </main>
  );
}