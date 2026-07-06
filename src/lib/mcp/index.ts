import { auth, defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import getCurrentUserTool from "./tools/get-current-user";

// The OAuth issuer MUST be the direct Supabase host built from the project ref,
// never SUPABASE_URL (which on Lovable Cloud is a .lovable.cloud proxy that
// mcp-js's issuer verifier rejects, RFC 8414 §3.3).
const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "sokrat-ai-mcp",
  title: "Сократ AI",
  version: "0.1.0",
  instructions:
    "Tools for the Сократ AI tutoring platform. Call `get_current_user` first to confirm the signed-in user and their role. Use `echo` to verify connectivity.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [echoTool, getCurrentUserTool],
});